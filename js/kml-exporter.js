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
  <Document id="Geowill_Project">
    <name><![CDATA[${docTitle}]]></name>
    <open>1</open>
    <description><![CDATA[Exportado desde Geowill Android GIS el ${dateDisplay} a las ${new Date().toLocaleTimeString()}]]></description>

    <!-- Schema Definition for ArcGIS Pro and QGIS Attribute Tables -->
    <Schema name="GeowillAttributes" id="GeowillAttributes">
      <SimpleField name="Nombre" type="string"><displayName>Nombre</displayName></SimpleField>
      <SimpleField name="Categoria" type="string"><displayName>Categoría</displayName></SimpleField>
      <SimpleField name="Descripcion" type="string"><displayName>Descripción</displayName></SimpleField>
      <SimpleField name="Longitud_m" type="double"><displayName>Longitud (m)</displayName></SimpleField>
      <SimpleField name="Area_m2" type="double"><displayName>Área (m²)</displayName></SimpleField>
      <SimpleField name="Area_ha" type="double"><displayName>Área (ha)</displayName></SimpleField>
      <SimpleField name="Perimetro_m" type="double"><displayName>Perímetro (m)</displayName></SimpleField>
      <SimpleField name="Latitud" type="double"><displayName>Latitud</displayName></SimpleField>
      <SimpleField name="Longitud" type="double"><displayName>Longitud</displayName></SimpleField>
      <SimpleField name="Fecha" type="string"><displayName>Fecha</displayName></SimpleField>
    </Schema>

    <!-- Global Styles -->
    <Style id="pointStyle">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
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
      kml += `    <Folder id="folder_puntos">\n      <name>Puntos de Interés / Vértices</name>\n      <open>1</open>\n`;
      points.forEach((f, i) => {
        kml += this._generatePlacemarkPoint(f, i);
      });
      kml += `    </Folder>\n`;
    }

    // Folder: Líneas
    if (lines.length > 0) {
      kml += `    <Folder id="folder_lineas">\n      <name>Líneas y Linderos</name>\n      <open>1</open>\n`;
      lines.forEach((f, i) => {
        kml += this._generatePlacemarkLine(f, i);
      });
      kml += `    </Folder>\n`;
    }

    // Folder: Polígonos
    if (polygons.length > 0) {
      kml += `    <Folder id="folder_poligonos">\n      <name>Polígonos y Áreas</name>\n      <open>1</open>\n`;
      polygons.forEach((f, i) => {
        kml += this._generatePlacemarkPolygon(f, i);
      });
      kml += `    </Folder>\n`;
    }

    // Georeferenced PDF Neatline polygon if available
    if (pdfPlan && pdfPlan.georef && pdfPlan.georef.cornersGeo) {
      kml += `    <Folder id="folder_plano_pdf">\n      <name>Límites Plano Georreferenciado</name>\n`;
      kml += this._generatePdfNeatlinePlacemark(pdfPlan);
      kml += `    </Folder>\n`;
    }

    kml += `  </Document>\n</kml>`;
    return kml;
  }

  /**
   * Helper to escape XML characters for KML validity
   */
  _escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Optimizes a photo DataURL to a compact thumbnail (~15-25KB) specifically for KML embed
   * to ensure 100% compatibility with ArcGIS Pro KML To Layer and Google Earth.
   */
  async _optimizePhotoForKml(photoDataUrl, maxDim = 480, quality = 0.58) {
    if (!photoDataUrl || typeof photoDataUrl !== 'string') return '';
    if (photoDataUrl.length < 35000) return photoDataUrl; // Already compact

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            }
          } else {
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          resolve(photoDataUrl);
        }
      };
      img.onerror = () => resolve(photoDataUrl);
      img.src = photoDataUrl;
    });
  }

  /**
   * Pre-processes features to optimize embedded photos for clean KML export
   */
  async prepareFeaturesForKml(features = []) {
    const optimized = [];
    for (const f of features) {
      const featCopy = { ...f, properties: { ...(f.properties || {}) } };
      if (featCopy.properties.photos && featCopy.properties.photos.length > 0) {
        const optPhotos = [];
        for (const p of featCopy.properties.photos) {
          const optP = await this._optimizePhotoForKml(p);
          optPhotos.push(optP);
        }
        featCopy.properties.photos = optPhotos;
      }
      optimized.push(featCopy);
    }
    return optimized;
  }

  _generatePlacemarkPoint(f, index = 0) {
    const props = f.properties || {};
    const [lat, lng] = f.coordinates;
    const colorKml = this.hexToKmlColor(props.color, 'ff');
    const descHtml = this._buildDescriptionHtml(props, [lat, lng], 'Punto');
    const safeId = `point_${f.id || index}`;

    return `      <Placemark id="${safeId}">
        <name><![CDATA[${props.name || 'Punto'}]]></name>
        <description><![CDATA[${descHtml}]]></description>
        <Style>
          <IconStyle>
            <color>${colorKml}</color>
            <scale>1.1</scale>
            <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
          </IconStyle>
        </Style>
        <ExtendedData>
          <Data name="Nombre"><value>${this._escapeXml(props.name || 'Punto')}</value></Data>
          <Data name="Categoria"><value>${this._escapeXml(props.category || 'General')}</value></Data>
          <Data name="Descripcion"><value>${this._escapeXml(props.description || '')}</value></Data>
          <Data name="Latitud"><value>${lat.toFixed(7)}</value></Data>
          <Data name="Longitud"><value>${lng.toFixed(7)}</value></Data>
          <Data name="Fotos"><value>${(props.photos || []).length}</value></Data>
          <Data name="Fecha"><value>${new Date(f.createdAt || Date.now()).toISOString()}</value></Data>
        </ExtendedData>
        <Point>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${lng.toFixed(7)},${lat.toFixed(7)},0</coordinates>
        </Point>
      </Placemark>\n`;
  }

  _generatePlacemarkLine(f, index = 0) {
    const props = f.properties || {};
    const coordsStr = f.coordinates.map(c => `${c[1].toFixed(7)},${c[0].toFixed(7)},0`).join(' ');
    const colorKml = this.hexToKmlColor(props.color, 'ff');
    const descHtml = this._buildDescriptionHtml(props, null, 'Línea');
    const safeId = `line_${f.id || index}`;

    return `      <Placemark id="${safeId}">
        <name><![CDATA[${props.name || 'Línea'}]]></name>
        <description><![CDATA[${descHtml}]]></description>
        <Style>
          <LineStyle>
            <color>${colorKml}</color>
            <width>3.5</width>
          </LineStyle>
        </Style>
        <ExtendedData>
          <Data name="Nombre"><value>${this._escapeXml(props.name || 'Línea')}</value></Data>
          <Data name="Categoria"><value>${this._escapeXml(props.category || 'General')}</value></Data>
          <Data name="Descripcion"><value>${this._escapeXml(props.description || '')}</value></Data>
          <Data name="Longitud_m"><value>${(props.length || 0).toFixed(2)}</value></Data>
          <Data name="Fotos"><value>${(props.photos || []).length}</value></Data>
          <Data name="Fecha"><value>${new Date(f.createdAt || Date.now()).toISOString()}</value></Data>
        </ExtendedData>
        <LineString>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coordsStr}</coordinates>
        </LineString>
      </Placemark>\n`;
  }

  _generatePlacemarkPolygon(f, index = 0) {
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
    const safeId = `poly_${f.id || index}`;

    return `      <Placemark id="${safeId}">
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
          <Data name="Nombre"><value>${this._escapeXml(props.name || 'Polígono')}</value></Data>
          <Data name="Categoria"><value>${this._escapeXml(props.category || 'General')}</value></Data>
          <Data name="Descripcion"><value>${this._escapeXml(props.description || '')}</value></Data>
          <Data name="Area_m2"><value>${(props.area || 0).toFixed(2)}</value></Data>
          <Data name="Area_ha"><value>${((props.area || 0) / 10000).toFixed(3)}</value></Data>
          <Data name="Perimetro_m"><value>${(props.perimeter || 0).toFixed(2)}</value></Data>
          <Data name="Fotos"><value>${(props.photos || []).length}</value></Data>
          <Data name="Fecha"><value>${new Date(f.createdAt || Date.now()).toISOString()}</value></Data>
        </ExtendedData>
        <Polygon>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
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

    return `      <Placemark id="pdf_neatline">
        <name><![CDATA[Huella Plano: ${pdfPlan.name || 'PDF'}]]></name>
        <Style>
          <LineStyle><color>ff38bdf8</color><width>2</width></LineStyle>
          <PolyStyle><color>2038bdf8</color></PolyStyle>
        </Style>
        <Polygon>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordsStr}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>\n`;
  }

  _buildDescriptionHtml(props, coords, typeStr) {
    let photosHtml = '';
    if (props.photos && props.photos.length > 0) {
      photosHtml = `
      <div style="margin-top:10px; padding-top:8px; border-top:1px solid #cbd5e1;">
        <div style="font-size:12px; font-weight:bold; color:#0f172a; margin-bottom:6px;">📸 Fotografías de Campo (${props.photos.length}):</div>
        <div style="display:flex; flex-direction:column; gap:8px;">`;
      props.photos.forEach((photoDataUrl, idx) => {
        photosHtml += `
          <div style="border-radius:6px; overflow:hidden; border:1px solid #94a3b8; background:#0f172a; margin-bottom:8px;">
            <img src="${photoDataUrl}" style="width:100%; max-width:100%; height:auto; max-height:280px; object-fit:contain; display:block; margin:0 auto;" alt="Foto ${idx + 1}" />
            <div style="font-size:11px; color:#475569; background:#f8fafc; padding:4px 8px; border-top:1px solid #e2e8f0;">
              <b>Foto #${idx + 1}</b> • Registro Topográfico Geowill
            </div>
          </div>`;
      });
      photosHtml += `</div></div>`;
    }

    let html = `<div style="font-family:sans-serif; min-width:240px; max-width:340px; padding:4px; color:#1e293b;">
      <h3 style="color:#0284c7; margin:0 0 6px 0; font-size:16px;">${props.name || typeStr}</h3>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:6px;">
        <tr><td style="color:#64748b; padding:2px 0; width:95px;"><b>Categoría:</b></td><td>${props.category || 'General'}</td></tr>
        ${coords ? `<tr><td style="color:#64748b; padding:2px 0;"><b>Coordenadas:</b></td><td>${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}</td></tr>` : ''}
        ${props.length ? `<tr><td style="color:#64748b; padding:2px 0;"><b>Longitud:</b></td><td>${props.length > 1000 ? (props.length/1000).toFixed(3) + ' km' : props.length.toFixed(1) + ' m'}</td></tr>` : ''}
        ${props.area ? `<tr><td style="color:#64748b; padding:2px 0;"><b>Área:</b></td><td>${(props.area/10000).toFixed(2)} ha (${props.area.toFixed(1)} m²)</td></tr>` : ''}
        ${props.photos && props.photos.length > 0 ? `<tr><td style="color:#64748b; padding:2px 0;"><b>Fotografías:</b></td><td>📸 ${props.photos.length} foto(s) incrustada(s)</td></tr>` : ''}
      </table>
      ${props.description ? `<p style="font-size:12px; margin:6px 0; background:#f1f5f9; padding:8px; border-radius:6px; color:#0f172a; border-left:3px solid #0284c7;">${props.description}</p>` : ''}
      ${photosHtml}
    </div>`;
    return html;
  }

  /**
   * Shares KML directly to WhatsApp, Bluetooth, Telegram, Drive via AndroidBridge or WebShare API
   */
  async shareViaNativeOrWebShare(projectName, features, pdfPlan = null) {
    const readyFeatures = await this.prepareFeaturesForKml(features);
    const kmlContent = this.generateKmlString(projectName, readyFeatures, pdfPlan);
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
  async downloadDirect(projectName, features, pdfPlan = null) {
    const readyFeatures = await this.prepareFeaturesForKml(features);
    const kmlContent = this.generateKmlString(projectName, readyFeatures, pdfPlan);
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
