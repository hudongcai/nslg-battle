@echo off
title nslg-battle restart all services
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-all.ps1" %*
pause
