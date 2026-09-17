@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem ============================================================================
rem  一键推送到 GitHub（新手向，全中文引导）
rem
rem  首次运行会引导你贴一次 Personal Access Token；
rem  之后每次双击本脚本都会自动：构建 → 提交 → 推送。
rem ============================================================================

set "REPO=%~dp0"
set "TOOLS=%REPO%..\DSH-tools"
set "PATH=%TOOLS%\PortableGit\cmd;%TOOLS%\node-v24.21.0-win-x64;%TOOLS%\gh;%PATH%"

cd /d "%REPO%"

echo ============================================
echo   推送世界观 Wiki 到 GitHub
echo ============================================
echo.

rem ---------- 0. 工具自检 ----------
where gh >nul 2>nul
if errorlevel 1 (
  echo [!] 找不到 gh 命令。
  echo     请确认 DSH-tools 文件夹与 DSH-wiki 在同一个目录下。
  echo     期望位置：%TOOLS%
  echo.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo [!] 找不到 git 命令。同上，请确认 DSH-tools 文件夹位置。
  echo.
  pause
  exit /b 1
)

rem ---------- 1. 登录状态 ----------
echo [1/4] 检查 GitHub 登录状态...
gh auth status >nul 2>nul
if not errorlevel 1 goto logged_in

echo.
echo       你还没有登录 GitHub，现在引导你完成（只需一次）。
echo.
echo   ----------------------------------------------
echo   第一步：在浏览器打开下面这个网址
echo.
echo       https://github.com/settings/tokens/new
echo.
echo   第二步：按下表填写
echo       Note（备注）  ：随便写，例如 dsh-wiki
echo       Expiration    ：选 90 days 或 No expiration 都行
echo       Select scopes ：勾选最上面那个  [x] repo
echo   第三步：页面拉到底，点绿色的  Generate token
echo   第四步：复制生成的 token（形如 ghp_xxxxxxxx）
echo   ----------------------------------------------
echo.
echo   注意：token 只显示一次，请先复制好。
echo.
echo   准备好后，在下面按鼠标右键粘贴（或 Ctrl+V），然后回车：
echo.
set "GHTOKEN="
set /p "GHTOKEN= 粘贴 token 后回车: "

if "!GHTOKEN!"=="" (
  echo.
  echo [!] 没有输入内容，已退出。重新双击本脚本即可重来。
  echo.
  pause
  exit /b 1
)

echo.
echo       正在验证 token...
echo !GHTOKEN!| gh auth login --hostname github.com --with-token
if errorlevel 1 (
  echo.
  echo [!] 登录失败。常见原因：
  echo     - token 复制不全或多了空格
  echo     - token 没有勾选 repo 权限
  echo     - token 已经过期
  echo     请重新生成一个 token 再试。
  echo.
  pause
  exit /b 1
)
echo       登录成功 ✓
set "GHTOKEN="

:logged_in
echo       已登录 ✓
echo.

rem ---------- 2. 远程仓库 ----------
echo [2/4] 检查远程仓库...
git remote get-url origin >nul 2>nul
if not errorlevel 1 goto have_remote

echo       还没有远程仓库，正在创建 DSH-wiki（私有）...
gh repo create DSH-wiki --private --source=. --remote=origin
if errorlevel 1 (
  echo.
  echo [!] 创建仓库失败。可能原因：
  echo     - 同名仓库已存在（若是你自己的，可用下面的命令手动关联）：
  echo         git remote add origin https://github.com/你的用户名/DSH-wiki.git
  echo     - 网络不通，或 token 权限不足
  echo.
  pause
  exit /b 1
)
echo       仓库已创建并关联 ✓

:have_remote
git remote -v
echo.

rem ---------- 3. 构建 ----------
echo [3/4] 本地重建验证...
node build.mjs
if errorlevel 1 (
  echo.
  echo [!] 构建失败，已中止，不会提交。
  echo.
  pause
  exit /b 1
)
echo.

rem ---------- 4. 提交并推送 ----------
echo [4/4] 提交并推送...
git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo       内容没有变化，跳过提交。
  goto do_push
)

for /f "tokens=1-4 delims=/-. " %%a in ("%date%") do set "TODAY=%%a-%%b-%%c"
git commit -m "更新：%TODAY%" >nul
if errorlevel 1 (
  echo.
  echo [!] 提交失败。若提示需要 user.name / user.email，请执行：
  echo       git config --global user.name  "你的名字"
  echo       git config --global user.email "你的邮箱"
  echo.
  pause
  exit /b 1
)
echo       已提交 ✓

:do_push
git push -u origin main
if errorlevel 1 (
  echo.
  echo [!] 推送失败。常见原因：
  echo     - 网络不通（GitHub 有时需要重试几次）
  echo     - token 过期，重新生成后重跑本脚本
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   全部完成 ✓
echo.
echo   你的仓库地址（可在浏览器打开）：
gh repo view --json url -q .url 2>nul
echo.
echo   接下来：登录 Netlify - Add new site - Import an existing project
echo   - 选 GitHub - 选中 DSH-wiki
echo     Build command    : node build.mjs
echo     Publish directory: site
echo   之后每次双击本脚本，线上站点会自动更新。
echo ============================================
echo.
pause
