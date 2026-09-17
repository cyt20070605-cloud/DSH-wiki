@echo off
rem 重新构建，并打包成可直接拖入 Netlify 的 zip（netlify-deploy.zip）
setlocal
cd /d "%~dp0"
set "TOOLS=%~dp0..\DSH-tools"
if exist "%TOOLS%\node-v24.21.0-win-x64\node.exe" (
  set "NODE_EXE=%TOOLS%\node-v24.21.0-win-x64\node.exe"
) else (
  set "NODE_EXE=node"
)
"%NODE_EXE%" pack-netlify.mjs
pause
