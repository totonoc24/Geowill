/**
 * GeoPlan Android GIS - KML & KMZ Exporter
 * Generates standard OGC KML 2.2 files compatible with Google Earth, ArcGIS, QGIS, and AutoCAD.
 */

class KmlExporter {
  constructor() {}

  /**
   * Converts HEX color (#RRGGBB) to KML color format (AABBGGRR)
   */
  hexToKmlColor(hex, opacity = 'ff') {
    if (!hex) return opacity + 'ffffff';
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return opacity + b + g + r;
  }

  /**
   * Helper to format KML export names and titles with prefix "Trabajo:" and numeric day, month, year
   */
  getFormattedExportName(projectName) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateNumeric = `${day}_${month}_${year}`;
    const dateDisplay = `${day}/${month}/${year}`;

    const cleanProject = (projectName || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    
    // File name: Trabajo_26_08_2026.kml or Trabajo_Nombre_26_08_2026.kml
    const fileName = cleanProject 
      ? `Trabajo_${cleanProject}_${dateNumeric}.kml` 
      : `Trabajo_${dateNumeric}.kml`;

    // Document / Subject title: "Trabajo: [Nombre] - 26/08/2026"
    const docTitle = cleanProject 
      ? `Trabajo: ${cleanProject} - ${dateDisplay}` 
      : `Trabajo: ${dateDisplay}`;

    return { fileName, docTitle, dateNumeric, dateDisplay };
  }

  /**
   * Builds the KML 2.2 XML string from project features
   */
  generateKmlString(projectName, features = [], pdfPlan = null) {
    const timestamp = new Date().toISOString();
    const { docTitle, dateDisplay } = this.getFormattedExportName(projectName);

    const points = features.filter(f => f.type === 'Point');
    const lines = features.filter(f => f.type === 'LineString');
    const polygons = features.filter(f => f.type === 'Polygon');

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name><![CDATA[${docTitle}]]></name>
    <open>1</open>
    <description><![CDATA[Exportado desde Geowill Android GIS el ${dateDisplay} a las ${new Date().toLocaleTimeString()}]]></description>

    <!-- Global Styles -->
    <Style id="pointStyle">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
        </Icon>
        <color>ff147efb</color>
      </IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>

    <Style id="lineStyle">
      <LineStyle>
        <color>ffd4b606</color>
        <width>3.5</width>
      </LineStyle>
    </Style>

    <Style id="polygonStyle">
      <LineStyle>
        <color>ff81b910</color>
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>5081b910</color>
      </PolyStyle>
    </Style>
`;

    // Folder: Puntos
    if (points.length > 0) {
      kml += `    <Folder>\n      <name>Puntos de Interés / Vértices</name>\n      <open>1</open>\n`;
      points.forEach(f => {
        kml += this._generatePlacemarkPoint(f);
      });
      kml += `    </Folder>\n`;
    }

    // Folder: Líneas
    if (lines.length > 0) {
      kml += `    <Folder>\n      <name>Líneas y Linderos</name>\n      <open>1</open>\n`;
      lines.forEach(f => {
        kml += this._generatePlacemarkLine(f);
      });
      kml += `    </Folder>\n`;
    }

    // Folder: Polígonos
    if (polygons.length > 0) {
      kml += `    <Folder>\n      <name>Polígonos y Áreas</name>\n      <open>1</open>\n`;
      polygons.forEach(f => {
        kml += this._generatePlacemarkPolygon(f);
      });
      kml += `    </Folder>\n`;
    }

    // Georeferenced PDF Neatline polygon if available
    if (pdfPlan && pdfPlan.georef && pdfPlan.georef.cornersGeo) {
      kml += `    <Folder>\n      <name>Límites Plano Georreferenciado</name>\n`;
      kml += this._generatePdfNeatlinePlacemark(pdfPlan);
      kml += `    </Folder>\n`;
    }

    kml += `  </Document>\n</kml>`;
    return kml;
  }

  _generatePlacemarkPoint(f) {
    const props = f.properties || {};
    const [lat, lng] = f.coordinates;
    const colorKml = this.hexToKmlColor(props.color, 'ff');
    const descHtml = this._buildDescriptionHtml(props, [lat, lng], 'Punto');

    return `      <Placemark>
        <name><![CDATA[${props.name || 'Punto'}]]></name>
        <description><![CDATA[${descHtml}]]></description>
        <Style>
          <IconStyle>
            <color>${colorKml}</color>
            <scale>1.1</scale>
            <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
          </IconStyle>
        </Style>
        <ExtendedData>
          <Data name="Categoría"><value><![CDATA[${props.category || ''}]]></value></Data>
          <Data name="Latitud"><value>${lat.toFixed(7)}</value></Data>
          <Data name="Longitud"><value>${lng.toFixed(7)}</value></Data>
          <Data name="Fecha"><value>${new Date(f.createdAt || Date.now()).toISOString()}</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>${lng.toFixed(7)},${lat.toFixed(7)},0</coordinates>
        </Point>
      </Placemark>\n`;
  }

  _generatePlacemarkLine(f) {
    const props = f.properties || {};
    const coordsStr = f.coordinates.map(c => `${c[1].toFixed(7)},${c[0].toFixed(7)},0`).join(' ');
    const colorKml = this.hexToKmlColor(props.color, 'ff');
    const descHtml = this._buildDescriptionHtml(props, null, 'Línea');

    return `      <Placemark>
        <name><![CDATA[${props.name || 'Línea'}]]></name>
        <description><![CDATA[${descHtml}]]></description>
        <Style>
          <LineStyle>
            <color>${colorKml}</color>
            <width>3.5</width>
          </LineStyle>
        </Style>
        <ExtendedData>
          <Data name="Categoría"><value><![CDATA[${props.category || ''}]]></value></Data>
          <Data name="Longitud_m"><value>${(props.length || 0).toFixed(2)}</value></Data>
          <Data name="Fecha"><value>${new Date(f.createdAt || Date.now()).toISOString()}</value></Data>
        </ExtendedData>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordsStr}</coordinates>
        </LineString>
      </Placemark>\n`;
  }

  _generatePlacemarkPolygon(f) {
    const props = f.properties || {};
    // Ensure polygon loop is closed
    const ring = [...f.coordinates];
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push(ring[0]);
    }
    const coordsStr = ring.map(c => `${c[1].toFixed(7)},${c[0].toFixed(7)},0`).join(' ');
    const lineCol = this.hexToKmlColor(props.color, 'ff');
    const polyCol = this.hexToKmlColor(props.color, '4d'); // 30% alpha
    const descHtml = this._buildDescriptionHtml(props, null, 'Polígono');

    return `      <Placemark>
        <name><![CDATA[${props.name || 'Polígono'}]]></name>
        <description><![CDATA[${descHtml}]]></description>
        <Style>
          <LineStyle>
            <color>${lineCol}</color>
            <width>2.5</width>
          </LineStyle>
          <PolyStyle>
            <color>${polyCol}</color>
          </PolyStyle>
        </Style>
        <ExtendedData>
          <Data name="Categoría"><value><![CDATA[${props.category || ''}]]></value></Data>
          <Data name="Área_m2"><value>${(props.area || 0).toFixed(2)}</value></Data>
          <Data name="Área_ha"><value>${((props.area || 0) / 10000).toFixed(3)}</value></Data>
          <Data name="Perímetro_m"><value>${(props.perimeter || 0).toFixed(2)}</value></Data>
          <Data name="Fecha"><value>${new Date(f.createdAt || Date.now()).toISOString()}</value></Data>
        </ExtendedData>
        <Polygon>
          <tessellate>1</tessellate>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordsStr}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>\n`;
  }

  _generatePdfNeatlinePlacemark(pdfPlan) {
    const corners = pdfPlan.georef.cornersGeo;
    const ring = [corners[0], corners[1], corners[2], corners[3], corners[0]];
    const coordsStr = ring.map(c => `${c.lng.toFixed(7)},${c.lat.toFixed(7)},0`).join(' ');

    return `      <Placemark>
        <name><![CDATA[Huella Plano: ${pdfPlan.name || 'PDF'}]]></name>
        <Style>
          <LineStyle><color>ff38bdf8</color><width>2</width></LineStyle>
          <PolyStyle><color>2038bdf8</color></PolyStyle>
        </Style>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordsStr}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>\n`;
  }

  _buildDescriptionHtml(props, coords, typeStr) {
    let html = `<div style="font-family:sans-serif; min-width:240px; padding:4px;">
      <h3 style="color:#0284c7; margin:0 0 6px 0;">${props.name || typeStr}</h3>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px;">
        <tr><td style="color:#64748b; padding:3px 0;"><b>Categoría:</b></td><td>${props.category || 'General'}</td></tr>
        ${coords ? `<tr><td style="color:#64748b; padding:3px 0;"><b>Coordenadas:</b></td><td>${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}</td></tr>` : ''}
        ${props.length ? `<tr><td style="color:#64748b; padding:3px 0;"><b>Longitud:</b></td><td>${props.length > 1000 ? (props.length/1000).toFixed(3) + ' km' : props.length.toFixed(1) + ' m'}</td></tr>` : ''}
        ${props.area ? `<tr><td style="color:#64748b; padding:3px 0;"><b>Área:</b></td><td>${(props.area/10000).toFixed(2)} ha (${props.area.toFixed(1)} m²)</td></tr>` : ''}
      </table>
      ${props.description ? `<p style="font-size:12px; margin:6px 0; background:#f1f5f9; padding:6px; border-radius:4px;">${props.description}</p>` : ''}`;

    if (props.photos && props.photos.length > 0) {
      html += `<div style="margin-top:8px;"><b>Fotografías (${props.photos.length}):</b><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">`;
      props.photos.forEach(imgData => {
        html += `<img src="${imgData}" style="max-width:280px; max-height:200px; border-radius:4px; object-fit:cover; border:1px solid #cbd5e1;"/>`;
      });
      html += `</div></div>`;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Shares KML directly to WhatsApp, Bluetooth, Telegram, Drive via AndroidBridge or WebShare API
   */
  async shareViaNativeOrWebShare(projectName, features, pdfPlan = null) {
    const kmlContent = this.generateKmlString(projectName, features, pdfPlan);
    const { fileName, docTitle, dateDisplay } = this.getFormattedExportName(projectName);

    // 1. Prioritize Android Native Bridge (100% reliable for WhatsApp & Bluetooth on Android APK)
    if (window.AndroidNative && typeof window.AndroidNative.shareKml === 'function') {
      try {
        window.AndroidNative.shareKml(kmlContent, fileName);
        return { success: true, method: 'android_native', fileName };
      } catch (err) {
        console.warn('AndroidNative share error:', err);
      }
    }

    const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });

    // 2. Web Share API fallback (Browser / PWA)
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: blob.type })] })) {
      try {
        const file = new File([blob], fileName, { type: blob.type });
        await navigator.share({
          files: [file],
          title: docTitle,
          text: `${docTitle} - Exportado desde Geowill.`
        });
        return { success: true, method: 'share', fileName };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: true, method: 'aborted' };
        }
        console.warn('WebShare failed:', err);
      }
    }

    // 3. Direct Download fallback
    return this.downloadDirect(projectName, features, pdfPlan);
  }

  /**
   * Direct download of KML file to device storage
   */
  downloadDirect(projectName, features, pdfPlan = null) {
    const kmlContent = this.generateKmlString(projectName, features, pdfPlan);
    const { fileName, docTitle } = this.getFormattedExportName(projectName);
    const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { success: true, method: 'download', fileName };
  }

  async exportAndDownload(projectName, features, pdfPlan = null) {
    return this.shareViaNativeOrWebShare(projectName, features, pdfPlan);
  }
}

// Global Singleton Instance
window.kmlExporter = new KmlExporter();
