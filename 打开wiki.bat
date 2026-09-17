@echo off
chcp 65001 >nul
setlocal
rem 构建世界观 Wiki 并启动本地服务
rem 端口可用环境变量 WIKI_PORT 覆盖，默认 8899

cd /d "%~dp0"
if "%WIKI_PORT%"=="" set "WIKI_PORT=8899"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] PATH 中没有 node，尝试使用 DSH 自带 node...
  set "NODE_EXE=C:\Users\cyt\AppData\Local\Programs\DSH Desktop\resources\app\node_modules\node\bin\node.exe"
) else (
  set "NODE_EXE=node"
)

"%NODE_EXE%" build.mjs --serve %WIKI_PORT%
pause
