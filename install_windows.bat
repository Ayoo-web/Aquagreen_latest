@echo off
echo ==============================================================
echo   AquaGreen Smart Irrigation System - Windows 11 Installer
echo ==============================================================
echo.

:: Check for Python installation
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found in PATH!
    echo Please install Python 3.10+ from python.org and check "Add Python to PATH".
    pause
    exit /b 1
)

echo [1/3] Creating Python virtual environment (venv)...
python -m venv venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
)

echo [2/3] Activating virtual environment...
call venv\Scripts\activate.bat

echo [3/3] Installing dependencies from server\requirements.txt...
pip install --upgrade pip
pip install -r server\requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo ==============================================================
echo [SUCCESS] AquaGreen installation completed successfully!
echo You can now start the local server by double-clicking run_dashboard.bat.
echo ==============================================================
pause
