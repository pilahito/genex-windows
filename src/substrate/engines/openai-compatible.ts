/**
 * Genex Windows Community: one engine for any OpenAI-compatible chat-completions server.
 *
 * Local servers (Jan, LM Studio, llama.cpp's llama-server, vLLM, Ollama's /v1) and hosted APIs
 * (OpenRouter, DeepSeek, or any other) speak the same `/v1/chat/completions` + `/v1/models`
 * dialect, so this engine is the OpenRouter engine with a configurable base URL, an optional key
 * and an optional fixed model list. It runs on the same pi-ai path (`pi-completions.ts`): the
 * studio's own turn loop drives the model and runs the tools itself (OpenAI `tools` /
 * `tool_calls`), and a game chat or a build runs as a Genex session (`LocalSessions`).
 *
 * Configured from `community.json` in userData or the GENEX_OPENAI_* environment variables
 * (`src/main/community.ts`).
 */
import path from "node:path";
import {
  type CompleteRequest,
  type CompleteResponse,
  type DelegateRequest,
  type DelegateResult,
  type Engine,
  EngineError,
  type EngineModel,
  type EngineStatus,
  ModelContextSource,
  classifyHttpFailure,
} from "./types.ts";
import {
  drainPiStream,
  fromPiAssistant,
  isCutConnection,
  longHaulFetch,
  needsVision,
  type PiAssistant,
  piContext,
  type PiStreamFn,
  streamHttpStatus,
} from "./pi-completions.ts";
import { CATALOG_DEADLINE_MS, CatalogError, ModelCatalog } from "./model-catalog.ts";
import { LocalSessions } from "./local-session.ts";
import { CompletionStop, STOPPED_BY_USER } from "./common.ts";
import { HOUR_MS, SECOND_MS } from "../../shared/duration.ts";
import { EngineKind, EngineStatusCode } from "../../shared/engine-descriptor.ts";
import { EngineFailureKind } from "../../shared/engine-requests.ts";
import { ModelCatalogProblemCode, ModelCatalogSource } from "../../shared/model-catalog.ts";
import { ReasoningEffort } from "../../shared/model-preferences.ts";
import { EngineId } from "../../shared/providers.ts";
import { errorMessage } from "../../shared/errors.ts";
import { redactSecrets } from "../../shared/redact.ts";

/** A known server: its name, base URL and whether it needs a key. */
export interface OpenAICompatiblePreset {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly needsKey: boolean;
  /** Runs on this computer: free, so the app may choose it on its own. */
  readonly local: boolean;
}

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAICompatiblePreset[] = [
  { id: "jan", label: "Jan", baseUrl: "http://127.0.0.1:1337/v1", needsKey: false, local: true },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", needsKey: false, local: true },
  { id: "llamacpp", label: "llama.cpp server", baseUrl: "http://127.0.0.1:8080/v1", needsKey: false, local: true },
  { id: "vllm", label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", needsKey: false, local: true },
  { id: "ollama", label: "Ollama (OpenAI API)", baseUrl: "http://127.0.0.1:11434/v1", needsKey: false, local: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, local: false },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", needsKey: true, local: false },
  { id: "openai", label: "OpenAI API", baseUrl: "https://api.openai.com/v1", needsKey: true, local: false },
  // Genex Windows Community: Gemini's OpenAI-compatible endpoint (API key from Google AI Studio).
  {
    id: "gemini",
    label: "Google Gemini (API key)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    local: false,
  },
  { id: "xai", label: "xAI Grok (API key)", baseUrl: "https://api.x.ai/v1", needsKey: true, local: false },
];

export interface OpenAICompatibleConfig {
  /** A preset id (`jan`, `lmstudio`, ...); `custom` or unknown uses `baseUrl` alone. */
  preset: string;
  /** Overrides the preset's URL. Ends in `/v1` for most servers. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`; local servers usually need none (Jan may, if set in Jan). */
  apiKey: string;
  /** Fixed model ids; empty means read `/models`. */
  models: string[];
  /** The model the app uses when none was picked; the first listed when unset. */
  defaultModel: string;
  /** Context window assumed for every model (servers rarely report it). */
  contextWindow: number;
  /** Label shown in the model picker. */
  label: string;
  /** Whether the models can see images. */
  vision: boolean;
}

const STATUS_FRESH_MS = 30 * SECOND_MS;
const CHECK_TIMEOUT_MS = 8 * SECOND_MS;
export const COMPLETION_TIMEOUT_MS = HOUR_MS;
const DEFAULT_CONTEXT_TOKENS = 32_768;
const MAX_REPLY_TOKENS = 16_384;
const EFFORTS = [ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High] as const;
/** Ids that are clearly not chat models (embeddings, rerankers, speech). */
const NOT_CHAT = /(embed|rerank|whisper|tts|bge-|e5-|clip)/i;

/** The config with the preset's URL filled in. */
export function resolveOpenAICompatible(config: Partial<OpenAICompatibleConfig>): {
  preset: OpenAICompatiblePreset | null;
  baseUrl: string;
  label: string;
  local: boolean;
} {
  const preset = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === (config.preset ?? "jan").toLowerCase()) ?? null;
  const baseUrl = (config.baseUrl || preset?.baseUrl || OPENAI_COMPATIBLE_PRESETS[0].baseUrl).replace(/\/+$/, "");
  const local = preset ? preset.local && !config.baseUrl : /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(baseUrl);
  const label = config.label || (preset ? `${preset.label} (OpenAI-compatible)` : "OpenAI-compatible");
  return { preset, baseUrl, label, local: local || /\/\/(127\.0\.0\.1|localhost)[:/]/.test(baseUrl) };
}

/** One model row from an id and what the server said about it. */
export function openAICompatibleModel(
  id: string,
  entry: Record<string, unknown>,
  config: Partial<OpenAICompatibleConfig>,
): EngineModel {
  const reported = [entry.context_length, entry.max_model_len, entry.context_window, entry.ctx_len].find(
    (v): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0,
  );
  const contextWindow =
    config.contextWindow && config.contextWindow > 0 ? config.contextWindow : (reported ?? DEFAULT_CONTEXT_TOKENS);
  const thinking = /(r1|qwq|thinking|reason|qwen3(?!-coder))/i.test(id);
  return {
    id,
    label: typeof entry.name === "string" && entry.name ? entry.name : id,
    contextWindow,
    contextSource: config.contextWindow || reported ? ModelContextSource.Catalog : ModelContextSource.Unknown,
    maxTokens: Math.min(MAX_REPLY_TOKENS, Math.floor(contextWindow / 4)),
    supportsTools: true,
    supportsVision: Boolean(config.vision),
    supportsThinking: thinking,
    ...(thinking ? { efforts: [...EFFORTS], defaultEffort: ReasoningEffort.Low } : {}),
  };
}

/** The chat models of a `/models` response (OpenAI's `{ data: [...] }`, or a bare array). */
export function openAICompatibleModels(body: unknown, config: Partial<OpenAICompatibleConfig>): EngineModel[] {
  const data = Array.isArray(body) ? body : (body as { data?: unknown; models?: unknown } | null)?.data;
  if (!Array.isArray(data))
    throw new CatalogError(ModelCatalogProblemCode.Malformed, "The server's model list could not be read.");
  const rows: EngineModel[] = [];
  for (const raw of data) {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    let id = typeof raw === "string" ? raw : "";
    if (typeof entry.id === "string") id = entry.id;
    if (!id || NOT_CHAT.test(id)) continue;
    rows.push(openAICompatibleModel(id, entry, config));
  }
  return rows;
}

export interface OpenAICompatibleEngineOptions {
  root: string;
  scratchRoot?: string;
  protectedPaths?: string[];
  toolPath?: () => Promise<string>;
  config: Partial<OpenAICompatibleConfig>;
  onModelsChanged?: () => void;
  now?: () => number;
  timeoutMs?: number;
}

export class OpenAICompatibleEngine implements Engine {
  readonly id = EngineId.OpenAICompatible;
  readonly label: string;
  readonly kind = EngineKind.Direct;
  readonly supportsSessions = true;
  readonly sessions: LocalSessions;
  readonly baseUrl: string;
  readonly local: boolean;
  /** A paid API (OpenRouter, DeepSeek, OpenAI, a remote URL): never picked automatically as a free fallback. */
  readonly metered: boolean;
  readonly #config: Partial<OpenAICompatibleConfig>;
  readonly #catalog: ModelCatalog;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #status: { at: number; value: EngineStatus } | null = null;
  #models: unknown = null;

  constructor(options: OpenAICompatibleEngineOptions) {
    const resolved = resolveOpenAICompatible(options.config);
    this.baseUrl = resolved.baseUrl;
    this.label = resolved.label;
    this.local = resolved.local;
    this.metered = !resolved.local;
    this.#config = options.config;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? COMPLETION_TIMEOUT_MS;
    this.#catalog = new ModelCatalog(options.onModelsChanged, this.#now);
    this.sessions = new LocalSessions({
      engine: EngineId.OpenAICompatible,
      root: path.join(options.root, "sessions"),
      scratchRoot: options.scratchRoot,
      protectedPaths: options.protectedPaths ?? [options.root],
      complete: (r) => this.complete(r),
      contextWindow: (model) => this.#row(model)?.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      toolPath: options.toolPath,
    });
  }

  #headers(): Record<string, string> {
    const key = this.#config.apiKey?.trim();
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async status(): Promise<EngineStatus> {
    const cached = this.#status;
    if (cached && this.#now() - cached.at < STATUS_FRESH_MS) return cached.value;
    const value = await this.#readStatus();
    this.#status = { at: this.#now(), value };
    return value;
  }

  async #readStatus(): Promise<EngineStatus> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    } catch (err) {
      return {
        code: EngineStatusCode.Error,
        detail: `${this.label} could not be reached at ${this.baseUrl} (${errorMessage(err)}).`,
        remedy: this.local
          ? "Start the local server (in Jan: Settings › Local API Server › Start server) and try again."
          : "Check the base URL in community.json.",
      };
    }
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      return {
        code: EngineStatusCode.NeedsLogin,
        detail: `${this.label} refused the API key.`,
        remedy: "Set apiKey in community.json (or GENEX_OPENAI_API_KEY).",
      };
    if (!response.ok)
      return { code: EngineStatusCode.Error, detail: `${this.label} answered HTTP ${response.status}.` };
    return { code: EngineStatusCode.Ready, detail: `${this.label} at ${this.baseUrl}` };
  }

  catalogSnapshot = () => this.#catalog.snapshot();

  async models(): Promise<EngineModel[]> {
    void this.refreshModels().catch(() => {});
    return this.#catalog.models();
  }

  async refreshModels(force = false): Promise<void> {
    if (force) this.#status = null;
    await this.#catalog.refresh(this.baseUrl, () => this.#readCatalog(), force);
  }

  async #readCatalog(): Promise<{ models: EngineModel[]; source: typeof ModelCatalogSource.Provider }> {
    const fixed = (this.#config.models ?? []).filter(Boolean);
    if (fixed.length)
      return {
        models: fixed.map((id) => openAICompatibleModel(id, {}, this.#config)),
        source: ModelCatalogSource.Provider,
      };
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.#headers(),
      signal: AbortSignal.timeout(CATALOG_DEADLINE_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new CatalogError(ModelCatalogProblemCode.Provider, `The model list failed (HTTP ${response.status}).`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CatalogError(ModelCatalogProblemCode.Malformed, "The server's model list could not be read.");
    }
    return { models: openAICompatibleModels(body, this.#config), source: ModelCatalogSource.Provider };
  }

  /** A local server's first model (it is free); a hosted API waits for the person's pick. */
  async defaultModel(): Promise<string | null> {
    if (this.#config.defaultModel) return this.#config.defaultModel;
    if (!this.local) return null;
    if (!this.#catalog.models().length) await this.refreshModels(true).catch(() => {});
    return this.#catalog.models()[0]?.id ?? null;
  }

  #row(model: string): EngineModel | undefined {
    return this.#catalog.models().find((row) => row.id === model);
  }

  /** A model the server did not list is still tried: many servers list only the loaded one. */
  async #knownRow(model: string): Promise<EngineModel> {
    if (!this.#row(model)) await this.refreshModels(true).catch(() => {});
    return this.#row(model) ?? openAICompatibleModel(model, {}, this.#config);
  }

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    const model = request.model ?? (await this.defaultModel());
    if (!model) throw new EngineError(EngineFailureKind.Unavailable, this.id, `Pick a ${this.label} model.`);
    return this.sessions.run(request, model);
  }

  async complete(request: CompleteRequest): Promise<CompleteResponse> {
    const modelId = request.model ?? (await this.defaultModel());
    if (!modelId) throw new EngineError(EngineFailureKind.Unavailable, this.id, `Pick a ${this.label} model.`);
    const row = await this.#knownRow(modelId);
    if (needsVision(request) && !row.supportsVision)
      throw new EngineError(
        EngineFailureKind.Unavailable,
        this.id,
        'this model is not marked as able to see images (set "vision": true in community.json)',
      );
    const maxTokens = Math.min(request.maxTokens ?? row.maxTokens, row.maxTokens);
    const { models, model } = await this.#provider(row);
    try {
      const stream = (models as { stream: PiStreamFn }).stream(model, piContext(request, this.id), {
        fetch: longHaulFetch(request.signal),
        timeoutMs: Math.min(request.timeoutMs ?? this.#timeoutMs, this.#timeoutMs),
        maxTokens,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      await drainPiStream(stream, request, this.id);
      const assistant = (await stream.result()) as PiAssistant;
      if (assistant.stopReason === CompletionStop.Aborted)
        throw new EngineError(EngineFailureKind.Aborted, this.id, STOPPED_BY_USER);
      if (assistant.stopReason === CompletionStop.Error)
        throw this.#streamFailure(assistant.errorMessage ?? "model stream failed");
      const { message, usage } = fromPiAssistant(assistant, this.id);
      return {
        message,
        usage,
        stopReason: assistant.stopReason ?? CompletionStop.Stop,
        model: modelId,
        engine: this.id,
      };
    } catch (err) {
      throw this.#failure(err, request);
    }
  }

  async #provider(row: EngineModel): Promise<{ models: unknown; model: unknown }> {
    const { createModels, createProvider } = await import("@earendil-works/pi-ai");
    const { openAICompletionsApi } = await import("@earendil-works/pi-ai/api/openai-completions.lazy");
    if (!this.#models) this.#models = createModels();
    const model = this.#piModel(row);
    const key = this.#config.apiKey?.trim() || "local-no-key";
    (this.#models as { setProvider: (p: unknown) => void }).setProvider(
      createProvider({
        id: this.id,
        name: this.label,
        baseUrl: this.baseUrl,
        auth: {
          apiKey: {
            name: `${this.label} key`,
            resolve: async () => ({ auth: { apiKey: key }, source: "community.json" }),
          },
        } as never,
        models: [model] as never,
        api: openAICompletionsApi(),
      }) as never,
    );
    return { models: this.#models, model };
  }

  /** Conservative dialect: no `developer` role, no `store`, `max_tokens` — what local servers accept. */
  #piModel(row: EngineModel): Record<string, unknown> {
    return {
      id: row.id,
      name: row.label,
      api: "openai-completions",
      provider: this.id,
      baseUrl: this.baseUrl,
      reasoning: false,
      supportsTools: true,
      input: row.supportsVision ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: row.contextWindow,
      maxTokens: row.maxTokens,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsStore: false,
        maxTokensField: "max_tokens",
      },
    };
  }

  #streamFailure(said: string): EngineError {
    const message = redactSecrets(said);
    const status = streamHttpStatus(message);
    if (status !== null) return classifyHttpFailure(this.id, status, message);
    if (isCutConnection(message))
      return new EngineError(
        EngineFailureKind.Unavailable,
        this.id,
        `the connection to ${this.label} was cut mid-reply`,
      );
    return new EngineError(EngineFailureKind.Other, this.id, message);
  }

  #failure(err: unknown, request: CompleteRequest): EngineError {
    if (err instanceof EngineError) return err;
    if (request.signal?.aborted) return new EngineError(EngineFailureKind.Aborted, this.id, STOPPED_BY_USER);
    const error = err as Error & { status?: number };
    if (error.status) return classifyHttpFailure(this.id, error.status, redactSecrets(error.message));
    return this.#streamFailure(error.message);
  }
}
