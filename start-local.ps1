# AI Stock Prediction System — Local Launcher Script
# Usage: Right-click → Run with PowerShell  OR  .\start-local.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "      AI Stock Prediction — Local Launcher        " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Python virtual environment (.venv)
if (-Not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[WARNING] Python virtual environment (.venv) not found." -ForegroundColor Yellow
    $choice = Read-Host "Would you like to automatically create .venv and install requirements? (Y/N)"
    if ($choice.ToUpper() -eq 'Y') {
        Write-Host "Creating virtual environment..." -ForegroundColor Yellow
        python -m venv .venv
        Write-Host "Installing backend dependencies (this may take a minute)..." -ForegroundColor Yellow
        .\.venv\Scripts\pip install -r requirements.txt
        Write-Host "[SUCCESS] Virtual environment ready!" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Please create a virtual environment first." -ForegroundColor Red
        exit 1
    }
}

# 2. Check Node dependencies (frontend/node_modules)
if (-Not (Test-Path ".\frontend\node_modules")) {
    Write-Host "[WARNING] frontend/node_modules not found." -ForegroundColor Yellow
    $choice = Read-Host "Would you like to automatically run 'npm install' in the frontend? (Y/N)"
    if ($choice.ToUpper() -eq 'Y') {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        Set-Location .\frontend
        npm install
        Set-Location ..
        Write-Host "[SUCCESS] Frontend dependencies installed!" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Please install frontend dependencies first." -ForegroundColor Red
        exit 1
    }
}

# 3. Start FastAPI backend on port 8000 in a new window
Write-Host "[1/2] Launching FastAPI backend on http://localhost:8000..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Write-Host '--- FastAPI Backend API ---' -ForegroundColor Green; .\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload"
)

# 4. Start React Vite frontend in a new window
Write-Host "[2/2] Launching React frontend on http://localhost:5173..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Write-Host '--- React Vite Frontend ---' -ForegroundColor Green; cd frontend; npm run dev"
)

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Dashboard URL: http://localhost:5173            " -ForegroundColor Green
Write-Host "  Backend docs:  http://localhost:8000/docs       " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "Both processes are running in the background." -ForegroundColor Gray
Write-Host "To stop them, simply close the opened PowerShell windows." -ForegroundColor Gray
Write-Host ""
