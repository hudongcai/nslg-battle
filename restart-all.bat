@echo off
chcp 936 >nul
title nslg-battle restart all services
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding('gbk'); $OutputEncoding = [System.Text.Encoding]::GetEncoding('gbk'); & '%~dp0restart-all.ps1' %*"
pause
