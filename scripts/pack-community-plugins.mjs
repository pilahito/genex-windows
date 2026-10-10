// Genex Windows Community: zip each optional community plugin (src/plugins/mobile, src/plugins/apk)
// as a standalone download for the GitHub release: out/plugins/genex-plugin-<id>-v<appVersion>.zip.
// Each zip holds one folder (the plugin) with INSTALAR.txt. Usage: node scripts/pack-community-plugins.mjs
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const out = path.join(root, "out", "plugins");
const stage = path.join(out, "stage");
await rm(out, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const PLUGINS = { mobile: "Juegos para móvil", apk: "Análisis de APK" };
const install = (
  id,
  name,
  pluginVersion,
) => `${name} ${pluginVersion} — plugin opcional de Genex Windows Community ${version}

Genex Windows Community ${version} ya lo trae incluido: no hace falta instalarlo. Si no lo quieres,
desactívalo o quítalo en Ajustes › Plugins.

Para otra instalación de Genex (por ejemplo la oficial, o una compilada sin plugins con
GENEX_BUNDLE_COMMUNITY_PLUGINS=0):
  1. Descomprime este zip; queda una carpeta "${id}" con plugin.json dentro.
  2. En Genex: Ajustes › Plugins › Añadir › Desde una carpeta local, y elige esa carpeta "${id}".
  3. Acepta el aviso de instalación (el plugin ejecuta código de confianza en tu PC).
`;

for (const [id, name] of Object.entries(PLUGINS)) {
  const dir = path.join(stage, id);
  await cp(path.join(root, "src", "plugins", id), dir, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(dir, "plugin.json"), "utf8"));
  await writeFile(path.join(dir, "INSTALAR.txt"), install(id, name, manifest.version));
  const zip = path.join(out, `genex-plugin-${id}-v${version}.zip`);
  // Windows' own bsdtar writes zip archives (-a picks the format from .zip); elsewhere Info-ZIP.
  if (process.platform === "win32")
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, id], {
      cwd: stage,
    });
  else execFileSync("zip", ["-r", "-q", zip, id], { cwd: stage });
  console.log(zip);
}
await rm(stage, { recursive: true, force: true });
