@echo off
rem GitHub 登录（只需一次）。先做 API 预检以定位失败原因，再写入凭据。
setlocal
set "TOOLS=%~dp0..\DSH-tools"
set "PATH=%TOOLS%\PortableGit\cmd;%TOOLS%\node-v24.21.0-win-x64;%TOOLS%\gh;%PATH%"
set "HT=%TEMP%\gh_headers.txt"
set "BD=%TEMP%\gh_body.txt"
set "TF=%TEMP%\gh_token.txt"
cd /d "%~dp0"
echo ============================================
echo   GitHub 登录（只需做一次）
echo ============================================
echo.
echo   重要：请用 classic token，不要用 fine-grained
echo.
echo   第 1 步  浏览器打开：
echo            https://github.com/settings/tokens/new
echo.
echo   第 2 步  按下表填写：
echo            Note 备注     : dsh-wiki
echo            Expiration    : 选 90 days 或 No expiration
echo            Select scopes : 勾选这三个
echo                            [x] repo
echo                            [x] read:org
echo                            [x] gist
echo.
echo   第 3 步  页面拉到底，点绿色按钮 Generate token
echo   第 4 步  复制 token，形如 ghp_xxxxxxxxxx
echo.
echo   注意：token 只显示一次，请先复制好。
echo.
echo   现在在下面按鼠标右键粘贴，然后回车：
echo.
set /p "TOK=" > "%TF%"
for /f "usebackq delims=" %%t in ("%TF%") do set "TOK=%%t"
if "%TOK%"=="" goto no_token
echo.
echo   [预检] 正在用该 token 访问 GitHub API ...
for /f %%c in ('curl -s -D "%HT%" -o "%BD%" -w "%%{http_code}" -H "Authorization: Bearer %TOK%" -H "User-Agent: dsh-wiki" https://api.github.com/user') do set "CODE=%%c"
echo   状态码: %CODE%
echo.
if "%CODE%"=="401" goto api_401
if "%CODE%"=="200" goto api_ok
echo [!] 意外的状态码 %CODE%。响应内容：
type "%BD%"
echo.
goto end
:api_ok
echo   预检通过。账号与权限：
findstr /i /c:"\"login\"" "%BD%"
findstr /i /c:"X-OAuth-Scopes" "%HT%"
echo.
echo   [写入] 正在保存凭据 ...
echo %TOK%> "%TF%"
gh auth login --hostname github.com --with-token < "%TF%" 2> "%TEMP%\gh_err.txt"
set "RC=%errorlevel%"
del "%TF%" >nul 2>nul
if exist "%TEMP%\gh_err.txt" for %%e in ("%TEMP%\gh_err.txt") do if %%~ze GTR 0 (
  echo   gh 报错：
  type "%TEMP%\gh_err.txt"
)
del "%TEMP%\gh_err.txt" >nul 2>nul
if not "%RC%"=="0" goto gh_failed
echo.
gh auth status
echo.
echo       登录成功。接下来双击 一键推送.bat。
goto end
:api_401
echo [!] GitHub 明确拒绝了该 token：401 Bad credentials
echo.
echo     这说明 token 本身无效，不是本脚本的问题。可能是：
echo.
echo     1^) 复制时漏了字符
echo        token 很长，请重新完整复制，注意前后不要有空格。
echo.
echo     2^) 生成后没有立即复制
echo        token 只显示一次，离开页面就看不到了。
echo        请重新生成一个新的。
echo.
echo     3^) 生成时页面选错了类型
echo        若页面顶部是 Fine-grained tokens，请点 Tokens (classic)，
echo        再点 Generate new token -^> Generate new token (classic)。
echo.
echo     4^) 该 token 已被删除或已过期
echo        打开 https://github.com/settings/tokens 检查它是否还在。
echo.
echo     建议：直接重新生成一个 classic token，勾 repo / read:org / gist 再试。
goto end
:gh_failed
echo [!] API 预检通过了，但 gh 写入凭据失败（退出码 %RC%）。
echo     请把上面的 gh 报错信息发给我。
goto end
:no_token
echo [!] 没读到输入内容。粘贴可能没成功（要先复制，再在窗口里点右键）。
goto end
:end
del "%HT%" "%BD%" "%TF%" >nul 2>nul
echo.
pause
