@echo off
rem bpa-dev 回滚器：部署位一键回切上一版（.old 回滚位）。
rem 用法：rollback.cmd <部署目录>    或预设环境变量 BPA_DIR。
if not defined BPA_KEEPWIN (
  set "BPA_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
setlocal EnableExtensions
chcp 65001 >nul
if not "%~1"=="" set "BPA_DIR=%~1"
if not defined BPA_DIR (
  echo 回滚失败：未指定部署目录（参数或环境变量 BPA_DIR）。
  pause & exit /b 1
)
if not exist "%BPA_DIR%.old" (
  echo 回滚失败：没有回滚位 %BPA_DIR%.old（每次 deploy 只留最近一版）。
  pause & exit /b 1
)
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
