@echo off
setlocal
title Secret Call V1.3 - Producao Local
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Node.js nao encontrado.
  pause
  exit /b 1
)

echo Instalando dependencias...
call npm install
call npm run install:all

echo Gerando frontend de producao...
call npm run build
if errorlevel 1 (
  echo Falha no build.
  pause
  exit /b 1
)

echo Iniciando Secret Call em modo producao...
set NODE_ENV=production
set PORT=3001
start "" "http://localhost:3001"
call npm start --prefix server
