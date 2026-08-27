# 🍏 Guía de Instalación de Geowill en iPhone (iOS)

Geowill está optimizada para **iOS (iPhone y iPad)** como una **Progressive Web App (PWA) de alto rendimiento**. Al instalarla en tu iPhone, funcionará en **pantalla completa**, con su icono propio, acceso al **GPS de alta precisión**, **brújula magnética integrada de iOS**, **cámara de campo** y **exportación a WhatsApp vía el menú nativo de compartir**.

---

## 🚀 Método 1: Instalación Inmediata en tu iPhone (Recomendado)

> **No necesitas cables, ni computadora Mac, ni cuenta de desarrollador.**

### Paso 1: Iniciar el Servidor en tu Computadora
1. Asegúrate de que tu iPhone y tu computadora estén conectados a la **misma red Wi-Fi**.
2. En tu computadora, haz doble clic en el archivo:
   👉 **[`iniciar_para_iphone.bat`](file:///c:/Users/WilliamACardenasGarc/Documents/Antigravity/App/iniciar_para_iphone.bat)**
3. Se abrirá una ventana negra que mostrará la dirección IP de tu red local (por ejemplo: `http://10.20.15.67:8080`).

---

### Paso 2: Abrir en Safari e Instalar en el iPhone
1. Abre la aplicación **Safari** 🧭 en tu iPhone.
2. Escribe en la barra de direcciones la IP mostrada en la computadora (ej: `http://10.20.15.67:8080`).
3. Cuando cargue Geowill:
   - Toca el botón **Compartir** de Safari (el ícono del cuadrado con la flecha hacia arriba `⎋` en el centro inferior).
   - Desliza hacia abajo y toca la opción **`📲 Agregar a inicio`** (o *Add to Home Screen*).
   - Toca **`Agregar`** en la esquina superior derecha.
4. **¡Listo!** En la pantalla de inicio de tu iPhone aparecerá el ícono de **Geowill**. Ábrela y se iniciará en pantalla completa como cualquier app descargada de la App Store.

---

## 🌐 Método 2: Despliegue en la Nube (Acceso desde el campo sin PC)

Si deseas usar Geowill en tu iPhone en cualquier lugar del país (con datos móviles 4G/5G en el campo, sin necesidad de tener tu computadora encendida):

1. Sube la carpeta del proyecto a **GitHub**, **Vercel**, **Netlify** o **Cloudflare Pages** (todos son gratuitos).
2. Obtendrás un enlace con certificado SSL seguro (ej: `https://geowill.vercel.app`).
3. Abres ese enlace en **Safari en tu iPhone** y tocas **`Compartir > Agregar a inicio`**.
4. La aplicación guardará todos tus proyectos y mapas en la memoria interna de tu iPhone (**IndexedDB**) y funcionará incluso sin señal de internet en zonas rurales.

---

## 💻 Método 3: Compilar como App Nativa `.IPA` con Xcode (Para Mac)

Si dispones de una computadora Mac con Xcode y deseas generar el archivo `.ipa`:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init Geowill com.geowill.gis --web-dir .
npx cap add ios
npx cap open ios
```
En Xcode seleccionas tu equipo y conectas tu iPhone por cable para compilar e instalar directamente.
