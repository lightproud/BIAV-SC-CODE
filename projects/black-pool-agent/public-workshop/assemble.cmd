@echo off
rem Public-edition in-repo workshop (keeper directive 2026-08-04): a silver-core
rem checkout assembles and deploys the PUBLIC Black Pool bundle by itself.
rem Self-rooted layout (everything under this dir); no intranet parts involved.
rem Flow: pick zip from releases\ -> optional SHA check -> unpack to staging\
rem -> refresh launcher family from ..\deploy -> preserve user home -> rotate
rem old deployment into BlackPool.old -> land product at BlackPool\.
rem goto-based guard: %~f0 / %* expanded inside a ( ) block breaks cmd
rem parsing when the path or args contain a parenthesis (e.g. "xxx (1)").
if defined BPW_KEEPWIN goto :bpw_keepwin
set "BPW_KEEPWIN=1"
cmd /d /k call "%~f0" %*
exit /b
:bpw_keepwin
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "SD=%~dp0"
set "KIT=%SD%..\deploy"
set "LOG=%SD%assemble.log"
echo [%date% %time%] public assemble start > "%LOG%"

rem input zip: arg 1 (file name under releases\) or the newest zip there
set "ZIP="
if not "%~1"=="" (
  set "ZIP=%SD%releases\%~1"
) else (
  for /f "delims=" %%F in ('dir /b /o:d "%SD%releases\*.zip" 2^>nul') do set "ZIP=%SD%releases\%%F"
)
if not defined ZIP (
  echo 组装失败：releases\ 里没有 zip 包。先按 RUNBOOK.md 从银芯 Release 下载公版包放入。
  echo 详情见 %LOG% & pause & exit /b 1
)
if not exist "%ZIP%" (
  echo 组装失败：指定的包不存在 %ZIP%
  pause & exit /b 1
)
echo 进料：%ZIP%
echo [ok] zip=%ZIP% >> "%LOG%"

rem optional goods check against releases\CHECKSUMS.txt (SHA-256)
if exist "%SD%releases\CHECKSUMS.txt" (
  set "SHA="
  for /f "skip=1 delims=" %%H in ('certutil -hashfile "%ZIP%" SHA256 2^>nul') do if not defined SHA set "SHA=%%H"
  set "SHA=!SHA: =!"
  findstr /i /c:"!SHA!" "%SD%releases\CHECKSUMS.txt" >nul || (
    echo 组装失败：SHA-256 与 CHECKSUMS.txt 不符（包损坏或未登记）。
    echo   实测 !SHA! >> "%LOG%"
    echo 详情见 %LOG% & pause & exit /b 1
  )
  echo 验货通过：SHA-256 已比对 CHECKSUMS.txt
) else (
  echo [warn] no CHECKSUMS.txt, skip goods check >> "%LOG%"
  echo 提示：未做 SHA 验货（releases\CHECKSUMS.txt 不存在）。
)

rem unpack onto a clean bench
if exist "%SD%staging" rd /s /q "%SD%staging"
mkdir "%SD%staging"
echo 解压中（约 1 分钟）...
tar -xf "%ZIP%" -C "%SD%staging" || (
  echo 组装失败：解压出错。& echo 详情见 %LOG% & pause & exit /b 1
)
set "B=%SD%staging\BlackPool"
if not exist "%B%\launcher.cmd" (
  echo 组装失败：包结构异常（未见 BlackPool\launcher.cmd）。
  pause & exit /b 1
)

rem refresh launcher family from the repo deploy kit (repo fixes win over zip)
for %%F in (launcher.cmd launch_desktop.py fix_venv_path.py) do (
  if exist "%KIT%\%%F" copy /y "%KIT%\%%F" "%B%\%%F" >nul
)
echo 启动器族已按仓内套件版覆盖（launcher / 监督器 / venv 自愈）

rem preserve user data from the previous deployment (incremental, no clobber)
if exist "%SD%BlackPool\home" (
  robocopy "%SD%BlackPool\home" "%B%\home" /e /xc /xn /xo /njh /njs /ndl /nfl >nul
  if errorlevel 8 (echo 组装失败：home 保全拷贝出错。& echo 详情见 %LOG% & pause & exit /b 1)
  echo 用户数据已保全（旧 home 增量并入，不覆盖新配置）
)

rem rotation deploy: kill lockers, current -> BlackPool.old (single slot)
set "STPY="
for /d %%D in ("%B%\python\cpython-*") do set "STPY=%%~fD\python.exe"
set "OLD_EXE="
for %%F in ("%SD%BlackPool\desktop\*.exe") do if not defined OLD_EXE set "OLD_EXE=%%~nxF"
if defined OLD_EXE taskkill /f /im "%OLD_EXE%" >nul 2>&1
if defined STPY "%STPY%" "%KIT%\kill_by_path.py" "%SD%BlackPool" >> "%LOG%" 2>&1
ping -n 2 127.0.0.1 >nul

set /a _TRIES=0
:rot_old
if exist "%SD%BlackPool.old" (
  rd /s /q "%SD%BlackPool.old" >nul 2>&1
  if exist "%SD%BlackPool.old" (
    set /a _TRIES+=1
    if !_TRIES! geq 3 goto rot_fail
    echo 回滚位清理被占用，重试 !_TRIES!/3 ...
    ping -n 3 127.0.0.1 >nul
    goto rot_old
  )
)
set /a _TRIES=0
:rot_move
if exist "%SD%BlackPool" (
  move "%SD%BlackPool" "%SD%BlackPool.old" >nul 2>&1
  if exist "%SD%BlackPool" (
    set /a _TRIES+=1
    if !_TRIES! geq 3 goto rot_fail
    echo 目录占用，清障重试 !_TRIES!/3 ...
    if defined OLD_EXE taskkill /f /im "%OLD_EXE%" >nul 2>&1
    if defined STPY "%STPY%" "%KIT%\kill_by_path.py" "%SD%BlackPool" >> "%LOG%" 2>&1
    ping -n 3 127.0.0.1 >nul
    goto rot_move
  )
)
move "%B%" "%SD%BlackPool" >nul || (
  echo 部署失败：成品搬运出错；旧版仍在 BlackPool.old 可手工恢复。
  echo 详情见 %LOG% & pause & exit /b 1
)

rem one-click icon entry beside the deployed product
set "BPW_EXE="
for %%F in ("%SD%BlackPool\desktop\*.exe") do if not defined BPW_EXE set "BPW_EXE=%%~fF"
set "LNK_TARGET=%SD%BlackPool\launcher.cmd"
if exist "%SD%BlackPool\Black Pool.exe" set "LNK_TARGET=%SD%BlackPool\Black Pool.exe"
if defined BPW_EXE (
  cscript //nologo "%KIT%\make-shortcut.vbs" "%SD%BlackPool\Black Pool.lnk" "%LNK_TARGET%" "%SD%BlackPool" "%BPW_EXE%,0" >nul 2>&1 && echo 已生成带图标入口：Black Pool.lnk（可拷到桌面）
)

echo.
echo 组装部署完成（公版）：%SD%BlackPool
echo 启动：双击 BlackPool\launcher.cmd 或 Black Pool.lnk   回滚：rollback.cmd
echo 全程日志：%LOG%
exit /b 0

:rot_fail
rem ASCII-only in this block: UTF-8 echo after goto labels desyncs the 65001
rem parser (field case 3, see ..\deploy\deploy.cmd).
echo [FAIL] BlackPool dir is locked - close Black Pool and any console window
echo whose current directory sits inside it, then rerun assemble.cmd.
echo Log: %LOG%
pause & exit /b 1
