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

rem (zh comment moved to RUNBOOK - 65001 parser desync)
set "PATCHED=0"
if exist "%DEVROOT%\patches\*.patch" (
  for /f "delims=" %%P in ('dir /b /o:n "%DEVROOT%\patches\*.patch"') do (
    "%PYHOME%\python.exe" "%SD%apply_patch.py" --root "%B%\app" "%DEVROOT%\patches\%%P" >> "%LOG%" 2>&1 || (
      echo 组装失败：补丁 %%P 应用失败（上下文不匹配或目标缺失）。
      echo 详情见 %LOG% & pause & exit /b 1
    )
    set /a PATCHED+=1
    echo 补丁已打：%%P
  )
)

rem (zh comment moved to RUNBOOK - 65001 parser desync)
if exist "%DEVROOT%\config\SOUL.md" (
  if not exist "%B%\home" mkdir "%B%\home"
  copy /y "%DEVROOT%\config\SOUL.md" "%B%\home\SOUL.md" >nul && echo 已注入 SOUL.md
)
if exist "%DEVROOT%\config\env.cmd" copy /y "%DEVROOT%\config\env.cmd" "%B%\env.cmd" >nul && echo 已注入 env.cmd
if exist "%DEVROOT%\config\model-prices.json" (
  if not exist "%B%\home" mkdir "%B%\home"
  copy /y "%DEVROOT%\config\model-prices.json" "%B%\home\model-prices.json" >nul && echo 已注入 model-prices.json
)
if exist "%DEVROOT%\plugins" robocopy "%DEVROOT%\plugins" "%B%\app\plugins" /e /njh /njs /ndl /nfl >nul & if !errorlevel! geq 8 (echo 组装失败：plugins 拷贝出错 & pause & exit /b 1)
if exist "%DEVROOT%\skills" (
  if not exist "%B%\home\skills" mkdir "%B%\home\skills"
  robocopy "%DEVROOT%\skills" "%B%\home\skills" /e /njh /njs /ndl /nfl >nul
  if !errorlevel! geq 8 (echo 组装失败：skills 拷贝出错 & pause & exit /b 1)
)
if exist "%DEVROOT%\overlay" robocopy "%DEVROOT%\overlay" "%B%" /e /njh /njs /ndl /nfl >nul & if !errorlevel! geq 8 (echo 组装失败：overlay 拷贝出错 & pause & exit /b 1)

rem (zh comment moved to RUNBOOK - 65001 parser desync)
> "%B%\MANIFEST.txt" (
  echo assembled: %date% %time%
  echo source-zip: %ZIP%
  echo patches-applied: %PATCHED%
  for /f "delims=" %%P in ('dir /b /o:n "%DEVROOT%\patches\*.patch" 2^>nul') do echo   - %%P
)
echo.
echo 组装完成：%B%
echo 验证（可选）：verify.cmd 就地体检成品，不触碰运行位、不影响在用的 Black Pool。
echo 部署上线：deploy.cmd ^<部署目录^>   （例：deploy.cmd E:\BIAV-BP\black-pool-agent）
echo 全程日志：%LOG%
exit /b 0
