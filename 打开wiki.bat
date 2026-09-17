@echo off
rem 构建世界观 Wiki 并启动本地服务，端口可用环境变量 WIKI_PORT 覆盖，默认 8899
setlocal
cd /d "%~dp0"
if "%WIKI_PORT%"=="" set "WIKI_PORT=8899"
set "TOOLS=%~dp0..\DSH-tools"
if exist "%TOOLS%\node-v24.21.0-win-x64\node.exe" (
  set "NODE_EXE=%TOOLS%\node-v24.21.0-win-x64\node.exe"
) else (
  set "NODE_EXE=node"
)
"%NODE_EXE%" build.mjs --serve %WIKI_PORT%
pause
