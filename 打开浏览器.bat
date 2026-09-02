@echo off
cd /d "%~dp0"
start "概率世界本地预览" /D "%~dp0" "D:\node.js\node.exe" "%~dp0server.cjs"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4173/index.html"
