# Builds bboxai-desktop-setup-<version>.exe. Run on Windows (needs Inno
# Setup's ISCC.exe, Node.js for the bbox-web build, and internet access to
# fetch nssm.exe). Pre-builds bbox-web once here so end users never need
# Node.js at install time.
param(
    [string]$IsccPath = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceDir = Resolve-Path (Join-Path $ScriptDir "..\..\..")
$StageDir  = Join-Path $ScriptDir "stage"

Write-Host "==> Building bbox-web (bundled, pre-built -- no Node needed at install time)"
Push-Location (Join-Path $SourceDir "bbox-web")
@"
VITE_API_BASE_URL=http://bboxai:8321
VITE_REMOTE=false
VITE_APP_TITLE=bboxAI-Desktop
"@ | Out-File -Encoding ascii .env.production
$ErrorActionPreference = "Continue"
npm install --silent
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; throw "npm install failed with exit code $LASTEXITCODE" }
npm run build --silent
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; throw "npm run build failed with exit code $LASTEXITCODE" }
$ErrorActionPreference = "Stop"
Pop-Location

Write-Host "==> Staging files"
Remove-Item -Recurse -Force $StageDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$StageDir\bbox-api", "$StageDir\bbox-agent", "$StageDir\bbox-web-dist" | Out-Null

$excludeDirs = @("venv", "__pycache__", "storage", "weights")
robocopy (Join-Path $SourceDir "bbox-api") "$StageDir\bbox-api" /E /XD $excludeDirs /XF ".env" "*.pyc" | Out-Null
robocopy (Join-Path $SourceDir "bbox-agent") "$StageDir\bbox-agent" /E /XD "venv" "__pycache__" /XF "*.pyc" | Out-Null
robocopy (Join-Path $SourceDir "bbox-web\dist") "$StageDir\bbox-web-dist" /E | Out-Null

Write-Host "==> Fetching nssm.exe"
$nssmZip = Join-Path $env:TEMP "nssm.zip"
Invoke-WebRequest -Uri "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip" -OutFile $nssmZip
$nssmExtract = Join-Path $env:TEMP "nssm-extract"
Remove-Item -Recurse -Force $nssmExtract -ErrorAction SilentlyContinue
Expand-Archive -Path $nssmZip -DestinationPath $nssmExtract
Copy-Item (Get-ChildItem -Path $nssmExtract -Filter nssm.exe -Recurse | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1).FullName "$StageDir\nssm.exe"

Write-Host "==> Compiling installer with Inno Setup"
if (-not (Test-Path $IsccPath)) {
    throw "ISCC.exe not found at $IsccPath -- pass -IsccPath or install Inno Setup"
}
New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "out") | Out-Null
& $IsccPath (Join-Path $ScriptDir "bboxai-desktop.iss")

Write-Host "==> Built: $ScriptDir\out\bboxai-desktop-setup-1.2.3.exe"
