@echo off
title Frida Hook V2 - Waiting for Morimens
echo Killing old python processes...
taskkill /f /im python.exe 2>nul
timeout /t 2 /nobreak >nul
echo Starting hook V2 (will wait for game)...
cd /d "%~dp0"
python _frida_hook_v2.py
pause
