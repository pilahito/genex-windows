# Genera un APK de Android a partir de este juego (plugin "Juegos para móvil" de Genex Windows Community).
#
# Antes:
#   1. En Genex: menú del juego › "Exportar juego…" a una carpeta FUERA del juego (por ejemplo C:\Juegos\__SLUG__-web).
#   2. Necesitas Node.js 20+, Java (JDK 21 recomendado; 17 también vale) y el SDK de Android
#      (Android Studio lo trae). El script los busca solo: JAVA_HOME / ANDROID_HOME, G:\Dev\jdk21,
#      G:\Dev\jdk17, G:\Dev\Android\Sdk, el JBR de Android Studio y %LOCALAPPDATA%\Android\Sdk.
#
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File docs\build-android.ps1 -Export "C:\Juegos\__SLUG__-web"
#   ... -Check          solo comprueba Java / SDK / Node, sin compilar
#   ... -Install        además instala el APK en el móvil conectado por USB (adb)
#   ... -Release        compila también la versión release (sin firmar; fírmala con tu propia clave)
#
# Resultado: <carpeta>\__SLUG__-android\android\app\build\outputs\apk\debug\app-debug.apk
param(
  [string]$Export = "",
  [string]$Out = "",
  [string]$AppId = "__APP_ID__",
  [string]$AppName = "__APP_NAME__",
  [switch]$Check,
  [switch]$Install,
  [switch]$Release
)
$ErrorActionPreference = "Stop"

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($arguments -join ' ') terminó con código $LASTEXITCODE" }
}
function JavaMajor($javaHome) {
  $java = Join-Path $javaHome "bin\java.exe"
  if (-not (Test-Path $java)) { return 0 }
  $text = (& $java -version 2>&1 | Out-String)
  if ($text -match 'version "(\d+)(\.(\d+))?') {
    $major = [int]$Matches[1]; if ($major -eq 1 -and $Matches[3]) { $major = [int]$Matches[3] }
    return $major
  }
  return 0
}

# --- Java: el más nuevo que encuentre (Capacitor 7+ pide JDK 21; con JDK 17 se usa Capacitor 6) ---
$javaCandidates = @($env:JAVA_HOME, "G:\Dev\jdk21", "C:\Program Files\Android\Android Studio\jbr", "G:\Dev\jdk17") +
  @(Get-ChildItem "C:\Program Files\Eclipse Adoptium", "C:\Program Files\Microsoft", "C:\Program Files\Java" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'jdk' } | ForEach-Object FullName)
$best = $null; $bestMajor = 0
foreach ($c in $javaCandidates) {
  if (-not $c) { continue }
  $m = JavaMajor $c
  if ($m -gt $bestMajor) { $best = $c; $bestMajor = $m }
}
if ($bestMajor -lt 17) { Fail "No encuentro Java 17 o superior. Instala Android Studio o un JDK 21 (https://adoptium.net) y vuelve a probar." }
$env:JAVA_HOME = $best
$env:Path = "$best\bin;$env:Path"
$capVersion = if ($bestMajor -ge 21) { "latest" } else { "6" }

# --- SDK de Android ---
$sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "G:\Dev\Android\Sdk", (Join-Path $env:LOCALAPPDATA "Android\Sdk")) |
  Where-Object { $_ -and (Test-Path (Join-Path $_ "platform-tools")) } | Select-Object -First 1
if (-not $sdk) { Fail "No encuentro el SDK de Android. Abre Android Studio una vez (instala el SDK) o define ANDROID_HOME." }
$env:ANDROID_HOME = $sdk; $env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$sdk\platform-tools;$env:Path"

# --- Node / npm ---
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { Fail "No encuentro Node.js (npm). Instálalo desde https://nodejs.org (versión LTS)." }

Write-Host "Java:    $best (JDK $bestMajor) -> Capacitor $capVersion"
Write-Host "SDK:     $sdk"
Write-Host "Node:    $(& node -v)"
if ($Check) { Write-Host "Todo listo para compilar." -ForegroundColor Green; exit 0 }

if (-not $Export) { Fail "Falta -Export <carpeta del juego exportado>." }
if (-not (Test-Path (Join-Path $Export "index.html"))) { Fail "No hay index.html en $Export. Exporta el juego primero (menú del juego › Exportar juego…)." }
$Export = (Resolve-Path $Export).Path
if (-not $Out) { $Out = Join-Path (Split-Path $Export -Parent) "__SLUG__-android" }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Push-Location $Out
try {
  Step "Preparando proyecto Capacitor en $Out"
  if (-not (Test-Path "package.json")) { Run "npm.cmd" @("init", "-y") | Out-Null }
  Run "npm.cmd" @("install", "--no-fund", "--no-audit", "--save", "@capacitor/core@$capVersion", "@capacitor/cli@$capVersion", "@capacitor/android@$capVersion")
  if (Test-Path "www") { Remove-Item -Recurse -Force "www" }
  Copy-Item -Recurse -Force $Export "www"
  if (-not (Test-Path "capacitor.config.json")) {
    @{ appId = $AppId; appName = $AppName; webDir = "www"; server = @{ androidScheme = "https" } } |
      ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 "capacitor.config.json"
  }
  if (-not (Test-Path "android")) { Step "Añadiendo plataforma Android"; Run "npx.cmd" @("cap", "add", "android") }
  Step "Sincronizando el juego"
  Run "npx.cmd" @("cap", "sync", "android")
  # Gradle lee el SDK de local.properties (barras normales).
  Set-Content -Encoding ASCII (Join-Path $Out "android\local.properties") ("sdk.dir=" + ($sdk -replace '\\', '/'))
  Push-Location android
  try {
    Step "Compilando APK (debug)"
    Run ".\gradlew.bat" @("assembleDebug", "--no-daemon")
    if ($Release) { Step "Compilando APK (release, sin firmar)"; Run ".\gradlew.bat" @("assembleRelease", "--no-daemon") }
  } finally { Pop-Location }
  $apk = Join-Path $Out "android\app\build\outputs\apk\debug\app-debug.apk"
  Write-Host ""
  Write-Host "APK listo: $apk" -ForegroundColor Green
  if ($Release) { Write-Host "Release (sin firmar): $(Join-Path $Out 'android\app\build\outputs\apk\release')" }
  if ($Install) {
    Step "Instalando en el móvil (activa la depuración USB)"
    Run "adb.exe" @("install", "-r", $apk)
  } else {
    Write-Host "Pásalo al móvil, o vuelve a ejecutar con -Install con el móvil conectado por USB."
  }
} finally { Pop-Location }
