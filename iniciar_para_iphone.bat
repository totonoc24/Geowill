@echo off
title Geowill - Servidor para iPhone (iOS) y Computadora
echo =====================================================================
echo           Geowill GIS - Servidor para iPhone (iOS) y PC
echo =====================================================================
echo.

set PYTHON_EXE="C:\Users\WilliamACardenasGarc\AppData\Local\Programs\Python\Python312\python.exe"

if exist %PYTHON_EXE% (
    %PYTHON_EXE% servidor_iphone.py
) else (
    python servidor_iphone.py
)

pause
