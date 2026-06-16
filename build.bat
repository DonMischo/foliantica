@echo off
setlocal EnableDelayedExpansion

:: ─────────────────────────────────────────────────────────────────────────────
:: Foliantica — full local build  (Windows batch)
:: Run from the project root:  build.bat
::
:: Steps
::   1. Install Electron dependencies
::   2. Build Next.js standalone
::   3. Build FastAPI backend (PyInstaller)
::   4. Build Electron app LOCALLY (unpacked) — verify before packaging
::   5. Build Windows installer  (.exe)
:: ─────────────────────────────────────────────────────────────────────────────

:: Project root (folder where this script lives, no trailing backslash)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"


:: ═══════════════════════════════════════════════════════════════════════════
:: Locate (and install) Node.js
:: ═══════════════════════════════════════════════════════════════════════════
set "NODE="

where node >nul 2>&1
if not errorlevel 1 for /f "delims=" %%n in ('where node') do (set "NODE=%%n" & goto :node_found)

for %%p in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
    "%APPDATA%\npm\node.exe"
) do if exist %%p (set "NODE=%%~p" & goto :node_found)

for %%r in ("%APPDATA%\nvm" "%LOCALAPPDATA%\nvm") do (
    if exist "%%~r" (
        for /f "delims=" %%n in ('dir /b /s "%%~r\node.exe" 2^>nul ^| sort /r') do (
            set "NODE=%%n" & goto :node_found
        )
    )
)

echo Node.js not found. Attempting to install via winget...
where winget >nul 2>&1
if errorlevel 1 (
    echo [ERROR] winget not available. Please install Node.js 20+ from https://nodejs.org
    pause & exit /b 1
)
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo [ERROR] winget install failed. Please install Node.js 20+ from https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "PATH=%%b;%PATH%"
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "PATH=%%b;%PATH%"
for /f "delims=" %%n in ('where node 2^>nul') do (set "NODE=%%n" & goto :node_found)
echo [ERROR] Node.js installed but not found — please restart and try again.
pause & exit /b 1

:node_found
for %%d in ("%NODE%") do set "NODEDIR=%%~dpd"
:: Always prepend node dir so both node.exe and npm.cmd are reachable
echo %PATH% | findstr /i "%NODEDIR:~0,-1%" >nul 2>&1
if errorlevel 1 set "PATH=%NODEDIR%;%PATH%"

:: npm.cmd sometimes lives in a different directory (e.g. %APPDATA%\npm with nvm)
where npm >nul 2>&1
if errorlevel 1 (
    if exist "%NODEDIR%npm.cmd"       set "PATH=%NODEDIR%;%PATH%"
    if exist "%APPDATA%\npm\npm.cmd"  set "PATH=%APPDATA%\npm;%PATH%"
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found alongside node.exe at %NODEDIR%
        echo         Please reinstall Node.js from https://nodejs.org
        pause & exit /b 1
    )
)

for /f "delims=" %%v in ('"%NODE%" --version') do set "NODEVER=%%v"
echo Using Node.js %NODEVER% at %NODE%
echo.


:: ═══════════════════════════════════════════════════════════════════════════
:: Locate Python (and install via winget if missing)
:: ═══════════════════════════════════════════════════════════════════════════
set "PYTHON="

where python >nul 2>&1
if not errorlevel 1 for /f "delims=" %%p in ('where python') do (set "PYTHON=%%p" & goto :python_found)

for %%p in (
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%ProgramFiles%\Python311\python.exe"
    "%ProgramFiles%\Python312\python.exe"
) do if exist %%p (set "PYTHON=%%~p" & goto :python_found)

echo Python not found. Attempting to install via winget...
where winget >nul 2>&1
if errorlevel 1 (
    echo [ERROR] winget not available. Please install Python 3.11+ from https://python.org
    pause & exit /b 1
)
winget install --id Python.Python.3.11 --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo [ERROR] winget install failed. Please install Python 3.11+ from https://python.org
    pause & exit /b 1
)
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "PATH=%%b;%PATH%"
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "PATH=%%b;%PATH%"
for /f "delims=" %%p in ('where python 2^>nul') do (set "PYTHON=%%p" & goto :python_found)
echo [ERROR] Python installed but not found — please restart and try again.
pause & exit /b 1

:python_found
for /f "delims=" %%v in ('"%PYTHON%" --version') do set "PYVER=%%v"
echo Using %PYVER% at %PYTHON%
echo.


:: ═══════════════════════════════════════════════════════════════════════════
:: Step 1/5 — Electron dependencies
:: ═══════════════════════════════════════════════════════════════════════════
echo.
echo [1/5] Installing Electron dependencies...
cd /d "%ROOT%"
if exist "node_modules" rd /s /q "node_modules"
call npm install
if errorlevel 1 ( echo [ERROR] npm install failed & pause & exit /b 1 )
echo OK  Electron deps installed


:: ═══════════════════════════════════════════════════════════════════════════
:: Step 2/5 — Next.js standalone build
:: ═══════════════════════════════════════════════════════════════════════════
echo.
echo [2/5] Building Next.js (standalone)...
cd /d "%ROOT%\web"
if exist "node_modules" rd /s /q "node_modules"
call npm install
if errorlevel 1 ( echo [ERROR] web npm install failed & pause & exit /b 1 )
call npm run build
if errorlevel 1 ( echo [ERROR] Next.js build failed & pause & exit /b 1 )

:: Copy static assets into standalone output.
:: Next.js nests under "web\" when a parent node_modules exists; detect the layout.
if exist ".next\standalone\web" (
    robocopy ".next\static" ".next\standalone\web\.next\static" /E /NFL /NDL /NJH /NJS >nul
    if exist "public" robocopy "public" ".next\standalone\web\public" /E /NFL /NDL /NJH /NJS >nul
) else (
    robocopy ".next\static" ".next\standalone\.next\static" /E /NFL /NDL /NJH /NJS >nul
    if exist "public" robocopy "public" ".next\standalone\public" /E /NFL /NDL /NJH /NJS >nul
)

:: Stage into .next-standalone\ (flat, regardless of Next.js nesting layout)
cd /d "%ROOT%"
if exist ".next-standalone" rd /s /q ".next-standalone"
if exist "web\.next\standalone\web" (
    robocopy "web\.next\standalone\web" ".next-standalone" /E /NFL /NDL /NJH /NJS >nul
) else (
    robocopy "web\.next\standalone" ".next-standalone" /E /NFL /NDL /NJH /NJS >nul
)
copy /y "web\server-wrapper.js" ".next-standalone\server-wrapper.js" >nul
echo OK  Next.js standalone staged -^> .next-standalone\


:: ═══════════════════════════════════════════════════════════════════════════
:: Step 3/5 — FastAPI backend (PyInstaller via uv or pip)
:: ═══════════════════════════════════════════════════════════════════════════
echo.
echo [3/5] Building FastAPI backend with PyInstaller...
cd /d "%ROOT%\api"

:: Locate or install uv (preferred over plain pip)
set "UV_EXE="
where uv >nul 2>&1
if not errorlevel 1 for /f "delims=" %%u in ('where uv') do set "UV_EXE=%%u"
if not defined UV_EXE if exist "%USERPROFILE%\.local\bin\uv.exe" set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
if not defined UV_EXE if exist "%USERPROFILE%\.cargo\bin\uv.exe" set "UV_EXE=%USERPROFILE%\.cargo\bin\uv.exe"

if not defined UV_EXE (
    echo   uv not found — installing...
    powershell -NoProfile -Command "Invoke-RestMethod 'https://astral.sh/uv/install.ps1' | Invoke-Expression"
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
    where uv >nul 2>&1
    if not errorlevel 1 for /f "delims=" %%u in ('where uv') do set "UV_EXE=%%u"
)

if defined UV_EXE (
    echo   Using uv: %UV_EXE%
    call "%UV_EXE%" sync
    if errorlevel 1 ( echo [ERROR] uv sync failed & pause & exit /b 1 )
    call "%UV_EXE%" pip install pyinstaller
    if errorlevel 1 ( echo [ERROR] uv pip install pyinstaller failed & pause & exit /b 1 )
    call "%UV_EXE%" run pyinstaller foliantica.spec ^
        --distpath "%ROOT%\api-dist-tmp" ^
        --workpath "%ROOT%\.pyinstaller-work" ^
        --clean --noconfirm
    if errorlevel 1 ( echo [ERROR] PyInstaller failed & pause & exit /b 1 )
) else (
    echo   uv not available — falling back to pip
    call "%PYTHON%" -m pip install .
    if errorlevel 1 ( echo [ERROR] pip install failed & pause & exit /b 1 )
    call "%PYTHON%" -m pip install pyinstaller
    if errorlevel 1 ( echo [ERROR] pip install pyinstaller failed & pause & exit /b 1 )
    call "%PYTHON%" -m PyInstaller foliantica.spec ^
        --distpath "%ROOT%\api-dist-tmp" ^
        --workpath "%ROOT%\.pyinstaller-work" ^
        --clean --noconfirm
    if errorlevel 1 ( echo [ERROR] PyInstaller failed & pause & exit /b 1 )
)

:: Stage flat api-dist\
cd /d "%ROOT%"
if exist "api-dist" rd /s /q "api-dist"
move "api-dist-tmp\foliantica-api" "api-dist" >nul
rd /s /q "api-dist-tmp"
echo OK  API binary staged -^> api-dist\


:: ═══════════════════════════════════════════════════════════════════════════
:: Step 4/5 — Local (unpacked) Electron app
::   Builds an unpackaged copy you can run and test before creating the
::   installer.  Output goes to dist\win-unpacked\Foliantica.exe
:: ═══════════════════════════════════════════════════════════════════════════
echo.
echo [4/5] Building Electron app locally (unpacked, no installer)...
cd /d "%ROOT%"
call npx electron-builder --win --dir --publish never
if errorlevel 1 ( echo [ERROR] Local Electron build failed & pause & exit /b 1 )
echo OK  Local app built
echo.
echo   ^> dist\win-unpacked\Foliantica.exe
echo.
if defined CI (
    echo [CI] Skipping interactive test step.
    goto :build_installer
)
set /p _TEST="Test the app now, then press Enter to continue with installer — or type N to stop: "
if /i "%_TEST%"=="N" (
    echo.
    echo Stopped after local build. Installer was not created.
    echo Local app:  %ROOT%\dist\win-unpacked\Foliantica.exe
    echo.
    pause & exit /b 0
)
:build_installer


:: ═══════════════════════════════════════════════════════════════════════════
:: Step 5/5 — Windows installer (.exe via NSIS)
:: ═══════════════════════════════════════════════════════════════════════════
echo.
echo [5/5] Packaging Windows installer...
cd /d "%ROOT%"
call npm run dist:win -- --publish never
if errorlevel 1 ( echo [ERROR] electron-builder installer failed & pause & exit /b 1 )

echo.
echo ════════════════════════════════════════════════════════════════════
echo   Build complete!
echo.
echo   Local app  :  dist\win-unpacked\Foliantica.exe
echo   Installer  :  dist\*.exe   ^(NSIS^)
echo ════════════════════════════════════════════════════════════════════
echo.
pause
