/**
 * Controles táctiles para móvil (plugin "Juegos para móvil" de Genex Windows Community).
 *
 * Convierte los toques en la misma entrada que ya lee update(ctx): teclas en ctx.keys y miradas en
 * ctx.look, a través de window.__studio.injectInput. Así el juego tiene UNA sola ruta de entrada y
 * los revisores de Genex lo prueban igual que con teclado y ratón.
 *
 *   import { installTouchControls } from "./touch-controls.js";
 *   const touch = installTouchControls({ buttons: [{ key: "Space", label: "Saltar" }] });
 *   // en update(): dibuja touch.state() con __studio.hud (arcos para el joystick y los botones).
 *
 * Mitad izquierda: joystick (W/A/S/D). Mitad derecha: arrastrar para mirar. Botones: círculos
 * abajo a la derecha. Todas las medidas son fracciones de la ALTURA de la pantalla, igual que el HUD.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one closure a game copies whole; its handlers share the touch state.
export function installTouchControls(options = {}) {
  const opts = {
    keys: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
    buttons: [{ key: "Space", label: "A" }],
    look: true,
    lookSensitivity: 1.4,
    deadZone: 0.25,
    stickRadius: 0.12,
    buttonRadius: 0.075,
    orientation: "landscape",
    fullscreenOnFirstTouch: true,
    force: false,
    ...options,
  };
  const touchCapable = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!touchCapable && !opts.force) return { enabled: false, state: () => null, dispose() {} };

  const studio = () => window.__studio;
  const held = new Set();
  const stick = { id: null, active: false, cx: 0, cy: 0, x: 0, y: 0 };
  const look = { id: null, x: 0, y: 0 };
  const pressed = new Map(); // touch id -> button index

  const size = () => ({ w: window.innerWidth, h: window.innerHeight });
  /** Centre of button i in pixels: a row from the bottom-right corner, leftwards. */
  const buttonCentre = (i) => {
    const { w, h } = size();
    const r = opts.buttonRadius * h;
    return { x: w - r * 1.6 - i * r * 2.4, y: h - r * 1.8 - (i % 2) * r * 1.2, r };
  };
  const buttonAt = (x, y) =>
    opts.buttons.findIndex((_, i) => {
      const c = buttonCentre(i);
      return Math.hypot(x - c.x, y - c.y) <= c.r * 1.25;
    });

  function setKeys(next) {
    const down = [...next].filter((k) => !held.has(k));
    const up = [...held].filter((k) => !next.has(k));
    if (!down.length && !up.length) return;
    for (const k of up) held.delete(k);
    for (const k of down) held.add(k);
    studio()?.injectInput?.({ down, up });
  }
  function stickKeys() {
    const next = new Set([...held].filter((k) => !Object.values(opts.keys).includes(k)));
    if (stick.active) {
      if (stick.y < -opts.deadZone) next.add(opts.keys.up);
      if (stick.y > opts.deadZone) next.add(opts.keys.down);
      if (stick.x < -opts.deadZone) next.add(opts.keys.left);
      if (stick.x > opts.deadZone) next.add(opts.keys.right);
    }
    setKeys(next);
  }
  function pressButton(index, down) {
    const key = opts.buttons[index]?.key;
    if (!key) return;
    const next = new Set(held);
    if (down) next.add(key);
    else next.delete(key);
    setKeys(next);
  }

  let firstTouch = true;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass sorts each new touch into button, stick or look.
  function onStart(event) {
    event.preventDefault();
    if (firstTouch && opts.fullscreenOnFirstTouch) {
      firstTouch = false;
      try {
        document.documentElement.requestFullscreen?.()?.catch?.(() => {});
        screen.orientation?.lock?.(opts.orientation)?.catch?.(() => {});
      } catch {}
    }
    const { w } = size();
    for (const t of event.changedTouches) {
      const b = buttonAt(t.clientX, t.clientY);
      if (b >= 0) {
        pressed.set(t.identifier, b);
        pressButton(b, true);
      } else if (t.clientX < w / 2 && stick.id === null) {
        Object.assign(stick, { id: t.identifier, active: true, cx: t.clientX, cy: t.clientY, x: 0, y: 0 });
      } else if (opts.look && look.id === null) {
        Object.assign(look, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
    }
  }
  function onMove(event) {
    event.preventDefault();
    const { h } = size();
    for (const t of event.changedTouches) {
      if (t.identifier === stick.id) {
        const r = opts.stickRadius * h;
        let dx = (t.clientX - stick.cx) / r;
        let dy = (t.clientY - stick.cy) / r;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        stick.x = dx;
        stick.y = dy;
        stickKeys();
      } else if (t.identifier === look.id) {
        const dx = (t.clientX - look.x) * opts.lookSensitivity;
        const dy = (t.clientY - look.y) * opts.lookSensitivity;
        look.x = t.clientX;
        look.y = t.clientY;
        studio()?.injectInput?.({ look: { dx, dy } });
      }
    }
  }
  function onEnd(event) {
    event.preventDefault();
    for (const t of event.changedTouches) {
      if (t.identifier === stick.id) {
        Object.assign(stick, { id: null, active: false, x: 0, y: 0 });
        stickKeys();
      } else if (t.identifier === look.id) {
        look.id = null;
      } else if (pressed.has(t.identifier)) {
        pressButton(pressed.get(t.identifier), false);
        pressed.delete(t.identifier);
      }
    }
  }

  const listen = { passive: false };
  window.addEventListener("touchstart", onStart, listen);
  window.addEventListener("touchmove", onMove, listen);
  window.addEventListener("touchend", onEnd, listen);
  window.addEventListener("touchcancel", onEnd, listen);

  return {
    enabled: true,
    /**
     * What to draw this frame, in fractions of the screen height (x from the left edge), for
     * __studio.hud arcs and text: the joystick base and knob while held, and every button.
     */
    state() {
      const { h } = size();
      return {
        stick: stick.active
          ? {
              x: stick.cx / h,
              y: stick.cy / h,
              radius: opts.stickRadius,
              knobX: (stick.cx + stick.x * opts.stickRadius * h) / h,
              knobY: (stick.cy + stick.y * opts.stickRadius * h) / h,
            }
          : null,
        buttons: opts.buttons.map((b, i) => {
          const c = buttonCentre(i);
          return { label: b.label, key: b.key, x: c.x / h, y: c.y / h, radius: c.r / h, down: held.has(b.key) };
        }),
      };
    },
    dispose() {
      window.removeEventListener("touchstart", onStart, listen);
      window.removeEventListener("touchmove", onMove, listen);
      window.removeEventListener("touchend", onEnd, listen);
      window.removeEventListener("touchcancel", onEnd, listen);
      setKeys(new Set());
    },
  };
}
