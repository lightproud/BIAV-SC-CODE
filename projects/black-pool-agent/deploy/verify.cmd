@echo off
rem (zh comment moved to RUNBOOK - 65001 parser desync)
rem verify staging bundle in place: structure / venv heal / import check
rem never touches the live install dir - safe while it is in use
if not defined BPA_KEEPWIN (
  set "BPA_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
setlocal EnableExtensions
chcp 65001 >nul
set "SD=%~dp0"
set "DEVROOT=%SD%.."
set "LOG=%DEVROOT%\verify.log"
set "B=%DEVROOT%\staging\BlackPool"
echo [%date% %time%] verify start > "%LOG%"
echo 组装验证：只就地检查 staging 成品，不触碰运行位、不影响正在使用的 Black Pool。
if not exist "%B%\MANIFEST.txt" (
  echo 验证失败：staging 里没有组装成品（先跑 assemble.cmd）。
  pause & exit /b 1
)

rem -- 1. structure checks --
if not exist "%B%\launcher.cmd" (
  echo 验证失败：包结构异常（未见 launcher.cmd）。
  pause & exit /b 1
)
set "PYHOME="
for /d %%D in ("%B%\python\cpython-*") do set "PYHOME=%%~fD"
if not defined PYHOME (
  echo 验证失败：包内 python\cpython-* 缺失。
  pause & exit /b 1
)
if not exist "%B%\desktop" echo 提示：包内无 desktop 目录（启动将回退命令行模式）。
echo 结构检查通过。

rem -- 2. venv self-heal against staging path (idempotent) --
rem post-install launch re-heals to the final path, so this is side-effect free
"%PYHOME%\python.exe" "%B%\fix_venv_path.py" "%B%\." >> "%LOG%" 2>&1
if errorlevel 1 (
  echo 验证失败：venv 自愈未通过。详情见 %LOG%
  pause & exit /b 1
)
echo venv 自愈通过。

rem -- 3. runtime import check --
"%B%\venv\Scripts\python.exe" -c "import hermes_cli" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo 验证失败：运行时导入自检未通过。详情见 %LOG%
  pause & exit /b 1
)
echo 运行时导入自检通过。

echo.
echo 验证通过：%B%
type "%B%\MANIFEST.txt"
echo 下一步：deploy.cmd 上线（届时才会提示重启正在运行的 Black Pool）。
echo 备注：桌面端真机冒烟需部署后进行（单实例约束，staging 直启会转交给在跑实例）。
exit /b 0
