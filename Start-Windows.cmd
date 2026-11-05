@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
if not exist ".venv\Scripts\python.exe" goto missing
".venv\Scripts\python.exe" desktop\windows.py start
set RESULT=%ERRORLEVEL%
if not "%RESULT%"=="0" pause
exit /b %RESULT%
:missing
echo Run Install-Windows.cmd first.
pause
exit /b 1
