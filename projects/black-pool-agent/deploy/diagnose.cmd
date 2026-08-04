@echo off
rem Black Pool lag triage wrapper (kit-aware, plain cmd, no PowerShell).
rem Runs deploy\diagnose_lag.py against the deployed bundle. Works from the
rem workshop kit against existing deployments - no reassembly needed.
rem NOTE: keep rem lines ASCII-short (chcp 65001 parser discipline).
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=%~dp0"
set "TARGET=%ROOT%."
rem Kit mode: no bundle here - resolve config\deploy-target.txt like launcher.
if exist "%ROOT%python\" goto have_target
if not exist "%ROOT%..\config\deploy-target.txt" goto have_target
set /p BPA_TARGET=<"%ROOT%..\config\deploy-target.txt"
set "_ABS="
if "%BPA_TARGET:~1,1%"==":" set "_ABS=1"
if "%BPA_TARGET:~0,2%"=="\\" set "_ABS=1"
if not defined _ABS set "BPA_TARGET=%ROOT%..\%BPA_TARGET%"
for %%I in ("%BPA_TARGET%") do set "TARGET=%%~fI"
:have_target
if exist "%TARGET%\python\" goto run_diag
echo [FAIL] no bundle found at %TARGET% - run assemble + deploy first.
pause
exit /b 1
:run_diag
set "PYHOME="
for /d %%D in ("%TARGET%\python\cpython-*") do set "PYHOME=%%~fD"
if not defined PYHOME goto no_python
echo 正在分诊部署位 %TARGET% ...
"%PYHOME%\python.exe" "%ROOT%diagnose_lag.py" "%TARGET%"
echo.
pause
exit /b 0
:no_python
echo [FAIL] bundle python missing under %TARGET%\python\ - recopy the bundle.
pause
exit /b 1
