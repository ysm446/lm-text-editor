@echo off
rem lm-text-editor dev launcher
rem  - bootstraps .venv with whatever Python is available (any version)
rem  - starts FastAPI backend (127.0.0.1:8000) in a separate window
rem  - then starts Vite + Electron in this window (Ctrl+C to stop)
rem NOTE: keep this file ASCII-only (cmd parses .bat with the system codepage)

cd /d "%~dp0"

rem Electron breaks if this is inherited (e.g. from VS Code terminals)
set ELECTRON_RUN_AS_NODE=

rem --- create .venv if missing, using any available Python ---
if exist ".venv\Scripts\python.exe" goto venv_ready

echo .venv not found. Creating it...

rem Pick a Python launcher. Prefer the py launcher (avoids the
rem Windows Store stub that "python" often resolves to).
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY ( where python3 >nul 2>&1 && set "PY=python3" )
if not defined PY (
    echo [ERROR] Python not found. Install Python 3.11+ from python.org, then re-run.
    pause
    exit /b 1
)

echo Using: %PY%
%PY% -m venv .venv
if errorlevel 1 (
    echo [ERROR] Failed to create .venv with "%PY%".
    pause
    exit /b 1
)

echo Installing backend dependencies (first run only, may take a while)...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install backend requirements.
    pause
    exit /b 1
)

:venv_ready

if not exist "node_modules" (
    echo [ERROR] node_modules not found. Run: npm install
    pause
    exit /b 1
)

echo Starting backend (it exits automatically when the app window is closed)...
start "lm-text-editor backend" cmd /c ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo Starting Vite + Electron...
call npm run dev
