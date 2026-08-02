@echo off
rem Silver Core 便携整包启动器（cmd 批处理，零 PowerShell）。
rem 合箱布局：python\（uv 托管 CPython）、venv\、app\（组装源树）、desktop\（win-unpacked）、
rem home\（HERMES_HOME）与本文件同级。默认拉起 desktop；CLI 用法 launcher.cmd cli <args>。
rem 自诊断：全程写 launcher.log；任何一步失败都停窗展示原因（不再闪退吞错）；
rem desktop 由 launch_desktop.py 监督式拉起（捕获输出 + 探活 + 软渲染重试，治黑屏一闪即终）。
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=%~dp0"
set "LOG=%ROOT%launcher.log"
echo [%date% %time%] launcher start ROOT=%ROOT% > "%LOG%"
echo Silver Core 启动中，请稍候（本窗会显示进度，失败会停窗给出原因）...

set "HERMES_HOME=%ROOT%home"
set "PATH=%ROOT%venv\Scripts;%PATH%"
if not exist "%HERMES_HOME%" mkdir "%HERMES_HOME%"

rem -- 步骤 1：定位包内便携 CPython --
set "PYHOME="
for /d %%D in ("%ROOT%python\cpython-*") do set "PYHOME=%%~fD"
if not defined PYHOME (
  echo [FAIL] bundle python not found under %ROOT%python\ >> "%LOG%"
  echo 启动失败：包内 python\cpython-* 目录缺失。请把整个 SilverCore 文件夹完整复制后重试。
  echo 详情见 %LOG%
  pause
  exit /b 1
)
echo [ok] PYHOME=%PYHOME% >> "%LOG%"

rem -- 步骤 2：venv 自愈（pyvenv.cfg home 指回当前位置；幂等） --
"%PYHOME%\python.exe" "%ROOT%fix_venv_path.py" "%ROOT%." >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] fix_venv_path failed >> "%LOG%"
  echo 启动失败：venv 自愈未通过。详情见 %LOG%
  pause
  exit /b 1
)

rem -- 步骤 3：运行时健康自检（真启动 CLI 入口） --
"%ROOT%venv\Scripts\python.exe" -c "import hermes_cli" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAIL] runtime import check failed >> "%LOG%"
  echo 启动失败：包内运行时导入自检未通过。详情见 %LOG%
  pause
  exit /b 1
)
echo [ok] runtime import check passed >> "%LOG%"
echo 运行时自检通过。

rem -- CLI 模式：launcher.cmd cli <args> --
if /i "%~1"=="cli" (
  shift
  "%ROOT%venv\Scripts\hermes.exe" %2 %3 %4 %5 %6 %7 %8 %9
  exit /b %errorlevel%
)

rem -- 步骤 4：监督式拉起 desktop（捕获输出 + 探活 + 软渲染重试；未找到则回退 CLI） --
if exist "%ROOT%desktop" (
  echo 正在启动桌面端，自检守窗约 25 秒，窗口正常出现后本窗自动关闭...
  "%ROOT%venv\Scripts\python.exe" "%ROOT%launch_desktop.py" "%ROOT%."
  if errorlevel 1 (
    echo.
    echo 启动失败：桌面端进程未能存活。上方为取证日志尾部，
    echo 完整日志见 %LOG% 与 home\logs\ 目录。
    pause
    exit /b 1
  )
  exit /b 0
)
echo [warn] desktop dir not found, falling back to CLI >> "%LOG%"
echo 未找到桌面端目录，回退命令行模式...
"%ROOT%venv\Scripts\hermes.exe" %*
echo.
echo 命令行会话已结束。
pause
endlocal
