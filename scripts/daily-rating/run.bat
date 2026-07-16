@echo off
setlocal EnableExtensions
set NTFY_TOPIC=yay-agent
set DIR=%~dp0
set OUT=%DIR%out
if not exist "%OUT%" mkdir "%OUT%"
set LOG=%OUT%\cron.log
echo ==== %DATE% %TIME% ====>>"%LOG%"
"C:\Users\friend\AppData\Local\Programs\Python\Python311\python.exe" "%DIR%daily_rating_push.py" --symbols-file "%DIR%symbols.txt" --out-dir "%OUT%" %* >>"%LOG%" 2>&1
