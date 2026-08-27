# GeoPlan Android - SIG & Georreferenciación de Planos PDF (APK / PWA)

Aplicación móvil especializada en topografía, catastro y trabajo de campo para Android. Permite cargar planos PDF, georreferenciarlos interactivamente con 3 puntos de control (GCPs - Transformación Afín 2D), rastrear la posición GPS en tiempo real sobre el plano, digitalizar puntos, líneas y polígonos, adjuntar fotos y descripciones a cada elemento, almacenar todo localmente sin conexión (Offline-First) y exportar el proyecto completo en formato **KML** compatible con Google Earth, ArcGIS y QGIS.

---

## 🚀 Cómo Iniciar la Aplicación

### Opción 1: Ejecutar en la Computadora
Haga doble clic en el archivo **`iniciar_app.bat`** o ejecute:
```powershell
python -m http.server 8080
```
Luego abra su navegador en: `http://localhost:8080`

### Opción 2: Instalar y Usar en su Celular Android (100% Sin Cables ni Android Studio)
1. Conecte su celular y su PC a la misma red Wi-Fi.
2. Ejecute `iniciar_app.bat`.
3. En su celular Android, abra **Google Chrome** e ingrese la IP de su computador (ej. `http://192.168.1.50:8080`).
4. Toque el menú de los tres puntos en Chrome y seleccione **"Instalar aplicación"** o **"Agregar a la pantalla principal"**.
5. ¡Listo! Se instalará como una App nativa con su icono en el menú de aplicaciones de Android y funcionará **sin conexión a internet (Offline)**.

### Opción 3: Generar archivo `.APK` directo con PWABuilder
1. Suba esta carpeta a su GitHub o servidor web (ej. Vercel / Netlify / GitHub Pages).
2. Ingrese a [https://www.pwabuilder.com](https://www.pwabuilder.com).
3. Pegue la URL de su app y haga clic en **Package for Android (APK)**.
4. Descargue el archivo `.apk` firmado y transfiéralo a su teléfono para instalarlo directamente.

---

## 🛠️ Guía de Uso de las Funcionalidades

### 1. 🗺️ Georreferenciación de Planos PDF con 3 Puntos (GCPs)
1. Toque el botón central inferior **"Plano PDF"**.
2. Seleccione su archivo PDF (plano topográfico, arquitectónico o de loteo).
3. Toque en el plano para ubicar el **Punto 1 (P1)**:
   - Ingrese sus coordenadas (Latitud / Longitud en WGS84 o DMS), o presione **"📍 Usar mi GPS"** si se encuentra físicamente sobre ese vértice en el terreno.
4. Repita el proceso para el **Punto 2 (P2)** y el **Punto 3 (P3)** (es recomendable elegir 3 esquinas o puntos opuestos formando un triángulo amplio).
5. Presione **"Aplicar al Mapa"**.
6. El plano se deformará, rotará y posicionará con exactitud matemática (Transformación Afín) sobre la imagen satelital con el Error Medio Cuadrático (RMS).
7. Puede ajustar la transparencia del plano con el control deslizante **"Opacidad Plano"**.

### 2. 📍 Posicionamiento GPS en Tiempo Real
- **Círculo Azul:** Muestra su posición actual con el margen de precisión en metros.
- **Flecha de Rumbo:** Indica la orientación física según la brújula y giroscopio del teléfono.
- **Botón Centrar (`◎`):** Mueve la vista a su ubicación actual.
- **Botón Seguir (`➤`):** Mantiene la pantalla centrada mientras camina por el terreno.
- **Botón Captura Rápida (`📍`):** Crea un punto instantáneo en las coordenadas exactas de su GPS.

### 3. ✍️ Digitalización de Entidades
- **Punto (`📍`):** Toque cualquier lugar del mapa o del plano PDF para crear un punto.
- **Línea (`📏`):** Toque sucesivamente para trazar linderos, vías o cercas. Muestra la distancia acumulada en tiempo real.
- **Polígono (`⬡`):** Toque los vértices para delimitar predios o parcelas. Muestra el área en metros cuadrados ($m^2$) y hectáreas ($ha$), así como el perímetro.

### 4. 📷 Ficha Técnica, Fotos y Descripciones
Al finalizar o tocar cualquier entidad en el mapa:
- Asigne un **Nombre** y **Categoría** (Vértice Topográfico, Lindero, Construcción, etc.).
- Escriba una **Descripción u observaciones de campo**.
- Toque **"Tomar Foto / Galería"** para capturar fotos con la cámara del celular.
- Las fotos se optimizan y comprimen automáticamente para no saturar la memoria del teléfono.

### 5. 💾 Exportación a KML para Google Earth y QGIS
1. Toque el botón inferior **"KML"**.
2. La aplicación generará un archivo `.kml` estándar OGC 2.2 con:
   - Capas organizadas por carpetas (*Puntos*, *Líneas*, *Polígonos*, *Huella del Plano*).
   - Estilos y colores personalizados.
   - Fichas técnicas completas con datos de área, longitud, fecha y **fotografías incrustadas**.
3. En Android, abrirá automáticamente la ventana para compartir por WhatsApp, Drive, Gmail o guardar en Descargas.
