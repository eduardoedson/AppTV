@echo off
REM Starts the Android TV emulator without opening Android Studio
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0abrir-emulador.ps1" %*
if errorlevel 1 pause
timeout /t 5 >nul
