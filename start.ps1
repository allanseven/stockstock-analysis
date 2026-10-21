# ====================================================================
#  A股四线资金博弈分时图 - PowerShell 启动脚本 (single-shot)
#  Usage: .\start.ps1  or right-click "Run with PowerShell"
# ====================================================================

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$Port = 8765
$Url  = "http://127.0.0.1:$Port/"

# 1. Check if port already in use
$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq 'Listen' }
if ($existing) {
    Write-Host "[info] Port $Port already listening (PID $($existing.OwningProcess)). Opening browser..." -ForegroundColor Yellow
    Start-Process $Url
    Read-Host "Press Enter to exit"
    return
}

# 2. Locate python
$pyCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) { $pyCmd = 'python' }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $pyCmd = 'py -3' }
else {
    Write-Host "[error] Python 3.7+ not found in PATH." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# 3. Launch server (foreground)
Write-Host "[info] Starting proxy server at $Url" -ForegroundColor Green
Write-Host "[info] Press Ctrl+C to stop, or close this window."

try {
    if ($pyCmd -eq 'python') { python server.py }
    else { py -3 server.py }
}
finally {
    Write-Host ""
    Write-Host "[info] Server stopped." -ForegroundColor Yellow
}