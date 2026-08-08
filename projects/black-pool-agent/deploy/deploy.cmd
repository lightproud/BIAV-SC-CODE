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
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "SD=%~dp0"
set "DEVROOT=%SD%.."
set "LOG=%DEVROOT%\deploy.log"
if not "%~1"=="" set "BPA_DIR=%~1"
rem (zh comment moved to RUNBOOK - 65001 parser desync)
if not defined BPA_DIR if exist "%DEVROOT%\config\deploy-target.txt" set /p BPA_DIR=<"%DEVROOT%\config\deploy-target.txt"
if not defined BPA_DIR (
  echo 部署失败：未指定部署目录（参数或环境变量 BPA_DIR）。
  pause & exit /b 1
)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
set "_ABS="
if "%BPA_DIR:~1,1%"==":" set "_ABS=1"
if "%BPA_DIR:~0,2%"=="\\" set "_ABS=1"
if not defined _ABS set "BPA_DIR=%DEVROOT%\%BPA_DIR%"
for %%I in ("%BPA_DIR%") do set "BPA_DIR=%%~fI"
set "B=%DEVROOT%\staging\BlackPool"
echo [%date% %time%] deploy to %BPA_DIR% > "%LOG%"
if not exist "%B%\MANIFEST.txt" (
  echo 部署失败：staging 里没有组装成品（先跑 assemble.cmd）。
  pause & exit /b 1
)

rem (zh comment moved to RUNBOOK - 65001 parser desync)
if exist "%BPA_DIR%\home" (
  robocopy "%BPA_DIR%\home" "%B%\home" /e /xc /xn /xo /njh /njs /ndl /nfl >nul
  if errorlevel 8 (echo 部署失败：home 保全拷贝出错。
  echo 详情见 %LOG%
  pause
  exit /b 1)
  echo 用户数据已保全（旧 home 增量并入，不覆盖新配置）
)

rem -- 2. self-clearing rotation: kill known lockers, then retry --
rem lockers: TSVN icon cache / desktop exe / any process running FROM the dir
set "STPY="
for /d %%D in ("%B%\python\cpython-*") do set "STPY=%%~fD\python.exe"
taskkill /f /im TSVNCache.exe >nul 2>&1
set "OLD_EXE="
for %%F in ("%BPA_DIR%\desktop\*.exe") do if not defined OLD_EXE set "OLD_EXE=%%~nxF"
if defined OLD_EXE taskkill /f /im "%OLD_EXE%" >nul 2>&1
rem path-scoped kill via bundled python (wmic is gone on newer Windows)
if defined STPY "%STPY%" "%SD%kill_by_path.py" "%BPA_DIR%" >> "%LOG%" 2>&1
set "WQL=%BPA_DIR:\=\\%"
wmic process where "ExecutablePath like '%WQL%\\%%'" call terminate >nul 2>&1
ping -n 2 127.0.0.1 >nul

set /a _TRIES=0
:rot_old
if exist "%BPA_DIR%.old" (
  rd /s /q "%BPA_DIR%.old" >nul 2>&1
  if exist "%BPA_DIR%.old" (
    set /a _TRIES+=1
    if !_TRIES! geq 3 goto rot_mirror
    echo 回滚位清理被占用，重试 !_TRIES!/3 ...
    ping -n 3 127.0.0.1 >nul
    goto rot_old
  )
)
set /a _TRIES=0
:rot_move
if exist "%BPA_DIR%" (
  move "%BPA_DIR%" "%BPA_DIR%.old" >nul 2>&1
  if exist "%BPA_DIR%" (
    set /a _TRIES+=1
    if !_TRIES! geq 3 goto rot_mirror
    echo 目录占用，清障重试 !_TRIES!/3 ...
    taskkill /f /im TSVNCache.exe >nul 2>&1
    if defined OLD_EXE taskkill /f /im "%OLD_EXE%" >nul 2>&1
    if defined STPY "%STPY%" "%SD%kill_by_path.py" "%BPA_DIR%" >> "%LOG%" 2>&1
    ping -n 3 127.0.0.1 >nul
    goto rot_move
  )
)
set "DEPLOY_MODE=rotate"
rem (zh comment moved to RUNBOOK - 65001 parser desync)
move "%B%" "%BPA_DIR%" >nul || (
  echo 部署失败：成品搬运出错；旧版仍在 %BPA_DIR%.old 可手工恢复。
  echo 详情见 %LOG%
  pause
  exit /b 1
)
goto post_deploy

:rot_mirror
rem Rotation blocked - typically a console/Explorer window whose CWD sits in
rem the target dir. That CWD lock stops rename but NOT file overwrite, so
rem fall back to an in-place mirror deploy. ASCII-only in this block:
rem UTF-8 echo after goto labels desyncs the 65001 parser (field case 3).
echo [mirror] dir busy - deploying in place. No rollback snapshot this round.
robocopy "%B%" "%BPA_DIR%" /mir /r:2 /w:2 /njh /njs /ndl /nfl >> "%LOG%" 2>&1
if errorlevel 8 (
  echo [FAIL] mirror deploy blocked too - a target file is still locked.
  echo Close Black Pool and any console in the target dir, then rerun.
  echo Log: %LOG%
  pause & exit /b 1
)
rd /s /q "%B%" >nul 2>&1
set "DEPLOY_MODE=mirror"

:post_deploy
rem -- one-click icon entry: "Black Pool.lnk" next to launcher (icon from the exe) --
set "BPA_EXE="
for %%F in ("%BPA_DIR%\desktop\*.exe") do if not defined BPA_EXE set "BPA_EXE=%%~fF"
set "LNK_TARGET=%BPA_DIR%\launcher.cmd"
if exist "%BPA_DIR%\Black Pool.exe" set "LNK_TARGET=%BPA_DIR%\Black Pool.exe"
if defined BPA_EXE (
  cscript //nologo "%SD%make-shortcut.vbs" "%BPA_DIR%\Black Pool.lnk" "%LNK_TARGET%" "%BPA_DIR%" "%BPA_EXE%,0" >nul 2>
  1
  echo 已生成带图标入口：Black Pool.lnk（可拷到桌面）
)

echo.
if "%DEPLOY_MODE%"=="mirror" (
  echo 部署完成（就地覆盖模式）：%BPA_DIR%
  echo 注意：本轮未刷新回滚位，rollback 回切的是更早版本。
) else (
  echo 部署完成：%BPA_DIR%   （回滚位：%BPA_DIR%.old，rollback.cmd 一键回切）
)
echo 启动：双击 %BPA_DIR%\launcher.cmd
type "%BPA_DIR%\MANIFEST.txt"
exit /b 0
