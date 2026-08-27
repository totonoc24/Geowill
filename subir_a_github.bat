@echo off
title Geowill - Subir Proyecto a GitHub
echo =====================================================================
echo                GEOWILL - SUBIR PROYECTO A GITHUB
echo =====================================================================
echo.
echo Este asistente subira tu codigo a tu cuenta de GitHub.
echo.

if not exist .git (
    echo [1/4] Inicializando repositorio Git local...
    git init
    git branch -M main
) else (
    echo [1/4] Repositorio Git local ya inicializado.
)

echo [2/4] Preparando archivos del proyecto...
git add .
git commit -m "Publicacion inicial de Geowill GIS para iOS y Android"

echo.
echo [3/4] Configuracion del repositorio remoto en GitHub:
echo Por favor ingresa el enlace HTTPS de tu nuevo repositorio en GitHub
echo (Ejemplo: https://github.com/tu-usuario/geowill.git)
echo.
set /p REPO_URL="Pega tu enlace de GitHub aqui: "

if "%REPO_URL%"=="" (
    echo.
    echo No ingresaste ningun enlace.
    echo Para subirlo manualmente ejecuta:
    echo   git remote add origin TU_URL_DE_GITHUB
    echo   git push -u origin main
    echo.
    pause
    exit /b
)

git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo.
echo [4/4] Subiendo archivos a GitHub...
git push -u origin main

echo.
echo =====================================================================
echo                  PROCESO COMPLETADO CON EXITO
echo =====================================================================
echo.
echo Ahora puedes activar GitHub Pages para usarlo en tu iPhone:
echo 1. Ve a tu repositorio en GitHub.com
echo 2. Entra en Settings -^> Pages
echo 3. En 'Source' selecciona 'Deploy from a branch' y elige la rama 'main' /root
echo 4. Guarda y en 1 minuto tendras tu enlace HTTPS para tu iPhone.
echo.
pause
