@echo off
rem Black Pool one-click update pipeline (keeper ruling 2026-08-04):
rem   [1] git pull silver-core clone  [2] svn update workshop
rem   [3] download newest bundle     [4] assemble  [5] deploy  [6] launch
rem Thin orchestrator: steps 4/5/6 call the existing kit scripts, which all
rem stay independently runnable. Usage: update.cmd [nodl]
rem   nodl = skip download, assemble newest zip already in releases\
rem ASCII rem only + no zh echo after goto labels (65001 desync, RUNBOOK).
rem Bootstrap is goto-based on purpose: expanding %~f0 or %* inside a ( )
rem block breaks cmd parsing when the value contains a parenthesis - e.g.
rem a dir or file Explorer renamed to "xxx (1)" - and the window dies
rem instantly with no message. Field class found 2026-08-04.
>> "%TEMP%\black-pool-update-boot.log" echo [%date% %time%] entry %~f0
if defined BPA_KEEPWIN goto :bpa_keepwin
set "BPA_KEEPWIN=1"
cmd /d /k call "%~f0" %*
exit /b
:bpa_keepwin
rem Re-exec from a TEMP copy: steps 1/2 may rewrite this very file mid-run
rem (cmd parses batch files incrementally - self-modification desyncs it).
rem Detect the TEMP copy by FILE NAME, not an env flag: a leftover env var
rem in a reused window must not make the self-modifiable original run.
if /i "%~nx0"=="bpa-update-run.cmd" goto :bpa_run
set "BPA_UPD_SD=%~dp0"
copy /y "%~f0" "%TEMP%\bpa-update-run.cmd" >nul
if exist "%TEMP%\bpa-update-run.cmd" goto :bpa_staged
echo [FAIL] cannot stage a TEMP copy of update.cmd - check TEMP dir and disk space.
pause
exit /b 1
:bpa_staged
call "%TEMP%\bpa-update-run.cmd" %*
exit /b
:bpa_run
if not defined BPA_UPD_SD goto :bpa_no_sd
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "SD=%BPA_UPD_SD%"
for %%I in ("%SD%..") do set "DEVROOT=%%~fI"
set "LOG=%DEVROOT%\update.log"
echo [%date% %time%] one-click update start > "%LOG%"
echo ============ 黑池一键更新（六步流水线）============

rem -- [1/6] git pull --ff-only on the silver-core clone --
rem Clone root: config\git-root.txt if present, else auto-detect (works when
rem deploy\ is junctioned/checked out inside the git working tree).
set "GITROOT="
if exist "%DEVROOT%\config\git-root.txt" set /p GITROOT=<"%DEVROOT%\config\git-root.txt"
where git >nul 2>&1
if errorlevel 1 (
  echo [1/6] 跳过银芯仓更新：机器上没有 git 命令
) else (
  if not defined GITROOT for /f "delims=" %%G in ('git -C "%SD%." rev-parse --show-toplevel 2^>nul') do set "GITROOT=%%G"
  if defined GITROOT (
    set "GITROOT=!GITROOT:/=\!"
    echo [1/6] 银芯仓 git pull --ff-only ...
    git -C "!GITROOT!" pull --ff-only >> "%LOG%" 2>&1 && (
      echo       完成：!GITROOT!
    ) || (
      echo       未成功（离线或本地有改动），跳过继续，详见 update.log
    )
  ) else (
    echo [1/6] 跳过银芯仓更新：未定位克隆（可在 config\git-root.txt 写一行路径启用）
  )
)

rem -- [2/6] svn update the workshop root (also refreshes deploy\ external) --
where svn >nul 2>&1
if errorlevel 1 (
  echo [2/6] 跳过车间 svn update：没有 svn 命令行（TortoiseSVN 安装时勾 command line client tools）
) else (
  if exist "%DEVROOT%\.svn" (
    echo [2/6] 车间 svn update ...
    svn update "%DEVROOT%" >> "%LOG%" 2>&1 && (
      echo       完成
    ) || (
      echo       未成功，跳过继续，详见 update.log
    )
  ) else (
    echo [2/6] 跳过车间 svn update：%DEVROOT% 不是 SVN 工作副本
  )
)

rem -- [3/6] download newest bundle into releases\ --
set "REL=%DEVROOT%\releases"
if not exist "%REL%" mkdir "%REL%"
set "ZIPURL=https://github.com/lightproud/BIAV-SC-CODE/releases/download/black-pool-bundle/black-pool-win64.zip"
set "APIURL=https://api.github.com/repos/lightproud/BIAV-SC-CODE/releases/tags/black-pool-bundle"
if /i "%~1"=="nodl" (
  echo [3/6] 跳过下载（nodl）：用 releases\ 现存最新包组装
) else (
  echo [3/6] 下载最新整包（数百 MB，视网速数分钟）...
  set "DLOK="
  curl.exe -L --fail -o "%REL%\black-pool-win64.zip.part" "%ZIPURL%" 2>> "%LOG%" && set "DLOK=1"
  if defined DLOK (
    move /y "%REL%\black-pool-win64.zip.part" "%REL%\black-pool-win64.zip" >nul
    set "SHA="
    for /f "skip=1 delims=" %%H in ('certutil -hashfile "%REL%\black-pool-win64.zip" SHA256 2^>nul') do if not defined SHA set "SHA=%%H"
    set "SHA=!SHA: =!"
    set "SHAOK="
    curl.exe -s "%APIURL%" 2>nul | findstr /i /c:"!SHA!" >nul && set "SHAOK=1"
    if defined SHAOK (
      echo       验明正身：SHA-256 与 Release 官方 digest 一致
    ) else (
      echo       提示：未能对上官方 digest（离线或 API 不可达），按 TLS 下载信任
    )
    findstr /i /c:"!SHA!" "%REL%\CHECKSUMS.txt" >nul 2>&1 || >>"%REL%\CHECKSUMS.txt" echo !SHA!  black-pool-win64.zip  %date%
    echo       下载完成，SHA-256 已登记 CHECKSUMS.txt
  ) else (
    del "%REL%\black-pool-win64.zip.part" >nul 2>&1
    echo       下载失败（网络不通或 Release 不可达）。
    choice /c YN /m "用 releases\ 里现存最新包继续吗"
    if errorlevel 2 (
      echo 已中止：本次一键更新未进行组装部署。
      exit /b 1
    )
  )
)

rem -- [4/6] assemble (existing kit script, unchanged) --
echo [4/6] 组装 ...
call "%SD%assemble.cmd"
if errorlevel 1 (
  echo 流水线中止于组装步（原因见上方与 assemble.log）。
  exit /b 1
)

rem -- [5/6] deploy (target from config\deploy-target.txt, same as manual) --
echo [5/6] 部署 ...
call "%SD%deploy.cmd"
if errorlevel 1 (
  echo 流水线中止于部署步（原因见上方与 deploy.log）。
  exit /b 1
)

rem -- [6/6] launch the deployed bundle --
set "BPA_DIR="
if exist "%DEVROOT%\config\deploy-target.txt" set /p BPA_DIR=<"%DEVROOT%\config\deploy-target.txt"
if defined BPA_DIR (
  set "_ABS="
  if "!BPA_DIR:~1,1!"==":" set "_ABS=1"
  if "!BPA_DIR:~0,2!"=="\\" set "_ABS=1"
  if not defined _ABS set "BPA_DIR=%DEVROOT%\!BPA_DIR!"
  for %%I in ("!BPA_DIR!") do set "BPA_DIR=%%~fI"
)
if exist "!BPA_DIR!\launcher.cmd" (
  echo [6/6] 启动黑池 ...
  start "" "!BPA_DIR!\launcher.cmd"
  echo ============ 一键更新完成，黑池启动中 ============
) else (
  echo [6/6] 未找到部署位 launcher.cmd，跳过启动（可手动双击部署位入口）。
)
exit /b 0

:bpa_no_sd
echo [FAIL] run update.cmd from the deploy kit dir, not the TEMP copy directly.
pause
exit /b 1
