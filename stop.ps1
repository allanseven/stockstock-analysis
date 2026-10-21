# ====================================================================
#  A?????????? - PowerShell ????
#  Usage: .\stop.ps1
# ====================================================================

$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot

$Port = 8765
$hit  = New-Object System.Collections.Generic.List[int]

# 1. ???? 8765?????
foreach ($c in (Get-NetTCPConnection -LocalPort $Port -State Listen)) {
    $procId = [int]$c.OwningProcess
    if ($procId -gt 0 -and -not $hit.Contains($procId)) {
        Write-Host "[info] ???? $Port ???? (PID $procId)..."
        Stop-Process -Id $procId -Force
        $hit.Add($procId)
    }
}

# 2. ????????????????? server.py
Start-Sleep -Milliseconds 800
$stray = Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
         Where-Object { $_.CommandLine -like "*$PSScriptRoot*server.py*" }
foreach ($p in $stray) {
    $procId = [int]$p.ProcessId
    if (-not $hit.Contains($procId)) {
        Write-Host "[info] ?????? (PID $procId)..."
        Stop-Process -Id $procId -Force
        $hit.Add($procId)
    }
}

# 3. ????????
Start-Sleep -Milliseconds 800
if (Get-NetTCPConnection -LocalPort $Port -State Listen) {
    Write-Host "[warn] ?? $Port ?????????????????" -ForegroundColor Yellow
} elseif ($hit.Count -eq 0) {
    Write-Host "[ok] ?? $Port ?????????????" -ForegroundColor Green
} else {
    Write-Host "[ok] ????????? $($hit.Count) ?????" -ForegroundColor Green
}
