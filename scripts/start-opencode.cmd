@echo off
rem Launch the local OpenCode server.
rem
rem This is invoked by the NexoraEntityOpenCode scheduled task, not run directly.
rem A server started from an interactive console receives CTRL_C_EVENT when that console
rem closes, which removes it mid-request and surfaces to users as provider discovery
rem failing. Running under Task Scheduler gives it a session with no console, so it
rem survives independently.

setlocal

set "ROOT=C:\Users\adede\nexora-entity"
set "BIN=%ROOT%\node_modules\opencode-ai\bin\opencode.exe"
set "PORT=4137"

if not exist "%BIN%" (
  echo OPENCODE BINARY MISSING at %BIN%. Run: npm run opencode:install 1>&2
  exit /b 1
)

cd /d "%ROOT%"
"%BIN%" serve --port %PORT% --hostname 127.0.0.1