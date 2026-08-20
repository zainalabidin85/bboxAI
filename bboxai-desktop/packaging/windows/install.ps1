# bboxai-desktop post-install setup, run by the Inno Setup installer
# (elevated, after files are copied to $AppDir). Idempotent: safe to re-run.
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$DataDir
)
$ErrorActionPreference = "Stop"

$ApiDir       = Join-Path $AppDir "bbox-api"
$AgentDir     = Join-Path $AppDir "bbox-agent"
$NssmExe      = Join-Path $AppDir "nssm.exe"
$VenvDir      = Join-Path $DataDir "venv"
$AgentVenvDir = Join-Path $DataDir "agent-venv"
$StorageDir   = Join-Path $DataDir "storage"
$WeightsDir   = Join-Path $DataDir "weights"
$WebPort      = 8321
$RelayUrl     = "https://bboxai-relay.unitani.com"
$AgentCredentialsFile = Join-Path $DataDir "agent-credentials.json"

Write-Host "==> Ensuring data directories exist"
New-Item -ItemType Directory -Force -Path $DataDir, $StorageDir, $WeightsDir | Out-Null

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "==> Checking for Python 3.11+"
# Reject the Windows Store "app execution alias" stub
# (%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe) -- it only works for the
# interactive user who triggered it; a LocalSystem service can't access it
# at all ("file cannot be accessed by the system" when nssm tries to launch
# a venv built from it). Resolve to a real, absolute exe path instead of an
# ambient PATH lookup, so venv creation can't silently pick the stub back up.
function Get-RealPython311 {
    foreach ($cmd in @("py", "python")) {
        $info = Get-Command $cmd -ErrorAction SilentlyContinue
        if (-not $info -or $info.Source -match "WindowsApps") { continue }
        $verArgs = if ($cmd -eq "py") { @("-3.11", "--version") } else { @("--version") }
        try {
            $verOut = & $info.Source $verArgs 2>&1
            if ($verOut -match "Python 3\.(\d+)" -and [int]$Matches[1] -ge 11) {
                if ($cmd -eq "py") {
                    # resolve py -3.11's actual target interpreter path
                    $realPath = (& $info.Source "-3.11" "-c" "import sys; print(sys.executable)").Trim()
                    if ($realPath -and (Test-Path $realPath)) { return $realPath }
                } else {
                    return $info.Source
                }
            }
        } catch {}
    }
    return $null
}

$pythonExe = Get-RealPython311
if (-not $pythonExe) {
    Write-Host "    No suitable Python found -- installing Python 3.11 via winget"
    winget install --id Python.Python.3.11 -e --silent --accept-package-agreements --accept-source-agreements
    $pythonExe = Get-RealPython311
    if (-not $pythonExe) { throw "Python 3.11 install via winget did not produce a usable interpreter" }
}
Write-Host "    Using: $pythonExe"

Write-Host "==> Setting up bbox-api venv"
if (-not (Test-Path $VenvDir)) {
    & $pythonExe "-m" "venv" $VenvDir
}
$venvPython = Join-Path $VenvDir "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip -q

# psycopg2-binary is Postgres-only -- Windows uses SQLite (config.py/database.py
# already handle both), and psycopg2-binary has no prebuilt wheel for newer
# Python versions, failing to build from source without pg_config installed.
$reqSrc = Join-Path $ApiDir "requirements.txt"
$reqWin = Join-Path $DataDir "requirements-windows.txt"
(Get-Content $reqSrc) | Where-Object { $_ -notmatch '^psycopg2' } | Set-Content $reqWin

$hasNvidia = Test-Command "nvidia-smi"
if ($hasNvidia) {
    Write-Host "    NVIDIA GPU detected -- pinning CUDA 12.4 torch build"
    & $venvPython -m pip install -q torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124
    "torch==2.6.0+cu124" | Out-File -Encoding ascii (Join-Path $DataDir "constraints.txt")
    & $venvPython -m pip install -q -r $reqWin -c (Join-Path $DataDir "constraints.txt")
} else {
    Write-Host "    No NVIDIA GPU detected -- installing default (CPU) torch"
    & $venvPython -m pip install -q -r $reqWin
}

$EnvFile = Join-Path $ApiDir ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Host "==> Writing $EnvFile"
    $secretBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
    $secretKey = -join ($secretBytes | ForEach-Object { $_.ToString("x2") })

    $storagePathFwd = $StorageDir -replace '\\', '/'
    $weightsPathFwd = $WeightsDir -replace '\\', '/'
    $dbPathFwd      = (Join-Path $DataDir "bboxai.db") -replace '\\', '/'
    $webDistFwd     = (Join-Path $AppDir "bbox-web-dist") -replace '\\', '/'

    @"
STORAGE_PATH=$storagePathFwd
WEIGHTS_PATH=$weightsPathFwd
DATABASE_URL=sqlite:///$dbPathFwd
SECRET_KEY=$secretKey
ACCESS_TOKEN_EXPIRE_MINUTES=10080
CORS_ORIGINS=http://localhost:$WebPort,http://bboxai:$WebPort
WEB_DIST_PATH=$webDistFwd
AGENT_CREDENTIALS_PATH=$($AgentCredentialsFile -replace '\\', '/')
"@ | Out-File -Encoding ascii $EnvFile
} else {
    Write-Host "==> $EnvFile already exists, leaving it as-is"
}

Write-Host "==> Fetching default base model weight"
$WeightPath = Join-Path $WeightsDir "yolo11n.pt"
if (-not (Test-Path $WeightPath)) {
    Invoke-WebRequest -Uri "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt" -OutFile $WeightPath
    if ((Get-Item $WeightPath).Length -lt 100000) {
        Write-Warning "yolo11n.pt download failed -- training won't work until a valid weight is placed in $WeightsDir"
        Remove-Item $WeightPath -Force
    }
}

Write-Host "==> Registering bboxai-api Windows service"
# nssm writes "Can't open service!" to stderr when the service doesn't exist
# yet (expected on first install) -- PowerShell's $ErrorActionPreference =
# "Stop" turns that stderr output into a terminating error regardless of
# stream redirection, so these two idempotent-cleanup calls need their own
# relaxed error handling, not just 2>$null.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& $NssmExe stop bboxai-api 2>$null | Out-Null
& $NssmExe remove bboxai-api confirm 2>$null | Out-Null
$ErrorActionPreference = $prevEap
& $NssmExe install bboxai-api $venvPython "-m uvicorn main:app --host 127.0.0.1 --port $WebPort"
& $NssmExe set bboxai-api AppDirectory $ApiDir
& $NssmExe set bboxai-api Start SERVICE_AUTO_START
& $NssmExe set bboxai-api AppStdout (Join-Path $DataDir "api.log")
& $NssmExe set bboxai-api AppStderr (Join-Path $DataDir "api.log")
& $NssmExe start bboxai-api

Write-Host "==> Adding 'bboxai' hostname to the hosts file"
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$hostsContent = Get-Content $HostsPath -Raw -ErrorAction SilentlyContinue
if ($hostsContent -notmatch '(?m)^127\.0\.0\.1\s+bboxai\s*$') {
    Add-Content -Path $HostsPath -Value "`r`n127.0.0.1 bboxai"
}

Write-Host "==> Setting up bbox-agent (tunnels to $RelayUrl for remote access)"
if (-not (Test-Path $AgentVenvDir)) {
    & $pythonExe "-m" "venv" $AgentVenvDir
}
$agentPython = Join-Path $AgentVenvDir "Scripts\python.exe"
& $agentPython -m pip install --upgrade pip -q
& $agentPython -m pip install -q -r (Join-Path $AgentDir "requirements.txt")

Write-Host "==> Registering bboxai-agent Windows service"
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& $NssmExe stop bboxai-agent 2>$null | Out-Null
& $NssmExe remove bboxai-agent confirm 2>$null | Out-Null
$ErrorActionPreference = $prevEap
& $NssmExe install bboxai-agent $agentPython "-u agent.py"
& $NssmExe set bboxai-agent AppDirectory $AgentDir
& $NssmExe set bboxai-agent Start SERVICE_AUTO_START
& $NssmExe set bboxai-agent AppStdout (Join-Path $DataDir "agent.log")
& $NssmExe set bboxai-agent AppStderr (Join-Path $DataDir "agent.log")
& $NssmExe set bboxai-agent AppEnvironmentExtra `
    "BBOXAI_API_BASE=http://localhost:$WebPort" "BBOXAI_RELAY_URL=$RelayUrl" `
    "BBOXAI_CREDENTIALS_FILE=$AgentCredentialsFile"
& $NssmExe start bboxai-agent

Write-Host ""
Write-Host "================================================================"
Write-Host " bboxai-desktop installed."
Write-Host " Local UI: http://bboxai:$WebPort  (or http://localhost:$WebPort)"
Write-Host ""
Write-Host " Register an account through the UI above -- remote access via"
Write-Host " bboxai-remote.unitani.com activates automatically once you do,"
Write-Host " no separate step needed."
Write-Host "================================================================"
