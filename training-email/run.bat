@echo off
REM ============================================================
REM  Weekly FMCSA Training Email - Windows launcher
REM  Double-click this file to generate this week's email + slides.
REM  Nothing is emailed unless you edit the SEND line below.
REM ============================================================

cd /d "%~dp0"

REM --- First run only: install the PowerPoint library. Safe to leave in;
REM     pip skips it if it's already installed. ---
python -m pip install -r requirements.txt

REM --- Preview only (default): writes email + .pptx slides to output folder ---
python main.py

REM --- To ACTUALLY send to your staff list, put your Gmail App Password
REM     between the quotes below, delete the word REM at the start of the
REM     next two lines, and put REM in front of the "python main.py" line above.
REM set GMAIL_APP_PASSWORD=your16charpassword
REM python main.py --send

echo.
echo Done. Your files are in the "output" folder.
pause
