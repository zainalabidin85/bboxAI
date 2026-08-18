; bboxai-desktop Windows installer.
; Built by build.ps1, which stages bbox-api/bbox-web-dist/nssm.exe into
; packaging/windows/stage/ before invoking ISCC on this script.

#define MyAppName "bboxAI Desktop"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Zainal Abidin"
#define MyAppURL "https://github.com/zainalabidin85/bboxAI"

[Setup]
AppId={{B6C1B6B4-6E9B-4B8B-9C1E-BB0XA1DE5K70}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\bboxai-desktop
DefaultGroupName=bboxAI Desktop
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputBaseFilename=bboxai-desktop-setup-{#MyAppVersion}
OutputDir=out
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "stage\bbox-api\*"; DestDir: "{app}\bbox-api"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\bbox-agent\*"; DestDir: "{app}\bbox-agent"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\bbox-web-dist\*"; DestDir: "{app}\bbox-web-dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "install.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "enable-remote.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\bboxAI Desktop"; Filename: "http://bboxai:8080"
Name: "{group}\Uninstall bboxAI Desktop"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install.ps1"" -AppDir ""{app}"" -DataDir ""{commonappdata}\bboxai-desktop"""; \
    StatusMsg: "Setting up bbox-api, downloading dependencies, and starting the service (this can take a few minutes)..."; \
    Flags: runhidden waituntilterminated
Filename: "http://bboxai:8080"; Description: "Open bboxAI Desktop"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -AppDir ""{app}"" -DataDir ""{commonappdata}\bboxai-desktop"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "UninstallBboxaiDesktop"
