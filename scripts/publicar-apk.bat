@echo off
REM Builds and publishes a new AppTV version on Google Drive
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar-apk.ps1" %*
pause
