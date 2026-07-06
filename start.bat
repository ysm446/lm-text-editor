@echo off
rem lm-text-editor dev launcher
rem  - starts FastAPI backend (127.0.0.1:8000) in a separate window
rem  - then starts Vite + Electron in this window (Ctrl+C to stop)
rem NOTE: keep this file ASCII-only (cmd parses .bat with the system codepage)

cd /d "%~dp0"

rem Electron breaks if this is inherited (e.g. from VS Code terminals)
set ELECTRON_RUN_AS_NODE=

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] .venv not found. Run: py -3.13 -m venv .venv ^&^& .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [ERROR] node_modules not found. Run: npm install
    pause
    exit /b 1
)

echo Starting backend (close its window to stop it)...
start "lm-text-editor backend" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo Starting Vite + Electron...
call npm run dev
