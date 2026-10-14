@echo off
echo ==============================================================
echo   AquaGreen Smart Irrigation System - Local Server Launch
echo ==============================================================
echo.

if exist venv\Scripts\activate.bat (
    echo Activating Python virtual environment...
    call venv\Scripts\activate.bat
) else (
    echo [WARN] Virtual environment not detected. Running with system Python...
)

echo.
echo Starting AquaGreen FastAPI Server on http://127.0.0.1:8000 ...
echo Local Network Access: Allowed across your LAN subnet
echo Press Ctrl+C to stop the server.
echo.

uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload
pause
