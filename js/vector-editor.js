/**
 * GeoPlan Android GIS - Vector Geometry & Attribute Editor
 * Digitize Points, Lines, and Polygons with live Geodesic Area/Distance calculation,
 * camera photo attachment, and attribute forms.
 */

class VectorEditor {
  constructor() {
    this.map = null;
    this.currentMode = 'none'; // 'none', 'point', 'line', 'polygon'
    this.activeProjectId = null;
    
    // In-progress drawing state
    this.drawingPoints = [];
    this.tempLayer = null;
    this.tempMarkerGroup = null;
    
    // Feature LayerGroup on map
    this.featureLayerGroup = null;
    this.currentEditingFeature = null;

    // Callbacks
    this.onDrawingUpdate = null;
    this.onFeatureSelected = null;
  }

  init(map) {
    this.map = map;
    this.featureLayerGroup = L.layerGroup().addTo(this.map);
    this.tempMarkerGroup = L.layerGroup().addTo(this.map);

    // Bind Map click event for drawing
    this.map.on('click', (e) => this._handleMapClick(e));
  }

  setProjectId(projectId) {
    this.activeProjectId = projectId;
    this.loadProjectFeatures();
  }

  /* ==========================================================================
     Drawing Mode Controls
     ========================================================================== */
  setMode(mode) {
    this.cancelDrawing();
    this.currentMode = mode;

    if (this.onDrawingUpdate) {
      this.onDrawingUpdate({
        mode: this.currentMode,
        pointsCount: 0,
        metricText: ''
      });
    }

    if (mode !== 'none') {
      this.map.getContainer().style.cursor = 'crosshair';
    } else {
      this.map.getContainer().style.cursor = '';
    }
  }

  cancelDrawing() {
    this.currentMode = 'none';
    this.drawingPoints = [];
    if (this.tempLayer) {
      this.map.removeLayer(this.tempLayer);
      this.tempLayer = null;
    }
    if (this.tempMarkerGroup) {
      this.tempMarkerGroup.clearLayers();
    }
    if (this.map) {
      this.map.getContainer().style.cursor = '';
    }
    if (this.onDrawingUpdate) {
      this.onDrawingUpdate({ mode: 'none', pointsCount: 0, metricText: '' });
    }
  }

  undoLastPoint() {
    if (this.drawingPoints.length > 0) {
      this.drawingPoints.pop();
      this._refreshTempLayer();
    }
  }

  /* ==========================================================================
     Map Click Handler & Geometry Building
     ========================================================================== */
  _handleMapClick(e) {
    if (this.currentMode === 'none') return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    if (this.currentMode === 'point') {
      this._promptSavePoint({ lat, lng });
      this.setMode('none');
      return;
    }

    // Line or Polygon
    this.drawingPoints.push([lat, lng]);
    this._refreshTempLayer();
  }

  addPointAtCurrentGps() {
    if (!window.gpsTracker || !window.gpsTracker.currentPosition) {
      window.app?.showToast('No hay señal GPS disponible actualmente', 'warning');
      return;
    }

    const { lat, lng } = window.gpsTracker.currentPosition;
    if (this.currentMode === 'point' || this.currentMode === 'none') {
      this._promptSavePoint({ lat, lng });
      this.setMode('none');
    } else {
      // Adding GPS vertex to active line or polygon
      this.drawingPoints.push([lat, lng]);
      this._refreshTempLayer();
      window.app?.showToast('Vértice capturado con GPS', 'success');
    }
  }

  _refreshTempLayer() {
    if (this.tempLayer) {
      this.map.removeLayer(this.tempLayer);
      this.tempLayer = null;
    }
    this.tempMarkerGroup.clearLayers();

    if (this.drawingPoints.length === 0) {
      if (this.onDrawingUpdate) {
        this.onDrawingUpdate({ mode: this.currentMode, pointsCount: 0, metricText: '' });
      }
      return;
    }

    // Add small vertex handle markers
    this.drawingPoints.forEach((pt, idx) => {
      const marker = L.circleMarker(pt, {
        pane: 'markerPaneCustom',
        radius: 5,
        color: '#06b6d4',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 2
      }).addTo(this.tempMarkerGroup);
    });

    let metricText = '';

    if (this.currentMode === 'line') {
      if (this.drawingPoints.length >= 2) {
        this.tempLayer = L.polyline(this.drawingPoints, {
          pane: 'vectorPane',
          color: '#06b6d4',
          weight: 4,
          dashArray: '6, 6'
        }).addTo(this.map);

        const lengthMeters = this.calculatePolylineLength(this.drawingPoints);
        metricText = lengthMeters > 1000 
          ? `Longitud: ${(lengthMeters / 1000).toFixed(3)} km` 
          : `Longitud: ${lengthMeters.toFixed(1)} m`;
      } else {
        metricText = 'Toque el mapa para añadir vértices';
      }
    } else if (this.currentMode === 'polygon') {
      if (this.drawingPoints.length >= 3) {
        this.tempLayer = L.polygon(this.drawingPoints, {
          pane: 'vectorPane',
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.25,
          weight: 3,
          dashArray: '6, 6'
        }).addTo(this.map);

        const areaSqM = this.calculatePolygonArea(this.drawingPoints);
        const perimeterM = this.calculatePolylineLength([...this.drawingPoints, this.drawingPoints[0]]);
        const ha = areaSqM / 10000;

        metricText = ha >= 1 
          ? `Área: ${ha.toFixed(2)} ha (${perimeterM.toFixed(0)} m perím.)` 
          : `Área: ${areaSqM.toFixed(1)} m² (${perimeterM.toFixed(0)} m perím.)`;
      } else {
        metricText = `Vértices: ${this.drawingPoints.length}/3 mín.`;
      }
    }

    if (this.onDrawingUpdate) {
      this.onDrawingUpdate({
        mode: this.currentMode,
        pointsCount: this.drawingPoints.length,
        metricText
      });
    }
  }

  finishDrawing() {
    if (this.currentMode === 'line') {
      if (this.drawingPoints.length < 2) {
        window.app?.showToast('Una línea requiere al menos 2 vértices.', 'warning');
        return;
      }
      const coords = [...this.drawingPoints];
      const length = this.calculatePolylineLength(coords);
      this.cancelDrawing();
      this._promptSaveFeature('LineString', coords, { length });
    } else if (this.currentMode === 'polygon') {
      if (this.drawingPoints.length < 3) {
        window.app?.showToast('Un polígono requiere al menos 3 vértices.', 'warning');
        return;
      }
      const coords = [...this.drawingPoints];
      const area = this.calculatePolygonArea(coords);
      const perimeter = this.calculatePolylineLength([...coords, coords[0]]);
      this.cancelDrawing();
      this._promptSaveFeature('Polygon', coords, { area, perimeter });
    }
  }

  /* ==========================================================================
     Geodesic Calculations (Haversine & Spherical Excess)
     ========================================================================== */

  /**
   * Distance between 2 lat/lng points in meters (Haversine Formula)
   */
  getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Total length of a polyline in meters
   */
  calculatePolylineLength(latlngs) {
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      total += this.getDistance(
        latlngs[i][0], latlngs[i][1],
        latlngs[i + 1][0], latlngs[i + 1][1]
      );
    }
    return total;
  }

  /**
   * Geodesic area of a polygon in square meters
   */
  calculatePolygonArea(latlngs) {
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

  /* ==========================================================================
     Feature Attribute Form & Storage
     ========================================================================== */
  _promptSavePoint(coord) {
    this._promptSaveFeature('Point', [coord.lat, coord.lng], {});
  }

  _promptSaveFeature(type, coordinates, metrics = {}) {
    const defaultName = type === 'Point' 
      ? `Punto ${(Date.now() % 1000).toString().padStart(3, '0')}`
      : type === 'LineString' ? `Línea ${(Date.now() % 1000).toString().padStart(3, '0')}`
      : `Polígono ${(Date.now() % 1000).toString().padStart(3, '0')}`;

    const newFeature = {
      projectId: this.activeProjectId,
      type: type,
      coordinates: coordinates,
      properties: {
        name: defaultName,
        category: 'General',
        description: '',
        photos: [],
        color: type === 'Point' ? '#f43f5e' : type === 'LineString' ? '#06b6d4' : '#10b981',
        ...metrics
      }
    };

    window.app?.openFeatureModal(newFeature, true);
  }

  async loadProjectFeatures() {
    if (!this.featureLayerGroup || !this.activeProjectId) return;
    this.featureLayerGroup.clearLayers();

    const features = await window.db.getFeaturesByProject(this.activeProjectId);
    features.forEach(feat => this.renderFeatureOnMap(feat));
  }

  renderFeatureOnMap(feature) {
    let layer = null;
    const props = feature.properties || {};
    const color = props.color || '#3b82f6';

    if (feature.type === 'Point') {
      // Larger hit area (36x36) with visible pin (14x14) centered inside for easy mobile tapping
      const icon = L.divIcon({
        className: 'custom-point-pin',
        html: `<div style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                 <div style="background-color: ${color}; width: 16px; height: 16px; border: 2.5px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 0 3px ${color}44;"></div>
               </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      layer = L.marker(feature.coordinates, { pane: 'markerPaneCustom', icon });
    } else if (feature.type === 'LineString') {
      layer = L.polyline(feature.coordinates, {
        pane: 'vectorPane',
        color: color,
        weight: 4,
        opacity: 0.95
      });
    } else if (feature.type === 'Polygon') {
      layer = L.polygon(feature.coordinates, {
        pane: 'vectorPane',
        color: color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2.5
      });
    }

    if (layer) {
      layer.featureData = feature;

      // Click listener: if in Info Mode, open Google Earth info sheet directly
      layer.on('click', (e) => {
        if (window.app && window.app.isInfoMode) {
          L.DomEvent.stopPropagation(e);
          layer.closePopup();
          window.app.showFeatureInfo(feature.id);
        }
      });
      
      // Build Popup Content with rich feature information
      const popupHtml = this._buildFeaturePopupHtml(feature);

      layer.bindPopup(popupHtml, {
        maxWidth: 280,
        minWidth: 200,
        className: 'geowill-popup'
      });
      this.featureLayerGroup.addLayer(layer);
    }
  }

  /**
   * Builds rich HTML popup content for a feature, showing all available info
   * including coordinates, altitude, description, category, metrics, and photos.
   * Works for manually created features AND imported KML features.
   */
  _buildFeaturePopupHtml(feature) {
    const props = feature.properties || {};

    // 1. Resolve qualities / extendedData (from feature.properties, or fallback to Collar_Cordero pre-indexed cache)
    let qualities = props.extendedData && typeof props.extendedData === 'object' && Object.keys(props.extendedData).length > 0
      ? { ...props.extendedData }
      : {};

    if (Object.keys(qualities).length === 0 && window.findCollarCorderoQualities) {
      const cached = window.findCollarCorderoQualities(feature);
      if (cached && Object.keys(cached).length > 0) {
        qualities = { ...cached };
        props.extendedData = qualities;
        if (cached.Hole_numbe && (!props.name || props.name.startsWith('Elemento'))) {
          props.name = cached.Hole_numbe;
        }
      }
    }

    const displayName = props.name || qualities['Hole_numbe'] || qualities['Name'] || 'Entidad';
    const safeName = displayName.replace(/'/g, "\\'");

    // --- Type Icon & Label ---
    const typeIcon = feature.type === 'Point' ? '📍' : feature.type === 'LineString' ? '📏' : '⬡';
    const typeLabel = feature.type === 'Point' ? 'Punto' : feature.type === 'LineString' ? 'Línea' : 'Polígono';

    // --- Qualities Table (Cualidades del Punto) ---
    let qualitiesHtml = '';
    const qKeys = Object.keys(qualities);
    if (qKeys.length > 0) {
      const rows = qKeys.map(k => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
          <td style="color: #38bdf8; font-weight: 700; padding: 3px 5px; font-size: 11px; width: 45%; vertical-align: top; word-break: break-word;">${k}</td>
          <td style="color: #f8fafc; padding: 3px 5px; font-size: 11px; font-family: monospace; vertical-align: top; word-break: break-word;">${qualities[k] || '<span style="color:#64748b;">(vacío)</span>'}</td>
        </tr>
      `).join('');

      qualitiesHtml = `
        <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 6px; padding: 6px 8px; margin: 6px 0; max-height: 180px; overflow-y: auto;">
          <div style="font-size: 10px; color: #38bdf8; font-weight: 800; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 3px; letter-spacing: 0.5px;">
            <span>📋 CUALIDADES DEL PUNTO (${qKeys.length})</span>
            <span style="color: #fbbf24; font-size: 9px; cursor: pointer;" onclick="window.app.showFeatureInfo('${feature.id}')">Ficha ↗</span>
          </div>
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            ${rows}
          </table>
        </div>
      `;
    }

    // --- Coordinate Info (for Points) ---
    let coordsHtml = '';
    if (feature.type === 'Point' && Array.isArray(feature.coordinates)) {
      const lat = parseFloat(feature.coordinates[0]);
      const lng = parseFloat(feature.coordinates[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        coordsHtml = `
          <div style="background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 11px; font-family: 'Courier New', monospace;">
            <div style="color: #94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">Coordenadas WGS84</div>
            <div style="color: #e2e8f0;"><b>Lat:</b> ${lat.toFixed(7)}°</div>
            <div style="color: #e2e8f0;"><b>Lng:</b> ${lng.toFixed(7)}°</div>
            ${(props.altitude && props.altitude !== 0) ? `<div style="color: #fbbf24;"><b>Alt:</b> ${parseFloat(props.altitude).toFixed(1)} m</div>` : ''}
          </div>`;
      }
    }

    // --- Metrics (Lines & Polygons) ---
    let metricsHtml = '';
    if (feature.type === 'LineString' && props.length) {
      const lengthDisplay = props.length > 1000 
        ? (props.length / 1000).toFixed(3) + ' km' 
        : props.length.toFixed(1) + ' m';
      metricsHtml = `
        <div style="background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 11px;">
          <div style="color: #e2e8f0;">📏 <b>Longitud:</b> ${lengthDisplay}</div>
        </div>`;
    } else if (feature.type === 'Polygon' && props.area) {
      const ha = (props.area / 10000).toFixed(2);
      const sqm = props.area.toFixed(1);
      metricsHtml = `
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 6px; padding: 6px 8px; margin: 6px 0; font-size: 11px;">
          <div style="color: #e2e8f0;">📐 <b>Área:</b> ${ha} ha (${sqm} m²)</div>
          ${props.perimeter ? `<div style="color: #e2e8f0;">📏 <b>Perímetro:</b> ${props.perimeter.toFixed(1)} m</div>` : ''}
        </div>`;
    }

    // --- Description ---
    let descHtml = '';
    if (props.description && props.description.trim() && !props.description.includes('<table') && props.description !== props.name) {
      const descText = props.description.length > 200 
        ? props.description.substring(0, 200) + '...' 
        : props.description;
      descHtml = `<p style="font-size: 11px; margin: 6px 0; color: #cbd5e1; line-height: 1.4; border-left: 2px solid rgba(148, 163, 184, 0.3); padding-left: 8px;">${descText}</p>`;
    }

    // --- Photo Thumbnail ---
    let photoThumb = '';
    if (props.photos && props.photos.length > 0) {
      const firstPhoto = props.photos[0];
      const countBadge = props.photos.length > 1 
        ? `<span style="position: absolute; top: 6px; right: 6px; background: rgba(15, 23, 42, 0.85); color: #38bdf8; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.4);">📸 1 de ${props.photos.length}</span>` 
        : '';

      photoThumb = `
        <div style="margin-top: 8px; position: relative; cursor: pointer; border-radius: 8px; overflow: hidden; border: 1px solid rgba(56, 189, 248, 0.4); box-shadow: 0 4px 12px rgba(0,0,0,0.3);" onclick="window.app.openPhotoViewer('${firstPhoto}', '${safeName}')">
          <img src="${firstPhoto}" style="width: 100%; max-height: 120px; object-fit: cover; display: block;">
          ${countBadge}
          <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(15,23,42,0.9), transparent); padding: 6px 8px; display: flex; align-items: center; justify-content: center; gap: 4px; color: #38bdf8; font-size: 10px; font-weight: 700;">
            <span>🔍</span> <span>Toca para ver en Pantalla Completa</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="popup-feature-card" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span style="font-size: 16px;">${typeIcon}</span>
          <h4 style="margin: 0; font-size: 14px; font-weight: 700; color: #f1f5f9; flex: 1; word-break: break-word;">${displayName}</h4>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          <span style="background: ${props.color || '#3b82f6'}33; color: ${props.color || '#3b82f6'}; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: 1px solid ${props.color || '#3b82f6'}55;">${props.category || 'Collar_Cordero'}</span>
          <span style="color: #64748b; font-size: 10px;">${typeLabel}</span>
        </div>
        ${descHtml}
        ${qualitiesHtml}
        ${coordsHtml}
        ${metricsHtml}
        ${photoThumb}
        <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 8px;">
          <button class="btn btn-sm" onclick="window.app.showFeatureInfo('${feature.id}')" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #38bdf8; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; cursor: pointer;">
            <span>ℹ️</span> <span>Ver Información</span>
          </button>
          <button class="btn btn-sm" onclick="window.app.startNavigationToFeature('${feature.id}')" style="background: rgba(16,185,129,0.25); color: #10b981; border: 1px solid #10b981; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 6px; cursor: pointer;">
            <span>🎯</span> <span>Guiar / Navegar hacia este Punto</span>
          </button>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-primary flex-1" style="flex:1; border-radius: 6px; cursor: pointer;" onclick="window.app.editFeature('${feature.id}')">Editar / Ficha</button>
            <button class="btn btn-sm btn-danger flex-1" style="flex:1; border-radius: 6px; cursor: pointer;" onclick="window.app.deleteFeatureConfirm('${feature.id}')">Eliminar</button>
          </div>
        </div>
      </div>
    `;
  }
}

// Global Singleton Instance
window.vectorEditor = new VectorEditor();
