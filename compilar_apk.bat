@echo off
title Compilador APK - Geowill Android GIS
echo =====================================================================
echo           Geowill Android - Compilador Automatico de APK (v2.0)
echo =====================================================================
echo.
echo Compilando y firmando el archivo APK de Android (Geowill v2.0)...
echo.

set PYTHON_EXE="C:\Users\Dell\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist %PYTHON_EXE% (
    %PYTHON_EXE% build_apk.py
) else if exist "C:\Users\Dell\AppData\Local\Programs\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" (
    "C:\Users\Dell\AppData\Local\Programs\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" build_apk.py
) else (
    python build_apk.py
)

echo.
echo Proceso finalizado. Puede enviar el archivo Geowill_Android_v2.0.apk por WhatsApp.
pause
