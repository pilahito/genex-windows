// Análisis de APK — Genex Windows Community.
// Descompila y analiza APK de Android con apktool y jadx para estudiar TUS PROPIAS apps (o apps cuyo
// autor te ha dado permiso): manifiesto, permisos, recursos, motor del juego y código Java/Kotlin.
// Solo análisis: no recompila, no firma, no quita protecciones ni DRM. Los resultados van a
// <juego abierto>/apk-analysis/<nombre>/.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const OUT_DIR = "apk-analysis";
/** How long one tool call waits for a decompile before answering "still running". */
const WAIT_MS = 150_000;
/** A decompile that runs longer than this is stopped. */
const JOB_LIMIT_MS = 45 * 60_000;

/** Pinned official releases the "Instalar herramientas" action downloads, verified by SHA-256. */
const PINNED = {
  apktool: {
    version: "3.0.3",
    url: "https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar",
    sha256: "dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423",
  },
  jadx: {
    version: "1.5.6",
    url: "https://github.com/skylot/jadx/releases/download/v1.5.6/jadx-1.5.6.zip",
    sha256: "545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974",
  },
};

const present = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const run = (file, args, timeout = 20_000) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, encoding: "utf8", maxBuffer: 4 << 20 },
      (error, stdout, stderr) => resolve({ ok: !error, text: `${stdout ?? ""}${stderr ?? ""}`.trim() }),
    );
  });

/** Where the tools are installed by default: G:\Dev\tools when that folder exists, else %LOCALAPPDATA%. */
function toolRoots() {
  const roots = [];
  if (process.env.GENEX_APK_TOOLS) roots.push(process.env.GENEX_APK_TOOLS);
  if (WIN) roots.push("G:\\Dev\\tools");
  roots.push(
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "GenexCommunity", "tools"),
  );
  return roots;
}

/** The major Java version in `java -version` output ("1.8.0" is 8, "21.0.2" is 21); 0 when unknown. */
function javaMajor(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return 0;
  return m[1] === "1" ? Number(m[2]) : Number(m[1]);
}

async function findJava() {
  const exe = WIN ? "java.exe" : "java";
  const homes = [
    process.env.JAVA_HOME,
    WIN && "G:\\Dev\\jdk21",
    WIN && "G:\\Dev\\jdk17",
    WIN && "C:\\Program Files\\Android\\Android Studio\\jbr",
  ].filter(Boolean);
  let best = null;
  const consider = async (java) => {
    const { ok, text } = await run(java, ["-version"]);
    if (!ok && !text) return;
    const major = javaMajor(text);
    if (major && (!best || major > best.major)) best = { java, major };
  };
  for (const home of homes) {
    const java = path.join(home, "bin", exe);
    if (await present(java)) await consider(java);
  }
  if (!best) await consider(exe); // PATH
  return best;
}

async function findApktool() {
  const candidates = [process.env.APKTOOL_JAR, ...toolRoots().map((r) => path.join(r, "apktool", "apktool.jar"))];
  for (const c of candidates) if (c && (await present(c))) return c;
  return null;
}

async function findJadx() {
  const homes = [process.env.JADX_HOME, ...toolRoots().map((r) => path.join(r, "jadx"))].filter(Boolean);
  for (const home of homes) {
    const names = await readdir(path.join(home, "lib")).catch(() => []);
    const jar = names.find((n) => /^jadx-.*-all\.jar$/.test(n));
    if (jar) return path.join(home, "lib", jar);
  }
  return null;
}

async function tools() {
  const [java, apktool, jadx] = await Promise.all([findJava(), findApktool(), findJadx()]);
  return { java, apktool, jadx };
}

const slugify = (text) =>
  String(text || "apk")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.apk$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "apk";

function projectDir(ctx) {
  if (!ctx.directory)
    throw new Error("Abre un juego (proyecto) primero: los resultados se guardan en su carpeta apk-analysis/.");
  return ctx.directory;
}

/** An APK the user named: absolute, or relative to the open project. Must exist and end in .apk/.xapk-free. */
async function resolveApk(ctx, given) {
  if (!given)
    throw new Error(
      "Indica la ruta del APK (por ejemplo C:\\Users\\<tu usuario>\\Downloads\\mi-juego.apk o apk/mi-juego.apk).",
    );
  const raw = String(given)
    .trim()
    .replace(/^"(.*)"$/, "$1");
  const file = path.isAbsolute(raw) ? raw : path.join(projectDir(ctx), raw);
  if (!/\.(apk|aab)$/i.test(file)) throw new Error("El archivo debe ser .apk (o .aab para inspeccionar recursos).");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`No encuentro el APK: ${file}`);
  return { file, bytes: info.size };
}

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

/** Running decompiles, by analysis folder. */
const jobs = new Map();

function runJob(cmd, args, log) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (b) => {
      tail = (tail + b.toString()).slice(-6000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill(), JOB_LIMIT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, tail: String(e.message) });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      void writeFile(log, tail).catch(() => {});
      resolve({ code, tail });
    });
  });
}

async function writeState(dir, state) {
  await writeFile(path.join(dir, "estado.json"), `${JSON.stringify(state, null, 2)}\n`);
}

async function readState(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, "estado.json"), "utf8"));
  } catch {
    return null;
  }
}

async function decompile(args, ctx) {
  const root = projectDir(ctx);
  const { file, bytes } = await resolveApk(ctx, args.apk);
  const t = await tools();
  if (!t.java || t.java.major < 11)
    throw new Error(
      "Falta Java (17 o superior). Instala un JDK 21 (adoptium.net) o Android Studio, o define JAVA_HOME.",
    );
  const which = ["both", "apktool", "jadx"].includes(args.tool) ? args.tool : "both";
  if (which !== "jadx" && !t.apktool)
    throw new Error("Falta apktool. Usa la acción «Instalar herramientas» del plugin.");
  if (which !== "apktool" && !t.jadx) throw new Error("Falta jadx. Usa la acción «Instalar herramientas» del plugin.");
  const name = slugify(args.name || path.basename(file));
  const rel = `${OUT_DIR}/${name}`;
  const dir = path.join(root, OUT_DIR, name);
  if (jobs.has(dir))
    return { text: `Ya se está descompilando ${name}. Consulta apk__status.`, running: true, folder: rel };
  const previous = await readState(dir);
  if (previous?.state === "done" && !args.overwrite)
    return {
      text: `${name} ya estaba analizado. Usa apk__inspect, apk__search o overwrite=true para repetir.`,
      folder: rel,
      state: previous,
    };
  await mkdir(path.join(root, OUT_DIR), { recursive: true });
  // Decompiled code is large: keep it out of the game's history, keep the report.
  await writeFile(path.join(root, OUT_DIR, ".gitignore"), "*\n!.gitignore\n!*/\n!*/INFORME.md\n");
  if (args.overwrite) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const digest = await sha256(file);
  const state = { state: "running", apk: file, bytes, sha256: digest, tool: which, started: new Date().toISOString() };
  await writeState(dir, state);
  const work = (async () => {
    const results = {};
    if (which !== "jadx") {
      const out = path.join(dir, "apktool");
      await rm(out, { recursive: true, force: true });
      results.apktool = await runJob(
        t.java.java,
        ["-jar", t.apktool, "d", "-f", "-o", out, file],
        path.join(dir, "apktool.log"),
      );
    }
    if (which !== "apktool") {
      const out = path.join(dir, "jadx");
      results.jadx = await runJob(
        t.java.java,
        [
          "-Xms256M",
          "-XX:MaxRAMPercentage=60.0",
          "-cp",
          t.jadx,
          "jadx.cli.JadxCLI",
          "--show-bad-code",
          "-d",
          out,
          file,
        ],
        path.join(dir, "jadx.log"),
      );
    }
    // jadx exits non-zero when some methods fail to decompile; what it wrote is still useful.
    const failed = Object.entries(results)
      .filter(([k, r]) => r.code !== 0 && !(k === "jadx" && /ERROR|WARN/.test(r.tail) && r.code === 1))
      .map(([k]) => k);
    const finished = { ...state, state: failed.length ? "failed" : "done", failed, ended: new Date().toISOString() };
    await writeState(dir, finished);
    if (!failed.length || which === "both") await report(dir, rel).catch(() => {});
    return finished;
  })().finally(() => jobs.delete(dir));
  jobs.set(dir, work);
  const done = await Promise.race([work, new Promise((r) => setTimeout(() => r(null), WAIT_MS))]);
  if (!done)
    return {
      text: `Descompilando ${name} (sigue en segundo plano; un APK grande tarda varios minutos). Llama a apk__status en un rato.`,
      running: true,
      folder: rel,
    };
  if (done.state === "failed")
    return {
      text: `La descompilación falló en: ${done.failed.join(", ")}. Mira ${rel}/apktool.log o ${rel}/jadx.log.`,
      folder: rel,
      state: done,
    };
  const summary = await inspectDir(dir, rel);
  return { text: `APK descompilado en ${rel}/ (informe: ${rel}/INFORME.md).`, folder: rel, ...summary };
}

/** Attribute values of every `<tag ... android:name="…">` in a decoded manifest. */
function components(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "g");
  for (const m of xml.matchAll(re)) {
    const name = /android:name="([^"]+)"/.exec(m[1])?.[1];
    if (!name) continue;
    const exported = /android:exported="true"/.test(m[1]);
    out.push(exported ? `${name} (exported)` : name);
  }
  return out;
}

async function listFiles(dir, depth = 3) {
  const out = [];
  async function walk(d, level) {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (level < depth) await walk(full, level + 1);
      } else out.push(full);
    }
  }
  await walk(dir, 0);
  return out;
}

const ENGINES = [
  [
    "Unity",
    (f) => f.some((x) => /libunity\.so$|libil2cpp\.so$/.test(x)) || f.some((x) => /assets[\\/]bin[\\/]Data/.test(x)),
  ],
  ["Godot", (f) => f.some((x) => /libgodot.*\.so$/.test(x))],
  ["Unreal Engine", (f) => f.some((x) => /libUE4\.so$|libUnreal\.so$/.test(x))],
  ["Flutter", (f) => f.some((x) => /libflutter\.so$/.test(x))],
  ["React Native", (f) => f.some((x) => /libreactnativejni\.so$|index\.android\.bundle$/.test(x))],
  ["Capacitor / Cordova (web)", (f) => f.some((x) => /assets[\\/](public|www)[\\/]index\.html$/.test(x))],
  ["Cocos", (f) => f.some((x) => /libcocos.*\.so$/.test(x))],
  ["libGDX", (f) => f.some((x) => /libgdx\.so$/.test(x))],
];

async function inspectDir(dir, rel) {
  const apktoolDir = path.join(dir, "apktool");
  const manifest = await readFile(path.join(apktoolDir, "AndroidManifest.xml"), "utf8").catch(() => "");
  const yml = await readFile(path.join(apktoolDir, "apktool.yml"), "utf8").catch(() => "");
  const pick = (re, text) => re.exec(text)?.[1] ?? null;
  const files = (await listFiles(apktoolDir, 6)).map((f) => path.relative(apktoolDir, f));
  const libs = files.filter((f) => /^lib[\\/]/.test(f) && f.endsWith(".so"));
  const abis = [...new Set(libs.map((f) => f.split(/[\\/]/)[1]))];
  const state = await readState(dir);
  const jadxFiles = await listFiles(path.join(dir, "jadx", "sources"), 12);
  const info = {
    package: pick(/package="([^"]+)"/, manifest),
    versionName: pick(/versionName:\s*'?([^'\n]+)'?/, yml),
    versionCode: pick(/versionCode:\s*'?(\d+)/, yml),
    minSdk: pick(/minSdkVersion:\s*'?(\d+)/, yml),
    targetSdk: pick(/targetSdkVersion:\s*'?(\d+)/, yml),
    permissions: [...manifest.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name="([^"]+)"/g)].map((m) => m[1]),
    activities: components(manifest, "activity"),
    services: components(manifest, "service"),
    receivers: components(manifest, "receiver"),
    providers: components(manifest, "provider"),
    debuggable: /android:debuggable="true"/.test(manifest),
    allowBackup: /android:allowBackup="true"/.test(manifest),
    cleartextTraffic: /android:usesCleartextTraffic="true"/.test(manifest),
    engine: ENGINES.filter(([, test]) => test(files)).map(([n]) => n),
    abis,
    nativeLibs: libs.slice(0, 40),
    smaliFolders: [...new Set(files.map((f) => f.split(/[\\/]/)[0]).filter((d) => /^smali/.test(d)))],
    assets: files.filter((f) => /^assets[\\/]/.test(f)).length,
    javaSources: jadxFiles.filter((f) => /\.(java|kt)$/.test(f)).length,
    apk: state?.apk ?? null,
    sha256: state?.sha256 ?? null,
    folder: rel,
  };
  return info;
}

const DANGEROUS =
  /(CAMERA|RECORD_AUDIO|READ_CONTACTS|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_SMS|SEND_SMS|READ_PHONE_STATE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_|POST_NOTIFICATIONS|SYSTEM_ALERT_WINDOW|REQUEST_INSTALL_PACKAGES|QUERY_ALL_PACKAGES)/;

async function report(dir, rel) {
  const i = await inspectDir(dir, rel);
  const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (ninguno)");
  const md = `# Informe de APK: ${i.package ?? path.basename(dir)}

Generado por el plugin **Análisis de APK** de Genex Windows Community. Uso permitido: tus propias apps
o apps cuyo autor te ha dado permiso. Solo análisis.

| Campo | Valor |
| --- | --- |
| APK | ${i.apk ?? "?"} |
| SHA-256 | ${i.sha256 ?? "?"} |
| Paquete | ${i.package ?? "?"} |
| Versión | ${i.versionName ?? "?"} (${i.versionCode ?? "?"}) |
| SDK mín. / objetivo | ${i.minSdk ?? "?"} / ${i.targetSdk ?? "?"} |
| Motor detectado | ${i.engine.join(", ") || "Android nativo (Java/Kotlin) o desconocido"} |
| ABIs nativas | ${i.abis.join(", ") || "ninguna"} |
| Fuentes Java/Kotlin (jadx) | ${i.javaSources} |
| Archivos en assets/ | ${i.assets} |
| debuggable / allowBackup / tráfico HTTP sin cifrar | ${i.debuggable} / ${i.allowBackup} / ${i.cleartextTraffic} |

## Permisos
${list(i.permissions.map((p) => (DANGEROUS.test(p) ? `${p} ⚠️ sensible` : p)))}

## Actividades
${list(i.activities)}

## Servicios
${list(i.services)}

## Receptores
${list(i.receivers)}

## Proveedores
${list(i.providers)}

## Carpetas
- \`apktool/\`: manifiesto decodificado, recursos (\`res/\`), \`assets/\`, smali.
- \`jadx/sources/\`: código Java descompilado (aproximado; puede no compilar).
`;
  const tmp = path.join(dir, "INFORME.md.tmp");
  await writeFile(tmp, md);
  await rename(tmp, path.join(dir, "INFORME.md"));
  return i;
}

async function analysisDir(ctx, name) {
  const root = projectDir(ctx);
  const base = path.join(root, OUT_DIR);
  const names = (await readdir(base, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (!names.length) throw new Error("Aún no hay análisis en este juego. Usa apk__decompile primero.");
  let chosen = names.length === 1 ? names[0] : null;
  if (name) chosen = slugify(name);
  if (!chosen || !names.includes(chosen)) throw new Error(`Indica cuál (name): ${names.join(", ")}`);
  return { dir: path.join(base, chosen), rel: `${OUT_DIR}/${chosen}` };
}

async function inspect(args, ctx) {
  const { dir, rel } = await analysisDir(ctx, args.name);
  const info = await report(dir, rel);
  return { text: `Resumen de ${info.package ?? rel} (también en ${rel}/INFORME.md).`, ...info };
}

const SEARCH_SCOPES = {
  recursos: ["apktool/res", "apktool/AndroidManifest.xml"],
  codigo: ["jadx/sources"],
  todo: ["jadx/sources", "apktool/res", "apktool/AndroidManifest.xml", "apktool/assets"],
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded walk over the analysis folders.
async function search(args, ctx) {
  const query = String(args.query ?? "").trim();
  if (query.length < 2) throw new Error("Escribe al menos 2 caracteres para buscar.");
  const { dir, rel } = await analysisDir(ctx, args.name);
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
  const where = SEARCH_SCOPES[args.in] ?? SEARCH_SCOPES.todo;
  const needle = query.toLowerCase();
  const hits = [];
  for (const w of where) {
    const full = path.join(dir, w);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    const files = info.isFile() ? [full] : await listFiles(full, 14);
    for (const f of files) {
      if (hits.length >= limit) break;
      if (!/\.(java|kt|xml|json|txt|js|html|smali|properties|cfg|ini|yml)$/i.test(f)) continue;
      const s = await stat(f).catch(() => null);
      if (!s || s.size > 2_000_000) continue;
      const text = await readFile(f, "utf8").catch(() => "");
      if (!text.toLowerCase().includes(needle)) continue;
      const lines = text.split(/\r?\n/);
      for (let n = 0; n < lines.length && hits.length < limit; n++)
        if (lines[n].toLowerCase().includes(needle))
          hits.push(`${path.relative(dir, f).split(path.sep).join("/")}:${n + 1}: ${lines[n].trim().slice(0, 200)}`);
    }
  }
  return {
    text: hits.length
      ? `${hits.length} coincidencias de "${query}" en ${rel}.`
      : `Sin coincidencias de "${query}" en ${rel}.`,
    hits,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat report of tools and analyses.
async function status(ctx) {
  const t = await tools();
  const missing = [];
  if (!t.java) missing.push("Java 17+");
  if (!t.apktool) missing.push("apktool");
  if (!t.jadx) missing.push("jadx");
  const analyses = [];
  if (ctx?.directory) {
    const base = path.join(ctx.directory, OUT_DIR);
    for (const e of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const dir = path.join(base, e.name);
      const st = await readState(dir);
      analyses.push({
        name: e.name,
        state: jobs.has(dir) ? "running" : (st?.state ?? "unknown"),
        apk: st?.apk ?? null,
      });
    }
  }
  return {
    text: missing.length
      ? `Faltan herramientas: ${missing.join(", ")}. Usa la acción «Instalar herramientas» del plugin (o instala Java).`
      : `Listo: Java ${t.java.major}, apktool y jadx encontrados.${analyses.length ? ` Análisis en este juego: ${analyses.map((a) => `${a.name} (${a.state})`).join(", ")}.` : ""}`,
    ready: !missing.length,
    java: t.java,
    apktool: t.apktool,
    jadx: t.jadx,
    analyses,
  };
}

async function download(url, file, expected) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Descarga fallida (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== expected) throw new Error(`La suma SHA-256 no coincide para ${url} (${got}); no se instala.`);
  await writeFile(file, bytes);
}

async function installTools() {
  const root =
    toolRoots().find((r) => r === process.env.GENEX_APK_TOOLS) ??
    (WIN && (await present("G:\\Dev")) ? "G:\\Dev\\tools" : toolRoots().at(-1));
  const done = [];
  if (!(await findApktool())) {
    const dir = path.join(root, "apktool");
    await mkdir(dir, { recursive: true });
    await download(PINNED.apktool.url, path.join(dir, "apktool.jar"), PINNED.apktool.sha256);
    done.push(`apktool ${PINNED.apktool.version}`);
  }
  if (!(await findJadx())) {
    const dir = path.join(root, "jadx");
    await mkdir(dir, { recursive: true });
    const zip = path.join(dir, "jadx.zip");
    await download(PINNED.jadx.url, zip, PINNED.jadx.sha256);
    const unzip = await run(WIN ? "tar.exe" : "unzip", WIN ? ["-xf", zip, "-C", dir] : ["-o", zip, "-d", dir], 120_000);
    await rm(zip, { force: true });
    if (!unzip.ok) throw new Error(`No se pudo descomprimir jadx: ${unzip.text}`);
    done.push(`jadx ${PINNED.jadx.version}`);
  }
  const t = await tools();
  return {
    text:
      (done.length
        ? `Instalado en ${root}: ${done.join(", ")} (SHA-256 verificado).`
        : "apktool y jadx ya estaban instalados.") +
      (t.java ? "" : " Falta Java 17+: instala un JDK 21 (adoptium.net) o Android Studio."),
  };
}

const HELP =
  "Análisis de APK: pon el APK (tuyo o con permiso del autor) en la carpeta apk/ del juego o dime su ruta, y pide en el chat " +
  "«analiza este APK». El agente lo descompila con apktool y jadx en apk-analysis/<nombre>/ y te resume permisos, motor, " +
  "recursos y código. Solo análisis: no recompila, no firma ni quita protecciones.";

export async function activate() {
  return {
    async tool(name, args, ctx) {
      if (name === "status") return status(ctx);
      if (name === "decompile") return decompile(args ?? {}, ctx);
      if (name === "inspect") return inspect(args ?? {}, ctx);
      if (name === "search") return search(args ?? {}, ctx);
      throw new Error(`Herramienta desconocida: ${name}`);
    },
    async action(name, _args, ctx) {
      if (name === "help") return { text: HELP };
      if (name === "status") return status(ctx);
      if (name === "install-tools") return installTools();
      throw new Error(`Acción desconocida: ${name}`);
    },
  };
}
