@echo off
rem Black Pool 整包一键更新器（部署件归档；使用时复制到桌面等 BlackPool 外的位置双击）。
rem 逻辑：下载最新整包 -> 旧版改名 BlackPool.old 留作回滚 -> 解压新版 ->
rem 迁回 home\（个人记忆与配置，更新不丢）-> 自动启动。零安装器零 PowerShell
rem （curl.exe / tar.exe 均为 Windows 10+ 自带）。
chcp 65001 >nul
cd /d %USERPROFILE%\Desktop
echo 正在下载最新 Black Pool 整包（约 1GB，请稍候）...
curl.exe -L -o black-pool-win64.zip https://github.com/lightproud/BIAV-SC-CODE/releases/download/black-pool-bundle/black-pool-win64.zip || goto :fail
if exist BlackPool.old rd /s /q BlackPool.old
if exist BlackPool move BlackPool BlackPool.old >nul
tar -xf black-pool-win64.zip || goto :fail
if exist BlackPool.old\home xcopy /e /i /y BlackPool.old\home BlackPool\home >nul
start "" "%USERPROFILE%\Desktop\BlackPool\launcher.cmd"
exit /b 0
:fail
echo 更新失败，请检查网络后重试。
pause
exit /b 1
