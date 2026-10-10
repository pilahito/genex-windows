/**
 * Genex Windows Community (unofficial fork): launch-time switches that the official build does not
 * have. Everything here is read once at launch from the environment and from `community.json` in
 * the app's userData folder, so a person can change it without a UI:
 *
 *   {
 *     "sandbox": true,                       // false = run agents without the process sandbox
 *     "aclTimeoutMs": 300000,                // srt-win ACL step timeout
 *     "sandboxSkipDirs": ["C:\\big\\dir"],   // PATH folders never granted to the sandbox user
 *     "openaiCompatible": { "preset": "jan", "baseUrl": "...", "apiKey": "...", "models": ["..."] }
 *   }
 *
 * Environment variables win over the file: GENEX_SANDBOX=off, GENEX_SANDBOX_ACL_TIMEOUT_MS,
 * GENEX_SANDBOX_SKIP_DIRS, GENEX_OPENAI_PRESET, GENEX_OPENAI_BASE_URL, GENEX_OPENAI_API_KEY,
 * GENEX_OPENAI_MODELS (comma separated).
 */
import { BrowserWindow } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OpenAICompatibleConfig } from "../substrate/engines/openai-compatible.ts";

/** The fork's name, everywhere a person reads it. */
export const COMMUNITY_PRODUCT_NAME = "Genex Windows Community";

export interface CommunitySettings {
  sandbox: boolean;
  aclTimeoutMs: number | null;
  sandboxSkipDirs: string[];
  openaiCompatible: Partial<OpenAICompatibleConfig>;
}

const OFF = new Set(["off", "0", "false", "no", "disabled"]);

/** The file beside the app's own data; written with the defaults on first launch so it is easy to find. */
export function communitySettingsPath(userData: string): string {
  return path.join(userData, "community.json");
}

export function readCommunitySettings(userData: string, env: NodeJS.ProcessEnv = process.env): CommunitySettings {
  const file = communitySettingsPath(userData);
  let saved: Record<string, unknown> = {};
  try {
    if (existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    else
      writeFileSync(
        file,
        `${JSON.stringify({ sandbox: true, aclTimeoutMs: 300000, sandboxSkipDirs: [], openaiCompatible: { preset: "jan" } }, null, 2)}\n`,
      );
  } catch (err) {
    console.error(`[community] ${file} could not be read: ${(err as Error).message}`);
  }
  const envSandbox = env.GENEX_SANDBOX?.trim().toLowerCase();
  const sandbox = envSandbox ? !OFF.has(envSandbox) : saved.sandbox !== false;
  const timeout = Number(env.GENEX_SANDBOX_ACL_TIMEOUT_MS ?? saved.aclTimeoutMs);
  const skip = Array.isArray(saved.sandboxSkipDirs)
    ? saved.sandboxSkipDirs.filter((d): d is string => typeof d === "string")
    : [];
  const openai = (
    saved.openaiCompatible && typeof saved.openaiCompatible === "object" ? saved.openaiCompatible : {}
  ) as Partial<OpenAICompatibleConfig>;
  const models = env.GENEX_OPENAI_MODELS?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    sandbox,
    aclTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : null,
    sandboxSkipDirs: skip,
    openaiCompatible: {
      ...openai,
      ...(env.GENEX_OPENAI_PRESET ? { preset: env.GENEX_OPENAI_PRESET } : {}),
      ...(env.GENEX_OPENAI_BASE_URL ? { baseUrl: env.GENEX_OPENAI_BASE_URL } : {}),
      ...(env.GENEX_OPENAI_API_KEY ? { apiKey: env.GENEX_OPENAI_API_KEY } : {}),
      ...(models?.length ? { models } : {}),
    },
  };
}

/**
 * Hand the sandbox settings to sandbox-runtime (patched to read GENEX_SANDBOX_ACL_TIMEOUT_MS) and
 * to `grantableToolDirs` (GENEX_SANDBOX_SKIP_DIRS), which both read the environment.
 */
export function applySandboxEnv(settings: CommunitySettings, env: NodeJS.ProcessEnv = process.env): void {
  if (settings.aclTimeoutMs && !env.GENEX_SANDBOX_ACL_TIMEOUT_MS)
    env.GENEX_SANDBOX_ACL_TIMEOUT_MS = String(settings.aclTimeoutMs);
  if (settings.sandboxSkipDirs.length)
    env.GENEX_SANDBOX_SKIP_DIRS = [env.GENEX_SANDBOX_SKIP_DIRS ?? "", ...settings.sandboxSkipDirs]
      .filter(Boolean)
      .join(";");
}

export const SANDBOX_OFF_WARNING =
  'The process sandbox is OFF (GENEX_SANDBOX=off or "sandbox": false in community.json). ' +
  "AI agents will run commands with your full user permissions: they can read and change any of your files. " +
  "Only use this with models and projects you trust.";

const SPLASH_HTML = (product: string) => `<!doctype html><meta charset="utf-8"><title>${product}</title>
<style>
body{margin:0;font:14px system-ui,Segoe UI,sans-serif;background:#16141c;color:#eee;display:flex;
flex-direction:column;align-items:center;justify-content:center;height:100vh;user-select:none}
h1{font-size:18px;margin:0 0 8px}p{margin:4px 24px;color:#aaa;text-align:center}
.bar{width:70%;height:6px;background:#2b2836;border-radius:3px;overflow:hidden;margin-top:18px}
.bar i{display:block;width:30%;height:100%;background:#ff4fa3;animation:m 1.2s infinite ease-in-out}
@keyframes m{0%{margin-left:-30%}100%{margin-left:100%}}
</style><h1>${product}</h1><p>Preparando el espacio de trabajo protegido (sandbox)…</p>
<p>Setting up the protected workspace. The first launch can take several minutes;<br>an antivirus may slow it down.</p>
<div class="bar"><i></i></div><p id="t" style="margin-top:14px;font-size:12px">0 s</p>
<script>let s=0;setInterval(()=>{document.getElementById('t').textContent=(++s)+' s'},1000)</script>`;

/** A small window shown while the core (and the sandbox's first ACL setup) starts. */
export function showSplash(product = COMMUNITY_PRODUCT_NAME): BrowserWindow | null {
  try {
    const splash = new BrowserWindow({
      width: 460,
      height: 260,
      frame: false,
      resizable: false,
      show: true,
      center: true,
      backgroundColor: "#16141c",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML(product))}`);
    return splash;
  } catch {
    return null;
  }
}
