; Genex Windows Community — asistente de instalación (Inno Setup 6).
; Compilar: node scripts/build-installer.mjs  (después de "npm run package" o "npm run make").
; Parámetros que pasa el script: /DAppVersion=x.y.z /DSourceDir=<carpeta empaquetada> /DOutputDir=<salida> /DRepoRoot=<repo>

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef RepoRoot
  #define RepoRoot "..\.."
#endif

#define AppName "Genex Windows Community"
#define AppExe "genex-community.exe"
#define AppPublisher "Genex Windows Community"
#define AppURL "https://github.com/pilahito/genex-windows"
; Must match APP_USER_MODEL_ID in src/main/windows-install.ts (taskbar grouping and notifications).
#define AppUserModelID "games.genex.desktop"
#define PluginsRel "resources\app.asar.unpacked\dist\resources"

[Setup]
AppId={{6B0E5C1E-2F4D-4C61-9A57-7E3B4D2C9A18}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
VersionInfoVersion={#AppVersion}
; Per-user by default (%LOCALAPPDATA%\Programs\...); the first page lets the user pick "all users" (Program Files).
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DisableDirPage=no
DefaultGroupName={#AppName}
DisableWelcomePage=no
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
LicenseFile={#RepoRoot}\LICENSE
SetupIconFile={#RepoRoot}\build\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardSizePercent=110
ShowLanguageDialog=yes
LanguageDetectionMethod=none
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=yes
RestartApplications=no
OutputDir={#OutputDir}
OutputBaseFilename=GenexWindowsCommunity-Setup-{#AppVersion}
SetupLogging=yes

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"; InfoBeforeFile: "{#RepoRoot}\build\windows\info-es.txt"
Name: "en"; MessagesFile: "compiler:Default.isl"; InfoBeforeFile: "{#RepoRoot}\build\windows\info-en.txt"

[Messages]
es.WelcomeLabel2=Se instalará [name/ver] en tu equipo.%n%nGenex Windows Community es una versión para Windows basada en el código base de Genex, con algunas mejoras. Es NO OFICIAL: todo el mérito del programa original es de sus autores (genex.games, github.com/genex-games/genex-desktop), que lo publican con licencia MIT.%n%nSe recomienda cerrar Genex antes de continuar.
en.WelcomeLabel2=This will install [name/ver] on your computer.%n%nGenex Windows Community is a Windows version based on the Genex code base, with some improvements. It is UNOFFICIAL: all credit for the original program goes to its authors (genex.games, github.com/genex-games/genex-desktop), who release it under the MIT license.%n%nIt is recommended that you close Genex before continuing.

[CustomMessages]
es.CompMain=Genex Windows Community (programa)
en.CompMain=Genex Windows Community (application)
es.CompPlugins=Plugins opcionales (puedes activarlos o quitarlos después en Plugins)
en.CompPlugins=Optional plugins (you can enable or remove them later in Plugins)
es.CompMobile=Juegos para móvil: controles táctiles, PWA y APK de Android
en.CompMobile=Mobile games: touch controls, PWA and Android APK
es.CompApk=Análisis de APK: apktool + jadx, para tus propias apps
en.CompApk=APK analysis: apktool + jadx, for your own apps
es.TaskDesktop=Crear un acceso directo en el escritorio
en.TaskDesktop=Create a desktop shortcut
es.TaskStartMenu=Crear un acceso directo en el menú Inicio
en.TaskStartMenu=Create a Start menu shortcut
es.TaskGroup=Accesos directos:
en.TaskGroup=Shortcuts:
es.LaunchNow=Abrir Genex Windows Community ahora
en.LaunchNow=Open Genex Windows Community now
es.FullInstall=Instalación completa
en.FullInstall=Full installation
es.CompactInstall=Solo el programa
en.CompactInstall=Application only
es.CustomInstall=Personalizada
en.CustomInstall=Custom
es.DeleteData=¿Borrar también tus datos de Genex Windows Community?%n%n%1%n%nIncluye ajustes, conversaciones y plugins instalados. Tus juegos (carpeta "AI Games") no se tocan.%n%nPulsa «No» para conservarlos (recomendado).
en.DeleteData=Also delete your Genex Windows Community data?%n%n%1%n%nThis includes settings, conversations and installed plugins. Your games ("AI Games" folder) are not touched.%n%nChoose "No" to keep them (recommended).

[Types]
Name: "full"; Description: "{cm:FullInstall}"
Name: "compact"; Description: "{cm:CompactInstall}"
Name: "custom"; Description: "{cm:CustomInstall}"; Flags: iscustom

[Components]
Name: "main"; Description: "{cm:CompMain}"; Types: full compact custom; Flags: fixed
Name: "plugins"; Description: "{cm:CompPlugins}"; Types: full
Name: "plugins\mobile"; Description: "{cm:CompMobile}"; Types: full
Name: "plugins\apk"; Description: "{cm:CompApk}"; Types: full

[Tasks]
Name: "startmenuicon"; Description: "{cm:TaskStartMenu}"; GroupDescription: "{cm:TaskGroup}"
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:TaskGroup}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Components: main; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelID}"; Tasks: startmenuicon
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelID}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchNow}"; Flags: nowait postinstall skipifsilent
; The in-app updater runs this installer with /SILENT /RELAUNCH=1: open Genex again when it ends.
; /DNoRelaunchRun (test builds only) leaves out the relaunch after an update.
#ifndef NoRelaunchRun
Filename: "{app}\{#AppExe}"; Flags: nowait skipifnotsilent runasoriginaluser; Check: WantsRelaunch
#endif

[UninstallDelete]
Type: files; Name: "{app}\{#PluginsRel}\community-plugins.json"

[Code]
function BoolToStr(Value: Boolean): String;
begin
  if Value then Result := 'true' else Result := 'false';
end;

{ The plugins always ship inside the app (they are a few KB); the components only decide whether
  they start enabled. The app reads this file the first time a profile installs its plugins. }
procedure WritePluginChoices();
var
  Json: String;
begin
  Json := '{ "mobile": ' + BoolToStr(WizardIsComponentSelected('plugins\mobile')) +
          ', "apk": ' + BoolToStr(WizardIsComponentSelected('plugins\apk')) + ' }';
  SaveStringToFile(ExpandConstant('{app}\{#PluginsRel}\community-plugins.json'), Json, False);
end;

function WantsRelaunch(): Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;

function GetTickCount(): DWord; external 'GetTickCount@kernel32.dll stdcall';

{ Processes whose executable lives under Dir (the app and its helpers such as srt-win.exe). }
function CountAppProcesses(Dir: String): Integer;
var
  Locator, Wmi, Procs, Proc: Variant;
  I: Integer;
  ExePath: String;
begin
  Result := 0;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Wmi := Locator.ConnectServer('.', 'root\CIMV2');
    Procs := Wmi.ExecQuery('SELECT ExecutablePath FROM Win32_Process WHERE ExecutablePath IS NOT NULL');
    for I := 0 to Procs.Count - 1 do
    begin
      Proc := Procs.ItemIndex(I);
      ExePath := Proc.ExecutablePath;
      if Pos(Lowercase(Dir), Lowercase(ExePath)) = 1 then Result := Result + 1;
    end;
  except
    Log('Could not list processes: ' + GetExceptionMessage);
    Result := 0;
  end;
end;

{ The in-app updater starts this installer (/RELAUNCH=1) and then quits, but the app needs some
  seconds to stop the studio and its sandbox. Files still in use make a silent install roll back,
  so on an update wait (up to three minutes) until nothing runs from the install folder. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Dir: String;
  Start, Elapsed: DWord;
  Left: Integer;
begin
  Result := '';
  if not WantsRelaunch() then exit;
  Dir := AddBackslash(ExpandConstant('{app}'));
  Start := GetTickCount();
  Left := CountAppProcesses(Dir);
  while (Left > 0) and (GetTickCount() - Start < 180000) do
  begin
    Sleep(500);
    Left := CountAppProcesses(Dir);
  end;
  Elapsed := (GetTickCount() - Start) div 1000;
  Log(Format('Update: waited %d s for the app to close (%d processes left).', [Integer(Elapsed), Left]));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then WritePluginChoices();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep <> usPostUninstall then exit;
  Data := ExpandConstant('{userappdata}\{#AppName}');
  if UninstallSilent() or not DirExists(Data) then exit;
  if MsgBox(FmtMessage(CustomMessage('DeleteData'), [Data]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DelTree(Data, True, True, True);
end;
