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
      const icon = L.divIcon({
        className: 'custom-point-pin',
        html: `<div style="background-color: ${color}; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.6);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
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
      
      // Popup Content
      let metricsHtml = '';
      if (feature.type === 'LineString' && props.length) {
        metricsHtml = `<div><b>Longitud:</b> ${props.length > 1000 ? (props.length/1000).toFixed(3) + ' km' : props.length.toFixed(1) + ' m'}</div>`;
      } else if (feature.type === 'Polygon' && props.area) {
        metricsHtml = `<div><b>Área:</b> ${(props.area/10000).toFixed(2)} ha (${props.area.toFixed(1)} m²)</div>`;
      }

      let photoThumb = '';
      if (props.photos && props.photos.length > 0) {
        const firstPhoto = props.photos[0];
        const safeName = (props.name || 'Entidad').replace(/'/g, "\\'");
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

      const popupHtml = `
        <div class="popup-feature-card">
          <h4>${props.name || 'Entidad'}</h4>
          <div class="popup-feature-meta">${props.category || 'General'}</div>
          ${props.description ? `<p style="font-size:12px; margin-bottom:6px; color:#cbd5e1;">${props.description}</p>` : ''}
          ${metricsHtml}
          ${photoThumb}
          <div class="popup-actions-row" style="display: flex; flex-direction: column; gap: 5px; margin-top: 8px;">
            <button class="btn btn-sm" onclick="window.app.startNavigationToFeature('${feature.id}')" style="background: rgba(16,185,129,0.25); color: #10b981; border: 1px solid #10b981; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px;">
              <span>🎯</span> <span>Guiar / Navegar hacia este Punto</span>
            </button>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-primary flex-1" style="flex:1;" onclick="window.app.editFeature('${feature.id}')">Editar / Ficha</button>
              <button class="btn btn-sm btn-danger flex-1" style="flex:1;" onclick="window.app.deleteFeatureConfirm('${feature.id}')">Eliminar</button>
            </div>
          </div>
        </div>
      `;

      layer.bindPopup(popupHtml);
      this.featureLayerGroup.addLayer(layer);
    }
  }
}

// Global Singleton Instance
window.vectorEditor = new VectorEditor();
