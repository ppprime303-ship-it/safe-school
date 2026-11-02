@echo off
rem SAFE SCHOOL external alert popup check - test DB only, no external calls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0alert-popup-demo.ps1"
pause
