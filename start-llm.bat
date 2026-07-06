@echo off
rem lm-text-editor LLM server launcher (Gemma 4, port 8080)
rem ornith 9B (port 8081) will be added in phase 4.
rem NOTE: keep this file ASCII-only (cmd parses .bat with the system codepage)

cd /d "%~dp0"

set GEMMA_MODEL=models\gemma-4-26B-A4B-it-GGUF\gemma-4-26B-A4B-it-Q4_K_M.gguf
set GEMMA_MMPROJ=models\gemma-4-26B-A4B-it-GGUF\mmproj-gemma-4-26B-A4B-it-BF16.gguf

if not exist "%GEMMA_MODEL%" (
    echo [ERROR] model not found: %GEMMA_MODEL%
    pause
    exit /b 1
)

echo Starting llama-server (Gemma 4) on 127.0.0.1:8080 ...
runtime\llama.cpp\llama-server.exe ^
  -m "%GEMMA_MODEL%" ^
  --mmproj "%GEMMA_MMPROJ%" ^
  --host 127.0.0.1 --port 8080 ^
  -ngl 99 -c 16384 --jinja
