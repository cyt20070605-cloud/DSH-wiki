@echo off
rem 一键推送：构建 - 提交 - 推送。首次运行会引导登录 GitHub。
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
echo [!] 找不到 gh 或 git 命令。
echo     请确认 DSH-tools 文件夹与 DSH-wiki 在同一个父目录下。
echo     期望工具目录: %TOOLS%
echo.
goto end
:check_login
echo [1/4] 检查 GitHub 登录状态...
gh auth status >nul 2>nul
if not errorlevel 1 goto logged_in
echo.
echo       你还没有登录 GitHub，现在引导你完成，只需做一次。
echo.
echo   -------------------- 操作步骤 --------------------
echo   1. 浏览器打开:  https://github.com/settings/tokens/new
echo   2. 按下表填写:
echo        Note 备注      : dsh-wiki   （随便写）
echo        Expiration     : 选 90 days 或 No expiration
echo        Select scopes  : 勾选最上面那个 [ ] repo
echo   3. 页面拉到底，点绿色按钮 Generate token
echo   4. 复制生成的 token，形如 ghp_xxxxxxxx
echo   --------------------------------------------------
echo.
echo   注意: token 只显示一次，请先复制好。
echo.
echo   现在在下面按鼠标右键粘贴，然后回车:
echo.
set "GHTOKEN="
set /p "GHTOKEN=  粘贴 token: "
if "!GHTOKEN!"=="" goto no_token
echo.
echo       正在验证 token ...
echo !GHTOKEN!| gh auth login --hostname github.com --with-token
if errorlevel 1 goto token_fail
echo       登录成功
set "GHTOKEN="
goto logged_in
:no_token
echo.
echo [!] 没有输入内容，已退出。重新双击本脚本即可重来。
echo.
goto end
:token_fail
echo.
echo [!] 登录失败。常见原因:
echo     - token 复制不全，或前后多了空格
echo     - 生成时没有勾选 repo 权限
echo     - token 已过期
echo     请重新生成一个再试。
echo.
goto end
:logged_in
echo       已登录
echo.
echo [2/4] 检查远程仓库...
git remote get-url origin >nul 2>nul
if not errorlevel 1 goto have_remote
echo       还没有远程仓库，正在创建 DSH-wiki，设为私有...
gh repo create DSH-wiki --private --source=. --remote=origin
if errorlevel 1 goto repo_fail
echo       仓库已创建并关联
goto have_remote
:repo_fail
echo.
echo [!] 创建仓库失败，可能原因:
echo     - 你账号下已有同名 DSH-wiki 仓库
echo     - 网络不通，或 token 权限不足
echo.
goto end
:have_remote
git remote -v
echo.
echo [3/4] 本地重建验证...
node build.mjs
if errorlevel 1 goto build_fail
echo.
echo [4/4] 提交并推送...
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
echo   全部完成
echo.
echo   你的仓库地址:
gh repo view --json url -q .url
echo.
echo   下一步: 登录 Netlify，Add new site
echo           Import an existing project，选 GitHub，选 DSH-wiki
echo           Build command    : node build.mjs
echo           Publish directory: site
echo.
echo   以后每次改完内容，双击本脚本即可自动上线。
echo ============================================
echo.
goto end
:build_fail
echo.
echo [!] 构建失败，已中止，不会提交任何东西。
echo.
goto end
:commit_fail
echo.
echo [!] 提交失败。若提示需要 user.name / user.email，请先执行:
echo       git config --global user.name  "你的名字"
echo       git config --global user.email "你的邮箱"
echo.
goto end
:push_fail
echo.
echo [!] 推送失败。常见原因:
echo     - 网络不通，可稍后重试
echo     - token 过期，重新生成后重跑本脚本
echo.
:end
echo.
pause
