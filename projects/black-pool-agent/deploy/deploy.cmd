@echo off
rem bpa-dev 部署器：staging 成品 -> 运行部署位（整目录替换 + 用户数据保全 + 回滚位）。
rem 用法：deploy.cmd <部署目录>    或预设环境变量 BPA_DIR 后直接双击。
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
if not "%~1"=="" set "BPA_DIR=%~1"
rem 目标地址属于「料」：一次写进 config\deploy-target.txt 后即可双击直跑（零参数）
if not defined BPA_DIR if exist "%DEVROOT%\config\deploy-target.txt" set /p BPA_DIR=<"%DEVROOT%\config\deploy-target.txt"
if not defined BPA_DIR (
  echo 部署失败：未指定部署目录（参数或环境变量 BPA_DIR）。
  pause & exit /b 1
)
rem 相对路径一律按车间根（bpa-dev\）解析——整棵树搬盘符零改配置；绝不按当前窗口目录（会静默指错）
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

rem -- 1. 用户数据保全：旧 home 中新包缺失的文件补进来（不覆盖注入的 SOUL 等）--
if exist "%BPA_DIR%\home" (
  robocopy "%BPA_DIR%\home" "%B%\home" /e /xc /xn /xo /njh /njs /ndl /nfl >nul
  if errorlevel 8 (echo 部署失败：home 保全拷贝出错。& echo 详情见 %LOG% & pause & exit /b 1)
  echo 用户数据已保全（旧 home 增量并入，不覆盖新配置）
)

rem -- 2. 自清障轮换（field: every deploy hit dir locks; clear + retry） --
rem 已知占用者三类：TSVN 图标缓存 / 桌面主程序 / 部署位内自家进程（含后端 python）
taskkill /f /im TSVNCache.exe >nul 2>&1
set "OLD_EXE="
for %%F in ("%BPA_DIR%\desktop\*.exe") do if not defined OLD_EXE set "OLD_EXE=%%~nxF"
if defined OLD_EXE taskkill /f /im "%OLD_EXE%" >nul 2>&1
set "WQL=%BPA_DIR:\=\\%"
wmic process where "ExecutablePath like '%WQL%\\%%'" call terminate >nul 2>&1
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
    echo 旧目录占用中，自动清障后重试 !_TRIES!/5 ...
    taskkill /f /im TSVNCache.exe >nul 2>&1
    if defined OLD_EXE taskkill /f /im "%OLD_EXE%" >nul 2>&1
    ping -n 3 127.0.0.1 >nul
    goto rot_move
  )
)
goto rot_done
:rot_fail
echo 部署失败：清障重试 5 轮后目录仍被占用。
echo 请关闭浏览过该目录的资源管理器窗口/编辑器，或用 resmon 的
echo 「CPU - 关联的句柄」搜索目录名找到占用进程后重试。
echo 详情见 %LOG%
pause & exit /b 1
:rot_done

rem -- 3. 上新 --
move "%B%" "%BPA_DIR%" >nul || (
  echo 部署失败：成品搬运出错；旧版仍在 %BPA_DIR%.old 可手工恢复。
  echo 详情见 %LOG% & pause & exit /b 1
)
rem -- one-click icon entry: "Black Pool.lnk" next to launcher (icon from the exe) --
set "BPA_EXE="
for %%F in ("%BPA_DIR%\desktop\*.exe") do if not defined BPA_EXE set "BPA_EXE=%%~fF"
if defined BPA_EXE (
  cscript //nologo "%SD%make-shortcut.vbs" "%BPA_DIR%\Black Pool.lnk" "%BPA_DIR%\launcher.cmd" "%BPA_DIR%" "%BPA_EXE%,0" >nul 2>&1 && echo 已生成带图标入口：Black Pool.lnk（可拷到桌面）
)

echo.
echo 部署完成：%BPA_DIR%   （回滚位：%BPA_DIR%.old，rollback.cmd 一键回切）
echo 启动：双击 %BPA_DIR%\launcher.cmd
type "%BPA_DIR%\MANIFEST.txt"
exit /b 0
