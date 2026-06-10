# MemBot 开发环境重启脚本 (Windows PowerShell)
# 用法: .\restart.ps1 [-SkipRedis]

param(
  [switch]$SkipRedis
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')

Write-Host "==> Project root: $ProjectRoot" -ForegroundColor Cyan

function Stop-PortListener {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $connections) {
    $procId = $conn.OwningProcess
    if ($procId -and $procId -ne 0) {
      Write-Host "    Stopping PID $procId on port $Port"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host '==> Stopping frontend (5173) and backend (3001)...' -ForegroundColor Yellow
Stop-PortListener -Port 5173
Stop-PortListener -Port 3001
Start-Sleep -Seconds 1

if (-not $SkipRedis) {
  Write-Host '==> Starting Redis (docker compose)...' -ForegroundColor Yellow
  Set-Location $ProjectRoot
  docker compose up -d redis
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Redis start failed. Backend may not work without Redis.'
  }
}

Write-Host '==> Starting backend (end/)...' -ForegroundColor Yellow
$endDir = Join-Path $ProjectRoot 'end'
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$endDir'; npm run start:dev"
) -WindowStyle Normal

Write-Host '==> Starting frontend (front/)...' -ForegroundColor Yellow
$frontDir = Join-Path $ProjectRoot 'front'
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$frontDir'; npm run dev"
) -WindowStyle Normal

Write-Host '==> Waiting for services...' -ForegroundColor Yellow
$backendOk = $false
$frontendOk = $false

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  if (-not $backendOk) {
    try {
      $null = Invoke-WebRequest -Uri 'http://localhost:3001/api/sessions/history' -UseBasicParsing -TimeoutSec 3
      $backendOk = $true
      Write-Host '    Backend ready: http://localhost:3001' -ForegroundColor Green
    } catch { }
  }
  if (-not $frontendOk) {
    try {
      $null = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 3
      $frontendOk = $true
      Write-Host '    Frontend ready: http://localhost:5173' -ForegroundColor Green
    } catch { }
  }
  if ($backendOk -and $frontendOk) { break }
}

if (-not $backendOk) { Write-Warning 'Backend not responding yet. Check the end/ terminal window.' }
if (-not $frontendOk) { Write-Warning 'Frontend not responding yet. Check the front/ terminal window.' }

Write-Host '==> Done.' -ForegroundColor Cyan
