@echo off
rem Launch the built Nexora Entity platform, detached from any interactive console.
rem Next 16 `output: standalone` builds are served by the emitted server.js, not `next start`.
rem Because the app lives at packages\web inside an npm workspace, the emitted entrypoint sits
rem at .next\standalone\packages\web\server.js.
rem
rem The project root is derived from this script's own location. It used to be hard-coded to the
rem original developer's machine (C:\Users\adede\nexora-entity), which made this launcher fail
rem everywhere else, including CI and any deployment host.

setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "SERVER=%ROOT%\packages\web\.next\standalone\packages\web\server.js"
set "STANDALONE_ROOT=%ROOT%\packages\web\.next\standalone"
set "LOG=%ROOT%\.pg\logs\web-platform.log"

if not exist "%ROOT%\.pg\logs" mkdir "%ROOT%\.pg\logs" 2>nul

if not exist "%SERVER%" (
  echo NO STANDALONE BUILD at "%SERVER%". Run: npm run build 1>&2
  exit /b 1
)

set "NODE_ENV=production"
set "PORT=4311"
set "HOSTNAME=127.0.0.1"
set "NODE_PATH=%STANDALONE_ROOT%\node_modules;%ROOT%\node_modules"

cd /d "%STANDALONE_ROOT%\packages\web"
node server.js >> "%LOG%" 2>&1