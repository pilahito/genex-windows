# Mobile games (Juegos para móvil)

Read this when the user wants a game for phones or tablets ("juego de móvil", "para Android",
"para el móvil", "táctil", "APK", "PWA"), or asks to make an existing game playable on a phone.
Answer the user in their language (Spanish by default in this build).

## What "mobile" means here

A Genex game is a web page (three.js + `window.__studio`). On a phone it runs in the browser, as an
installable PWA, or wrapped as an Android APK with Capacitor. The game code stays the same game:
one input path (`ctx.keys` / `ctx.look`), one canvas, all UI through `__studio.hud`.

## Steps

1. `mobile__status` — see what is already prepared and wired.
2. `mobile__prepare` with `name` (the game's title), `orientation` (`landscape` for action/racing,
   `portrait` for puzzle/runner/idle) and optionally `appId` (`com.author.game`). It writes
   `src/touch-controls.js`, `manifest.webmanifest`, `docs/MOBILE.md` and `docs/build-android.ps1`.
   It never overwrites existing files unless `overwrite: true`.
3. Wire it (you edit the game, the tool does not):
   - `index.html`: viewport meta (`width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover`),
     `<link rel="manifest" href="manifest.webmanifest">`, and `touch-action:none; overscroll-behavior:none;
     user-select:none; -webkit-user-select:none` on `html, body`.
   - `src/main.js`, inside the FACET WIRING block when there is one: `import { installTouchControls } from "./touch-controls.js";`
     and one init line, e.g. `const touch = installTouchControls({ keys: {up:"KeyW",down:"KeyS",left:"KeyA",right:"KeyD"}, buttons: [{ key: "Space", label: "Saltar" }] });`
     Map the buttons to the keys the game already reads. Do not add a second input path.
   - Draw the controls every frame with `__studio.hud` when `touch.enabled`: `touch.state()` gives the
     stick (base and knob) and buttons in fractions of the frame height, the same units the HUD's
     arcs use. Semi-transparent, in the bottom corners, never covering the middle of the screen.
4. Make it feel right on a phone:
   - Design for the chosen orientation; keep HUD text ≥ 0.035 of the frame height; big touch targets.
   - Performance: `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`, few lights, cheap or no
     real-time shadows, instanced/merged geometry, textures ≤ 1024 px, target 60 fps on mid phones.
   - Start the game from a tap on the title (the game's `config.begin` key can be pressed by a button).
   - Pause on `visibilitychange` (hidden) and resume on return.
   - Audio starts only after the first touch (mobile browsers block autoplay).
5. Verify in the preview as usual (keyboard still works: the touch layer only adds input).
   Tell the user how to test on a phone and how to build the APK: `docs/MOBILE.md`
   (Export game… → `docs/build-android.ps1 -Export <folder>`; needs Node.js and Android Studio).

## Do not

- Do not create DOM buttons or a second canvas for touch controls.
- Do not promise an iOS build from Windows: it needs a Mac with Xcode.
- Do not publish or upload anything; building the APK runs on the user's PC by their choice.
