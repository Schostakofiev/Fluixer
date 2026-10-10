@echo off
cd /d "%~dp0"
python -m fluixer.webapp --port 8768
pause
