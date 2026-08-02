@echo off
rem Silver Core 便携整包启动器（cmd 批处理，零 PowerShell）。
rem 布局约定：本文件位于整包根；python\（uv 托管 CPython）、venv\（relocatable）、
rem app\（品牌组装后的源树）、home\（HERMES_HOME，首启自动生成）与其同级。
setlocal
set "ROOT=%~dp0"
set "HERMES_HOME=%ROOT%home"
set "PATH=%ROOT%venv\Scripts;%PATH%"
if not exist "%HERMES_HOME%" mkdir "%HERMES_HOME%"
"%ROOT%venv\Scripts\hermes.exe" %*
endlocal
