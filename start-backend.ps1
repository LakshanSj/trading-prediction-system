# AI Stock Prediction System — Backend Startup Script
# Run this script every time you want the app to be accessible online
# Usage: Right-click → Run with PowerShell  OR  .\start-backend.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  AI Stock Prediction - Backend Launcher  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check .venv exists
if (-Not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[ERROR] Virtual environment not found." -ForegroundColor Red
    Write-Host "Run: py -3.14 -m venv .venv && .\.venv\Scripts\pip install -r requirements.txt"
    exit 1
}

# Check ngrok is installed
if (-Not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] ngrok not found." -ForegroundColor Red
    Write-Host "Install from: https://ngrok.com/download  OR  run: winget install ngrok"
    exit 1
}

Write-Host "[1/2] Starting FastAPI backend on port 8000..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Write-Host 'FastAPI Backend' -ForegroundColor Green; .\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload"
)

# Give uvicorn 3 seconds to start
Start-Sleep -Seconds 3

Write-Host "[2/2] Starting ngrok tunnel..." -ForegroundColor Yellow
Write-Host ""
Write-Host "YOUR PUBLIC URL will appear below (look for 'Forwarding'):" -ForegroundColor Green
Write-Host ""

# Static domain — tunnel to backend on port 8000
ngrok http --domain=promenade-laziness-outflank.ngrok-free.dev 8000
