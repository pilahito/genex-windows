# Análisis de APK (APK analysis)

Read this when the user wants to analyse, decompile, inspect or reverse-engineer an Android APK
("analiza este APK", "descompila", "ingeniería inversa", "qué permisos tiene", "con qué motor está hecho").
Answer in the user's language (Spanish by default in this build).

## Allowed use

- Only APKs the user made, or apps whose author gave permission, for learning, debugging,
  auditing their own app, interoperability or recovering their own lost source.
- Ask once, briefly, if it is unclear that the APK is theirs or permitted. Do not lecture.
- Never help to: remove licence checks, DRM, ads or anti-cheat; unlock paid content; repackage,
  re-sign or redistribute someone else's app; extract other people's API keys or credentials to use them;
  cheat in online games. The plugin has no rebuild/sign tool on purpose: do not run `apktool b`,
  `apksigner` or similar yourself to get around that.

## Tools

| Tool | What it does |
| --- | --- |
| `apk__status` | Java/apktool/jadx found? Analyses in this game and their state. Use first, and to follow a running decompile. |
| `apk__decompile` | `apk` (absolute path or relative to the game, e.g. `apk/juego.apk`), optional `name`, `tool` (`both`, `apktool`, `jadx`), `overwrite`. Output: `apk-analysis/<name>/apktool/`, `jadx/sources/`, `INFORME.md`. |
| `apk__inspect` | Structured summary of a finished analysis; rewrites `INFORME.md`. |
| `apk__search` | Text search in code/resources/manifest; returns `file:line`. |

## Steps

1. `apk__status`. If tools are missing, tell the user to press **Instalar herramientas (apktool + jadx)**
   in Plugins › Análisis de APK (and to install a JDK 21 if Java is missing). Stop until it is ready.
2. Get the APK path. If the user attached or mentioned a file, use its absolute path; otherwise ask
   them to copy it into the game's `apk/` folder.
3. `apk__decompile`. Start with `tool: "apktool"` when they only want permissions/resources (fast);
   use `both` when they want code. If it answers `running: true`, wait and call `apk__status`
   (do not start it again).
4. `apk__inspect`, then explain in plain Spanish: what the app is (package, version, SDKs), the
   engine, sensitive permissions and why an app might need them, exported components, native ABIs,
   and where to look next (`jadx/sources/<package path>`, `apktool/res/values/strings.xml`, `assets/`).
5. For specific questions use `apk__search` and open the files it points to with your normal read
   tools. Quote short snippets only.
6. If they want to port or remake their own game in Genex, propose a plan using what you found
   (scenes, assets in `assets/`, textures in `res/`), and rebuild it as a new three.js game; do not
   copy third-party assets.

## Notes

- jadx output is approximate Java: it may not compile, and obfuscated names (a, b, c…) are normal.
- Unity games keep logic in `libil2cpp.so` / `assets/bin/Data` (not readable as Java); say so.
- Results live inside the game folder but are ignored by its history (`apk-analysis/.gitignore`); only `INFORME.md` is kept.
