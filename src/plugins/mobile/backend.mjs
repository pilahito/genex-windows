// Juegos para móvil — Genex Windows Community.
// Prepara un juego de Genex para móvil: controles táctiles, PWA y un script que genera el APK de
// Android con Capacitor. Solo escribe dentro de la carpeta del juego abierto (project.write).
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const TEMPLATES = new URL("./templates/", import.meta.url);

/** What `prepare` writes: project path, template file, and whether it is an optional extra. */
const FILES = [
  { path: "src/touch-controls.js", template: "touch-controls.js" },
  { path: "manifest.webmanifest", template: "manifest.webmanifest" },
  { path: "docs/MOBILE.md", template: "MOBILE.md" },
  { path: "docs/build-android.ps1", template: "build-android.ps1" },
];

const ORIENTATIONS = new Set(["landscape", "portrait", "any"]);

const GUIDE = [
  "Siguiente paso (agente): conecta los archivos al juego.",
  '1. index.html: añade <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">,',
  '   <link rel="manifest" href="manifest.webmanifest"> y en el CSS de html,body: touch-action:none; overscroll-behavior:none; user-select:none.',
  '2. src/main.js (dentro del bloque FACET WIRING si existe): import { installTouchControls } from "./touch-controls.js";',
  '   const touch = installTouchControls({ buttons: [{ key: "Space", label: "A" }] }); usa las mismas teclas que ya lee update(ctx).',
  "3. Dibuja touch.state() con __studio.hud (arcos para joystick y botones), solo cuando touch.enabled. Nada de DOM.",
  "4. Juego jugable en vertical u horizontal según la orientación elegida; HUD anclado a las esquinas, zona central libre.",
  "5. Rendimiento móvil: renderer.setPixelRatio(Math.min(devicePixelRatio, 2)), sombras baratas, pocas luces, texturas ≤1024 px.",
  "6. Comprueba en la vista previa; para APK sigue docs/MOBILE.md.",
].join("\n");

const slugify = (text) =>
  String(text || "mi-juego")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mi-juego";

function appIdFor(slug, given) {
  if (given && /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(given)) return given;
  return `com.genexcommunity.${slug.replace(/-/g, "").replace(/^[^a-z]+/, "") || "juego"}`;
}

async function exists(ctx, path) {
  try {
    await ctx.host("project.read", { path });
    return true;
  } catch {
    return false;
  }
}

async function status(ctx) {
  if (!ctx.project) return { text: "Abre un juego para ver su estado móvil.", files: [] };
  const files = [];
  for (const f of FILES) files.push({ path: f.path, present: await exists(ctx, f.path) });
  const wired = { viewport: false, manifest: false, touch: false };
  try {
    const html = await ctx.host("project.read", { path: "index.html" });
    wired.viewport = /name=["']viewport["']/.test(html);
    wired.manifest = /rel=["']manifest["']/.test(html);
  } catch {}
  try {
    const main = await ctx.host("project.read", { path: "src/main.js" });
    wired.touch = /installTouchControls/.test(main);
  } catch {}
  const ready = files.every((f) => f.present) && wired.viewport && wired.manifest && wired.touch;
  return {
    text: ready
      ? "Listo para móvil: controles táctiles conectados, PWA y script de Android presentes."
      : "Aún no está listo para móvil. Usa mobile__prepare y después conecta los archivos (ver guide).",
    ready,
    files,
    wired,
    guide: GUIDE,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear write of four templated files with a docs/ fallback.
async function prepare(args, ctx) {
  if (!ctx.project) throw new Error("Abre un juego antes de prepararlo para móvil.");
  const appName = String(args.name || "Mi juego").slice(0, 60);
  const slug = slugify(appName);
  const orientation = ORIENTATIONS.has(args.orientation) ? args.orientation : "landscape";
  const values = {
    __APP_NAME__: appName,
    __SHORT_NAME__: appName.slice(0, 12),
    __SLUG__: slug,
    __APP_ID__: appIdFor(slug, args.appId),
    __ORIENTATION__: orientation,
  };
  const written = [];
  const kept = [];
  for (const f of FILES) {
    if (!args.overwrite && (await exists(ctx, f.path))) {
      kept.push(f.path);
      continue;
    }
    let text = await readFile(new URL(f.template, TEMPLATES), "utf8");
    for (const [key, value] of Object.entries(values)) text = text.replaceAll(key, value);
    if (f.template === "touch-controls.js")
      text = text.replace('orientation: "landscape"', `orientation: "${orientation}"`);
    try {
      await ctx.host("project.write", { path: f.path, text });
      written.push(f.path);
    } catch (e) {
      // docs/ may not exist in an older game: fall back to the game root.
      if (f.path.startsWith("docs/")) {
        const alt = f.path.slice("docs/".length);
        await ctx.host("project.write", { path: alt, text });
        written.push(alt);
      } else throw e;
    }
  }
  return {
    text: `Archivos móviles preparados para "${appName}" (${values.__APP_ID__}, ${orientation}).`,
    written,
    kept,
    appId: values.__APP_ID__,
    guide: GUIDE,
  };
}

const run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 15000, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) =>
      resolve({ ok: !error, text: `${stdout ?? ""}${stderr ?? ""}`.trim() }),
    );
  });
const present = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/** The major Java version in `java -version` output ("1.8.0" is 8, "21.0.2" is 21); 0 when unknown. */
function javaMajor(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return 0;
  return m[1] === "1" ? Number(m[2]) : Number(m[1]);
}

/** The first Java home (JDK 17+) found where build-android.ps1 looks, with its major version. */
async function findJava() {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const homes = [
    process.env.JAVA_HOME,
    "G:\\Dev\\jdk21",
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    "G:\\Dev\\jdk17",
  ].filter(Boolean);
  let best = null;
  for (const home of homes) {
    const java = path.join(home, "bin", exe);
    if (!(await present(java))) continue;
    const { text } = await run(java, ["-version"]);
    const major = javaMajor(text);
    if (!best || major > best.major) best = { home, major };
  }
  return best;
}

async function findSdk() {
  const homes = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    "G:\\Dev\\Android\\Sdk",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : "",
  ].filter(Boolean);
  for (const home of homes) if (await present(path.join(home, "platform-tools"))) return home;
  return null;
}

/** Can this PC build the APK? Java, Android SDK, Node.js and a phone over adb. Reads only. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat checklist of four probes.
async function androidEnv() {
  const [java, sdk, node] = await Promise.all([
    findJava(),
    findSdk(),
    run(process.platform === "win32" ? "node.exe" : "node", ["-v"]),
  ]);
  let devices = [];
  if (sdk) {
    const adb = path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    const { ok, text } = await run(adb, ["devices"]);
    if (ok)
      devices = text
        .split(/\r?\n/)
        .slice(1)
        .filter((l) => /\tdevice$/.test(l))
        .map((l) => l.split("\t")[0]);
  }
  const problems = [];
  if (!java || java.major < 17) problems.push("Falta Java 17+ (instala Android Studio o un JDK 21 de adoptium.net).");
  if (!sdk) problems.push("Falta el SDK de Android (abre Android Studio una vez o define ANDROID_HOME).");
  if (!node.ok) problems.push("Falta Node.js (nodejs.org, versión LTS).");
  return {
    text: problems.length
      ? `Este PC aún no puede compilar el APK: ${problems.join(" ")}`
      : `Este PC puede compilar el APK (JDK ${java.major}${java.major >= 21 ? "" : ", se usará Capacitor 6"}).` +
        (devices.length ? ` Móvil conectado: ${devices.join(", ")}.` : " No hay móvil conectado por USB."),
    ready: problems.length === 0,
    java,
    androidSdk: sdk,
    node: node.ok ? node.text : null,
    devices,
    command:
      'powershell -ExecutionPolicy Bypass -File docs\\build-android.ps1 -Export "<carpeta exportada>" [-Install]',
  };
}

const HELP =
  'Juegos para móvil: pide en el chat de un juego "hazlo para móvil" o "crea un juego de móvil". ' +
  "El agente prepara controles táctiles, la PWA y un script que genera el APK de Android con Capacitor " +
  "(necesitas Node.js, Java 17+ y el SDK de Android; «Comprobar este PC» te dice qué falta). Guía completa en docs/MOBILE.md del juego.";

export async function activate() {
  return {
    async tool(name, args, ctx) {
      if (name === "status") return status(ctx);
      if (name === "prepare") return prepare(args ?? {}, ctx);
      if (name === "android-env") return androidEnv();
      throw new Error(`Herramienta desconocida: ${name}`);
    },
    async action(name) {
      if (name === "help") return { text: HELP };
      if (name === "android-env") return androidEnv();
      throw new Error(`Acción desconocida: ${name}`);
    },
  };
}
