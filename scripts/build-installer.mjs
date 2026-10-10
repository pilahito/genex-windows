// Genex Windows Community: build the Spanish/English installer wizard (Inno Setup 6) from the app
// that "npm run package" / "npm run make" left in out/<Product>-win32-x64.
// Output: out/installer/GenexWindowsCommunity-Setup-<version>.exe
// ISCC.exe is found through ISCC, then the usual Inno Setup 6 folders.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version, productName } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const source = path.join(root, "out", `${productName}-win32-x64`);
if (!existsSync(path.join(source, "genex-community.exe")) || !existsSync(path.join(source, "resources", "app.asar")))
  throw new Error(`No packaged app at ${source}. Run "npm run make -- --platform win32 --arch x64" first.`);

const candidates = [
  process.env.ISCC,
  path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe"),
].filter(Boolean);
const iscc = candidates.find((c) => existsSync(c));
if (!iscc)
  throw new Error(`Inno Setup 6 (ISCC.exe) not found. Install it (winget install JRSoftware.InnoSetup) or set ISCC.`);

const out = path.join(root, "out", "installer");
mkdirSync(out, { recursive: true });
execFileSync(
  iscc,
  [
    "/Qp",
    `/DAppVersion=${version}`,
    `/DSourceDir=${source}`,
    `/DOutputDir=${out}`,
    `/DRepoRoot=${root}`,
    path.join(root, "build", "windows", "genex-community.iss"),
  ],
  { stdio: "inherit" },
);
console.log(path.join(out, `GenexWindowsCommunity-Setup-${version}.exe`));
