@echo off
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem (zh comment moved to RUNBOOK - 65001 parser desync)
if not defined BPA_KEEPWIN (
  set "BPA_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "SD=%~dp0"
set "DEVROOT=%SD%.."
set "LOG=%DEVROOT%\assemble.log"
echo [%date% %time%] assemble start > "%LOG%"

rem (zh comment moved to RUNBOOK - 65001 parser desync)
set "ZIP="
if not "%~1"=="" (
  set "ZIP=%DEVROOT%\releases\%~1"
) else (
  for /f "delims=" %%F in ('dir /b /o:d "%DEVROOT%\releases\*.zip" 2^>nul') do set "ZIP=%DEVROOT%\releases\%%F"
)
if not defined ZIP (
  echo 组装失败：..\releases\ 里没有 zip 包。先从银芯 Release 下载入库。
  echo 详情见 %LOG% & pause & exit /b 1
)
if not exist "%ZIP%" (
  echo 组装失败：指定的包不存在 %ZIP%
  pause & exit /b 1
)
echo 进料：%ZIP%
echo [ok] zip=%ZIP% >> "%LOG%"

rem (zh comment moved to RUNBOOK - 65001 parser desync)
if exist "%DEVROOT%\releases\CHECKSUMS.txt" (
  set "SHA="
  for /f "skip=1 delims=" %%H in ('certutil -hashfile "%ZIP%" SHA256 2^>nul') do if not defined SHA set "SHA=%%H"
  set "SHA=!SHA: =!"
  findstr /i /c:"!SHA!" "%DEVROOT%\releases\CHECKSUMS.txt" >nul || (
    echo 组装失败：SHA-256 与 CHECKSUMS.txt 不符（包损坏或未登记）。
    echo   实测 !SHA! >> "%LOG%"
    echo 详情见 %LOG% & pause & exit /b 1
  )
  echo 验货通过：SHA-256 已比对 CHECKSUMS.txt
) else (
  echo [warn] 无 CHECKSUMS.txt，跳过验货 >> "%LOG%"
  echo 提示：未做 SHA 验货（..\releases\CHECKSUMS.txt 不存在）。
)

rem (zh comment moved to RUNBOOK - 65001 parser desync)
if exist "%DEVROOT%\staging" rd /s /q "%DEVROOT%\staging"
mkdir "%DEVROOT%\staging"
echo 解压中（约 1 分钟）...
tar -xf "%ZIP%" -C "%DEVROOT%\staging" || (
  echo 组装失败：解压出错。& echo 详情见 %LOG% & pause & exit /b 1
)
set "B=%DEVROOT%\staging\BlackPool"
if not exist "%B%\launcher.cmd" (
  echo 组装失败：包结构异常（未见 BlackPool\launcher.cmd）。
  pause & exit /b 1
)

rem (zh comment moved to RUNBOOK - 65001 parser desync)
for %%F in (launcher.cmd launch_desktop.py fix_venv_path.py) do (
  if exist "%SD%%%F" copy /y "%SD%%%F" "%B%\%%F" >nul
)
echo 启动器族已按套件版覆盖（launcher / 监督器 / venv 自愈）

rem (zh comment moved to RUNBOOK - 65001 parser desync)
set "PYHOME="
for /d %%D in ("%B%\python\cpython-*") do set "PYHOME=%%~fD"
if not defined PYHOME (
  echo 组装失败：包内 python\cpython-* 缺失。& pause & exit /b 1
)

rem Injection phase (patches/config/plugins/skills/overlay) + assembly docs
rem now live in assemble_inject.py, driven by the optional selection table
rem config\assembly.txt (missing = everything on). It prints its own zh
rem progress lines and writes ASSEMBLY.md + MANIFEST.txt into the bundle.
set "PYTHONIOENCODING=utf-8"
"%PYHOME%\python.exe" "%SD%assemble_inject.py" --devroot "%DEVROOT%" --bundle "%B%" --zip "%ZIP%" --sha "!SHA!"
if errorlevel 1 (
  echo 组装失败：注入/清单阶段出错（补丁上下文不匹配或拷贝失败）。
  echo 详情见 %LOG% & pause & exit /b 1
)

echo.
echo 组装完成：%B%
echo 装配清单：%B%\ASSEMBLY.md   （拼了什么、跳了什么，逐条在案）
echo 下一步：deploy.cmd ^<部署目录^>   （例：deploy.cmd E:\BIAV-BP\black-pool-agent）
echo 全程日志：%LOG%
exit /b 0
