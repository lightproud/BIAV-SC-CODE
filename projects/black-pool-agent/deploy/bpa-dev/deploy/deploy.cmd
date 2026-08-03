@echo off
rem bpa-dev 部署器：staging 成品 -> 运行部署位（整目录替换 + 用户数据保全 + 回滚位）。
rem 用法：deploy.cmd <部署目录>    或预设环境变量 BPA_DIR 后直接双击。
if not defined BPA_KEEPWIN (
  set "BPA_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
setlocal EnableExtensions
chcp 65001 >nul
set "SD=%~dp0"
set "DEVROOT=%SD%.."
set "LOG=%DEVROOT%\deploy.log"
if not "%~1"=="" set "BPA_DIR=%~1"
if not defined BPA_DIR (
  echo 部署失败：未指定部署目录（参数或环境变量 BPA_DIR）。
  pause & exit /b 1
)
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

rem -- 2. 轮换：旧版让位回滚位 --
if exist "%BPA_DIR%.old" rd /s /q "%BPA_DIR%.old"
if exist "%BPA_DIR%" (
  move "%BPA_DIR%" "%BPA_DIR%.old" >nul || (
    echo 部署失败：旧目录占用中（先关掉正在运行的 Black Pool）。
    pause & exit /b 1
  )
)

rem -- 3. 上新 --
move "%B%" "%BPA_DIR%" >nul || (
  echo 部署失败：成品搬运出错；旧版仍在 %BPA_DIR%.old 可手工恢复。
  echo 详情见 %LOG% & pause & exit /b 1
)
echo.
echo 部署完成：%BPA_DIR%   （回滚位：%BPA_DIR%.old，rollback.cmd 一键回切）
echo 启动：双击 %BPA_DIR%\launcher.cmd
type "%BPA_DIR%\MANIFEST.txt"
exit /b 0
