/**
 * Geowill Android GIS - KML & KMZ Importer Engine
 * Parses standard OGC KML 2.2 / Google Earth files (Points, Lines, Polygons, MultiGeometries)
 * and imports them cleanly into the active Geowill project.
 */

class KmlImporter {
  constructor() {}

  /**
   * Reads a File object and parses its KML content
   * @param {File} file - KML file from input
   * @param {string} projectId - Target project ID
   * @returns {Promise<Object>} Result with parsed features array and stats
   */
  async parseKmlFile(file, projectId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const result = this.parseKmlString(text, projectId, file.name);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(new Error('Error al leer el archivo KML: ' + err.message));
      reader.readAsText(file);
    });
  }

  /**
   * Parses KML XML text string into Geowill features
   * @param {string} kmlText - Raw KML XML string
   * @param {string} projectId - Target project ID
   * @param {string} [sourceFileName] - Optional original file name
   * @returns {Object} { success, features, docName, stats: { points, lines, polygons, total } }
   */
  parseKmlString(kmlText, projectId, sourceFileName = '') {
    if (!kmlText || typeof kmlText !== 'string') {
      throw new Error('El archivo KML está vacío o no es válido.');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, 'text/xml');

    const parseError = xmlDoc.getElementsByTagName('parsererror');
    if (parseError && parseError.length > 0) {
      throw new Error('Formato XML no válido en el archivo KML: ' + parseError[0].textContent);
    }

    // Extract Document Name
    let docName = '';
    const docNode = xmlDoc.getElementsByTagName('Document')[0] || xmlDoc.getElementsByTagName('Folder')[0];
    if (docNode) {
      const nameNode = this._getChildByTagName(docNode, 'name');
      if (nameNode) docName = nameNode.textContent.trim();
    }
    if (!docName && sourceFileName) {
      docName = sourceFileName.replace(/\.kml$/i, '');
    }

    // Extract Styles Map (id -> { color, width, fillColor })
    const stylesMap = this._extractStyles(xmlDoc);

    // Extract all Placemarks
    const placemarks = xmlDoc.getElementsByTagName('Placemark');
    const features = [];

    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i];
      const parsedFeats = this._parsePlacemark(pm, projectId, stylesMap, i + 1);
      if (parsedFeats && parsedFeats.length > 0) {
        features.push(...parsedFeats);
      }
    }

    const pointsCount = features.filter(f => f.type === 'Point').length;
    const linesCount = features.filter(f => f.type === 'LineString').length;
    const polygonsCount = features.filter(f => f.type === 'Polygon').length;

    return {
      success: true,
      docName: docName || 'Levantamiento KML Importado',
      features: features,
      stats: {
        total: features.length,
        points: pointsCount,
        lines: linesCount,
        polygons: polygonsCount
      }
    };
  }

  /* ==========================================================================
     Placemark Parsing Helpers
     ========================================================================= */

  _parsePlacemark(pm, projectId, stylesMap, index) {
    const results = [];

    // Placemark Name
    const nameNode = this._getChildByTagName(pm, 'name');
    const name = nameNode ? nameNode.textContent.trim() : `Elemento ${index}`;

    // Placemark Description and Embedded Photos
    const descNode = this._getChildByTagName(pm, 'description');
    let description = descNode ? this._cleanHtmlDescription(descNode.textContent) : '';
    let photos = descNode ? this._extractPhotosFromDescription(descNode.textContent) : [];

    // Folder Category (if nested)
    let category = 'KML Importado';
    const parentFolder = pm.parentElement;
    if (parentFolder && parentFolder.tagName.toLowerCase() === 'folder') {
      const fName = this._getChildByTagName(parentFolder, 'name');
      if (fName && fName.textContent.trim()) {
        category = fName.textContent.trim();
      }
    }

    // Style Color
    let color = this._resolvePlacemarkColor(pm, stylesMap);

    // ExtendedData attributes (Google Earth style: Data, SimpleData, SchemaData)
    const rawDesc = descNode ? descNode.textContent : '';
    const extendedData = this._extractExtendedData(pm, rawDesc);

    // 1. Check for Point
    const pointNodes = pm.getElementsByTagName('Point');
    for (let p = 0; p < pointNodes.length; p++) {
      const coordsNode = this._getChildByTagName(pointNodes[p], 'coordinates');
      if (coordsNode) {
        const pt = this._parseSingleCoordinate(coordsNode.textContent);
        if (pt) {
          results.push({
            projectId: projectId,
            type: 'Point',
            coordinates: [pt.lat, pt.lng],
            properties: {
              name: name,
              category: category || 'Punto KML',
              description: description,
              altitude: pt.alt || 0,
              color: color || '#f43f5e',
              photos: photos,
              extendedData: extendedData
            }
          });
        }
      }
    }

    // 2. Check for LineString
    const lineNodes = pm.getElementsByTagName('LineString');
    for (let l = 0; l < lineNodes.length; l++) {
      const coordsNode = this._getChildByTagName(lineNodes[l], 'coordinates');
      if (coordsNode) {
        const coords = this._parseCoordinatesList(coordsNode.textContent);
        if (coords && coords.length >= 2) {
          const lengthMeters = this._calculatePolylineLength(coords);
          results.push({
            projectId: projectId,
            type: 'LineString',
            coordinates: coords,
            properties: {
              name: name,
              category: category || 'Línea KML',
              description: description,
              length: lengthMeters,
              color: color || '#06b6d4',
              photos: photos,
              extendedData: extendedData
            }
          });
        }
      }
    }

    // 3. Check for Polygon
    const polyNodes = pm.getElementsByTagName('Polygon');
    for (let g = 0; g < polyNodes.length; g++) {
      const outerRing = polyNodes[g].getElementsByTagName('outerBoundaryIs')[0];
      const coordsNode = outerRing 
        ? this._getChildByTagName(outerRing.getElementsByTagName('LinearRing')[0] || outerRing, 'coordinates')
        : this._getChildByTagName(polyNodes[g], 'coordinates');

      if (coordsNode) {
        const coords = this._parseCoordinatesList(coordsNode.textContent);
        if (coords && coords.length >= 3) {
          const areaSqMeters = this._calculatePolygonArea(coords);
          results.push({
            projectId: projectId,
            type: 'Polygon',
            coordinates: coords,
            properties: {
              name: name,
              category: category || 'Polígono KML',
              description: description,
              area: areaSqMeters,
              color: color || '#10b981',
              photos: photos,
              extendedData: extendedData
            }
          });
        }
      }
    }

    return results;
  }

  /* ==========================================================================
     Coordinate Parsing Helpers
     ========================================================================= */

  /**
   * Parses a single "lng,lat,alt" or "lng,lat" coordinate string
   */
  _parseSingleCoordinate(str) {
    if (!str) return null;
    const parts = str.trim().split(',');
    if (parts.length < 2) return null;

    const lng = parseFloat(parts[0].trim());
    const lat = parseFloat(parts[1].trim());
    const alt = parts.length >= 3 ? parseFloat(parts[2].trim()) : 0;

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }

    return { lat, lng, alt: isNaN(alt) ? 0 : alt };
  }

  /**
   * Parses a list of space or newline separated "lng,lat,alt" coordinates
   * Returns array of [lat, lng] pairs for Leaflet
   */
  _parseCoordinatesList(str) {
    if (!str) return [];
    const tuples = str.trim().split(/\s+/);
    const coords = [];

    for (let i = 0; i < tuples.length; i++) {
      const pt = this._parseSingleCoordinate(tuples[i]);
      if (pt) {
        coords.push([pt.lat, pt.lng]);
      }
    }

    return coords;
  }

  /* ==========================================================================
     Style and Color Resolvers
     ========================================================================= */

  _extractStyles(xmlDoc) {
    const styles = {};
    const styleNodes = xmlDoc.getElementsByTagName('Style');

    for (let i = 0; i < styleNodes.length; i++) {
      const s = styleNodes[i];
      const id = s.getAttribute('id');
      if (!id) continue;

      let hexColor = '';
      const lineStyle = s.getElementsByTagName('LineStyle')[0];
      const polyStyle = s.getElementsByTagName('PolyStyle')[0];
      const iconStyle = s.getElementsByTagName('IconStyle')[0];

      const colorNode = (lineStyle && lineStyle.getElementsByTagName('color')[0]) ||
                        (polyStyle && polyStyle.getElementsByTagName('color')[0]) ||
                        (iconStyle && iconStyle.getElementsByTagName('color')[0]);

      if (colorNode) {
        hexColor = this._kmlColorToHex(colorNode.textContent.trim());
      }

      styles[id] = { color: hexColor };
    }

    return styles;
  }

  _resolvePlacemarkColor(pm, stylesMap) {
    // 1. Inline Style
    const inlineStyle = pm.getElementsByTagName('Style')[0];
    if (inlineStyle) {
      const colorNode = inlineStyle.getElementsByTagName('color')[0];
      if (colorNode) return this._kmlColorToHex(colorNode.textContent.trim());
    }

    // 2. StyleUrl Reference (#styleId)
    const styleUrl = pm.getElementsByTagName('styleUrl')[0];
    if (styleUrl) {
      const url = styleUrl.textContent.trim().replace(/^#/, '');
      if (stylesMap[url] && stylesMap[url].color) {
        return stylesMap[url].color;
      }
    }

    return null;
  }

  /**
   * Converts KML color (AABBGGRR) to HTML HEX (#RRGGBB)
   */
  _kmlColorToHex(kmlColor) {
    if (!kmlColor || kmlColor.length < 6) return null;
    let clean = kmlColor.trim();
    if (clean.length === 8) {
      // Format: AABBGGRR -> RR=clean[6..7], GG=clean[4..5], BB=clean[2..3]
      const bb = clean.substring(2, 4);
      const gg = clean.substring(4, 6);
      const rr = clean.substring(6, 8);
      return `#${rr}${gg}${bb}`;
    } else if (clean.length === 6) {
      const bb = clean.substring(0, 2);
      const gg = clean.substring(2, 4);
      const rr = clean.substring(4, 6);
      return `#${rr}${gg}${bb}`;
    }
    return null;
  }

  /* ==========================================================================
     Geodesic Calculations
     ========================================================================= */

  _haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _calculatePolylineLength(latlngs) {
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      total += this._haversineDistance(
        latlngs[i][0], latlngs[i][1],
        latlngs[i + 1][0], latlngs[i + 1][1]
      );
    }
    return total;
  }

  _calculatePolygonArea(latlngs) {
    if (latlngs.length < 3) return 0;
    const R = 6378137.0;
    let total = 0;
    for (let i = 0; i < latlngs.length; i++) {
      const p1 = latlngs[i];
      const p2 = latlngs[(i + 1) % latlngs.length];

      const lon1 = (p1[1] * Math.PI) / 180;
      const lat1 = (p1[0] * Math.PI) / 180;
      const lon2 = (p2[1] * Math.PI) / 180;
      const lat2 = (p2[0] * Math.PI) / 180;

      total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs((total * R * R) / 2.0);
  }

  /**
   * Extracts all ExtendedData fields from a Placemark node.
   * Supports: <Data>, <SimpleData> within <SchemaData>, and plain <SimpleField>.
   * Also extracts key-value pairs from HTML tables inside <description> (ArcGIS / QGIS / Google Earth).
   * Returns an object with { fieldName: value } pairs, identical to Google Earth.
   */
  _extractExtendedData(pm, descRaw = '') {
    const data = {};
    if (!pm) return data;

    const getNodes = (parent, tag) => {
      if (!parent) return [];
      let nodes = parent.getElementsByTagName(tag);
      if (!nodes || nodes.length === 0) nodes = parent.getElementsByTagName('kml:' + tag);
      if ((!nodes || nodes.length === 0) && parent.getElementsByTagNameNS) {
        nodes = parent.getElementsByTagNameNS('*', tag);
      }
      return Array.from(nodes || []);
    };

    const extDataNodes = getNodes(pm, 'ExtendedData');
    if (extDataNodes.length > 0) {
      const extDataNode = extDataNodes[0];

      // Format 1: <Data name="key"><value>val</value></Data>
      const dataNodes = getNodes(extDataNode, 'Data');
      for (let i = 0; i < dataNodes.length; i++) {
        const key = dataNodes[i].getAttribute('name');
        if (!key) continue;
        const valNode = getNodes(dataNodes[i], 'value')[0];
        const displayNode = getNodes(dataNodes[i], 'displayName')[0];
        const displayKey = displayNode && displayNode.textContent.trim() ? displayNode.textContent.trim() : key;
        data[displayKey] = valNode ? valNode.textContent.trim() : '';
      }

      // Format 2: <SchemaData><SimpleData name="key">val</SimpleData></SchemaData>
      const simpleDataNodes = getNodes(extDataNode, 'SimpleData');
      for (let i = 0; i < simpleDataNodes.length; i++) {
        const key = simpleDataNodes[i].getAttribute('name');
        if (!key) continue;
        data[key] = simpleDataNodes[i].textContent.trim();
      }
    }

    // Format 3: If no ExtendedData found or table present in description, extract HTML <table> rows
    if (descRaw && descRaw.includes('<table')) {
      try {
        const temp = document.createElement('div');
        temp.innerHTML = descRaw;
        const rows = temp.getElementsByTagName('tr');
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].children;
          if (cells.length >= 2) {
            const k = cells[0].textContent.trim();
            const v = cells[1].textContent.trim();
            if (k && !data[k]) {
              data[k] = v;
            }
          }
        }
      } catch (e) {
        console.warn('Error parsing HTML table from description:', e);
      }
    }

    return data;
  }

  _extractPhotosFromDescription(desc) {
    if (!desc) return [];
    const photos = [];
    try {
      const temp = document.createElement('div');
      temp.innerHTML = desc;
      const imgs = temp.getElementsByTagName('img');
      for (let i = 0; i < imgs.length; i++) {
        const src = imgs[i].getAttribute('src');
        if (src && (src.startsWith('data:image/') || src.startsWith('http://') || src.startsWith('https://'))) {
          photos.push(src);
        }
      }
    } catch (e) {
      console.warn('Error extracting photos from KML description:', e);
    }
    return photos;
  }

  _cleanHtmlDescription(desc) {
    if (!desc) return '';
    const temp = document.createElement('div');
    temp.innerHTML = desc;
    return temp.textContent || temp.innerText || '';
  }

  _getChildByTagName(node, tag) {
    if (!node || !node.children) return null;
    const lower = tag.toLowerCase();
    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].tagName.toLowerCase() === lower) {
        return node.children[i];
      }
    }
    return null;
  }
}

// Global Singleton Instance
window.kmlImporter = new KmlImporter();
