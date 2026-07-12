@echo off
cd /d %TEMP%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0close-local-helper.ps1"
