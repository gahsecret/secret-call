@echo off
setlocal EnableExtensions
title Parar Secret Call

echo Encerrando Secret Call...

call :killport 3001
call :killport 5173

echo.
echo Secret Call encerrado.
timeout /t 2 /nobreak >nul
exit /b 0

:killport
set "PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING" 2^>nul') do (
    taskkill /PID %%P /F >nul 2>nul
)
exit /b 0
