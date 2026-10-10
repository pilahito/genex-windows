/**
 * Genex Windows Community: the fork's own updater, fed only by the GitHub Releases of
 * `pilahito/genex-windows` (never the official Genex feed). No electron imports, so tests load it.
 *
 * - `checkCommunityRelease` reads `releases/latest` (GitHub already leaves out drafts and
 *   pre-releases) and returns the newer version with its notes and its installer asset.
 * - The installer asset must be `GenexWindowsCommunity-Setup-<version>.exe`, downloaded from this
 *   repository's release, with the size and SHA-256 digest GitHub publishes for it;
 *   `downloadVerified` refuses anything else.
 * - A copy installed by the wizard (Inno Setup leaves `unins000.exe` beside the exe) can update
 *   itself; a portable copy opens the release page instead.
 * - `renderUpdatePage` turns the release notes (Markdown) into a static page with no scripts: raw
 *   HTML in the notes is shown as text, and the buttons are links main intercepts.
 * - Settings live in `community.json` under `"updates": { "autoCheck": true, "skippedVersion": null }`.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { compareVersions, releasePageUrl } from "./release-check.ts";

export const COMMUNITY_UPDATE_REPO = "pilahito/genex-windows";
/** The wizard's installer asset; the version in the name must be the release's. */
const INSTALLER_ASSET = /^GenexWindowsCommunity-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/;
const RELEASE_TAG = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const SHA256 = /^sha256:([0-9a-f]{64})$/i;
const CHECK_TIMEOUT_MS = 15_000;
/** The biggest installer the updater accepts (the 0.1.8 one is ~130 MB). */
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
/**
 * Where the update page's buttons point (`…/now`, `…/later`, `…/skip`). An https URL on a reserved
 * `.invalid` host, so Chromium treats a click as a navigation main intercepts (an unknown scheme
 * would be handed to Windows instead); it can never resolve.
 */
export const UPDATE_LINK_BASE = "https://genex-update.invalid/";

export interface InstallerAsset {
  name: string;
  size: number;
  sha256: string;
  url: string;
}

export interface CommunityRelease {
  version: string;
  /** The release page on github.com. */
  url: string;
  /** The release notes, Markdown. */
  notes: string;
  /** The verified installer, or null when the release has none usable (portable copies open `url`). */
  installer: InstallerAsset | null;
}

export type CommunityCheck =
  | { kind: "newer"; release: CommunityRelease }
  | { kind: "current" }
  | { kind: "failed"; reason: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The installer asset of a release, only when its name, origin, size and digest all check out. */
/** One asset of the GitHub answer as an installer, or null when anything about it is off. */
function installerOf(repo: string, version: string, raw: unknown): InstallerAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const name = typeof a.name === "string" ? a.name : "";
  if (INSTALLER_ASSET.exec(name)?.[1] !== version) return null;
  const sha256 = typeof a.digest === "string" ? SHA256.exec(a.digest)?.[1]?.toLowerCase() : undefined;
  const size = typeof a.size === "number" ? a.size : 0;
  const url = typeof a.browser_download_url === "string" ? a.browser_download_url : "";
  const fromRepo = url.startsWith(`https://github.com/${repo}/releases/download/`);
  if (!sha256 || size <= 0 || size > MAX_INSTALLER_BYTES || !fromRepo) return null;
  return { name, size, sha256, url };
}

/** The installer asset of a release, only when its name, origin, size and digest all check out. */
export function pickInstallerAsset(repo: string, version: string, assets: unknown): InstallerAsset | null {
  if (!Array.isArray(assets)) return null;
  for (const raw of assets) {
    const found = installerOf(repo, version, raw);
    if (found) return found;
  }
  return null;
}

/** The newest published release of `repo`, against the running version. Never throws. */
export async function checkCommunityRelease(options: {
  current: string;
  repo?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<CommunityCheck> {
  const { current, repo = COMMUNITY_UPDATE_REPO, fetchImpl = fetch, timeoutMs = CHECK_TIMEOUT_MS } = options;
  let body: Record<string, unknown>;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "genex-windows-community" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { kind: "failed", reason: `GitHub respondió ${response.status}` };
    body = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  const tag = typeof body?.tag_name === "string" ? body.tag_name : "";
  const version = RELEASE_TAG.exec(tag)?.[1];
  if (!version) return { kind: "failed", reason: `La última release no tiene una versión válida: ${tag}` };
  const url = typeof body.html_url === "string" ? releasePageUrl(repo, body.html_url) : null;
  if (!url) return { kind: "failed", reason: "La página de la release no es de este repositorio" };
  if (compareVersions(version, current) <= 0) return { kind: "current" };
  const notes = typeof body.body === "string" ? body.body : "";
  return { kind: "newer", release: { version, url, notes, installer: pickInstallerAsset(repo, version, body.assets) } };
}

/** How this copy was installed: by the wizard (it can update itself) or unpacked from the zip. */
export function installKind(execPath: string): "installer" | "portable" {
  return existsSync(path.join(path.dirname(execPath), "unins000.exe")) ? "installer" : "portable";
}

/**
 * Download `asset` to `dest`, checking the size while it streams and the SHA-256 at the end. The
 * file only takes its final name once both match; on any failure nothing is left behind.
 */
export async function downloadVerified(
  asset: InstallerAsset,
  dest: string,
  options: { fetchImpl?: FetchLike; onProgress?: (fraction: number) => void } = {},
): Promise<string> {
  const { fetchImpl = fetch, onProgress } = options;
  const partial = `${dest}.part`;
  await rm(partial, { force: true });
  try {
    const response = await fetchImpl(asset.url, { headers: { "user-agent": "genex-windows-community" } });
    if (!response.ok || !response.body) throw new Error(`La descarga falló (${response.status})`);
    const hash = createHash("sha256");
    const out = createWriteStream(partial);
    let received = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > asset.size) throw new Error("El archivo descargado es más grande de lo esperado");
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        onProgress?.(received / asset.size);
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }
    if (received !== asset.size) throw new Error(`Tamaño incorrecto: ${received} de ${asset.size} bytes`);
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) throw new Error("La suma SHA-256 no coincide con la publicada en GitHub");
    await rm(dest, { force: true });
    await rename(partial, dest);
    return dest;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/**
 * Arguments for the downloaded installer: progress window only, the same folder, components and
 * shortcuts as last time (Inno Setup remembers them), and Genex opened again at the end. A copy
 * installed for all users (under Program Files) is updated for all users, behind Windows' prompt.
 */
export function updateInstallerArgs(execPath: string, programFolders: readonly (string | undefined)[]): string[] {
  const exe = path.win32.resolve(execPath).toLowerCase();
  const allUsers = programFolders.some((dir) => dir && exe.startsWith(`${path.win32.resolve(dir).toLowerCase()}\\`));
  return [
    "/SILENT",
    "/SP-",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/CLOSEAPPLICATIONS",
    "/RELAUNCH=1",
    allUsers ? "/ALLUSERS" : "/CURRENTUSER",
  ];
}

// ── settings (community.json) ───────────────────────────────────────────────────────────────

export interface UpdatePrefs {
  /** Check at startup. On unless the person turns it off. */
  autoCheck: boolean;
  /** The version the person chose to skip, or null. */
  skippedVersion: string | null;
}

function readJson(file: string): Record<string, unknown> {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readUpdatePrefs(file: string): UpdatePrefs {
  const saved = readJson(file);
  const update = (saved.updates && typeof saved.updates === "object" ? saved.updates : {}) as Record<string, unknown>;
  return {
    autoCheck: update.autoCheck !== false,
    skippedVersion: typeof update.skippedVersion === "string" ? update.skippedVersion : null,
  };
}

/** Change the update settings in `community.json`, keeping everything else in the file as it was. */
export function writeUpdatePrefs(file: string, patch: Partial<UpdatePrefs>): UpdatePrefs {
  const saved = readJson(file);
  const next = { ...readUpdatePrefs(file), ...patch };
  saved.updates = { autoCheck: next.autoCheck, skippedVersion: next.skippedVersion };
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
  return next;
}

// ── the page ────────────────────────────────────────────────────────────────────────────────

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Release notes as HTML: Markdown rendered, raw HTML shown as text, only https links kept. */
export function notesHtml(markdown: string): string {
  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    renderer: {
      html: ({ text }) => escapeHtml(text),
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        return /^https:\/\//i.test(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
      },
      image: ({ text }) => escapeHtml(text),
    },
  });
  return marked.parse(markdown || "_Sin notas de versión._") as string;
}

/** The line under the notes: what "Actualizar ahora" will do on this copy. */
function updateHow(release: CommunityRelease, kind: "installer" | "portable", canInstall: boolean): string {
  if (canInstall && release.installer)
    return `«Actualizar ahora» descarga el instalador (${(release.installer.size / 1024 / 1024).toFixed(0)} MB), comprueba su SHA-256, cierra Genex y lo instala en la misma carpeta. Tus datos y juegos se conservan.`;
  if (kind === "portable")
    return "Esta copia es la versión portable: «Actualizar ahora» abre la página de la release para descargar el zip nuevo.";
  return "Esta release no trae un instalador verificable: «Actualizar ahora» abre su página.";
}

/** The whole update page: what is new, and the three buttons. No scripts run in it. */
export function renderUpdatePage(release: CommunityRelease, current: string, kind: "installer" | "portable"): string {
  const canInstall = kind === "installer" && release.installer !== null;
  const how = updateHow(release, kind, canInstall);
  return `<!doctype html><html lang="es"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Hay una nueva versión v${escapeHtml(release.version)}</title>
<style>
body{margin:0;font:14px/1.5 "Segoe UI",system-ui,sans-serif;background:#16141c;color:#e8e6ef;display:flex;flex-direction:column;height:100vh}
header{padding:18px 22px 8px}h1{font-size:19px;margin:0}header p{margin:4px 0 0;color:#a9a5b8}
main{flex:1;overflow:auto;margin:8px 22px;padding:4px 16px;background:#1f1c28;border-radius:8px;border:1px solid #2e2a3a}
main h1,main h2,main h3{font-size:15px;margin:14px 0 6px}main code{background:#2b2836;padding:1px 4px;border-radius:4px}
main a{color:#ff7dbf}main table{border-collapse:collapse}main td,main th{border:1px solid #3a3548;padding:3px 8px}
.how{margin:4px 22px;color:#a9a5b8;font-size:12.5px}
footer{display:flex;gap:10px;justify-content:flex-end;padding:12px 22px 18px}
footer a{padding:7px 16px;border-radius:6px;text-decoration:none;color:#e8e6ef;background:#2b2836;border:1px solid #3a3548}
footer a.primary{background:#ff4fa3;border-color:#ff4fa3;color:#16141c;font-weight:600}footer a.skip{margin-right:auto}
</style>
<header><h1>Hay una nueva versión v${escapeHtml(release.version)}</h1>
<p>Tienes la ${escapeHtml(current)}. Novedades:</p></header>
<main>${notesHtml(release.notes)}</main>
<p class="how">${escapeHtml(how)}</p>
<footer><a class="skip" href="${UPDATE_LINK_BASE}skip">Omitir esta versión</a>
<a href="${UPDATE_LINK_BASE}later">Más tarde</a>
<a class="primary" href="${UPDATE_LINK_BASE}now">Actualizar ahora</a></footer>`;
}

/** A small page while the installer downloads (the taskbar shows the progress). */
export function renderProgressPage(version: string, text: string): string {
  return `<!doctype html><html lang="es"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Actualizando a v${escapeHtml(version)}</title>
<style>body{margin:0;font:14px "Segoe UI",system-ui,sans-serif;background:#16141c;color:#e8e6ef;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center}
p{margin:6px 30px;color:#a9a5b8}footer{margin-top:18px}footer a{color:#ff7dbf}</style>
<h2>Actualizando a v${escapeHtml(version)}</h2><p>${escapeHtml(text)}</p>`;
}
