@echo off
title Geowill - Subir Proyecto a GitHub
echo =====================================================================
echo                GEOWILL - SUBIR PROYECTO A GITHUB
echo =====================================================================
echo.

cd /d "%~dp0"

echo [1/3] Configurando usuario y autor...
git config user.name "totonoc24"
git config user.email "totonoc24@hotmail.com"

echo [2/3] Preparando y confirmando cambios...
git add .
git commit -m "feat: actualizacion general con soporte AAB, mejoras en brujula de replanteo, lightbox de fotos y scripts de compilacion" 2>nul

echo [3/3] Subiendo cambios a GitHub (origin/main)...
echo (Si aparece la ventana de inicio de sesion de GitHub en tu navegador, por favor autorizala)
echo.
git push origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo =====================================================================
    echo            PROYECTO SUBIDO EXITOSAMENTE A GITHUB!
    echo =====================================================================
    echo Repositorio: https://github.com/totonoc24/Geowill
) else (
    echo.
    echo =====================================================================
    echo            HUBO UN PROBLEMA AL SUBIR LOS CAMBIOS
    echo =====================================================================
    echo Si GitHub te pide un token de acceso personal (PAT):
    echo 1. Ve a GitHub.com -^> Settings -^> Developer settings -^> Personal access tokens
    echo 2. Genera un token clasico con permiso 'repo' y usalo como contrasena.
)

echo.
pause

