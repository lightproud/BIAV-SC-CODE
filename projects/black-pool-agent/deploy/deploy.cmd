@echo off
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem args: [target-dir] [/y]   /y = unattended, skip all prompts
if not defined BPA_KEEPWIN (
  set "BPA_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "SD=%~dp0"
set "DEVROOT=%SD%.."
set "LOG=%DEVROOT%\deploy.log"
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="/y" (set "BPA_YES=1") else (set "BPA_DIR=%~1")
shift
goto parse_args
:args_done
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
set "STPY="
for /d %%D in ("%B%\python\cpython-*") do set "STPY=%%~fD\python.exe"

rem -- 1. probe: is BPA running / busy? announce restart before touching it --
set "WAS_RUNNING="
set "BPA_BUSY="
if not defined STPY goto probe_done
"%STPY%" "%SD%bpa_lifecycle.py" status "%BPA_DIR%" >> "%LOG%" 2>&1
if errorlevel 2 (set "WAS_RUNNING=1" & set "BPA_BUSY=1" & goto probe_done)
if errorlevel 1 set "WAS_RUNNING=1"
:probe_done
if not defined WAS_RUNNING goto shutdown_done
echo.
echo 提示：部署将重启 Black Pool（BPA），当前会话窗口会被关闭。
echo 部署完成后会自动重新启动（旧版照常留在回滚位）。
if defined BPA_BUSY echo 注意：检测到 BPA 疑似正在执行任务（CPU / 日志活跃）。
if defined BPA_YES goto graceful
if defined BPA_BUSY goto confirm_busy
choice /c YN /n /m "确认重启 BPA 并继续部署？ [Y]继续 [N]取消 "
if errorlevel 2 (echo 已取消部署，BPA 未受影响。& exit /b 1)
goto graceful

:confirm_busy
choice /c WYN /n /m "请选择： [W]等任务完成后自动继续 [Y]立即重启 [N]取消 "
if errorlevel 3 (echo 已取消部署，BPA 未受影响。& exit /b 1)
if errorlevel 2 goto graceful
echo 等待中：每 10 秒复测一次，任务空闲后自动继续（Ctrl+C 可中止）...
set /a _WAITS=0
:wait_idle
ping -n 11 127.0.0.1 >nul
"%STPY%" "%SD%bpa_lifecycle.py" status "%BPA_DIR%" >> "%LOG%" 2>&1
if errorlevel 2 (
  set /a _WAITS+=1
  if !_WAITS! geq 60 (
    echo 已等待约 10 分钟，任务仍未空闲。
    goto confirm_busy
  )
  goto wait_idle
)
echo BPA 已空闲，继续部署。

:graceful
rem -- 2. graceful close first (WM_CLOSE + wait); force-kill only leftovers --
echo 正在请求 BPA 优雅退出（最长等 20 秒，会话状态正常落盘）...
"%STPY%" "%SD%bpa_lifecycle.py" graceful "%BPA_DIR%" --timeout 20 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo 优雅退出超时，强制终止残余进程...
  "%STPY%" "%SD%kill_by_path.py" "%BPA_DIR%" >> "%LOG%" 2>&1
) else (
  echo BPA 已优雅退出。
)
:shutdown_done

rem -- 3. preserve user data (after shutdown, so files are quiescent) --
if exist "%BPA_DIR%\home" (
  robocopy "%BPA_DIR%\home" "%B%\home" /e /xc /xn /xo /njh /njs /ndl /nfl >nul
  if errorlevel 8 (echo 部署失败：home 保全拷贝出错。& echo 详情见 %LOG% & pause & exit /b 1)
  echo 用户数据已保全（旧 home 增量并入，不覆盖新配置）
)

rem -- 4. self-clearing rotation: clear external lockers, then retry --
rem lockers: TSVN icon cache (auto-restarts itself) / stray dir-scoped procs
taskkill /f /im TSVNCache.exe >nul 2>&1
ping -n 2 127.0.0.1 >nul

set /a _TRIES=0
:rot_old
if exist "%BPA_DIR%.old" (
  rd /s /q "%BPA_DIR%.old" >nul 2>&1
  if exist "%BPA_DIR%.old" (
    set /a _TRIES+=1
    if !_TRIES! geq 5 goto rot_fail
    echo 回滚位清理被占用，重试 !_TRIES!/5 ...
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
    if !_TRIES! geq 5 goto rot_fail
    echo 目录占用，清障重试 !_TRIES!/5 ...
    taskkill /f /im TSVNCache.exe >nul 2>&1
    if defined STPY "%STPY%" "%SD%kill_by_path.py" "%BPA_DIR%" >> "%LOG%" 2>&1
    ping -n 3 127.0.0.1 >nul
    goto rot_move
  )
)
goto rot_done
:rot_fail
echo 部署失败：重试 5 轮仍被占用。
echo 排查：关掉浏览该目录的窗口；
echo 或 resmon 句柄搜目录名找占用者。
echo 日志：%LOG%
pause & exit /b 1
:rot_done

rem (zh comment moved to RUNBOOK - 65001 parser desync)
move "%B%" "%BPA_DIR%" >nul || (
  echo 部署失败：成品搬运出错；旧版仍在 %BPA_DIR%.old 可手工恢复。
  echo 详情见 %LOG% & pause & exit /b 1
)
rem -- one-click icon entry: "Black Pool.lnk" next to launcher (icon from the exe) --
set "BPA_EXE="
for %%F in ("%BPA_DIR%\desktop\*.exe") do if not defined BPA_EXE set "BPA_EXE=%%~fF"
set "LNK_TARGET=%BPA_DIR%\launcher.cmd"
if exist "%BPA_DIR%\Black Pool.exe" set "LNK_TARGET=%BPA_DIR%\Black Pool.exe"
if defined BPA_EXE (
  cscript //nologo "%SD%make-shortcut.vbs" "%BPA_DIR%\Black Pool.lnk" "%LNK_TARGET%" "%BPA_DIR%" "%BPA_EXE%,0" >nul 2>&1 && echo 已生成带图标入口：Black Pool.lnk（可拷到桌面）
)

echo.
echo 部署完成：%BPA_DIR%   （回滚位：%BPA_DIR%.old，rollback.cmd 一键回切）
type "%BPA_DIR%\MANIFEST.txt"
rem -- 5. auto-restart: BPA was running before deploy, bring it back --
if defined WAS_RUNNING (
  echo 正在自动重启 Black Pool ...
  start "" "%LNK_TARGET%"
) else (
  echo 启动：双击 %BPA_DIR%\launcher.cmd
)
exit /b 0
