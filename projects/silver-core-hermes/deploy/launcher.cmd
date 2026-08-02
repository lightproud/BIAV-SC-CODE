@echo off
rem Silver Core 便携整包启动器（cmd 批处理，零 PowerShell）。
rem 合箱布局（守密人 2026-08-02 裁定单目录）：本文件位于整包根；python\（uv 托管
rem CPython）、venv\（relocatable）、app\（品牌组装源树）、desktop\（win-unpacked
rem 免装目录形态的 desktop 应用）、home\（HERMES_HOME，首启自动生成）与其同级。
rem 默认拉起 desktop 图形界面；命令行用法：直接运行 venv\Scripts\hermes.exe。
setlocal
set "ROOT=%~dp0"
set "HERMES_HOME=%ROOT%home"
set "PATH=%ROOT%venv\Scripts;%PATH%"
if not exist "%HERMES_HOME%" mkdir "%HERMES_HOME%"
for %%F in ("%ROOT%desktop\*.exe") do (
  start "Silver Core" "%%~fF"
  goto :eof
)
"%ROOT%venv\Scripts\hermes.exe" %*
endlocal
