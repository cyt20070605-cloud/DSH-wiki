@echo off
chcp 65001 >nul
setlocal
rem 重新构建世界观 Wiki，并打包成可直接拖入 Netlify 的 zip
rem 产出：本目录下的 netlify-deploy.zip（压缩包根层即 index.html）

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] PATH 中没有 node，尝试使用 DSH 自带 node...
  set "NODE_EXE=C:\Users\cyt\AppData\Local\Programs\DSH Desktop\resources\app\node_modules\node\bin\node.exe"
) else (
  set "NODE_EXE=node"
)
if not exist "%NODE_EXE%" (
  if not "%NODE_EXE%"=="node" (
    echo [!] 未找到 node 可执行文件：%NODE_EXE%
    echo     请先安装 Node.js，或手动修改本脚本里的 NODE_EXE 路径。
    pause
    exit /b 1
  )
)

"%NODE_EXE%" pack-netlify.mjs
pause
