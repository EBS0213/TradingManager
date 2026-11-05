@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 desktop\windows.py install
set RESULT=%ERRORLEVEL%
goto finish
:use_python
where python >nul 2>nul
if errorlevel 1 goto missing
python desktop\windows.py install
set RESULT=%ERRORLEVEL%
goto finish
:missing
echo Install Python 3.12 from https://www.python.org/downloads/windows/ and reopen this file.
set RESULT=1
:finish
if not "%RESULT%"=="0" echo Installation did not finish. See the error above; rerunning preserves existing keys and records.
pause
exit /b %RESULT%
