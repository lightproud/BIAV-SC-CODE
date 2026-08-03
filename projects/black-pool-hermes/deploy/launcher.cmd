@echo off
rem 双击防闪退外壳：把真正的执行放进 cmd /k 子窗——后面任何一步出事（含批处理
rem 语法错这种 pause 都来不及跑的死法），窗口都停住可读；成功路径用 exit 0 关窗。
if not defined SC_LAUNCHER_KEEPWIN (
  set "SC_LAUNCHER_KEEPWIN=1"
  cmd /d /k call "%~f0" %*
  exit /b
)
rem Black Pool（黑池）便携整包启动器（cmd 批处理，零 PowerShell）。
rem 合箱布局：python\（uv 托管 CPython）、venv\、app\（组装源树）、desktop\（win-unpacked）、
rem home\（HERMES_HOME）与本文件同级。默认拉起 desktop；CLI 用法 launcher.cmd cli <args>。
rem 自诊断：全程写 launcher.log；任何一步失败都停窗展示原因（不再闪退吞错）；
rem desktop 由 launch_desktop.py 监督式拉起（捕获输出 + 探活 + 软渲染重试，治黑屏一闪即终）。
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=%~dp0"
set "LOG=%ROOT%launcher.log"
echo [%date% %time%] launcher start ROOT=%ROOT% > "%LOG%"
echo Black Pool 启动中，请稍候（本窗会显示进度，失败会停窗给出原因）...

set "HERMES_HOME=%ROOT%home"
rem 应用显示名（上游官方旋钮）：main.ts 的 APP_NAME 行因含 HERMES_ 被换装规则
rem 跳线保留，兜底值仍是 'Hermes'——app.setName / About 面板 / 菜单标签全跟它走，
rem 任务管理器与 Alt-Tab 因此漏显 Hermes。经环境针覆盖为 Black Pool（零侵入）。
set "HERMES_DESKTOP_APP_NAME=Black Pool"
set "PATH=%ROOT%venv\Scripts;%PATH%"
if not exist "%HERMES_HOME%" mkdir "%HERMES_HOME%"

rem -- 步骤 1：定位包内便携 CPython --
set "PYHOME="
for /d %%D in ("%ROOT%python\cpython-*") do set "PYHOME=%%~fD"
if not defined PYHOME (
  echo [FAIL] bundle python not found under %ROOT%python\ >> "%LOG%"
  echo 启动失败：包内 python\cpython-* 目录缺失。请把整个 BlackPool 文件夹完整复制后重试。
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
if not exist "%ROOT%launch_desktop.py" goto legacy_start
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
  exit 0
)
goto cli_fallback

:legacy_start
rem 旧包没有监督器时的兜底（本文件可单独拷进旧 SilverCore 直接用）：
rem 直接拉起 desktop，窗口停住等守密人确认桌面端是否出现。
set "DESKTOP_EXE="
for %%F in ("%ROOT%desktop\*.exe") do if not defined DESKTOP_EXE set "DESKTOP_EXE=%%~fF"
if defined DESKTOP_EXE (
  echo [ok] legacy start %DESKTOP_EXE% >> "%LOG%"
  echo 未找到监督器 launch_desktop.py，直接拉起桌面端：
  echo   %DESKTOP_EXE%
  start "Black Pool" "%DESKTOP_EXE%"
  echo 若桌面端窗口没有出现，请把 home\logs\ 下日志发给艾瑞卡；本窗可手动关闭。
  pause
  exit /b 0
)

:cli_fallback
echo [warn] desktop dir not found, falling back to CLI >> "%LOG%"
echo 未找到桌面端目录，回退命令行模式...
"%ROOT%venv\Scripts\hermes.exe" %*
echo.
echo 命令行会话已结束。
pause
endlocal
