@echo off
rem 银芯仓库一键更新（双击即用；本文件随仓库分发，位于仓根）。
rem 前提：机器装有 Git for Windows。仅快进拉取（--ff-only），本地永远是干净只读镜像。
chcp 65001 >nul
echo 正在更新银芯仓库...
git -C "%~dp0." pull --ff-only
if errorlevel 1 (
  echo 更新失败：请检查网络，或本地有未提交改动（本仓应保持只读镜像）。
  pause
  exit /b 1
)
echo 银芯仓库已是最新。
pause
