@echo off
rem 一键推送：构建 - 提交 - 推送。已内置代理与凭据处理。
setlocal enabledelayedexpansion
set "REPO=%~dp0"
set "TOOLS=%REPO%..\DSH-tools"
set "PATH=%TOOLS%\PortableGit\cmd;%TOOLS%\node-v24.21.0-win-x64;%TOOLS%\gh;%PATH%"
cd /d "%REPO%"
echo ============================================
echo   推送世界观 Wiki 到 GitHub
echo ============================================
echo.
where gh >nul 2>nul
if errorlevel 1 goto no_tools
where git >nul 2>nul
if errorlevel 1 goto no_tools
goto check_login
:no_tools
echo [!] 找不到 gh 或 git。请确认 DSH-tools 与 DSH-wiki 在同一个父目录下。
echo     期望工具目录: %TOOLS%
goto end
:check_login
echo [1/5] 检查登录状态...
gh auth status >nul 2>nul
if errorlevel 1 goto need_login
echo       已登录
goto setup
:need_login
echo.
echo [!] 还没有登录 GitHub。请先双击 仅登录.bat 完成登录，再运行本脚本。
goto end
:setup
echo.
echo [2/5] 配置代理与凭据...
rem 读取系统代理设置；但必须先确认端口真的在监听，否则按直连处理
rem （代理软件关了而配置还指着它，会导致推送失败）
set "SYSPROXY="
for /f "tokens=2*" %%a in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer 2^>nul') do set "SYSPROXY=%%b"
if defined SYSPROXY (
  set "PPHOST=!SYSPROXY!"
  set "PPORT=!SYSPROXY!"
  for /f "tokens=1 delims=:" %%h in ("!SYSPROXY!") do set "PPHOST=%%h"
  for /f "tokens=2 delims=:" %%p in ("!SYSPROXY!") do set "PPORT=%%p"
  set "PROXYOK="
  for /f "usebackq delims=" %%r in (`powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('!PPHOST!',[int]'!PPORT!');'OK'}catch{'NO'}"`) do set "PROXYOK=%%r"
)
if "!PROXYOK!"=="OK" (
  git config http.proxy "http://!SYSPROXY!"
  git config https.proxy "http://!SYSPROXY!"
  echo       代理在监听，已交给 git: !SYSPROXY!
) else (
  git config --unset http.proxy >nul 2>nul
  git config --unset https.proxy >nul 2>nul
  if defined SYSPROXY (echo       系统代理 !SYSPROXY! 未在监听，按直连处理) else (echo       未检测到系统代理，按直连处理)
)
gh auth setup-git >nul 2>nul
echo       凭据已接通 gh
echo.
echo [3/5] 检查远程仓库...
git remote get-url origin >nul 2>nul
if errorlevel 1 goto make_repo
goto have_repo
:make_repo
echo       正在创建 DSH-wiki 私有仓库...
gh repo create DSH-wiki --private --source=. --remote=origin
if errorlevel 1 goto repo_fail
:have_repo
git remote -v | findstr /c:"origin" >nul
echo.
echo [4/5] 本地重建验证...
node build.mjs
if errorlevel 1 goto build_fail
echo.
echo [5/5] 提交并推送...
git add -A
git diff --cached --quiet
if not errorlevel 1 goto do_push
for /f "tokens=1-4 delims=/-. " %%a in ("%date%") do set "TODAY=%%a-%%b-%%c"
git commit -m "更新：!TODAY!" >nul
if errorlevel 1 goto commit_fail
echo       已提交
:do_push
git push -u origin main
if errorlevel 1 goto push_fail
echo.
echo ============================================
echo   完成！线上仓库已更新。
echo.
echo   仓库地址:
gh repo view --json url -q .url
echo.
echo   GitHub Pages 约一分钟后自动更新：
echo   https://cyt20070605-cloud.github.io/DSH-wiki/
echo ============================================
goto end
:repo_fail
echo.
echo [!] 创建仓库失败。若已存在同名仓库，可手动关联:
echo       git remote add origin https://github.com/你的用户名/DSH-wiki.git
goto end
:build_fail
echo.
echo [!] 构建失败，已中止，不会提交任何东西。
goto end
:commit_fail
echo.
echo [!] 提交失败。若提示需要 user.name / user.email，请执行:
echo       git config --global user.name  "你的名字"
echo       git config --global user.email "你的邮箱"
goto end
:push_fail
echo.
echo [!] 推送失败。常见原因:
echo     - 代理软件没开（若你平时需要代理才能访问 GitHub）
echo       本脚本会自动读取系统代理设置，请确认代理已启动
echo     - 网络波动，稍后重试即可
echo     - token 过期，重新生成后双击 仅登录.bat
:end
echo.
pause
