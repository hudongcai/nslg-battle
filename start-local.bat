@echo off
title nslg-battle startup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
pause
