/**
 * Genex Windows Community: recover from a wedged Windows sandbox helper at launch. No Electron
 * imports, so the unit tests load it directly.
 */
import { execFile } from "node:child_process";

/** One `srt-win.exe` process and the process that started it. */
export interface SrtWinProcess {
  pid: number;
  ppid: number;
}

/**
 * The srt-win helpers whose parent is gone. A Genex that crashed or was killed during the first
 * ACL setup leaves its srt-win behind holding `%LOCALAPPDATA%\\sandbox-runtime\\.acl-init.lock`, and
 * every later launch then waits the whole lock timeout and fails ("init lock … not acquired").
 * A helper whose parent still runs (another Genex, the official build) is never touched.
 */
export function orphanSrtWin(rows: SrtWinProcess[], isAlive: (pid: number) => boolean): number[] {
  return rows.filter((r) => r.pid > 0 && r.pid !== process.pid && !(r.ppid > 0 && isAlive(r.ppid))).map((r) => r.pid);
}

/** Parse `pid,ppid` lines. */
export function parseSrtWinRows(text: string): SrtWinProcess[] {
  const rows: SrtWinProcess[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return rows;
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const run = (file: string, args: string[], timeout: number) =>
  new Promise<string>((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, encoding: "utf8" }, (_e, stdout) =>
      resolve(String(stdout ?? "")),
    );
  });

/**
 * Windows: end orphaned srt-win helpers before the sandbox starts. Cheap when there are none (one
 * `tasklist`, ~50 ms); PowerShell runs only when an srt-win exists. Never throws.
 */
export async function reapOrphanSrtWin(log: (line: string) => void = () => {}): Promise<number[]> {
  if (process.platform !== "win32") return [];
  try {
    const listed = await run("tasklist.exe", ["/FI", "IMAGENAME eq srt-win.exe", "/NH", "/FO", "CSV"], 10_000);
    if (!/srt-win\.exe/i.test(listed)) return [];
    const text = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='srt-win.exe'\" | ForEach-Object { '{0},{1}' -f $_.ProcessId, $_.ParentProcessId }",
      ],
      20_000,
    );
    const orphans = orphanSrtWin(parseSrtWinRows(text), pidAlive);
    for (const pid of orphans) await run("taskkill.exe", ["/PID", String(pid), "/T", "/F"], 10_000);
    if (orphans.length) log(`ended ${orphans.length} orphaned srt-win helper(s): ${orphans.join(", ")}`);
    return orphans;
  } catch (e) {
    log(`srt-win cleanup skipped: ${(e as Error).message}`);
    return [];
  }
}

/** The sandbox failed because another srt-win holds its init lock. */
export function isSrtWinLockError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message}` : String(err);
  return /init lock .*not acquired/i.test(text) || /acl-init\.lock/i.test(text);
}

/** Spanish explanation shown when the sandbox lock is still held after cleanup. */
export const SANDBOX_LOCK_HELP =
  "Otro proceso del sandbox (srt-win.exe) está bloqueando el arranque. Cierra cualquier otra copia de Genex " +
  "(también la oficial), o en el Administrador de tareas finaliza «srt-win.exe», y vuelve a abrir Genex Windows Community. " +
  "Si persiste, reinicia Windows.";
