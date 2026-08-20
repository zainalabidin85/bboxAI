# Manual override for remote access on a bboxai-desktop Windows install.
#
# install.ps1 already sets up bbox-agent and enables remote access
# automatically the first time you register a local account -- you don't
# need this script for a normal fresh install. Use it only to force a
# *different* local account to become the remote-enabled one (bbox-agent
# sticks with whichever account it picked up first).
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [string]$Username = $env:BBOXAI_USERNAME,
    [string]$Password = $env:BBOXAI_PASSWORD
)
$ErrorActionPreference = "Stop"

$NssmExe = Join-Path $AppDir "nssm.exe"
$ApiBase = "http://localhost:8321"
$AgentCredentialsFile = Join-Path $DataDir "agent-credentials.json"

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
    throw "Login failed against $ApiBase -- check the username/password. ($($_.Exception.Message))"
}
Write-Host "    login OK"

Write-Host "==> Writing credentials for bbox-agent to pick up"
$credsJson = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
Set-Content -Path $AgentCredentialsFile -Value $credsJson -Encoding ascii -NoNewline

Write-Host "==> Restarting bboxai-agent to pick it up"
& $NssmExe restart bboxai-agent

Write-Host "==> Waiting for the agent to connect..."
Start-Sleep -Seconds 4
Write-Host ""
Write-Host "================================================================"
Get-Content (Join-Path $DataDir "agent.log") -Tail 20
Write-Host "================================================================"
Write-Host ""
Write-Host "If it says 'Tunnel connected.', log in at"
Write-Host "  https://bboxai-remote.unitani.com"
Write-Host "with account '$Username' from anywhere."
Write-Host "================================================================"
