@echo off
title Compilador APK - Geowill Android GIS
echo =====================================================================
echo           Geowill Android - Compilador Automatico de APK
echo =====================================================================
echo.
echo Compilando y firmando el archivo APK de Android (Geowill)...
echo.

set PYTHON_EXE="C:\Users\WilliamACardenasGarc\AppData\Local\Programs\Python\Python312\python.exe"

if exist %PYTHON_EXE% (
    %PYTHON_EXE% build_apk.py
) else (
    python build_apk.py
)

echo.
echo Proceso finalizado. Puede enviar el archivo Geowill_Android_v1.0.apk por WhatsApp.
pause
