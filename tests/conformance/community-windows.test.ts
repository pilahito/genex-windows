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
import { installerPluginChoices } from "../../src/main/installer-plugins.ts";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  checkCommunityRelease,
  downloadVerified,
  notesHtml,
  pickInstallerAsset,
  readUpdatePrefs,
  renderUpdatePage,
  updateInstallerArgs,
  writeUpdatePrefs,
} from "../../src/main/community-update.ts";
import { tmpDir } from "../helpers/tmp.ts";

describe("Community updater (pilahito/genex-windows releases)", () => {
  const repo = "pilahito/genex-windows";
  const bytes = Buffer.from("instalador de prueba");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const asset = {
    name: "GenexWindowsCommunity-Setup-0.1.9.exe",
    size: bytes.length,
    digest: `sha256:${sha}`,
    browser_download_url: `https://github.com/${repo}/releases/download/v0.1.9/GenexWindowsCommunity-Setup-0.1.9.exe`,
  };
  const latest = (body: object) => async () => new Response(JSON.stringify(body), { status: 200 });

  it("finds a newer release with its notes and verified installer asset", async () => {
    const found = await checkCommunityRelease({
      current: "0.1.8",
      fetchImpl: latest({
        tag_name: "v0.1.9",
        html_url: `https://github.com/${repo}/releases/tag/v0.1.9`,
        body: "## Novedades",
        assets: [{ ...asset, name: "Genex.zip" }, asset],
      }),
    });
    assert.equal(found.kind, "newer");
    if (found.kind !== "newer") return;
    assert.equal(found.release.version, "0.1.9");
    assert.equal(found.release.notes, "## Novedades");
    assert.deepEqual(found.release.installer, {
      name: asset.name,
      size: asset.size,
      sha256: sha,
      url: asset.browser_download_url,
    });
    const same = await checkCommunityRelease({
      current: "0.1.9",
      fetchImpl: latest({ tag_name: "v0.1.9", html_url: `https://github.com/${repo}/releases/tag/v0.1.9` }),
    });
    assert.equal(same.kind, "current");
    const elsewhere = await checkCommunityRelease({
      current: "0.1.8",
      fetchImpl: latest({
        tag_name: "v9.0.0",
        html_url: "https://github.com/genex-games/genex-desktop/releases/tag/v9.0.0",
      }),
    });
    assert.equal(elsewhere.kind, "failed");
  });

  it("refuses installer assets without digest, from elsewhere or for another version", () => {
    assert.equal(pickInstallerAsset(repo, "0.1.9", [{ ...asset, digest: null }]), null);
    assert.equal(
      pickInstallerAsset(repo, "0.1.9", [{ ...asset, browser_download_url: "https://evil.test/x.exe" }]),
      null,
    );
    assert.equal(pickInstallerAsset(repo, "0.2.0", [asset]), null);
  });

  it("downloads only a file whose size and SHA-256 match", async () => {
    const dir = await tmpDir("update-");
    const dest = path.join(dir, asset.name);
    const ok = { name: asset.name, size: asset.size, sha256: sha, url: asset.browser_download_url };
    const serve = (data: Buffer) => async () => new Response(new Uint8Array(data), { status: 200 });
    assert.equal(await downloadVerified(ok, dest, { fetchImpl: serve(bytes) }), dest);
    assert.deepEqual(await readFile(dest), bytes);
    const tampered = Buffer.from("instalador de pruebX");
    await assert.rejects(downloadVerified(ok, `${dest}.2`, { fetchImpl: serve(tampered) }), /SHA-256/);
    assert.equal(existsSync(`${dest}.2`) || existsSync(`${dest}.2.part`), false);
    await assert.rejects(
      downloadVerified(ok, `${dest}.3`, { fetchImpl: serve(Buffer.concat([bytes, bytes])) }),
      /grande/,
    );
  });

  it("renders notes as Markdown without raw HTML or non-https links", () => {
    const html = notesHtml("# Hola\n\n<script>alert(1)</script>\n\n[web](https://x.test) [js](javascript:alert(1))");
    assert.match(html, /<h1>Hola<\/h1>/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /<a href="https:\/\/x.test">web<\/a>/);
    assert.doesNotMatch(html, /javascript:/);
    const page = renderUpdatePage({ version: "0.1.9", url: "u", notes: "x", installer: null }, "0.1.8", "portable");
    for (const label of ["Hay una nueva versión v0.1.9", "Actualizar ahora", "Más tarde", "Omitir esta versión"])
      assert.ok(page.includes(label), label);
    assert.match(page, /script-src|default-src 'none'/);
  });

  it("runs the installer silently in the same scope and relaunches", () => {
    const pf = "C:\\Program Files";
    assert.ok(
      updateInstallerArgs("C:\\Program Files\\Genex Windows Community\\genex-community.exe", [pf]).includes(
        "/ALLUSERS",
      ),
    );
    const mine = updateInstallerArgs("D:\\Apps\\Genex Windows Community\\genex-community.exe", [pf]);
    assert.ok(mine.includes("/CURRENTUSER") && mine.includes("/SILENT") && mine.includes("/RELAUNCH=1"));
  });

  it("keeps the update settings in community.json without touching the rest", async () => {
    const file = path.join(await tmpDir("update-prefs-"), "community.json");
    assert.deepEqual(readUpdatePrefs(file), { autoCheck: true, skippedVersion: null });
    await writeFile(file, '{ "sandbox": true }');
    writeUpdatePrefs(file, { skippedVersion: "0.1.9" });
    writeUpdatePrefs(file, { autoCheck: false });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      sandbox: true,
      updates: { autoCheck: false, skippedVersion: "0.1.9" },
    });
  });
});

describe("Installer started by the updater", () => {
  it("waits on an update until nothing runs from the install folder", async () => {
    const iss = await readFile(path.join(import.meta.dirname, "../../build/windows/genex-community.iss"), "utf8");
    assert.match(
      iss,
      /function PrepareToInstall[\s\S]*if not WantsRelaunch\(\) then exit;[\s\S]*CountAppProcesses\(Dir\)/,
    );
  });
});

describe("Installer plugin choices", () => {
  it("reads booleans from community-plugins.json and ignores everything else", async () => {
    const dir = await tmpDir("installer-");
    assert.deepEqual(installerPluginChoices(dir), {});
    await writeFile(path.join(dir, "community-plugins.json"), '{ "mobile": true, "apk": false, "x": "no" }');
    assert.deepEqual(installerPluginChoices(dir), { mobile: true, apk: false });
    await writeFile(path.join(dir, "community-plugins.json"), "not json");
    assert.deepEqual(installerPluginChoices(dir), {});
  });
});

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
