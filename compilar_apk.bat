@echo off
title Compilador APK - Geowill Android GIS
echo =====================================================================
echo           Geowill Android - Compilador Automatico de APK (v2.1.4)
echo =====================================================================
echo.
echo Compilando y firmando el archivo APK de Android (Geowill v2.1.4)...
echo.

set "PY_CMD="
where py >nul 2>nul && set "PY_CMD=py"
if "%PY_CMD%"=="" (
    where python >nul 2>nul && set "PY_CMD=python"
)
if "%PY_CMD%"=="" (
    if exist "C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" (
        set "PY_CMD="C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe""
    )
)

if not "%PY_CMD%"=="" (
    %PY_CMD% build_apk.py
) else (
    echo Error: No se encontro Python en el sistema.
)

echo.
echo Proceso finalizado. Puede enviar el archivo Geowill_Android_v2.1.4.apk por WhatsApp.
pause
