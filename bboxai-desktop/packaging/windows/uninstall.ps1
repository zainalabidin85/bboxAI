# bboxai-desktop uninstall cleanup, run by the Inno Setup uninstaller
# (elevated). $Purge = also delete the database/storage/weights.
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$DataDir,
    [switch]$Purge
)
$ErrorActionPreference = "Continue"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Start-Transcript -Path (Join-Path $DataDir "uninstall.log") -Append | Out-Null

$NssmExe = Join-Path $AppDir "nssm.exe"

Write-Host "==> Stopping and removing bboxai-api / bboxai-agent services"
if (Test-Path $NssmExe) {
    & $NssmExe stop bboxai-api 2>$null | Out-Null
    & $NssmExe remove bboxai-api confirm 2>$null | Out-Null
    & $NssmExe stop bboxai-agent 2>$null | Out-Null
    & $NssmExe remove bboxai-agent confirm 2>$null | Out-Null
}

# install.ps1's .env, and Python's own __pycache__/*.pyc bytecode cache
# written the first time the service imports each module, both get created
# at runtime under {app}\bbox-api -- neither is part of Inno Setup's file
# manifest, so its built-in cleanup won't remove them (and, since they're
# genuinely non-empty, won't remove the directories containing them either).
# Delete both explicitly so the tree ends up empty and gets cleaned up.
Remove-Item -Force (Join-Path $AppDir "bbox-api\.env") -ErrorAction SilentlyContinue
Get-ChildItem -Path $AppDir -Filter "__pycache__" -Recurse -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "==> Removing 'bboxai' hostname from the hosts file"
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
if (Test-Path $HostsPath) {
    $lines = @(Get-Content $HostsPath -ErrorAction SilentlyContinue)
    $filtered = @($lines | Where-Object { $_ -notmatch '^127\.0\.0\.1\s+bboxai\s*$' })
    if ($filtered.Count -eq 0 -and $lines.Count -gt 0) {
        Write-Host "    hosts file will end up empty after removing this entry (nothing else was in it)"
    }
    Set-Content -Path $HostsPath -Value $filtered
}

if ($Purge) {
    Write-Host "==> Purging bboxai-desktop data (database, storage, weights)"
    Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue
} else {
    Stop-Transcript | Out-Null
}
