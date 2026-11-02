@echo off
REM Captures Android TV logs while reproducing a problem with AppTV
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0capturar-log.ps1" %*
pause
