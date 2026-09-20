@echo off
title Compilador APK - Geowill Android GIS
echo =====================================================================
echo           Geowill Android - Compilador Automatico de APK (v2.1.1)
echo =====================================================================
echo.
echo Compilando y firmando el archivo APK de Android (Geowill v2.1.1)...
echo.

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py build_apk.py
) else (
    python build_apk.py
)

echo.
echo Proceso finalizado. Puede enviar el archivo Geowill_Android_v2.1.1.apk por WhatsApp.
pause
