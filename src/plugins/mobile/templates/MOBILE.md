# __APP_NAME__ en el móvil

Este juego se preparó con el plugin **Juegos para móvil** de Genex Windows Community.

## Qué hay en el proyecto

| Archivo | Para qué sirve |
| --- | --- |
| `src/touch-controls.js` | Joystick táctil (mitad izquierda), mirar arrastrando (mitad derecha) y botones. Envía la entrada por `__studio.injectInput`, así que `ctx.keys` y `ctx.look` funcionan igual que con teclado y ratón. |
| `manifest.webmanifest` | Permite "Añadir a pantalla de inicio" y abrir el juego a pantalla completa (PWA). |
| `docs/build-android.ps1` | Crea un APK de Android con Capacitor a partir del juego exportado. |

## Probarlo en el PC como si fuera un móvil

Abre el juego en Chrome o Edge, pulsa F12 y activa la vista de dispositivo (Ctrl+Mayús+M). Los toques se simulan con el ratón.

## Opción 1: web / PWA (lo más fácil)

1. Exporta el juego (menú del juego › Exportar juego…).
2. Súbelo a cualquier hosting estático (GitHub Pages, itch.io, Netlify) o publícalo con Genex.
3. En el móvil ábrelo en el navegador y elige "Añadir a pantalla de inicio".

## Opción 2: APK de Android (Capacitor)

1. Exporta el juego a una carpeta fuera del juego, por ejemplo `C:\Juegos\__SLUG__-web`.
2. Instala Node.js 20+ y Android Studio.
3. En PowerShell, dentro de la carpeta del juego:

   ```powershell
   powershell -ExecutionPolicy Bypass -File docs\build-android.ps1 -Export "C:\Juegos\__SLUG__-web"
   ```

4. El APK queda en `__SLUG__-android\android\app\build\outputs\apk\debug\app-debug.apk`.

Para publicar en Google Play hace falta una versión firmada (`gradlew bundleRelease` y una clave de firma); Android Studio lo guía en Build › Generate Signed Bundle.

## iOS

Capacitor también genera proyectos de iOS (`npx cap add ios`), pero compilar para iPhone necesita un Mac con Xcode.
