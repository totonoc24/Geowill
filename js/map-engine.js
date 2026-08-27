/**
 * GeoPlan Android GIS - Interactive Map Engine & Warped PDF Overlay
 * Integrates Leaflet, satellite/topo basemaps, custom affine warped canvas layer, and layer controls.
 */

// Custom Leaflet Layer for Affine Warped PDF Overlays
L.WarpedPdfLayer = L.Layer.extend({
  options: {
    opacity: 0.85,
    zIndex: 300
  },

  initialize: function (imageUrl, georefInfo, options) {
    this._imageUrl = imageUrl;
    this._georef = georefInfo;
    this._image = new Image();
    this._image.src = imageUrl;
    this._imageLoaded = false;
    this._image.onload = () => {
      this._imageLoaded = true;
      this._update();
    };
    L.setOptions(this, options);
  },

  onAdd: function (map) {
    this._map = map;

    if (!this._canvas) {
      this._initCanvas();
    }

    const pane = map.getPane('pdfPlanPane') || map.getPane('overlayPane');
    pane.appendChild(this._canvas);
    map.on('moveend zoomend viewreset resize', this._update, this);
    this._update();
  },

  onRemove: function (map) {
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    map.off('moveend zoomend viewreset resize', this._update, this);
  },

  _initCanvas: function () {
    this._canvas = L.DomUtil.create('canvas', 'leaflet-warped-pdf-layer');
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';
    this._canvas.style.zIndex = '300';
    this._canvas.style.opacity = this.options.opacity;
  },

  setOpacity: function (opacity) {
    this.options.opacity = opacity;
    if (this._canvas) {
      this._canvas.style.opacity = opacity;
    }
  },

  _update: function () {
    if (!this._map || !this._imageLoaded || !this._canvas) return;

    const bounds = this._map.getBounds();
    const size = this._map.getSize();
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);

    L.DomUtil.setPosition(this._canvas, topLeft);

    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._canvas.style.width = size.x + 'px';
    this._canvas.style.height = size.y + 'px';

    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);

    const corners = this._georef.cornersGeo;
    if (!corners || corners.length < 4) return;

    // Get layer screen points for corners
    const ptTL = this._map.latLngToLayerPoint([corners[0].lat, corners[0].lng])._subtract(topLeft);
    const ptTR = this._map.latLngToLayerPoint([corners[1].lat, corners[1].lng])._subtract(topLeft);
    const ptBL = this._map.latLngToLayerPoint([corners[3].lat, corners[3].lng])._subtract(topLeft);

    const w = this._image.width;
    const h = this._image.height;

    // Calculate affine mapping matrix from Image (0..w, 0..h) to Screen Points (ptTL, ptTR, ptBL)
    // ScreenX = a*u + b*v + c
    // ScreenY = d*u + e*v + f
    const a = (ptTR.x - ptTL.x) / w;
    const b = (ptBL.x - ptTL.x) / h;
    const c = ptTL.x;

    const d = (ptTR.y - ptTL.y) / w;
    const e = (ptBL.y - ptTL.y) / h;
    const f = ptTL.y;

    ctx.save();
    ctx.transform(a, d, b, e, c, f);
    ctx.drawImage(this._image, 0, 0, w, h);
    ctx.restore();
  }
});

L.warpedPdfLayer = function (imageUrl, georefInfo, options) {
  return new L.WarpedPdfLayer(imageUrl, georefInfo, options);
};

class MapEngine {
  constructor() {
    this.map = null;
    this.baseLayers = {};
    this.currentPdfLayer = null;
    this.pdfOpacity = 0.85;
  }

  init(containerId = 'map') {
    // Standard Bogotá / Colombia default coordinates, or User's location
    const defaultCenter = [4.6097, -74.0817];

    this.map = L.map(containerId, {
      center: defaultCenter,
      zoom: 15,
      zoomControl: true,
      attributionControl: true
    });

    // Create dedicated panes to guarantee Vectors are ALWAYS on top of PDF
    this.map.createPane('pdfPlanPane');
    this.map.getPane('pdfPlanPane').style.zIndex = 300; // Above tiles (200), below vectors

    this.map.createPane('vectorPane');
    this.map.getPane('vectorPane').style.zIndex = 500; // Above PDF

    this.map.createPane('markerPaneCustom');
    this.map.getPane('markerPaneCustom').style.zIndex = 650; // Above lines & polygons

    // Base Layer: Google Satellite Hybrid (Default)
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps'
    });

    // Base Layer: Google Satellite Clean
    const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps'
    });

    // Base Layer: Google Streets
    const googleStreets = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps'
    });

    // Base Layer: Google Terrain
    const googleTerrain = L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps'
    });

    // Base Layer: Esri Satellite HD
    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics'
    });

    // Base Layer: OpenStreetMap
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    });

    this.baseLayers = {
      google_hybrid: googleHybrid,
      google_sat: googleSat,
      google_streets: googleStreets,
      google_terrain: googleTerrain,
      esri_sat: esriSat,
      osm: osm
    };

    // Add Google Hybrid by default
    googleHybrid.addTo(this.map);

    // Add Scale bar
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(this.map);

    // Track coordinates on map movement
    this.map.on('mousemove touchmove', (e) => {
      this._updateCoordinatesHUD(e.latlng);
    });

    return this.map;
  }

  setBaseMap(type) {
    Object.values(this.baseLayers).forEach(layer => {
      if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    });

    if (this.baseLayers[type]) {
      this.baseLayers[type].addTo(this.map);
    }
  }

  setPdfOverlay(renderDataUrl, georefInfo) {
    if (this.currentPdfLayer) {
      this.map.removeLayer(this.currentPdfLayer);
      this.currentPdfLayer = null;
    }

    if (!renderDataUrl || !georefInfo) return;

    this.currentPdfLayer = L.warpedPdfLayer(renderDataUrl, georefInfo, {
      opacity: this.pdfOpacity
    }).addTo(this.map);

    // Zoom to PDF bounds
    if (georefInfo.bounds) {
      this.map.fitBounds(georefInfo.bounds, { padding: [40, 40], animate: true });
    }
  }

  setPdfOpacity(val) {
    this.pdfOpacity = val;
    if (this.currentPdfLayer) {
      this.currentPdfLayer.setOpacity(val);
    }
  }

  removePdfOverlay() {
    if (this.currentPdfLayer) {
      this.map.removeLayer(this.currentPdfLayer);
      this.currentPdfLayer = null;
    }
  }

  _updateCoordinatesHUD(latlng) {
    const latElem = document.getElementById('hud-lat');
    const lngElem = document.getElementById('hud-lng');
    if (latElem && lngElem && latlng) {
      latElem.textContent = latlng.lat.toFixed(6);
      lngElem.textContent = latlng.lng.toFixed(6);
    }
  }
}

// Global Singleton Instance
window.mapEngine = new MapEngine();
