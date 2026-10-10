@echo off
title Compilador AAB (Google Play) - Geowill Android GIS
echo =====================================================================
echo    Geowill Android - Compilador Automatico de Bundle AAB (v2.2.2)
echo =====================================================================
echo.
echo Compilando y firmando el archivo AAB para Google Play Console...
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
    %PY_CMD% build_aab.py
) else (
    echo Error: No se encontro Python en el sistema.
)

echo.
echo Proceso finalizado. El archivo Geowill_Android_v2.2.2.aab esta listo para Google Play Console.
pause
