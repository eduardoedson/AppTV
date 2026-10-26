@echo off
REM Uploads AppTV.catalago.json to Google Drive keeping the same link
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0enviar-catalogo.ps1" %*
pause
