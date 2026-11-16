@echo off
REM VECONI - homologacao Android isolada (Firebase Emulator + app local + USB)
REM Uso: clique duas vezes (inicia) ou: iniciar-homologacao.cmd start --reset ^| usb ^| offline ^| online ^| reset
cd /d "%~dp0\..\.."
if "%~1"=="" (node scripts\homolog\android-homolog.cjs start) else (node scripts\homolog\android-homolog.cjs %*)
pause
