; bboxai-desktop Windows installer.
; Built by build.ps1, which stages bbox-api/bbox-web-dist/nssm.exe into
; packaging/windows/stage/ before invoking ISCC on this script.

#define MyAppName "bboxAI Desktop"
#define MyAppVersion "1.2.3"
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
Name: "{group}\bboxAI Desktop"; Filename: "http://bboxai:8321"
Name: "{group}\Uninstall bboxAI Desktop"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install.ps1"" -AppDir ""{app}"" -DataDir ""{commonappdata}\bboxai-desktop"""; \
    StatusMsg: "Setting up bbox-api, downloading dependencies, and starting the service (this can take a few minutes)..."; \
    Flags: waituntilterminated
Filename: "http://bboxai:8321"; Description: "Open bboxAI Desktop"; Flags: postinstall shellexec skipifsilent nowait

[Code]
// Uninstall.ps1 only deletes the app's data directory (accounts, project
// storage, trained weights, the Python venvs) when passed -Purge, and
// nothing here did that automatically -- a plain uninstall silently left
// gigabytes of data and every registered account sitting on disk. Prompt
// at uninstall time instead of guessing which behavior the user wants.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  PurgeArg: String;
  DataDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    DataDir := ExpandConstant('{commonappdata}\bboxai-desktop');
    PurgeArg := '';
    if MsgBox('Also delete all bboxAI data -- accounts, projects, annotations, and trained models -- stored in:' + #13#10 + DataDir + #13#10#13#10 + 'This cannot be undone. Choose No to keep this data (e.g. to reinstall later without losing it).', mbConfirmation, MB_YESNO) = IDYES then
      PurgeArg := ' -Purge';

    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}') + '\uninstall.ps1" -AppDir "' + ExpandConstant('{app}') + '" -DataDir "' + DataDir + '"' + PurgeArg, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
