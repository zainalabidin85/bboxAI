# Enables away-from-home access for a bboxai-desktop Windows install by
# setting up bbox-agent as a Windows service (via nssm), tunneling to the
# shared bbox-relay so https://bboxai-remote.unitani.com can reach this
# machine. Run this AFTER installing bboxai-desktop and registering a
# bboxAI account through the local web UI (http://bboxai:8080).
#
# Must run elevated (same as the main installer).
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [string]$Username = $env:BBOXAI_USERNAME,
    [string]$Password = $env:BBOXAI_PASSWORD
)
$ErrorActionPreference = "Stop"

$AgentDir  = Join-Path $AppDir "bbox-agent"
$NssmExe   = Join-Path $AppDir "nssm.exe"
$AgentVenv = Join-Path $DataDir "agent-venv"
$ApiBase   = "http://localhost:8080"
$RelayUrl  = "https://bboxai-relay.unitani.com"

if (-not $Username) { $Username = Read-Host "bboxAI username" }
if (-not $Password) {
    $securePw = Read-Host "bboxAI password" -AsSecureString
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw))
}

Write-Host "==> Validating login against $ApiBase"
$body = "username=$([uri]::EscapeDataString($Username))&password=$([uri]::EscapeDataString($Password))"
try {
    Invoke-RestMethod -Uri "$ApiBase/auth/login" -Method Post `
        -ContentType "application/x-www-form-urlencoded" -Body $body | Out-Null
} catch {
    throw "Login failed against $ApiBase -- register an account at http://bboxai:8080 first. ($($_.Exception.Message))"
}
Write-Host "    login OK"

Write-Host "==> Setting up bbox-agent venv"
$pythonExe = (Join-Path $DataDir "venv\Scripts\python.exe")
if (-not (Test-Path $pythonExe)) {
    throw "bbox-api venv not found at $pythonExe -- install bboxai-desktop first"
}
if (-not (Test-Path $AgentVenv)) {
    & $pythonExe "-m" "venv" $AgentVenv
}
$agentPython = Join-Path $AgentVenv "Scripts\python.exe"
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
    "BBOXAI_API_BASE=$ApiBase" "BBOXAI_RELAY_URL=$RelayUrl" `
    "BBOXAI_USERNAME=$Username" "BBOXAI_PASSWORD=$Password"
& $NssmExe start bboxai-agent

Write-Host ""
Write-Host "================================================================"
Write-Host " bbox-agent is running and tunneling to $RelayUrl."
Write-Host " Log into https://bboxai-remote.unitani.com with the same"
Write-Host " bboxAI account from anywhere."
Write-Host "================================================================"
