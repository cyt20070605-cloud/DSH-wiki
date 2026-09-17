@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem ============================================================================
rem  同步到 GitHub（改完设定后双击这个）
rem
rem  它会：本地重建验证 → git add → git commit → git push
rem  推送成功后，Netlify（若已关联仓库）会自动重建并发布。
rem
rem  首次使用前需先登录一次 GitHub：在「打开命令环境.bat」里执行 gh auth login
rem ============================================================================

set "REPO=%~dp0"
set "TOOLS=%REPO%..\DSH-tools"
set "PATH=%TOOLS%\PortableGit\cmd;%TOOLS%\node-v24.21.0-win-x64;%TOOLS%\gh;%PATH%"

cd /d "%REPO%"

echo ============================================
echo   同步世界观 Wiki 到 GitHub
echo ============================================
echo.

echo [1/4] 本地重建验证...
node build.mjs
if errorlevel 1 (
  echo.
  echo [!] 构建失败，已中止，不会提交。请先修好内容再试。
  echo.
  pause
  exit /b 1
)

echo.
echo [2/4] 暂存改动...
git add -A

echo [3/4] 检查是否有改动...
git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo [i] 内容没有变化，无需提交。
  echo.
  pause
  exit /b 0
)

for /f "tokens=1-4 delims=/-. " %%a in ("%date%") do set "TODAY=%%a-%%b-%%c"
echo       提交信息：更新：%TODAY%
git commit -m "更新：%TODAY%" >nul
if errorlevel 1 (
  echo.
  echo [!] 提交失败。若提示需要 user.name / user.email，请先设置：
  echo     git config --global user.name  "你的名字"
  echo     git config --global user.email "你的邮箱"
  echo.
  pause
  exit /b 1
)

echo.
echo [4/4] 推送到 GitHub...
git push
if errorlevel 1 (
  echo.
  echo [!] 推送失败。常见原因：
  echo     - 尚未登录：在「打开命令环境.bat」里执行 gh auth login
  echo     - 尚未建远程仓库：gh repo create DSH-wiki --private --source=. --push
  echo     - 网络不通
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   完成。若已在 Netlify 关联本仓库，
echo   约一分钟后线上站点会自动更新。
echo ============================================
echo.
pause
