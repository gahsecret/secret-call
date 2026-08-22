@echo off
setlocal EnableExtensions
title Secret Call V1.2.1

cd /d "%~dp0"

echo ==========================================
echo        SECRET CALL V1.2.1
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao foi encontrado.
    echo Instale o Node.js LTS e tente novamente.
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERRO] npm nao foi encontrado.
    echo Reinstale o Node.js LTS e marque a opcao PATH.
    echo.
    pause
    exit /b 1
)

echo [1/5] Verificando dependencias...

if not exist "node_modules" (
    call npm install
    if errorlevel 1 goto :error
)

if not exist "server\node_modules" (
    call npm install --prefix server
    if errorlevel 1 goto :error
)

if not exist "client\node_modules" (
    call npm install --prefix client
    if errorlevel 1 goto :error
)

echo [2/5] Encerrando instancias antigas do Secret Call...
call :killport 3001
call :killport 5173

timeout /t 2 /nobreak >nul

echo [3/5] Iniciando servidor...
start "Secret Call - Server" /min cmd /c "cd /d ""%~dp0server"" && npm run dev > ""%~dp0server.log"" 2>&1"

call :waitport 3001 20
if errorlevel 1 (
    echo.
    echo [ERRO] O servidor nao conseguiu iniciar na porta 3001.
    echo Abrindo o log...
    start notepad "%~dp0server.log"
    pause
    exit /b 1
)

echo [4/5] Iniciando interface...
start "Secret Call - Interface" /min cmd /c "cd /d ""%~dp0client"" && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort > ""%~dp0client.log"" 2>&1"

call :waitport 5173 20
if errorlevel 1 (
    echo.
    echo [ERRO] A interface nao conseguiu iniciar na porta 5173.
    echo Abrindo o log...
    start notepad "%~dp0client.log"
    pause
    exit /b 1
)

echo [5/5] Abrindo Secret Call...
start "" "http://localhost:5173"

echo.
echo ==========================================
echo       SECRET CALL ESTA RODANDO
echo ==========================================
echo.
echo Servidor:  http://localhost:3001
echo Interface: http://localhost:5173
echo.
echo Pode fechar esta janela.
timeout /t 4 /nobreak >nul
exit /b 0

:killport
set "PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING" 2^>nul') do (
    echo   Porta %PORT% ocupada pelo PID %%P - encerrando...
    taskkill /PID %%P /F >nul 2>nul
)
exit /b 0

:waitport
set "PORT=%~1"
set "MAX=%~2"
set /a COUNT=0

:waitloop
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 exit /b 0

set /a COUNT+=1
if %COUNT% GEQ %MAX% exit /b 1
timeout /t 1 /nobreak >nul
goto :waitloop

:error
echo.
echo [ERRO] Falha ao instalar as dependencias.
echo Veja a mensagem acima.
pause
exit /b 1
