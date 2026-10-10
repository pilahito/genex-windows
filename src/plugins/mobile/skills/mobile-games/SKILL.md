# Juegos para móvil (mobile games)

Read this when the user wants a game for phones or tablets ("juego de móvil", "para Android",
"para el móvil", "táctil", "APK", "PWA"), or asks to make an existing game playable on a phone.
Answer the user in their language (Spanish by default in this build). Keep replies short and
practical: what you changed, how to try it, what (if anything) they must install.

## What "mobile" means here

A Genex game is a web page (three.js + `window.__studio`). On a phone it runs in the browser, as an
installable PWA, or wrapped as an Android APK with Capacitor. The game code stays the same game:
one input path (`ctx.keys` / `ctx.look`), one canvas, all UI through `__studio.hud`.

## Tools

| Tool | When |
| --- | --- |
| `mobile__status` | First, always: what is prepared and what is wired. Again at the end to confirm `ready: true`. |
| `mobile__prepare` | Writes the kit (touch controls, PWA manifest, `docs/MOBILE.md`, `docs/build-android.ps1`). Never overwrites unless `overwrite: true`. |
| `mobile__android-env` | Only when the user wants an APK: tells whether this PC has Java 17+/21, the Android SDK, Node.js and a phone on USB. Report exactly what is missing. |

## Steps

1. `mobile__status`.
2. Choose the orientation from the genre: `landscape` for action, racing, shooters, platformers;
   `portrait` for puzzle, runner, idle, card games. Ask only if it is genuinely ambiguous.
3. `mobile__prepare` with `name`, `orientation` and optionally `appId` (`com.author.game`).
4. Wire it (you edit the game, the tool does not):
   - `index.html`: viewport meta (`width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover`),
     `<link rel="manifest" href="manifest.webmanifest">`, and `touch-action:none; overscroll-behavior:none;
     user-select:none; -webkit-user-select:none` on `html, body`.
   - `src/main.js`, inside the FACET WIRING block when there is one: `import { installTouchControls } from "./touch-controls.js";`
     and one init line, e.g. `const touch = installTouchControls({ keys: {up:"KeyW",down:"KeyS",left:"KeyA",right:"KeyD"}, buttons: [{ key: "Space", label: "Saltar" }] });`
     Map the buttons to the keys the game already reads (read `update(ctx)` first). At most 3 buttons,
     labelled in Spanish (Saltar, Disparar, Acción). Do not add a second input path.
   - Draw the controls every frame with `__studio.hud` when `touch.enabled`: `touch.state()` gives the
     stick (base and knob) and buttons in fractions of the frame height, the same units the HUD's
     arcs use. Semi-transparent, in the bottom corners, never covering the middle of the screen.
5. Make it feel right on a phone:
   - Design for the chosen orientation; keep HUD text ≥ 0.035 of the frame height; touch targets ≥ 0.09.
   - Performance: `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`, few lights, cheap or no
     real-time shadows, instanced/merged geometry, textures ≤ 1024 px, target 60 fps on mid phones.
   - Start from a tap on the title (the game's `config.begin` key can be pressed by a button).
   - Pause on `visibilitychange` (hidden) and resume on return; resize on `orientationchange`.
   - Audio starts only after the first touch (mobile browsers block autoplay).
6. Verify in the preview as usual (keyboard still works: the touch layer only adds input), then
   `mobile__status` must say `ready: true`.
7. Tell the user how to try it:
   - On the PC: Chrome/Edge → F12 → device view (Ctrl+Mayús+M).
   - APK: `mobile__android-env`; if ready, "Exportar juego…" to a folder outside the game, then
     `powershell -ExecutionPolicy Bypass -File docs\build-android.ps1 -Export "<carpeta>" -Install`
     (`-Install` needs the phone connected with USB debugging). Without Java/SDK, say what to install.

## Do not

- Do not create DOM buttons or a second canvas for touch controls.
- Do not promise an iOS build from Windows: it needs a Mac with Xcode.
- Do not run the APK build yourself or publish/upload anything; building runs on the user's PC by their choice.
