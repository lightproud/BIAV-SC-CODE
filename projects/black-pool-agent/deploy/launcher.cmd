@echo off
rem Keep-window shell: rerun inside cmd /k so ANY failure stays readable.
if not defined SC_LAUNCHER_KEEPWIN (
  set "SC_LAUNCHER_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
rem Black Pool portable launcher (plain cmd, no PowerShell).
rem Layout: python\ venv\ app\ desktop\ home\ next to this file.
rem NOTE: keep rem lines ASCII-short - long UTF-8 comments desync the
rem cmd parser under chcp 65001 (field-proven 2026-08-03).
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=%~dp0"
rem Kit mode: launched from the workshop (no bundle here) - dispatch to
rem the deployed bundle named by config\deploy-target.txt. No writes in
rem kit mode (this dir may be a read-only vendor external).
if exist "%ROOT%python\" goto in_bundle
if not exist "%ROOT%..\config\deploy-target.txt" goto in_bundle
set /p BPA_TARGET=<"%ROOT%..\config\deploy-target.txt"
set "_ABS="
if "%BPA_TARGET:~1,1%"==":" set "_ABS=1"
if "%BPA_TARGET:~0,2%"=="\\" set "_ABS=1"
if not defined _ABS set "BPA_TARGET=%ROOT%..\%BPA_TARGET%"
for %%I in ("%BPA_TARGET%") do set "BPA_TARGET=%%~fI"
if not exist "%BPA_TARGET%\launcher.cmd" (
  echo 启动失败：部署位 %BPA_TARGET% 里没有 launcher.cmd（先跑 assemble + deploy）。
  pause
  exit /b 1
)
echo 车间入口：转至部署位 %BPA_TARGET% ...
call "%BPA_TARGET%\launcher.cmd" %*
exit /b %errorlevel%
:in_bundle
set "LOG=%ROOT%launcher.log"
echo [%date% %time%] launcher start ROOT=%ROOT% > "%LOG%"
echo Black Pool 启动中，请稍候（本窗会显示进度，失败会停窗给出原因）...

set "HERMES_HOME=%ROOT%home"
rem Intranet env hook (proxy / corp CA / etc), injected at assemble time.
if exist "%ROOT%env.cmd" call "%ROOT%env.cmd"
rem Display-name pin (upstream official knob).
set "HERMES_DESKTOP_APP_NAME=Black Pool"
set "PATH=%ROOT%venv\Scripts;%PATH%"
if not exist "%HERMES_HOME%" mkdir "%HERMES_HOME%"

rem -- step 1: locate bundled CPython --
set "PYHOME="
for /d %%D in ("%ROOT%python\cpython-*") do set "PYHOME=%%~fD"
if not defined PYHOME (
  echo [FAIL] bundle python not found under %ROOT%python\ >> "%LOG%"
  echo 启动失败：包内 python\cpython-* 目录缺失。请把整个 BlackPool 文件夹完整复制后重试。
  echo 详情见 %LOG%
  pause
  exit /b 1
)
echo [ok] PYHOME=%PYHOME% >> "%LOG%"

rem -- step 2: venv self-heal (idempotent) --
"%PYHOME%\python.exe" "%ROOT%fix_venv_path.py" "%ROOT%." >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] fix_venv_path failed >> "%LOG%"
  echo 启动失败：venv 自愈未通过。详情见 %LOG%
  pause
  exit /b 1
)

rem -- step 3: runtime import check --
"%ROOT%venv\Scripts\python.exe" -c "import hermes_cli" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] runtime import check failed >> "%LOG%"
  echo 启动失败：包内运行时导入自检未通过。详情见 %LOG%
  pause
  exit /b 1
)
echo [ok] runtime import check passed >> "%LOG%"
echo 运行时自检通过。

rem -- CLI mode: launcher.cmd cli <args> --
if /i "%~1"=="cli" (
  shift
  "%ROOT%venv\Scripts\hermes.exe" %2 %3 %4 %5 %6 %7 %8 %9
  exit /b %errorlevel%
)

rem -- step 4: supervised desktop start (fallback: CLI) --
if not exist "%ROOT%launch_desktop.py" goto legacy_start
if exist "%ROOT%desktop" (
  echo 正在启动桌面端，自检守窗约 25 秒，窗口正常出现后本窗自动关闭...
  "%ROOT%venv\Scripts\python.exe" "%ROOT%launch_desktop.py" "%ROOT%."
  if errorlevel 1 (
    echo.
    echo 启动失败：桌面端进程未能存活。上方为取证日志尾部，
    echo 完整日志见 %LOG% 与 home\logs\ 目录。
    pause
    exit /b 1
  )
  exit 0
)
goto cli_fallback

:legacy_start
rem Fallback for bundles without the supervisor script.
set "DESKTOP_EXE="
for %%F in ("%ROOT%desktop\*.exe") do if not defined DESKTOP_EXE set "DESKTOP_EXE=%%~fF"
if defined DESKTOP_EXE (
  echo [ok] legacy start %DESKTOP_EXE% >> "%LOG%"
  echo 未找到监督器 launch_desktop.py，直接拉起桌面端：
  echo   %DESKTOP_EXE%
  start "Black Pool" "%DESKTOP_EXE%"
  echo 若桌面端窗口没有出现，请把 home\logs\ 下日志发给艾瑞卡；本窗可手动关闭。
  pause
  exit /b 0
)

:cli_fallback
echo [warn] desktop dir not found, falling back to CLI >> "%LOG%"
echo 未找到桌面端目录，回退命令行模式...
"%ROOT%venv\Scripts\hermes.exe" %*
echo.
echo 命令行会话已结束。
pause
endlocal
