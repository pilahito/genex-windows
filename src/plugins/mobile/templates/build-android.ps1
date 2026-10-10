# Genera un APK de Android a partir de este juego (plugin "Juegos para móvil" de Genex Windows Community).
#
# Antes:
#   1. En Genex: menú del juego › "Exportar juego…" a una carpeta FUERA del juego (por ejemplo C:\Juegos\__SLUG__-web).
#   2. Instala Node.js 20+ y Android Studio (trae el SDK de Android y Java 17+).
#
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File docs\build-android.ps1 -Export "C:\Juegos\__SLUG__-web"
#
# Resultado: <carpeta>\__SLUG__-android\android\app\build\outputs\apk\debug\app-debug.apk
param(
  [Parameter(Mandatory = $true)][string]$Export,
  [string]$Out = "",
  [string]$AppId = "__APP_ID__",
  [string]$AppName = "__APP_NAME__"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path (Join-Path $Export "index.html"))) { throw "No hay index.html en $Export. Exporta el juego primero." }
if (-not $Out) { $Out = Join-Path (Split-Path $Export -Parent) "__SLUG__-android" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Push-Location $Out
try {
  if (-not (Test-Path "package.json")) { npm init -y | Out-Null }
  npm install --save @capacitor/core @capacitor/cli @capacitor/android
  if (Test-Path "www") { Remove-Item -Recurse -Force "www" }
  Copy-Item -Recurse -Force $Export "www"
  if (-not (Test-Path "capacitor.config.json")) {
    @{ appId = $AppId; appName = $AppName; webDir = "www"; server = @{ androidScheme = "https" } } |
      ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 "capacitor.config.json"
  }
  if (-not (Test-Path "android")) { npx cap add android }
  npx cap sync android
  Push-Location android
  try { .\gradlew.bat assembleDebug } finally { Pop-Location }
  $apk = Join-Path $Out "android\app\build\outputs\apk\debug\app-debug.apk"
  Write-Host ""
  Write-Host "APK listo: $apk" -ForegroundColor Green
  Write-Host "Pásalo al móvil (o usa 'npx cap run android' con el móvil conectado por USB)."
} finally { Pop-Location }
