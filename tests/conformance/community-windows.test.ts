/**
 * Genex Windows Community v0.1.7: Windows startup (orphaned srt-win helpers), Local Blender on
 * Windows (drive-path candidates, `*` folders, GENEX_RUNTIME_<ID>, the opt-in for unsandboxed native
 * jobs) and the "Análisis de APK" plugin.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { isSrtWinLockError, orphanSrtWin, parseSrtWinRows } from "../../src/main/windows-srt.ts";
import { expandCandidates, runtimeOverride } from "../../src/substrate/plugins/native.ts";
import { windowsNativeAllowed } from "../../src/substrate/plugins/native-process.ts";
import { inspectPackage, validateManifest } from "../../src/substrate/plugins/manifest.ts";
import { OpenAICompatibleEngine, resolveOpenAICompatible } from "../../src/substrate/engines/openai-compatible.ts";
import { tmpDir } from "../helpers/tmp.ts";

describe("Gemini and xAI presets", () => {
  it("points at Gemini's OpenAI-compatible endpoint and is metered", () => {
    assert.equal(
      resolveOpenAICompatible({ preset: "gemini" }).baseUrl,
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    assert.equal(new OpenAICompatibleEngine({ root: "/tmp/x", config: { preset: "gemini" } }).metered, true);
    assert.equal(resolveOpenAICompatible({ preset: "xai" }).baseUrl, "https://api.x.ai/v1");
    assert.equal(new OpenAICompatibleEngine({ root: "/tmp/x", config: { preset: "xai" } }).metered, true);
  });
});

describe("Windows startup: orphaned srt-win helpers", () => {
  it("parses pid,ppid rows and picks only helpers whose parent is gone", () => {
    const rows = parseSrtWinRows("101,5\r\n102,6\r\njunk\n103,0\n");
    assert.deepEqual(rows, [
      { pid: 101, ppid: 5 },
      { pid: 102, ppid: 6 },
      { pid: 103, ppid: 0 },
    ]);
    assert.deepEqual(
      orphanSrtWin(rows, (pid) => pid === 5),
      [102, 103],
    );
  });

  it("recognises the init-lock failure", () => {
    assert.equal(
      isSrtWinLockError(
        new Error(
          "srt-win: error: init lock ~\\AppData\\Local\\sandbox-runtime\\.acl-init.lock not acquired within 60000ms",
        ),
      ),
      true,
    );
    assert.equal(isSrtWinLockError(new Error("something else")), false);
  });

  it("runs native jobs on Windows only with the explicit opt-in", () => {
    assert.equal(windowsNativeAllowed({}), false);
    assert.equal(windowsNativeAllowed({ GENEX_NATIVE_UNSANDBOXED: "1" }), true);
  });
});

describe("Local Blender on Windows", () => {
  it("accepts Windows drive candidates in the bundled manifest", async () => {
    const manifest = validateManifest(
      JSON.parse(await readFile(path.resolve("src/plugins/blender/plugin.json"), "utf8")),
    );
    const runtime = (manifest.nativeRuntimes ?? [])[0];
    assert.ok(runtime.candidates.includes("G:/Blender/blender.exe"));
    assert.doesNotMatch(manifest.description, /Mac\b.*only|this Mac/);
  });

  it("expands one * folder, newest first, and honours GENEX_RUNTIME_<ID>", async () => {
    const root = await tmpDir("blender-");
    for (const v of ["Blender 4.2", "Blender 5.2", "Blender 4.10"]) await mkdir(path.join(root, v));
    const found = await expandCandidates([path.join(root, "*", "blender.exe"), "/plain/path"]);
    assert.deepEqual(found, [
      path.join(root, "Blender 5.2", "blender.exe"),
      path.join(root, "Blender 4.10", "blender.exe"),
      path.join(root, "Blender 4.2", "blender.exe"),
      "/plain/path",
    ]);
    const abs = path.resolve("/x/blender");
    assert.deepEqual(runtimeOverride("blender", { GENEX_RUNTIME_BLENDER: abs }), [abs]);
    assert.deepEqual(runtimeOverride("blender", { GENEX_RUNTIME_BLENDER: "relative" }), []);
  });
});

describe("Análisis de APK plugin", () => {
  it("is a valid package whose search and inspect read a decompiled tree", async () => {
    const root = path.resolve("src/plugins/apk");
    const manifest = await inspectPackage(root);
    assert.equal(manifest.id, "apk");
    assert.deepEqual(
      manifest.tools.map((t) => t.name),
      ["status", "decompile", "inspect", "search"],
    );
    const game = await tmpDir("apk-game-");
    const dir = path.join(game, "apk-analysis", "demo");
    await mkdir(path.join(dir, "apktool", "lib", "arm64-v8a"), { recursive: true });
    await mkdir(path.join(dir, "jadx", "sources", "com", "demo"), { recursive: true });
    await writeFile(
      path.join(dir, "apktool", "AndroidManifest.xml"),
      '<manifest package="com.demo.juego"><uses-permission android:name="android.permission.CAMERA"/>' +
        '<application><activity android:name="com.demo.Main" android:exported="true"/></application></manifest>',
    );
    await writeFile(
      path.join(dir, "apktool", "apktool.yml"),
      "sdkInfo:\n  minSdkVersion: '24'\n  targetSdkVersion: '34'\nversionInfo:\n  versionCode: '7'\n  versionName: 1.2.3\n",
    );
    await writeFile(path.join(dir, "apktool", "lib", "arm64-v8a", "libunity.so"), "");
    await writeFile(
      path.join(dir, "jadx", "sources", "com", "demo", "Main.java"),
      'class Main {\n  String url = "https://api.demo.test";\n}\n',
    );
    const backend = await import(pathToFileURL(path.join(root, "backend.mjs")).href);
    const plugin = await backend.activate();
    const ctx = { project: game, directory: game, host: async () => null };
    const info = await plugin.tool("inspect", {}, ctx);
    assert.equal(info.package, "com.demo.juego");
    assert.equal(info.versionName, "1.2.3");
    assert.equal(info.minSdk, "24");
    assert.deepEqual(info.permissions, ["android.permission.CAMERA"]);
    assert.deepEqual(info.activities, ["com.demo.Main (exported)"]);
    assert.deepEqual(info.engine, ["Unity"]);
    assert.match(await readFile(path.join(dir, "INFORME.md"), "utf8"), /CAMERA ⚠️ sensible/);
    const found = await plugin.tool("search", { query: "API.DEMO" }, ctx);
    assert.deepEqual(found.hits, ['jadx/sources/com/demo/Main.java:2: String url = "https://api.demo.test";']);
    await assert.rejects(plugin.tool("decompile", { apk: "nope.txt" }, ctx), /\.apk/);
  });
});
