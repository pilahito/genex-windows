# Google (Gemini y Drive), Grok y extensiones MCP del navegador

## Gemini como modelo

**Con API key (funciona ya, v0.1.7).** Saca una clave en <https://aistudio.google.com/apikey> y,
con Genex cerrado, edita `%APPDATA%\Genex Windows Community\community.json` (preset
**Google Gemini (API key)**):

```json
"openaiCompatible": { "preset": "gemini", "apiKey": "TU_CLAVE", "defaultModel": "gemini-2.5-flash" }
```

Esto sustituye a Jan como proveedor compatible con OpenAI (solo hay uno a la vez); para volver a Jan pon `"preset": "jan"`.

La API de Gemini tiene su propio nivel gratuito y su facturación; **no usa la cuota de Google AI Pro**.

**Con tu cuenta de Google (Google AI Pro), sin API key: todavía no.** Eso se hace con
Gemini CLI (`npm i -g @google/gemini-cli`, luego `gemini` › «Login with Google»), que usa la cuota
de tu suscripción. Genex aún no tiene un motor «Gemini CLI» como los de Claude Code y Codex;
está anotado como siguiente paso del fork. Mientras tanto puedes usar Gemini CLI en una terminal
aparte sobre la carpeta del juego (`%USERPROFILE%\AI Games\<juego>`).

## Grok (xAI) como modelo

Igual que Gemini, con una clave de la API de xAI (<https://console.x.ai>, se factura aparte de la
suscripción de Grok/X Premium):

```json
"openaiCompatible": { "preset": "xai", "apiKey": "TU_CLAVE_XAI", "defaultModel": "grok-4" }
```

## Google Drive por MCP

Google publica un servidor MCP oficial para Drive (`https://drivemcp.googleapis.com/mcp/v1`,
Streamable HTTP + OAuth 2.0), pero está en *Developer Preview* y exige **tu propio proyecto de
Google Cloud y un cliente OAuth** (Google no permite un inicio de sesión compartido sin verificar).
El inicio de sesión de Genex para conectores por URL usa registro dinámico de clientes, que ese
servidor no ofrece, así que hoy no es un botón de un clic.

Opción que funciona hoy (servidor comunitario de código abierto, inicio de sesión en tu navegador):
[`workspace-mcp`](https://github.com/taylorwilsdon/google_workspace_mcp).

1. En <https://console.cloud.google.com>: crea un proyecto, activa **Google Drive API**, configura
   la pantalla de consentimiento (Externo, añádete como usuario de prueba) y crea un **ID de cliente
   OAuth de tipo «App de escritorio»**. Copia el ID y el secreto.
2. Instala `uv` (`winget install astral-sh.uv`).
3. En Genex: Ajustes › Conectores › «Conecta cualquier servidor MCP» › Importar, y pega:

```json
{
  "mcpServers": {
    "google-drive": {
      "command": "uvx",
      "args": ["workspace-mcp", "--tools", "drive", "--single-user"],
      "env": { "GOOGLE_OAUTH_CLIENT_ID": "", "GOOGLE_OAUTH_CLIENT_SECRET": "" }
    }
  }
}
```

4. Rellena los dos valores en los campos secretos del conector (Genex los guarda cifrados).
5. La primera vez que un agente use Drive se abrirá tu navegador para que **tú** inicies sesión con Google.

## Extensiones del navegador (Jan Browser MCP, MCP SuperAssistant)

Son otra cosa: dan herramientas MCP a chats **dentro del navegador** (Jan, ChatGPT web, DeepSeek…).
Genex no las necesita ni las usa: conecta servidores MCP directamente (sección Conectores).
Puedes tenerlas instaladas sin conflicto.

**MCP SuperAssistant dice «Server Disconnected / No tools available»** (por ejemplo en gemini.google.com):
la extensión no trae herramientas propias, necesita su proxy local encendido.

1. Abre PowerShell y arranca el proxy con tu archivo de servidores MCP:
   `npx -y @srbhptl39/mcp-superassistant-proxy@latest --config "%USERPROFILE%\mcpconfig.json"`
   (el archivo es un `{"mcpServers": {...}}` como el de arriba). Deja esa ventana abierta.
2. En la barra lateral de la extensión, comprueba que la URL del servidor es la que muestra el proxy
   (por defecto `http://localhost:3006/sse`) y pulsa **Reconnect/Refresh**.
3. Si sigue sin herramientas, revisa que el `mcpconfig.json` tenga al menos un servidor válido.
