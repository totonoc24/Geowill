@echo off
title GeoPlan Android - Servidor Local
echo =====================================================================
echo           GeoPlan Android - SIG y Planos PDF Georreferenciados
echo =====================================================================
echo.
echo Iniciando servidor local para acceso desde su computadora o celular...
echo.

set PYTHON_EXE="C:\Users\WilliamACardenasGarc\AppData\Local\Programs\Python\Python312\python.exe"

if exist %PYTHON_EXE% (
    echo Servidor activo en: http://localhost:8080
    echo.
    echo Para abrir en su celular Android en la misma red Wi-Fi:
    echo 1. Abra el navegador Chrome en su celular.
    echo 2. Ingrese la direccion IP de su PC seguida de :8080
    echo 3. Toque los 3 puntos de Chrome y seleccione 'Instalar aplicacion' o 'Agregar a pantalla principal'
    echo.
    %PYTHON_EXE% -m http.server 8080
) else (
    python -m http.server 8080
)

pause
