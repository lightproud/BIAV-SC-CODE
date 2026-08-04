@echo off
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem goto-based guard: %~f0 / %* expanded inside a ( ) block breaks cmd
rem parsing when the path or args contain a parenthesis (e.g. "xxx (1)").
if defined BPA_KEEPWIN goto :bpa_keepwin
set "BPA_KEEPWIN=1"
cmd /d /k call "%~f0" %*
exit /b
:bpa_keepwin
setlocal EnableExtensions
chcp 65001 >nul
set "SD=%~dp0"
set "DEVROOT=%SD%.."
if not "%~1"=="" set "BPA_DIR=%~1"
rem (zh comment moved to RUNBOOK - 65001 parser desync)
if not defined BPA_DIR if exist "%DEVROOT%\config\deploy-target.txt" set /p BPA_DIR=<"%DEVROOT%\config\deploy-target.txt"
if not defined BPA_DIR (
  echo 回滚失败：未指定部署目录（参数或环境变量 BPA_DIR）。
  pause & exit /b 1
)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
set "_ABS="
if "%BPA_DIR:~1,1%"==":" set "_ABS=1"
if "%BPA_DIR:~0,2%"=="\\" set "_ABS=1"
if not defined _ABS set "BPA_DIR=%DEVROOT%\%BPA_DIR%"
for %%I in ("%BPA_DIR%") do set "BPA_DIR=%%~fI"
if not exist "%BPA_DIR%.old" (
  echo 回滚失败：没有回滚位 %BPA_DIR%.old（每次 deploy 只留最近一版）。
  pause & exit /b 1
)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
taskkill /f /im TSVNCache.exe >nul 2>&1
set "RB_EXE="
for %%F in ("%BPA_DIR%\desktop\*.exe") do if not defined RB_EXE set "RB_EXE=%%~nxF"
if defined RB_EXE taskkill /f /im "%RB_EXE%" >nul 2>&1
ping -n 2 127.0.0.1 >nul
set "TS=%RANDOM%"
if exist "%BPA_DIR%" (
  move "%BPA_DIR%" "%BPA_DIR%.failed-%TS%" >nul || (
    echo 回滚失败：当前目录占用中（先关掉正在运行的 Black Pool）。
    pause & exit /b 1
  )
)
move "%BPA_DIR%.old" "%BPA_DIR%" >nul || (
  echo 回滚失败：回滚位搬运出错，当前版已让位到 %BPA_DIR%.failed-%TS%，请手工处置。
  pause & exit /b 1
)
echo 回滚完成：%BPA_DIR% 已回到上一版；问题版留在 %BPA_DIR%.failed-%TS% 供取证。
exit /b 0
