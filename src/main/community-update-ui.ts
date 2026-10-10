/**
 * Genex Windows Community: the update window and "Actualizar ahora" (see ./community-update.ts).
 * The window shows a static page (no scripts, no preload); its buttons are links to
 * `UPDATE_LINK_BASE` caught here, and https links in the notes open in the person's browser.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, net, shell } from "electron";
import {
  type CommunityCheck,
  type CommunityRelease,
  checkCommunityRelease,
  downloadVerified,
  installKind,
  readUpdatePrefs,
  renderProgressPage,
  renderUpdatePage,
  updateInstallerArgs,
  UPDATE_LINK_BASE,
  writeUpdatePrefs,
} from "./community-update.ts";

export type UpdateChoice = "now" | "later" | "skip";

export interface CommunityUpdaterOptions {
  /** `community.json`. */
  settingsFile: string;
  log: (line: string) => void;
  /** The window to sit over, when there is one. */
  parent: () => BrowserWindow | null;
}

/** The version the updater compares against: the app's, or GENEX_UPDATE_PRETEND_VERSION to try the window out. */
const runningVersion = () => {
  const pretend = process.env.GENEX_UPDATE_PRETEND_VERSION?.trim();
  return pretend && /^\d+\.\d+\.\d+$/.test(pretend) ? pretend : app.getVersion();
};

const dataUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one closure holds the window, the download and the checks together.
export function createCommunityUpdater({ settingsFile, log, parent }: CommunityUpdaterOptions) {
  let open: BrowserWindow | null = null;
  let last: CommunityRelease | null = null;
  let busy = false;

  const check = async (): Promise<CommunityCheck> => {
    const result = await checkCommunityRelease({ current: runningVersion(), fetchImpl: net.fetch });
    log(`community update check: ${result.kind}${result.kind === "failed" ? ` (${result.reason})` : ""}`);
    if (result.kind === "newer") last = result.release;
    return result;
  };

  /** Show the notes and the three buttons; resolves with the choice (closing the window is "later"). */
  const ask = (release: CommunityRelease): Promise<{ choice: UpdateChoice; win: BrowserWindow }> =>
    new Promise((resolve) => {
      open?.destroy();
      const owner = parent();
      const win = new BrowserWindow({
        width: 680,
        height: 600,
        minWidth: 480,
        minHeight: 380,
        title: `Hay una nueva versión v${release.version}`,
        backgroundColor: "#16141c",
        autoHideMenuBar: true,
        show: false,
        ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
      });
      open = win;
      let settled = false;
      const settle = (choice: UpdateChoice) => {
        if (settled) return;
        settled = true;
        resolve({ choice, win });
      };
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
      win.webContents.on("will-navigate", (event, url) => {
        event.preventDefault();
        if (url.startsWith(UPDATE_LINK_BASE)) {
          const choice = url.slice(UPDATE_LINK_BASE.length).replace(/\/+$/, "");
          if (choice === "now" || choice === "later" || choice === "skip") settle(choice);
        } else if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      });
      win.on("closed", () => {
        if (open === win) open = null;
        settle("later");
      });
      win.once("ready-to-show", () => win.show());
      void win.loadURL(dataUrl(renderUpdatePage(release, runningVersion(), installKind(process.execPath))));
    });

  /** Download, verify and start the installer, then quit; a portable copy opens the release page. */
  const install = async (release: CommunityRelease, win: BrowserWindow): Promise<void> => {
    const close = () => {
      if (!win.isDestroyed()) win.destroy();
    };
    if (installKind(process.execPath) !== "installer" || !release.installer) {
      close();
      await shell.openExternal(release.url);
      return;
    }
    const asset = release.installer;
    const folder = path.join(app.getPath("temp"), "genex-community-update");
    mkdirSync(folder, { recursive: true });
    let shown = -1;
    const progress = (fraction: number) => {
      if (win.isDestroyed()) return;
      win.setProgressBar(fraction);
      const step = Math.floor(fraction * 10);
      if (step === shown) return;
      shown = step;
      void win.loadURL(
        dataUrl(renderProgressPage(release.version, `Descargando el instalador… ${Math.round(fraction * 100)} %`)),
      );
    };
    try {
      progress(0);
      const file = await downloadVerified(asset, path.join(folder, asset.name), {
        fetchImpl: net.fetch,
        onProgress: progress,
      });
      log(`community update: ${asset.name} verified (sha256 ${asset.sha256})`);
      if (!win.isDestroyed()) {
        win.setProgressBar(-1);
        void win.loadURL(
          dataUrl(renderProgressPage(release.version, "Instalador verificado. Cerrando Genex para instalar…")),
        );
      }
      const args = updateInstallerArgs(process.execPath, [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]);
      const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      setTimeout(() => {
        close();
        app.quit();
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`community update failed: ${message}`);
      close();
      await dialog
        .showMessageBox({
          type: "error",
          title: "No se pudo actualizar",
          message: "No se pudo descargar o verificar el instalador.",
          detail: `${message}\n\nPuedes descargarlo a mano desde la página de la release.`,
          buttons: ["Abrir la página", "Cerrar"],
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(release.url);
        });
    }
  };

  /** Show the window for `release` and act on the answer. */
  const offer = async (release: CommunityRelease): Promise<void> => {
    if (busy) {
      open?.focus();
      return;
    }
    busy = true;
    try {
      const { choice, win } = await ask(release);
      log(`community update v${release.version}: ${choice}`);
      if (choice === "skip") writeUpdatePrefs(settingsFile, { skippedVersion: release.version });
      if (choice === "now") await install(release, win);
      else if (!win.isDestroyed()) win.destroy();
    } finally {
      busy = false;
    }
  };

  return {
    prefs: () => readUpdatePrefs(settingsFile),
    setAutoCheck: (on: boolean) => writeUpdatePrefs(settingsFile, { autoCheck: on }).autoCheck,
    /** The startup check: only when turned on, and quiet about a skipped version. */
    async atStartup(): Promise<void> {
      const prefs = readUpdatePrefs(settingsFile);
      if (!prefs.autoCheck) return log("community update check: off in Ajustes");
      const result = await check();
      if (result.kind === "newer" && result.release.version !== prefs.skippedVersion) await offer(result.release);
    },
    /** "Buscar actualizaciones": always offers a newer version, even a skipped one. */
    async manual(): Promise<CommunityCheck> {
      const result = await check();
      if (result.kind === "newer") void offer(result.release);
      return result;
    },
    /** Open the window again for the release the last check found; false when none. */
    reopen(): boolean {
      if (!last) return false;
      void offer(last);
      return true;
    },
  };
}
export type CommunityUpdater = ReturnType<typeof createCommunityUpdater>;
