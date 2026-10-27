# Builds bboxai-desktop-setup-<version>.exe. Run on Windows (needs Inno
# Setup's ISCC.exe, Node.js for the bbox-web build, and internet access to
# fetch nssm.exe). Pre-builds bbox-web once here so end users never need
# Node.js at install time.
param(
    [string]$IsccPath = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    # Local win64 nssm.exe to use when nssm.cc is down (it 503s often); by
    # default a winget-installed copy (winget install NSSM.NSSM) is tried
    [string]$NssmPath = ""
)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceDir = Resolve-Path (Join-Path $ScriptDir "..\..\..")
$StageDir  = Join-Path $ScriptDir "stage"

# Bundled interpreter -- bump all three together (SHA256 from the release's SHA256SUMS)
$PythonVersion = "3.11.17"
$PythonBuild   = "20261003"
$PythonSha256  = "0f7defa7a0ed99b61e0df0bba5027474711521f1307cc3830c2f456401beeed5"

Write-Host "==> Building bbox-web (bundled, pre-built -- no Node needed at install time)"
Push-Location (Join-Path $SourceDir "bbox-web")
@"
VITE_API_BASE_URL=http://localhost:8321
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

Write-Host "==> Fetching bundled Python $PythonVersion (python-build-standalone $PythonBuild)"
# A private interpreter shipped inside {app}\python, so the install never
# depends on whatever Python the user has (or doesn't have). Relying on the
# user's own Python broke real installs: a too-new one passes a ">= 3.11"
# check but may have no wheels for the pinned torch (2.6.0 stops at 3.13),
# and the winget fallback doesn't exist on every Windows edition. python-build-standalone's
# install_only build (unlike python.org's embeddable zip) ships venv + pip.
$pyTgzName = "cpython-$PythonVersion+$PythonBuild-x86_64-pc-windows-msvc-install_only.tar.gz"
$pyTgz = Join-Path $env:TEMP $pyTgzName
Invoke-WebRequest -Uri "https://github.com/astral-sh/python-build-standalone/releases/download/$PythonBuild/$($pyTgzName -replace '\+', '%2B')" -OutFile $pyTgz
$pyHash = (Get-FileHash -Algorithm SHA256 $pyTgz).Hash.ToLower()
if ($pyHash -ne $PythonSha256) { throw "Bundled Python checksum mismatch: got $pyHash, expected $PythonSha256" }
$pyExtract = Join-Path $env:TEMP "bboxai-python-extract"
Remove-Item -Recurse -Force $pyExtract -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $pyExtract | Out-Null
tar -xzf $pyTgz -C $pyExtract
if ($LASTEXITCODE -ne 0) { throw "Extracting $pyTgzName failed with exit code $LASTEXITCODE" }
# .pdb debug symbols are over half the archive (~80 of ~150 MB) and unused at runtime
robocopy (Join-Path $pyExtract "python") "$StageDir\python" /E /XF "*.pdb" | Out-Null
if (-not (Test-Path "$StageDir\python\python.exe")) { throw "Bundled Python staging failed: $StageDir\python\python.exe missing" }

Write-Host "==> Fetching nssm.exe"
$nssmZip = Join-Path $env:TEMP "nssm.zip"
$nssmExtract = Join-Path $env:TEMP "nssm-extract"
Remove-Item -Recurse -Force $nssmExtract -ErrorAction SilentlyContinue
try {
    Invoke-WebRequest -Uri "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip" -OutFile $nssmZip
    Expand-Archive -Path $nssmZip -DestinationPath $nssmExtract
} catch {
    Write-Host "    nssm.cc download failed ($($_.Exception.Message)) -- looking for a local copy"
    if (-not $NssmPath) {
        $NssmPath = (Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter nssm.exe -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "win64" } | Select-Object -First 1).FullName
    }
}
if (Test-Path $nssmExtract) {
    $NssmPath = (Get-ChildItem -Path $nssmExtract -Filter nssm.exe -Recurse | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1).FullName
}
if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    throw "No nssm.exe: nssm.cc is unreachable and no local copy found -- pass -NssmPath or winget install NSSM.NSSM"
}
Write-Host "    using $NssmPath"
Copy-Item $NssmPath "$StageDir\nssm.exe"

Write-Host "==> Compiling installer with Inno Setup"
if (-not (Test-Path $IsccPath)) {
    throw "ISCC.exe not found at $IsccPath -- pass -IsccPath or install Inno Setup"
}
New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "out") | Out-Null
& $IsccPath (Join-Path $ScriptDir "bboxai-desktop.iss")

Write-Host "==> Built: $ScriptDir\out\bboxai-desktop-setup-1.3.0.exe"
