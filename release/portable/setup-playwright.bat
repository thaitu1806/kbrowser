@echo off
chcp 65001 >nul
title Ken's Browser IM - Setup Playwright Browsers
echo.
echo ============================================
echo   Ken's Browser IM - Cai dat Playwright
echo ============================================
echo.

:: Kiem tra Node.js
echo [1/3] Kiem tra Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [LOI] Khong tim thay Node.js!
    echo.
    echo Ban can cai Node.js truoc:
    echo   1. Vao https://nodejs.org
    echo   2. Tai ban LTS (nut mau xanh)
    echo   3. Cai dat, next next finish
    echo   4. Chay lai file nay
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo    OK - Node.js %NODE_VER%

:: Kiem tra npm
echo.
echo [2/3] Kiem tra npm...
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay npm!
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo    OK - npm %NPM_VER%

:: Cai Playwright browsers
echo.
echo [3/3] Dang cai dat Playwright browsers (Chromium, Firefox, WebKit)...
echo    Phien ban: 1.59.1
echo    Qua trinh nay co the mat 5-10 phut tuy toc do mang...
echo.

npx playwright@1.59.1 install

if %errorlevel% neq 0 (
    echo.
    echo [LOI] Cai dat that bai!
    echo    Thu chay lai file nay.
    echo    Neu van loi, chay thu: npx playwright@1.59.1 install
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   HOAN TAT!
echo ============================================
echo.
echo Playwright browsers da duoc cai dat thanh cong.
echo Bay gio ban co the chay KenBrowserIM.exe
echo.
pause
