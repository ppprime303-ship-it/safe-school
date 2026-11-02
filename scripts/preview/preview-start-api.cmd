@echo off
rem SAFE SCHOOL local preview with public API keys - use only after call approval
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preview-start.ps1" -WithApiKeys
pause
