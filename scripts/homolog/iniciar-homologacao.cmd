@echo off
REM VECONI - homologacao Android isolada (Firebase Emulator + app local + USB)
cd /d "%~dp0\..\.."
node scripts\homologndroid-homolog.cjs %*
pause
