@echo off
rem Public workshop rollback: swap BlackPool.old back in (single slot).
rem goto-based guard: %~f0 / %* expanded inside a ( ) block breaks cmd
rem parsing when the path or args contain a parenthesis (e.g. "xxx (1)").
if defined BPW_KEEPWIN goto :bpw_keepwin
set "BPW_KEEPWIN=1"
cmd /d /k call "%~f0" %*
exit /b
:bpw_keepwin
setlocal EnableExtensions
chcp 65001 >nul
set "SD=%~dp0"
if not exist "%SD%BlackPool.old" (
  echo 回滚失败：没有回滚位 BlackPool.old（每次组装只留最近一版）。
  pause & exit /b 1
)
set "RB_EXE="
for %%F in ("%SD%BlackPool\desktop\*.exe") do if not defined RB_EXE set "RB_EXE=%%~nxF"
if defined RB_EXE taskkill /f /im "%RB_EXE%" >nul 2>&1
ping -n 2 127.0.0.1 >nul
set "TS=%RANDOM%"
if exist "%SD%BlackPool" (
  move "%SD%BlackPool" "%SD%BlackPool.failed-%TS%" >nul || (
    echo 回滚失败：当前目录占用中（先关掉正在运行的 Black Pool）。
    pause & exit /b 1
  )
)
move "%SD%BlackPool.old" "%SD%BlackPool" >nul || (
  echo 回滚失败：回滚位搬运出错，当前版已让位到 BlackPool.failed-%TS%，请手工处置。
  pause & exit /b 1
)
echo 回滚完成：BlackPool 已回到上一版；问题版留在 BlackPool.failed-%TS% 供取证。
exit /b 0
