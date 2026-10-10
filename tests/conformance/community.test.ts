/**
 * Genex Windows Community: the fork's own additions — the OpenAI-compatible engine (run for real
 * against the local fake OpenAI-style server, tool calls included) and the Windows sandbox's
 * skipped package-manager folders.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  OpenAICompatibleEngine,
  openAICompatibleModels,
  resolveOpenAICompatible,
} from "../../src/substrate/engines/openai-compatible.ts";
import { extraUngrantableDirs, grantableToolDirs } from "../../src/substrate/windows-sandbox.ts";
import { GOOD_KEY, startFakeOpenRouter, type FakeOpenRouter } from "../helpers/fake-openrouter.ts";
import { tmpDir } from "../helpers/tmp.ts";

const servers: FakeOpenRouter[] = [];
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

describe("OpenAI-compatible presets", () => {
  it("defaults to Jan and resolves the other presets and custom URLs", () => {
    assert.equal(resolveOpenAICompatible({}).baseUrl, "http://127.0.0.1:1337/v1");
    assert.equal(resolveOpenAICompatible({}).local, true);
    assert.equal(resolveOpenAICompatible({ preset: "lmstudio" }).baseUrl, "http://127.0.0.1:1234/v1");
    assert.equal(resolveOpenAICompatible({ preset: "deepseek" }).local, false);
    for (const preset of ["openrouter", "deepseek", "openai"])
      assert.equal(new OpenAICompatibleEngine({ root: "/tmp/x", config: { preset } }).metered, true, preset);
    assert.equal(new OpenAICompatibleEngine({ root: "/tmp/x", config: { preset: "jan" } }).metered, false);
    assert.equal(
      resolveOpenAICompatible({ preset: "custom", baseUrl: "http://localhost:9000/v1/" }).baseUrl,
      "http://localhost:9000/v1",
    );
  });

  it("lists chat models from /models and drops embedding models", () => {
    const rows = openAICompatibleModels({ data: [{ id: "Qwen3-Coder-30B" }, { id: "nomic-embed-text" }] }, {});
    assert.deepEqual(
      rows.map((r) => r.id),
      ["Qwen3-Coder-30B"],
    );
    assert.equal(rows[0]?.supportsTools, true);
    assert.equal(rows[0]?.contextWindow, 32_768);
  });
});

describe("OpenAI-compatible engine", () => {
  it("streams text, sends the key and runs tool calls", async () => {
    const server = await startFakeOpenRouter({
      replies: [{ text: "Hola nya" }, { toolCalls: [{ id: "call-1", name: "probe", arguments: { depth: 2 } }] }],
    });
    servers.push(server);
    const root = await tmpDir("openai-compat-");
    const engine = new OpenAICompatibleEngine({
      root: path.join(root, "engine"),
      config: { preset: "custom", baseUrl: server.baseUrl, apiKey: GOOD_KEY, models: ["qwen/qwen3-coder"] },
    });
    assert.equal((await engine.status()).code, "ready");
    const text = await engine.complete({ model: "qwen/qwen3-coder", messages: [{ role: "user", content: "hi" }] });
    assert.equal(text.message.content, "Hola nya");
    const tools = [{ name: "probe", description: "probe", parameters: { type: "object", properties: {} } }];
    const call = await engine.complete({
      model: "qwen/qwen3-coder",
      messages: [{ role: "user", content: "go" }],
      tools,
    });
    assert.deepEqual(call.message.tool_calls, [{ id: "call-1", name: "probe", arguments: { depth: 2 } }]);
    const sent = server.requests.find((r) => r.path.endsWith("/chat/completions"));
    assert.equal(sent?.authorization, `Bearer ${GOOD_KEY}`);
  });

  it("says the server is down instead of hanging", async () => {
    const root = await tmpDir("openai-compat-");
    const engine = new OpenAICompatibleEngine({ root, config: { baseUrl: "http://127.0.0.1:9/v1" } });
    const status = await engine.status();
    assert.equal(status.code, "error");
  });
});

describe("Windows sandbox grants", () => {
  const profile = "C:\\Users\\David";
  it("never grants the huge package-manager folders on PATH", () => {
    const entries = [
      "C:\\Users\\David\\AppData\\Local\\pnpm",
      "C:\\Users\\David\\AppData\\Roaming\\npm",
      "C:\\Users\\David\\bin",
    ];
    assert.deepEqual(
      grantableToolDirs(entries, profile, [], () => true),
      ["C:\\Users\\David\\bin"],
    );
  });
  it("adds folders from GENEX_SANDBOX_SKIP_DIRS", () => {
    assert.deepEqual(extraUngrantableDirs(profile, { GENEX_SANDBOX_SKIP_DIRS: "big;D:\\tools" }), [
      "C:\\Users\\David\\big",
      "D:\\tools",
    ]);
  });
});
