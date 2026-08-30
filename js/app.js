/**
 * GeoPlan Android GIS - Main Application Controller
 * Manages UI interactions, 3-point calibration wizard, photo attachments, project workflows, and events.
 */

class GeoPlanApp {
  constructor() {
    this.currentProject = null;
    this.currentPdfPlan = null;
    
    // Georeferencing Calibration Wizard State
    this.calibrationState = {
      activeGcpIndex: 0, // 0, 1, 2
      gcps: [
        { pdfX: null, pdfY: null, lat: null, lng: null },
        { pdfX: null, pdfY: null, lat: null, lng: null },
        { pdfX: null, pdfY: null, lat: null, lng: null }
      ],
      pdfDimensions: { width: 0, height: 0, scale: 2.0 },
      isSelectingOnMap: false
    };

    // Temporary photos for feature form
    this.tempFeaturePhotos = [];
    this.editingFeatureId = null;

    // Coordinate Systems State
    this.currentHudCrs = 'wgs84'; // 'wgs84', 'epsg3116', 'epsg9377'
    this.selectedWizardCrs = 'wgs84'; // 'wgs84', 'epsg3116', 'epsg9377'
  }

  async init() {
    console.log('Initializing Geowill GIS App...');

    // 1. Initialize Map
    const map = window.mapEngine.init('map');
    window.vectorEditor.init(map);
    window.navStakeout.init(map);

    // 2. Initialize GPS tracker callbacks
    window.gpsTracker.onStatusChange = (status, text) => this._updateGpsStatusUI(status, text);
    window.gpsTracker.onPositionUpdate = (pos) => {
      this._updateGpsHudUI(pos);
      if (window.navStakeout && window.navStakeout.isActive) {
        window.navStakeout.updateUserPosition(pos);
      }
    };
    window.gpsTracker.onHeadingUpdate = (heading) => {
      if (window.navStakeout && window.navStakeout.isActive) {
        window.navStakeout.updateCompassHeading(heading);
      }
    };
    window.gpsTracker.start(map);

    // 3. Vector Editor drawing updates
    window.vectorEditor.onDrawingUpdate = (state) => this._updateDrawingToolbarUI(state);

    // 4. Load or create initial project
    await this._loadOrCreateDefaultProject();

    // 5. Setup UI Event Listeners
    this._bindEvents();

    // 6. Register Service Worker for offline PWA
    this._registerServiceWorker();

    this.showToast('Geowill iniciado correctamente', 'success');
  }

  /* ==========================================================================
     Project Management
     ========================================================================== */
  async _loadOrCreateDefaultProject() {
    const projects = await window.db.getAllProjects();
    if (projects.length > 0) {
      const lastActiveId = await window.db.getSetting('activeProjectId', projects[0].id);
      const activeProj = projects.find(p => p.id === lastActiveId) || projects[0];
      await this.setActiveProject(activeProj);
    } else {
      const defaultProj = await window.db.saveProject({
        name: 'Levantamiento Predial',
        description: 'Proyecto de campo y georreferenciación'
      });
      await this.setActiveProject(defaultProj);
    }
  }

  async setActiveProject(project) {
    this.currentProject = project;
    await window.db.setSetting('activeProjectId', project.id);
    
    // Update UI title
    const pill = document.getElementById('active-project-pill');
    if (pill) pill.textContent = project.name;

    // Load vector features for this project
    window.vectorEditor.setProjectId(project.id);

    // Load PDF plan if exists
    const plans = await window.db.getPdfPlansByProject(project.id);
    if (plans.length > 0) {
      this.currentPdfPlan = plans[0];
      this._applyPdfPlanToMap(this.currentPdfPlan);
    } else {
      this.currentPdfPlan = null;
      window.mapEngine.removePdfOverlay();
      document.getElementById('pdf-opacity-box')?.classList.add('hidden');
    }
  }

  _applyPdfPlanToMap(plan) {
    if (plan && plan.georef && plan.renderDataUrl) {
      window.mapEngine.setPdfOverlay(plan.renderDataUrl, plan.georef);
      document.getElementById('pdf-opacity-box')?.classList.remove('hidden');
      const slider = document.getElementById('pdf-opacity-slider');
      if (slider) slider.value = 85;
    }
  }

  /* ==========================================================================
     UI Event Listeners
     ========================================================================== */
  _bindEvents() {
    // Top Navigation buttons
    document.getElementById('btn-projects-menu')?.addEventListener('click', () => this.openProjectsModal());
    document.getElementById('btn-layers-menu')?.addEventListener('click', () => this.openLayersModal());
    
    // Side Map Controls
    document.getElementById('btn-gps-center')?.addEventListener('click', () => {
      const ok = window.gpsTracker.centerOnUser();
      if (!ok) this.showToast('Esperando señal GPS válida...', 'warning');
    });

    document.getElementById('btn-gps-follow')?.addEventListener('click', (e) => {
      const following = window.gpsTracker.toggleFollow();
      e.currentTarget.classList.toggle('active', following);
      this.showToast(following ? 'Modo seguimiento activado' : 'Seguimiento desactivado', 'info');
    });

    document.getElementById('btn-quick-gps-point')?.addEventListener('click', () => {
      window.vectorEditor.addPointAtCurrentGps();
    });

    // Tap on HUD Coordinates to cycle CRS (WGS84 -> EPSG:3116 -> EPSG:9377)
    document.getElementById('hud-crs-container')?.addEventListener('click', () => {
      if (this.currentHudCrs === 'wgs84') {
        this.currentHudCrs = 'epsg3116';
      } else if (this.currentHudCrs === 'epsg3116') {
        this.currentHudCrs = 'epsg9377';
      } else {
        this.currentHudCrs = 'wgs84';
      }
      this._updateGpsHudUI(window.gpsTracker.currentPosition || { lat: 4.6097, lng: -74.0817, altitude: 0, accuracy: 0 });
      const crsName = this.currentHudCrs === 'wgs84' ? 'WGS84 (Lat/Lon)' : this.currentHudCrs === 'epsg3116' ? 'EPSG:3116 (Magna Bogotá)' : 'EPSG:9377 (Origen Nacional)';
      this.showToast(`Coordenadas: ${crsName}`, 'info');
    });

    // Auto-sync background points when phone screen is unlocked or app is reopened
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && window.gpsTracker) {
        window.gpsTracker.syncBufferedNativePoints();
      }
    });
    window.addEventListener('focus', () => {
      if (window.gpsTracker) {
        window.gpsTracker.syncBufferedNativePoints();
      }
    });

    // GPS Route Recording (Tracklog) Controls
    document.getElementById('btn-toggle-track')?.addEventListener('click', () => this._toggleTrackRecording());
    document.getElementById('btn-stop-track-hud')?.addEventListener('click', () => this._toggleTrackRecording());
    document.getElementById('btn-pause-track-hud')?.addEventListener('click', () => this._toggleTrackPause());

    // Toggle Distance Filter (5m -> 10m -> 20m -> 3m -> 5m)
    document.getElementById('track-dist-filter-badge')?.addEventListener('click', () => {
      const current = window.gpsTracker.minDistanceFilter || 5;
      let next = 5;
      if (current === 5) next = 10;
      else if (current === 10) next = 20;
      else if (current === 20) next = 3;
      else if (current === 3) next = 5;
      else next = 5;

      window.gpsTracker.minDistanceFilter = next;
      if (window.AndroidNative && typeof window.AndroidNative.setMinDistanceFilter === 'function') {
        window.AndroidNative.setMinDistanceFilter(next);
      }
      const badge = document.getElementById('track-dist-filter-badge');
      if (badge) badge.textContent = `${next}m ⚙️`;
      this.showToast(`Filtro GPS: Guardando puntos cada ${next} metros mínimo`, 'info');
    });

    // Tracklog live stats callback
    window.gpsTracker.onTrackUpdate = (stats) => {
      if (stats.isRecording) {
        const mins = Math.floor(stats.durationSec / 60).toString().padStart(2, '0');
        const secs = (stats.durationSec % 60).toString().padStart(2, '0');
        
        const timeElem = document.getElementById('track-hud-time');
        const distElem = document.getElementById('track-hud-dist');
        const spdElem = document.getElementById('track-hud-speed');

        if (timeElem) timeElem.textContent = `${mins}:${secs}`;
        if (distElem) distElem.textContent = stats.distanceMeters > 1000 ? `${(stats.distanceMeters / 1000).toFixed(2)} km` : `${stats.distanceMeters.toFixed(0)} m`;
        if (spdElem) spdElem.textContent = stats.isPaused ? 'Pausa' : `${stats.currentSpeed} km/h`;
      }
    };

    // Opacity Slider
    document.getElementById('pdf-opacity-slider')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      window.mapEngine.setPdfOpacity(val);
    });

    // Bottom Action Dock
    document.getElementById('dock-btn-point')?.addEventListener('click', () => this._toggleDrawMode('point'));
    document.getElementById('dock-btn-line')?.addEventListener('click', () => this._toggleDrawMode('line'));
    document.getElementById('dock-btn-polygon')?.addEventListener('click', () => this._toggleDrawMode('polygon'));
    document.getElementById('dock-btn-georef')?.addEventListener('click', () => this.openPdfWizard());
    document.getElementById('dock-btn-export')?.addEventListener('click', () => this.exportKmlProject());

    // Drawing In-Progress Banner Actions
    document.getElementById('btn-drawing-finish')?.addEventListener('click', () => window.vectorEditor.finishDrawing());
    document.getElementById('btn-drawing-undo')?.addEventListener('click', () => window.vectorEditor.undoLastPoint());
    document.getElementById('btn-drawing-cancel')?.addEventListener('click', () => window.vectorEditor.cancelDrawing());

    // Feature Modal Actions
    document.getElementById('btn-save-feature')?.addEventListener('click', () => this._saveCurrentFeatureForm());
    document.getElementById('camera-direct-input')?.addEventListener('change', (e) => this._handlePhotoSelected(e));
    document.getElementById('gallery-direct-input')?.addEventListener('change', (e) => this._handlePhotoSelected(e));
    document.getElementById('feature-photo-input')?.addEventListener('change', (e) => this._handlePhotoSelected(e));

    // Instant Native/Web Camera Trigger
    document.getElementById('btn-trigger-camera')?.addEventListener('click', () => {
      if (window.AndroidNative && typeof window.AndroidNative.takeCameraPhoto === 'function') {
        window.AndroidNative.takeCameraPhoto();
      } else {
        const input = document.getElementById('camera-direct-input');
        if (input) input.click();
      }
    });

    // Live In-App Camera Viewfinder Events
    document.getElementById('btn-open-live-cam')?.addEventListener('click', () => this.openLiveCamera());
    document.getElementById('btn-close-live-camera')?.addEventListener('click', () => this.closeLiveCamera());
    document.getElementById('btn-shutter-snap')?.addEventListener('click', () => this.snapLivePhoto());
    document.getElementById('btn-flip-camera')?.addEventListener('click', () => this.flipLiveCamera());

    // Point Search & Stakeout Navigation Controls
    document.getElementById('btn-open-point-search')?.addEventListener('click', () => this.openPointSearchModal());
    document.getElementById('btn-side-point-search')?.addEventListener('click', () => this.openPointSearchModal());
    document.getElementById('btn-close-point-search')?.addEventListener('click', () => this.closePointSearchModal());
    document.getElementById('point-search-input')?.addEventListener('input', () => this.filterPointSearchList());
    document.getElementById('btn-stop-navigation')?.addEventListener('click', () => this.stopNavigation());

    // Search filter pills
    document.querySelectorAll('#modal-point-search .filter-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('#modal-point-search .filter-pill').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'rgba(255,255,255,0.05)';
          b.style.color = '#cbd5e1';
          b.style.borderColor = 'rgba(255,255,255,0.1)';
        });
        const target = e.currentTarget;
        target.classList.add('active');
        target.style.background = 'rgba(56,189,248,0.2)';
        target.style.color = '#38bdf8';
        target.style.borderColor = 'rgba(56,189,248,0.4)';
        this.currentSearchFilter = target.dataset.filter || 'all';
        this.filterPointSearchList();
      });
    });

    // KML Hub Modal Events (Import / Export / WhatsApp / Bluetooth)
    document.getElementById('tab-btn-kml-import')?.addEventListener('click', () => this.switchKmlHubTab('import'));
    document.getElementById('tab-btn-kml-export')?.addEventListener('click', () => this.switchKmlHubTab('export'));
    document.getElementById('kml-file-import-input')?.addEventListener('change', (e) => this._handleKmlFileSelected(e));
    document.getElementById('btn-confirm-kml-import')?.addEventListener('click', () => this._confirmKmlImport());
    document.getElementById('btn-share-kml-whatsapp')?.addEventListener('click', () => this.shareKmlWhatsApp());
    document.getElementById('btn-download-kml-direct')?.addEventListener('click', () => this.downloadKmlDirect());

    // PDF 3-Point Calibration Wizard Events
    this._bindGeorefWizardEvents();
  }

  /* ==========================================================================
     Live In-App Camera Methods
     ========================================================================== */
  async openLiveCamera() {
    const modal = document.getElementById('modal-live-camera');
    const video = document.getElementById('live-camera-feed');
    if (!modal || !video) return;

    modal.style.display = 'flex';
    modal.classList.add('active');

    try {
      this.currentCameraFacing = this.currentCameraFacing || 'environment';
      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach(t => t.stop());
      }

      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: this.currentCameraFacing },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      video.srcObject = this.cameraStream;
      await video.play();
    } catch (err) {
      console.warn('Error opening camera stream:', err);
      this.showToast('No se pudo acceder a la cámara en vivo. Use el botón "Cámara Instantánea".', 'warning');
      this.closeLiveCamera();
    }
  }

  closeLiveCamera() {
    const modal = document.getElementById('modal-live-camera');
    const video = document.getElementById('live-camera-feed');
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    }
    if (video) video.srcObject = null;
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  async flipLiveCamera() {
    this.currentCameraFacing = this.currentCameraFacing === 'environment' ? 'user' : 'environment';
    await this.openLiveCamera();
  }

  snapLivePhoto() {
    const video = document.getElementById('live-camera-feed');
    const canvas = document.getElementById('live-camera-snap-canvas');
    if (!video || !canvas || !video.videoWidth) {
      this.showToast('Cámara no lista para capturar', 'warning');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get compressed jpeg
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.82);
    this.tempFeaturePhotos.push(photoDataUrl);
    this._renderPhotoThumbnails();

    this.closeLiveCamera();
    this.showToast('📸 Fotografía de campo capturada con éxito', 'success');
  }

  /* ==========================================================================
     KML Export Dialog & Sharing (WhatsApp / Bluetooth / Download)
     ========================================================================== */
  openExportKmlModal() {
    if (!this.currentProject) {
      this.showToast('Seleccione un proyecto primero', 'warning');
      return;
    }
    document.getElementById('modal-export-kml')?.classList.add('active');
  }

  closeExportKmlModal() {
    document.getElementById('modal-export-kml')?.classList.remove('active');
  }

  async shareKmlWhatsApp() {
    this.closeExportKmlModal();
    this.showToast('Preparando archivo para compartir por WhatsApp / Bluetooth...', 'info');

    const features = await window.db.getFeaturesByProject(this.currentProject.id);
    if (features.length === 0 && !this.currentPdfPlan) {
      this.showToast('No hay entidades digitalizadas ni plano para exportar.', 'warning');
      return;
    }

    const res = await window.kmlExporter.shareViaNativeOrWebShare(
      this.currentProject.name,
      features,
      this.currentPdfPlan
    );

    if (res.success && res.method !== 'aborted') {
      this.showToast('Levantamiento KML listo para enviar', 'success');
    }
  }

  async downloadKmlDirect() {
    this.closeExportKmlModal();
    this.showToast('Descargando archivo KML...', 'info');

    const features = await window.db.getFeaturesByProject(this.currentProject.id);
    if (features.length === 0 && !this.currentPdfPlan) {
      this.showToast('No hay entidades digitalizadas ni plano para exportar.', 'warning');
      return;
    }

    const res = window.kmlExporter.downloadDirect(
      this.currentProject.name,
      features,
      this.currentPdfPlan
    );

    if (res.success) {
      this.showToast(`Archivo "${res.fileName}" descargado`, 'success');
    }
  }

  exportKmlProject() {
    this.openExportKmlModal();
  }

  _toggleDrawMode(mode) {
    if (window.vectorEditor.currentMode === mode) {
      window.vectorEditor.setMode('none');
      this._updateDockButtons('none');
    } else {
      window.vectorEditor.setMode(mode);
      this._updateDockButtons(mode);
    }
  }

  _toggleTrackRecording() {
    const isRecording = window.gpsTracker.isRecordingTrack;
    const btn = document.getElementById('btn-toggle-track');
    const hud = document.getElementById('track-hud-bar');
    const lbl = document.getElementById('lbl-track-btn');
    const pauseBtn = document.getElementById('btn-pause-track-hud');
    const pulse = document.getElementById('track-hud-pulse');
    const statusLbl = document.getElementById('track-hud-status-lbl');

    if (!isRecording) {
      // Start recording
      window.gpsTracker.startTrackRecording();
      if (hud) hud.style.display = 'flex';
      document.getElementById('hud-crs-container')?.classList.add('track-active');
      if (pauseBtn) {
        pauseBtn.innerHTML = '⏸️ Pausa';
        pauseBtn.style.background = '#f59e0b';
      }
      if (pulse) {
        pulse.style.background = '#f43f5e';
        pulse.style.boxShadow = '0 0 8px #f43f5e';
      }
      if (statusLbl) {
        statusLbl.textContent = 'GRABANDO:';
        statusLbl.style.color = '#f43f5e';
      }
      if (btn) {
        btn.style.background = '#f43f5e';
        btn.style.color = '#ffffff';
        btn.style.borderColor = '#ffffff';
      }
      if (lbl) lbl.textContent = 'STOP';
      this.showToast('🔴 Grabando ruta GPS. Camine por el terreno para registrar el trayecto.', 'info');
    } else {
      // Stop recording
      const result = window.gpsTracker.stopTrackRecording();
      if (hud) hud.style.display = 'none';
      document.getElementById('hud-crs-container')?.classList.remove('track-active');
      if (btn) {
        btn.style.background = 'rgba(244, 63, 94, 0.2)';
        btn.style.color = '#f43f5e';
        btn.style.borderColor = 'rgba(244, 63, 94, 0.5)';
      }
      if (lbl) lbl.textContent = 'REC';

      if (result.points.length >= 2) {
        const dateStr = new Date().toISOString().slice(0, 10);
        const timeStr = new Date().toTimeString().slice(0, 5).replace(':', 'h');
        const distKm = (result.distanceMeters / 1000).toFixed(2);
        const mins = Math.floor(result.durationSec / 60);
        const secs = result.durationSec % 60;

        const trackFeature = {
          projectId: this.currentProject.id,
          type: 'LineString',
          coordinates: result.coordinates, // Correct [lat, lng] format
          properties: {
            name: `Recorrido_${dateStr}_${timeStr}`,
            category: 'Tracklog / Recorrido GPS',
            length: result.distanceMeters,
            durationSec: result.durationSec,
            pointsCount: result.points.length,
            color: '#f43f5e',
            description: `Ruta registrada con GPS en campo.\n• Distancia total: ${distKm} km (${result.distanceMeters.toFixed(1)} m)\n• Tiempo transcurrido: ${mins} min ${secs} s\n• Puntos registrados: ${result.points.length}`
          }
        };

        // Immediately persist this trajectory to database so it is NEVER lost or deleted
        window.db.saveFeature(trackFeature).then(async (savedFeat) => {
          await window.vectorEditor.loadProjectFeatures();
          this.openFeatureModal(savedFeat, false);
          this.showToast(`Ruta guardada permanentemente: ${distKm} km (${result.points.length} puntos)`, 'success');
        }).catch(err => {
          console.error('Error auto-saving track:', err);
          this.openFeatureModal(trackFeature, true);
        });
      } else {
        this.showToast('Ruta cancelada: Se requieren al menos 2 puntos GPS registrados.', 'warning');
      }
    }
  }

  _toggleTrackPause() {
    if (!window.gpsTracker.isRecordingTrack) return;
    const isPaused = window.gpsTracker.isRecordingPaused;
    const pauseBtn = document.getElementById('btn-pause-track-hud');
    const pulse = document.getElementById('track-hud-pulse');
    const statusLbl = document.getElementById('track-hud-status-lbl');

    if (!isPaused) {
      window.gpsTracker.pauseTrackRecording();
      if (pauseBtn) {
        pauseBtn.innerHTML = '▶️ Seguir';
        pauseBtn.style.background = '#10b981';
      }
      if (pulse) {
        pulse.style.background = '#f59e0b';
        pulse.style.boxShadow = '0 0 8px #f59e0b';
      }
      if (statusLbl) {
        statusLbl.textContent = 'PAUSADO:';
        statusLbl.style.color = '#f59e0b';
      }
      this.showToast('⏸️ Grabación de ruta en pausa.', 'warning');
    } else {
      window.gpsTracker.resumeTrackRecording();
      if (pauseBtn) {
        pauseBtn.innerHTML = '⏸️ Pausa';
        pauseBtn.style.background = '#f59e0b';
      }
      if (pulse) {
        pulse.style.background = '#f43f5e';
        pulse.style.boxShadow = '0 0 8px #f43f5e';
      }
      if (statusLbl) {
        statusLbl.textContent = 'GRABANDO:';
        statusLbl.style.color = '#f43f5e';
      }
      this.showToast('▶️ Grabación de ruta reanudada.', 'info');
    }
  }

  _updateDockButtons(activeMode) {
    document.querySelectorAll('.dock-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === activeMode);
    });
  }

  /* ==========================================================================
     GPS HUD & Status UI
     ========================================================================== */
  _updateGpsStatusUI(status, text) {
    const dot = document.getElementById('gps-status-dot');
    const label = document.getElementById('gps-status-text');
    if (dot) {
      dot.className = 'status-dot ' + (status === 'active' ? 'active' : status === 'searching' ? 'searching' : 'error');
    }
    if (label) label.textContent = text;
  }

  _updateGpsHudUI(pos) {
    if (!pos) return;
    const badge = document.getElementById('hud-crs-badge');
    const lbl1 = document.getElementById('hud-label-c1');
    const lbl2 = document.getElementById('hud-label-c2');
    const latElem = document.getElementById('hud-lat');
    const lngElem = document.getElementById('hud-lng');
    const altElem = document.getElementById('hud-alt');
    const accElem = document.getElementById('hud-acc');

    if (this.currentHudCrs === 'epsg3116') {
      if (badge) badge.textContent = 'EPSG:3116 (Bogotá)';
      if (lbl1) lbl1.textContent = 'N:';
      if (lbl2) lbl2.textContent = 'E:';
      const pt = window.georefEngine.wgs84ToEpsg3116(pos.lat, pos.lng);
      if (latElem) latElem.textContent = `${pt.norte.toFixed(1)} m`;
      if (lngElem) lngElem.textContent = `${pt.este.toFixed(1)} m`;
    } else if (this.currentHudCrs === 'epsg9377') {
      if (badge) badge.textContent = 'EPSG:9377 (Nacional)';
      if (lbl1) lbl1.textContent = 'N:';
      if (lbl2) lbl2.textContent = 'E:';
      const pt = window.georefEngine.wgs84ToEpsg9377(pos.lat, pos.lng);
      if (latElem) latElem.textContent = `${pt.norte.toFixed(1)} m`;
      if (lngElem) lngElem.textContent = `${pt.este.toFixed(1)} m`;
    } else {
      if (badge) badge.textContent = 'WGS84';
      if (lbl1) lbl1.textContent = 'Lat:';
      if (lbl2) lbl2.textContent = 'Lon:';
      if (latElem) latElem.textContent = pos.lat.toFixed(6);
      if (lngElem) lngElem.textContent = pos.lng.toFixed(6);
    }

    if (altElem) altElem.textContent = `${(pos.altitude || 0).toFixed(0)} m`;
    if (accElem) accElem.textContent = `±${(pos.accuracy || 0).toFixed(1)} m`;
  }

  _updateDrawingToolbarUI(state) {
    const banner = document.getElementById('drawing-banner');
    if (!banner) return;

    if (state.mode === 'none') {
      banner.style.display = 'none';
      this._updateDockButtons('none');
    } else {
      banner.style.display = 'flex';
      const label = document.getElementById('drawing-mode-name');
      const metric = document.getElementById('drawing-live-metric');

      if (label) {
        label.textContent = state.mode === 'point' ? 'MODO PUNTO' : state.mode === 'line' ? 'MODO LÍNEA' : 'MODO POLÍGONO';
      }
      if (metric) {
        metric.textContent = state.metricText || 'Toque en el mapa para marcar vértices';
      }
    }
  }

  /* ==========================================================================
     Feature Attribute Modal & Photo Management
     ========================================================================== */
  openFeatureModal(feature, isNew = false) {
    this.editingFeatureId = isNew ? null : feature.id;
    this.currentFeatureDraft = feature;
    this.tempFeaturePhotos = [...(feature.properties?.photos || [])];

    document.getElementById('modal-feature-title').textContent = isNew ? 'Nueva Entidad' : 'Editar Entidad';
    document.getElementById('feature-name-input').value = feature.properties?.name || '';
    document.getElementById('feature-category-input').value = feature.properties?.category || 'General';
    document.getElementById('feature-desc-input').value = feature.properties?.description || '';
    document.getElementById('feature-color-input').value = feature.properties?.color || '#06b6d4';

    // Metrics display
    const metaBox = document.getElementById('feature-metrics-info');
    if (metaBox) {
      if (feature.type === 'LineString' && feature.properties?.length) {
        metaBox.innerHTML = `<b>Longitud:</b> ${feature.properties.length > 1000 ? (feature.properties.length/1000).toFixed(3) + ' km' : feature.properties.length.toFixed(1) + ' m'}`;
        metaBox.style.display = 'block';
      } else if (feature.type === 'Polygon' && feature.properties?.area) {
        metaBox.innerHTML = `<b>Área:</b> ${(feature.properties.area/10000).toFixed(2)} ha (${feature.properties.area.toFixed(1)} m²) | <b>Perímetro:</b> ${feature.properties.perimeter.toFixed(1)} m`;
        metaBox.style.display = 'block';
      } else {
        metaBox.style.display = 'none';
      }
    }

    this._renderPhotoThumbnails();
    document.getElementById('modal-feature-backdrop').classList.add('active');
  }

  closeFeatureModal() {
    document.getElementById('modal-feature-backdrop').classList.remove('active');
    this.currentFeatureDraft = null;
    this.editingFeatureId = null;
    this.tempFeaturePhotos = [];
  }

  _renderPhotoThumbnails() {
    const gallery = document.getElementById('photo-gallery-list');
    const badge = document.getElementById('photo-count-badge');
    if (badge) {
      badge.textContent = `${this.tempFeaturePhotos.length} ${this.tempFeaturePhotos.length === 1 ? 'foto' : 'fotos'}`;
    }
    if (!gallery) return;
    gallery.innerHTML = '';

    this.tempFeaturePhotos.forEach((imgSrc, idx) => {
      const box = document.createElement('div');
      box.className = 'photo-thumb-box';
      box.style.cursor = 'pointer';
      box.innerHTML = `
        <img src="${imgSrc}" title="Toca para ver en pantalla completa" onclick="window.app.openPhotoViewer('${imgSrc}', 'Foto de Campo #${idx + 1}')" />
        <button class="photo-delete-btn" onclick="event.stopPropagation(); window.app.removePhoto(${idx})">✕</button>
      `;
      gallery.appendChild(box);
    });
  }

  /* ==========================================================================
     Fullscreen Photo Lightbox Viewer (Pinch-to-Zoom, Pan & Double-Tap)
     ========================================================================== */
  openPhotoViewer(imgSrc, title = 'Fotografía de Terreno') {
    const modal = document.getElementById('modal-photo-lightbox');
    const img = document.getElementById('lightbox-image');
    const titleElem = document.getElementById('lightbox-title');
    const subElem = document.getElementById('lightbox-subtitle');

    if (!modal || !img) return;

    img.src = imgSrc;
    if (titleElem) titleElem.textContent = title;
    if (subElem) subElem.textContent = `Proyecto: ${this.currentProject?.name || 'Geowill'} • Registro Topográfico`;

    modal.style.display = 'flex';
    modal.classList.add('active');

    // Initialize gesture listeners and reset zoom to 1.0x
    this.initLightboxGestures();
    this.resetLightboxZoom();
  }

  closePhotoViewer() {
    const modal = document.getElementById('modal-photo-lightbox');
    if (!modal) return;
    modal.classList.remove('active');
    modal.style.display = 'none';
    this.resetLightboxZoom();
  }

  initLightboxGestures() {
    const viewport = document.getElementById('lightbox-viewport');
    const img = document.getElementById('lightbox-image');
    if (!viewport || !img) return;

    this.lightboxState = {
      scale: 1.0,
      panX: 0,
      panY: 0,
      minScale: 1.0,
      maxScale: 6.0,
      isPanning: false,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0,
      initialDistance: 0,
      initialScale: 1.0,
      lastTapTime: 0
    };

    const getDistance = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const applyTransform = () => {
      const s = this.lightboxState;
      img.style.transform = `translate(${s.panX}px, ${s.panY}px) scale(${s.scale})`;
      const badge = document.getElementById('lightbox-zoom-badge');
      if (badge) badge.textContent = `${s.scale.toFixed(1)}x`;
    };

    this._applyLightboxTransform = applyTransform;

    if (this._lightboxGesturesBound) return;
    this._lightboxGesturesBound = true;

    // Touch Start (Pinch or Drag or Double-Tap)
    viewport.addEventListener('touchstart', (e) => {
      const s = this.lightboxState;
      if (!s) return;

      if (e.touches.length === 2) {
        // Pinch Zoom Start
        s.initialDistance = getDistance(e.touches[0], e.touches[1]);
        s.initialScale = s.scale;
      } else if (e.touches.length === 1) {
        // Double-Tap Detection
        const now = Date.now();
        if (now - s.lastTapTime < 300) {
          if (s.scale > 1.2) {
            this.resetLightboxZoom();
          } else {
            s.scale = 2.5;
            s.panX = 0;
            s.panY = 0;
            applyTransform();
          }
          s.lastTapTime = 0;
          return;
        }
        s.lastTapTime = now;

        // Single Finger Pan Start
        s.isPanning = true;
        s.startX = e.touches[0].clientX;
        s.startY = e.touches[0].clientY;
        s.startPanX = s.panX;
        s.startPanY = s.panY;
      }
    }, { passive: false });

    // Touch Move
    viewport.addEventListener('touchmove', (e) => {
      const s = this.lightboxState;
      if (!s) return;

      if (e.touches.length === 2 && s.initialDistance > 0) {
        e.preventDefault();
        const currentDist = getDistance(e.touches[0], e.touches[1]);
        const scaleChange = currentDist / s.initialDistance;
        let newScale = s.initialScale * scaleChange;
        newScale = Math.max(s.minScale, Math.min(s.maxScale, newScale));
        s.scale = newScale;
        applyTransform();
      } else if (e.touches.length === 1 && s.isPanning && s.scale > 1.05) {
        e.preventDefault();
        const dx = e.touches[0].clientX - s.startX;
        const dy = e.touches[0].clientY - s.startY;
        s.panX = s.startPanX + dx;
        s.panY = s.startPanY + dy;
        applyTransform();
      }
    }, { passive: false });

    // Touch End
    viewport.addEventListener('touchend', (e) => {
      const s = this.lightboxState;
      if (!s) return;

      if (e.touches.length < 2) {
        s.initialDistance = 0;
      }
      if (e.touches.length === 0) {
        s.isPanning = false;
        if (s.scale <= 1.05) {
          s.scale = 1.0;
          s.panX = 0;
          s.panY = 0;
          applyTransform();
        }
      }
    });

    // Mouse Wheel Zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const s = this.lightboxState;
      if (!s) return;

      const delta = e.deltaY < 0 ? 0.35 : -0.35;
      let newScale = s.scale + delta;
      newScale = Math.max(s.minScale, Math.min(s.maxScale, newScale));
      s.scale = newScale;
      if (s.scale <= 1.05) {
        s.panX = 0;
        s.panY = 0;
      }
      applyTransform();
    }, { passive: false });
  }

  adjustLightboxZoom(delta) {
    if (!this.lightboxState) this.initLightboxGestures();
    const s = this.lightboxState;
    let newScale = s.scale + delta;
    newScale = Math.max(s.minScale, Math.min(s.maxScale, newScale));
    s.scale = newScale;
    if (s.scale <= 1.05) {
      s.panX = 0;
      s.panY = 0;
    }
    if (this._applyLightboxTransform) this._applyLightboxTransform();
  }

  resetLightboxZoom() {
    if (!this.lightboxState) return;
    const s = this.lightboxState;
    s.scale = 1.0;
    s.panX = 0;
    s.panY = 0;
    if (this._applyLightboxTransform) this._applyLightboxTransform();
  }

  /**
   * Called directly by native Android Java after taking camera picture
   */
  addCapturedPhoto(photoDataUrl) {
    if (!photoDataUrl) return;
    this.tempFeaturePhotos.push(photoDataUrl);
    this._renderPhotoThumbnails();
    this.showToast('📸 Fotografía de campo guardada con éxito', 'success');
  }

  removePhoto(index) {
    this.tempFeaturePhotos.splice(index, 1);
    this._renderPhotoThumbnails();
  }

  async _handlePhotoSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const compressedBase64 = await this._compressImage(file);
      this.tempFeaturePhotos.push(compressedBase64);
    }
    this._renderPhotoThumbnails();
    e.target.value = ''; // Reset
  }

  /**
   * Compresses uploaded photo using OffscreenCanvas to save memory in IndexedDB
   */
  async _compressImage(file, maxDimension = 1280, quality = 0.78) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = readerEvent.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async _saveCurrentFeatureForm() {
    if (!this.currentFeatureDraft) return;

    const name = document.getElementById('feature-name-input').value.trim() || 'Entidad';
    const category = document.getElementById('feature-category-input').value.trim() || 'General';
    const desc = document.getElementById('feature-desc-input').value.trim();
    const color = document.getElementById('feature-color-input').value;

    const featureToSave = {
      ...this.currentFeatureDraft,
      id: this.editingFeatureId || undefined,
      projectId: this.currentProject.id,
      properties: {
        ...this.currentFeatureDraft.properties,
        name,
        category,
        description: desc,
        color,
        photos: this.tempFeaturePhotos
      }
    };

    await window.db.saveFeature(featureToSave);
    await window.vectorEditor.loadProjectFeatures();

    this.closeFeatureModal();
    this.showToast('Entidad guardada correctamente', 'success');
  }

  async editFeature(featureId) {
    const feat = await window.db.getFeature(featureId);
    if (feat) {
      this.openFeatureModal(feat, false);
    }
  }

  async deleteFeatureConfirm(featureId) {
    if (confirm('¿Está seguro de eliminar esta entidad?')) {
      await window.db.deleteFeature(featureId);
      await window.vectorEditor.loadProjectFeatures();
      this.showToast('Entidad eliminada', 'info');
    }
  }

  /* ==========================================================================
     3-Point Georeferencing Wizard Implementation
     ========================================================================== */
  openPdfWizard() {
    document.getElementById('modal-georef-wizard').classList.add('active');
    this._resetCalibrationState();
  }

  closePdfWizard() {
    document.getElementById('modal-georef-wizard').classList.remove('active');
  }

  _resetCalibrationState() {
    this.calibrationState = {
      activeGcpIndex: 0,
      gcps: [
        { pdfX: null, pdfY: null, lat: null, lng: null },
        { pdfX: null, pdfY: null, lat: null, lng: null },
        { pdfX: null, pdfY: null, lat: null, lng: null }
      ],
      pdfDimensions: { width: 0, height: 0, scale: 2.0 },
      isSelectingOnMap: false
    };
    this._updateGcpTabsUI();
  }

  _bindGeorefWizardEvents() {
    // Close button
    document.getElementById('btn-close-georef-wizard')?.addEventListener('click', () => this.closePdfWizard());

    // Tab Switching: GeoPDF vs 3-Point Calibration
    const tabGeoPdf = document.getElementById('tab-btn-geopdf');
    const tab3Point = document.getElementById('tab-btn-3point');
    const panelGeoPdf = document.getElementById('panel-geopdf-mode');
    const panel3Point = document.getElementById('panel-3point-mode');

    tabGeoPdf?.addEventListener('click', () => {
      tabGeoPdf.style.background = 'rgba(6, 182, 212, 0.2)';
      tabGeoPdf.style.color = '#38bdf8';
      tabGeoPdf.style.borderColor = '#06b6d4';
      tab3Point.style.background = 'transparent';
      tab3Point.style.color = '#94a3b8';
      tab3Point.style.borderColor = 'rgba(255,255,255,0.1)';
      if (panelGeoPdf) panelGeoPdf.style.display = 'block';
      if (panel3Point) panel3Point.style.display = 'none';
    });

    tab3Point?.addEventListener('click', () => {
      tab3Point.style.background = 'rgba(6, 182, 212, 0.2)';
      tab3Point.style.color = '#38bdf8';
      tab3Point.style.borderColor = '#06b6d4';
      tabGeoPdf.style.background = 'transparent';
      tabGeoPdf.style.color = '#94a3b8';
      tabGeoPdf.style.borderColor = 'rgba(255,255,255,0.1)';
      if (panel3Point) panel3Point.style.display = 'flex';
      if (panelGeoPdf) panelGeoPdf.style.display = 'none';
    });

    // 1. File Input for Direct GeoPDF
    document.getElementById('geopdf-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this._handleGeoPdfLoaded(file);
      }
    });

    // Apply Auto GeoPDF
    document.getElementById('btn-apply-auto-geopdf')?.addEventListener('click', () => this._applyAutoGeoPdf());

    // Apply Manual Bounding Box Extents
    document.getElementById('btn-apply-bbox-geopdf')?.addEventListener('click', () => this._applyBboxGeoref());

    // 2. File Input for 3-Point Calibration
    document.getElementById('pdf-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this._handlePdfFileLoaded(file);
      }
    });

    // GCP Tab buttons
    document.querySelectorAll('.gcp-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.gcp);
        this.calibrationState.activeGcpIndex = idx;
        this._updateGcpTabsUI();
      });
    });

    // Canvas click on PDF for setting GCP coordinate
    const canvas = document.getElementById('pdf-render-canvas');
    canvas?.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Scale back to real canvas pixels
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const pdfPixelX = clickX * scaleX;
      const pdfPixelY = clickY * scaleY;

      const idx = this.calibrationState.activeGcpIndex;
      this.calibrationState.gcps[idx].pdfX = pdfPixelX;
      this.calibrationState.gcps[idx].pdfY = pdfPixelY;

      this._renderGcpCanvasMarkers();
      this._updateGcpInputsFromState();
      this.showToast(`Punto P${idx + 1} marcado en el plano`, 'info');
    });

    // Coordinate System Selector (WGS84, EPSG:3116, EPSG:9377)
    document.getElementById('wizard-crs-select')?.addEventListener('change', (e) => {
      this.selectedWizardCrs = e.target.value;
      const lbl1 = document.getElementById('lbl-gcp-c1');
      const lbl2 = document.getElementById('lbl-gcp-c2');
      const inp1 = document.getElementById('gcp-lat-input');
      const inp2 = document.getElementById('gcp-lng-input');

      if (this.selectedWizardCrs === 'epsg3116') {
        if (lbl1) lbl1.textContent = 'Coordenada Norte (Y en metros - Bogotá):';
        if (lbl2) lbl2.textContent = 'Coordenada Este (X en metros - Bogotá):';
        if (inp1) inp1.placeholder = 'ej. 1000000.00';
        if (inp2) inp2.placeholder = 'ej. 1000000.00';
      } else if (this.selectedWizardCrs === 'epsg9377') {
        if (lbl1) lbl1.textContent = 'Coordenada Norte (Y en metros - Origen Nal.):';
        if (lbl2) lbl2.textContent = 'Coordenada Este (X en metros - Origen Nal.):';
        if (inp1) inp1.placeholder = 'ej. 2000000.00';
        if (inp2) inp2.placeholder = 'ej. 5000000.00';
      } else {
        if (lbl1) lbl1.textContent = 'Latitud (WGS84 o DMS):';
        if (lbl2) lbl2.textContent = 'Longitud (WGS84 o DMS):';
        if (inp1) inp1.placeholder = 'ej. 4.609712 ó 4°36\'35"N';
        if (inp2) inp2.placeholder = 'ej. -74.081734 ó 74°04\'54"W';
      }

      this._updateGcpInputsFromState();
    });

    // Coordinate input changes
    const updateGcpFromInputs = () => {
      const idx = this.calibrationState.activeGcpIndex;
      const val1 = document.getElementById('gcp-lat-input')?.value.trim();
      const val2 = document.getElementById('gcp-lng-input')?.value.trim();
      if (!val1 || !val2) return;

      const converted = window.georefEngine.parseCoordinateInput(val1, val2, this.selectedWizardCrs);
      if (converted) {
        this.calibrationState.gcps[idx].lat = converted.lat;
        this.calibrationState.gcps[idx].lng = converted.lng;
      } else {
        this.calibrationState.gcps[idx].lat = null;
        this.calibrationState.gcps[idx].lng = null;
      }
      this._updateGcpTabsUI();
    };

    document.getElementById('gcp-lat-input')?.addEventListener('change', updateGcpFromInputs);
    document.getElementById('gcp-lng-input')?.addEventListener('change', updateGcpFromInputs);

    // "Usar mi ubicación GPS actual para este punto"
    document.getElementById('btn-gcp-use-gps')?.addEventListener('click', () => {
      if (!window.gpsTracker.currentPosition) {
        this.showToast('No hay señal GPS disponible', 'warning');
        return;
      }
      const { lat, lng } = window.gpsTracker.currentPosition;
      const idx = this.calibrationState.activeGcpIndex;
      this.calibrationState.gcps[idx].lat = lat;
      this.calibrationState.gcps[idx].lng = lng;
      this._updateGcpInputsFromState();
      this._updateGcpTabsUI();
      this.showToast(`Coordenadas GPS asignadas a P${idx + 1}`, 'success');
    });

    // Apply Georeferencing
    document.getElementById('btn-apply-georef')?.addEventListener('click', () => this._applyGeoreferencingCalibration());
  }

  async _handleGeoPdfLoaded(file) {
    try {
      this.showToast('Analizando estructura y metadatos GeoPDF...', 'info');
      
      // Hidden canvas to render the page
      let canvas = document.getElementById('geopdf-offscreen-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'geopdf-offscreen-canvas';
        canvas.style.display = 'none';
        document.body.appendChild(canvas);
      }

      const loadResult = await window.pdfLoader.loadPdf(file);
      const renderDim = await window.pdfLoader.renderPageToCanvas(1, canvas, 2.0);

      this.currentGeoPdfData = {
        file,
        name: file.name,
        renderDim,
        renderDataUrl: window.pdfLoader.getRenderDataUrl(canvas),
        geoMetadata: loadResult.geoMetadata
      };

      const statusBox = document.getElementById('geopdf-status-box');
      const statusTitle = document.getElementById('geopdf-status-title');
      const statusDetails = document.getElementById('geopdf-status-details');

      if (loadResult.geoMetadata && loadResult.geoMetadata.hasGeoMetadata) {
        // Automatic GeoPDF tags detected!
        statusBox.style.display = 'block';
        statusTitle.textContent = `GeoPDF detectado: "${file.name}"`;
        const b = loadResult.geoMetadata.bounds;
        statusDetails.innerHTML = `<b>Límites extraídos:</b> Lat [${b[0][0].toFixed(5)}, ${b[1][0].toFixed(5)}], Lon [${b[0][1].toFixed(5)}, ${b[1][1].toFixed(5)}]`;

        // Pre-fill BBox inputs as well
        document.getElementById('bbox-north-input').value = b[1][0].toFixed(6);
        document.getElementById('bbox-south-input').value = b[0][0].toFixed(6);
        document.getElementById('bbox-west-input').value = b[0][1].toFixed(6);
        document.getElementById('bbox-east-input').value = b[1][1].toFixed(6);

        this.showToast('¡Plano GeoPDF detectado automáticamente con coordenadas!', 'success');
      } else {
        // No embedded GeoPDF header found, encourage BBox entry or 3-Point
        statusBox.style.display = 'block';
        statusTitle.textContent = `Plano cargado: "${file.name}"`;
        statusDetails.innerHTML = `No se encontraron metadatos espaciales embebidos en el PDF. Ingrese los límites abajo o cambie a la pestaña <b>"Calibrar con 3 Puntos"</b>.`;
        this.showToast('Plano cargado. Defina los límites o use 3 puntos.', 'info');
      }
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  async _applyAutoGeoPdf() {
    if (!this.currentGeoPdfData) {
      this.showToast('Por favor seleccione primero un archivo PDF.', 'warning');
      return;
    }

    const { file, name, renderDim, renderDataUrl, geoMetadata } = this.currentGeoPdfData;

    if (geoMetadata && geoMetadata.hasGeoMetadata && typeof geoMetadata.getCanvasGcps === 'function') {
      const gcps = geoMetadata.getCanvasGcps(renderDim.scale || 2.0);
      const georefResult = window.georefEngine.calculateAffineTransformation(gcps, renderDim.width, renderDim.height);

      const planRecord = {
        projectId: this.currentProject.id,
        name: name,
        renderDataUrl: renderDataUrl,
        width: renderDim.width,
        height: renderDim.height,
        georef: georefResult
      };

      const savedPlan = await window.db.savePdfPlan(planRecord);
      this.currentPdfPlan = savedPlan;
      this._applyPdfPlanToMap(savedPlan);
      this.closePdfWizard();
      this.showToast(`Plano GeoPDF "${name}" proyectado en el mapa con éxito`, 'success');
    } else {
      this._applyBboxGeoref();
    }
  }

  async _applyBboxGeoref() {
    if (!this.currentGeoPdfData) {
      this.showToast('Por favor seleccione primero un archivo PDF.', 'warning');
      return;
    }

    const nStr = document.getElementById('bbox-north-input').value.trim();
    const sStr = document.getElementById('bbox-south-input').value.trim();
    const wStr = document.getElementById('bbox-west-input').value.trim();
    const eStr = document.getElementById('bbox-east-input').value.trim();

    const north = window.georefEngine.parseDMSToDecimal(nStr);
    const south = window.georefEngine.parseDMSToDecimal(sStr);
    const west = window.georefEngine.parseDMSToDecimal(wStr);
    const east = window.georefEngine.parseDMSToDecimal(eStr);

    if (isNaN(north) || isNaN(south) || isNaN(west) || isNaN(east)) {
      this.showToast('Ingrese las 4 coordenadas límite (Norte, Sur, Este, Oeste).', 'warning');
      return;
    }

    const { name, renderDim, renderDataUrl } = this.currentGeoPdfData;

    // Build 3 GCPs from BBox
    const gcps = [
      { pdfX: 0, pdfY: 0, lat: north, lng: west }, // Top-Left
      { pdfX: renderDim.width, pdfY: 0, lat: north, lng: east }, // Top-Right
      { pdfX: 0, pdfY: renderDim.height, lat: south, lng: west }  // Bottom-Left
    ];

    try {
      const georefResult = window.georefEngine.calculateAffineTransformation(gcps, renderDim.width, renderDim.height);

      const planRecord = {
        projectId: this.currentProject.id,
        name: name,
        renderDataUrl: renderDataUrl,
        width: renderDim.width,
        height: renderDim.height,
        georef: georefResult
      };

      const savedPlan = await window.db.savePdfPlan(planRecord);
      this.currentPdfPlan = savedPlan;
      this._applyPdfPlanToMap(savedPlan);
      this.closePdfWizard();
      this.showToast(`Plano georreferenciado proyectado en el mapa`, 'success');
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  async _handlePdfFileLoaded(file) {
    try {
      this.showToast('Cargando y procesando PDF...', 'info');
      const canvas = document.getElementById('pdf-render-canvas');
      const loadResult = await window.pdfLoader.loadPdf(file);
      const renderDim = await window.pdfLoader.renderPageToCanvas(1, canvas, 2.0);

      this.calibrationState.pdfDimensions = renderDim;
      this.calibrationState.loadedFileName = file.name;

      document.getElementById('pdf-upload-placeholder')?.classList.add('hidden');
      document.getElementById('pdf-wizard-content')?.classList.remove('hidden');

      if (loadResult.geoMetadata && loadResult.geoMetadata.hasGeoMetadata && typeof loadResult.geoMetadata.getCanvasGcps === 'function') {
        const autoGcps = loadResult.geoMetadata.getCanvasGcps(renderDim.scale || 2.0);
        this.calibrationState.gcps = [
          { pdfX: autoGcps[0].pdfX, pdfY: autoGcps[0].pdfY, lat: autoGcps[0].lat, lng: autoGcps[0].lng },
          { pdfX: autoGcps[1].pdfX, pdfY: autoGcps[1].pdfY, lat: autoGcps[1].lat, lng: autoGcps[1].lng },
          { pdfX: autoGcps[2].pdfX, pdfY: autoGcps[2].pdfY, lat: autoGcps[2].lat, lng: autoGcps[2].lng }
        ];
        this._renderGcpCanvasMarkers();
        this._updateGcpTabsUI();
        this.showToast(`✨ GeoPDF detectado: Puntos P1, P2 y P3 calibrados automáticamente. Presione "Aplicar al Mapa".`, 'success');
      } else {
        this.showToast(`Plano "${file.name}" cargado. Toque en el plano para definir los 3 puntos.`, 'success');
      }
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  _updateGcpTabsUI() {
    const idx = this.calibrationState.activeGcpIndex;
    document.querySelectorAll('.gcp-pill').forEach(pill => {
      const pIdx = parseInt(pill.dataset.gcp);
      pill.classList.toggle('active', pIdx === idx);
      
      const gcp = this.calibrationState.gcps[pIdx];
      const isComplete = gcp.pdfX !== null && gcp.lat !== null && gcp.lng !== null;
      pill.classList.toggle('completed', isComplete);
    });

    this._updateGcpInputsFromState();
  }

  _updateGcpInputsFromState() {
    const idx = this.calibrationState.activeGcpIndex;
    const gcp = this.calibrationState.gcps[idx];

    const latInput = document.getElementById('gcp-lat-input');
    const lngInput = document.getElementById('gcp-lng-input');
    const pixelInfo = document.getElementById('gcp-pixel-info');

    if (gcp.lat !== null && gcp.lng !== null) {
      if (this.selectedWizardCrs === 'epsg3116') {
        const pt = window.georefEngine.wgs84ToEpsg3116(gcp.lat, gcp.lng);
        if (latInput) latInput.value = pt.norte.toFixed(2);
        if (lngInput) lngInput.value = pt.este.toFixed(2);
      } else if (this.selectedWizardCrs === 'epsg9377') {
        const pt = window.georefEngine.wgs84ToEpsg9377(gcp.lat, gcp.lng);
        if (latInput) latInput.value = pt.norte.toFixed(2);
        if (lngInput) lngInput.value = pt.este.toFixed(2);
      } else {
        if (latInput) latInput.value = gcp.lat.toFixed(6);
        if (lngInput) lngInput.value = gcp.lng.toFixed(6);
      }
    } else {
      if (latInput) latInput.value = '';
      if (lngInput) lngInput.value = '';
    }

    if (pixelInfo) {
      pixelInfo.textContent = gcp.pdfX !== null 
        ? `Pixel: (${gcp.pdfX.toFixed(0)}, ${gcp.pdfY.toFixed(0)})` 
        : 'Toque en el plano para definir pixel';
    }
  }

  _renderGcpCanvasMarkers() {
    const layer = document.getElementById('gcp-crosshair-layer');
    if (!layer) return;
    layer.innerHTML = '';

    const canvas = document.getElementById('pdf-render-canvas');
    if (!canvas) return;

    this.calibrationState.gcps.forEach((gcp, i) => {
      if (gcp.pdfX !== null && gcp.pdfY !== null) {
        // Calculate relative %
        const leftPercent = (gcp.pdfX / canvas.width) * 100;
        const topPercent = (gcp.pdfY / canvas.height) * 100;

        const marker = document.createElement('div');
        marker.className = `gcp-marker-point p${i + 1}`;
        marker.style.left = `${leftPercent}%`;
        marker.style.top = `${topPercent}%`;
        marker.textContent = `P${i + 1}`;
        layer.appendChild(marker);
      }
    });
  }

  async _applyGeoreferencingCalibration() {
    const gcps = this.calibrationState.gcps;
    for (let i = 0; i < 3; i++) {
      if (gcps[i].pdfX === null || gcps[i].lat === null || gcps[i].lng === null) {
        this.showToast(`Por favor complete el Punto P${i + 1} (Pixel y Coordenadas Lat/Lng)`, 'warning');
        return;
      }
    }

    try {
      const { width, height } = this.calibrationState.pdfDimensions;
      const georefResult = window.georefEngine.calculateAffineTransformation(gcps, width, height);

      // Render Canvas to DataURL
      const renderDataUrl = window.pdfLoader.getRenderDataUrl();

      const planRecord = {
        projectId: this.currentProject.id,
        name: this.calibrationState.loadedFileName || 'Plano Georreferenciado',
        renderDataUrl: renderDataUrl,
        width: width,
        height: height,
        georef: georefResult
      };

      const savedPlan = await window.db.savePdfPlan(planRecord);
      this.currentPdfPlan = savedPlan;

      this._applyPdfPlanToMap(savedPlan);
      this.closePdfWizard();

      this.showToast(`¡Plano georreferenciado! Error RMS: ${georefResult.rmse.toFixed(2)}m`, 'success');
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  /* ==========================================================================
     KML Hub (Unified Import & Export)
     ========================================================================== */
  exportKmlProject() {
    this.openKmlHub('export');
  }

  openKmlHub(tab = 'import') {
    const modal = document.getElementById('modal-export-kml');
    if (!modal) return;
    modal.classList.add('active');
    this.switchKmlHubTab(tab);
  }

  switchKmlHubTab(tab) {
    const btnImport = document.getElementById('tab-btn-kml-import');
    const btnExport = document.getElementById('tab-btn-kml-export');
    const panelImport = document.getElementById('panel-kml-import-mode');
    const panelExport = document.getElementById('panel-kml-export-mode');

    if (tab === 'import') {
      if (btnImport) {
        btnImport.style.background = 'rgba(6, 182, 212, 0.2)';
        btnImport.style.color = '#38bdf8';
        btnImport.style.borderColor = '#06b6d4';
      }
      if (btnExport) {
        btnExport.style.background = 'transparent';
        btnExport.style.color = '#94a3b8';
        btnExport.style.borderColor = 'rgba(255,255,255,0.1)';
      }
      if (panelImport) panelImport.style.display = 'block';
      if (panelExport) panelExport.style.display = 'none';
    } else {
      if (btnExport) {
        btnExport.style.background = 'rgba(6, 182, 212, 0.2)';
        btnExport.style.color = '#38bdf8';
        btnExport.style.borderColor = '#06b6d4';
      }
      if (btnImport) {
        btnImport.style.background = 'transparent';
        btnImport.style.color = '#94a3b8';
        btnImport.style.borderColor = 'rgba(255,255,255,0.1)';
      }
      if (panelImport) panelImport.style.display = 'none';
      if (panelExport) panelExport.style.display = 'block';
    }
  }

  async _handleKmlFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      this.showToast('Analizando archivo KML...', 'info');
      const result = await window.kmlImporter.parseKmlFile(file, this.currentProject.id);

      if (!result.features || result.features.length === 0) {
        this.showToast('No se encontraron geometrías válidas (Puntos/Líneas/Polígonos) en el KML.', 'warning');
        return;
      }

      this.pendingImportKmlFeatures = result.features;

      const previewBox = document.getElementById('kml-import-preview-box');
      const nameElem = document.getElementById('kml-import-doc-name');
      const statsElem = document.getElementById('kml-import-stats');
      const listElem = document.getElementById('kml-import-elements-list');

      if (nameElem) nameElem.textContent = result.docName || file.name;
      if (statsElem) {
        statsElem.innerHTML = `
          <span>📍 <b>${result.stats.points}</b> Puntos</span>
          <span>〰️ <b>${result.stats.lines}</b> Líneas</span>
          <span>⬡ <b>${result.stats.polygons}</b> Polígonos</span>
        `;
      }

      if (listElem) {
        listElem.innerHTML = result.features.slice(0, 50).map((f) => {
          const icon = f.type === 'Point' ? '📍' : f.type === 'LineString' ? '〰️' : '⬡';
          return `<div style="padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #e2e8f0;">
            ${icon} <b>${f.properties.name}</b> <span style="color:#94a3b8; font-size:10px;">(${f.properties.category || f.type})</span>
          </div>`;
        }).join('') + (result.features.length > 50 ? `<div style="color:#38bdf8; padding-top:4px;">...y ${result.features.length - 50} elementos más</div>` : '');
      }

      if (previewBox) previewBox.style.display = 'block';
      this.showToast(`KML cargado: ${result.features.length} elementos listos para importar.`, 'success');
    } catch (err) {
      console.error('Error importing KML:', err);
      this.showToast('Error al importar KML: ' + err.message, 'error');
    }
  }

  async _confirmKmlImport() {
    if (!this.pendingImportKmlFeatures || this.pendingImportKmlFeatures.length === 0) {
      this.showToast('No hay elementos seleccionados para importar.', 'warning');
      return;
    }

    try {
      const feats = this.pendingImportKmlFeatures;
      let count = 0;
      const allBounds = [];

      for (const feat of feats) {
        feat.projectId = this.currentProject.id;
        await window.db.saveFeature(feat);
        count++;

        if (feat.type === 'Point') {
          allBounds.push(feat.coordinates);
        } else if (Array.isArray(feat.coordinates[0])) {
          feat.coordinates.forEach(c => allBounds.push(c));
        }
      }

      await window.vectorEditor.loadProjectFeatures();
      this.pendingImportKmlFeatures = null;

      document.getElementById('modal-export-kml')?.classList.remove('active');
      const previewBox = document.getElementById('kml-import-preview-box');
      if (previewBox) previewBox.style.display = 'none';

      // Fit map to imported features
      if (allBounds.length > 0 && window.mapEngine.map) {
        try {
          window.mapEngine.map.fitBounds(L.latLngBounds(allBounds), { padding: [50, 50] });
        } catch (e) {}
      }

      this.showToast(`✅ Se importaron ${count} elementos con éxito al proyecto actual.`, 'success');
    } catch (err) {
      console.error('Error saving imported features:', err);
      this.showToast('Error guardando entidades KML: ' + err.message, 'error');
    }
  }

  async shareKmlWhatsApp() {
    try {
      this.showToast('Preparando archivo KML para compartir...', 'info');
      const features = await window.db.getFeaturesByProject(this.currentProject.id);
      const kmlString = window.kmlExporter.generateKmlString(this.currentProject.name, features, this.currentPdfPlan);
      const { fileName, docTitle } = window.kmlExporter.getFormattedExportName(this.currentProject.name);

      if (window.AndroidNative && typeof window.AndroidNative.shareKmlFile === 'function') {
        window.AndroidNative.shareKmlFile(fileName, kmlString, docTitle);
        document.getElementById('modal-export-kml')?.classList.remove('active');
      } else if (window.AndroidNative && typeof window.AndroidNative.shareKml === 'function') {
        window.AndroidNative.shareKml(kmlString, fileName);
        document.getElementById('modal-export-kml')?.classList.remove('active');
      } else if (navigator.share) {
        try {
          const file = new File([kmlString], fileName, { type: 'application/vnd.google-earth.kml+xml' });
          await navigator.share({
            title: docTitle,
            text: `Levantamiento topográfico Geowill: ${docTitle}`,
            files: [file]
          });
          document.getElementById('modal-export-kml')?.classList.remove('active');
        } catch (shareErr) {
          console.warn('navigator.share failed, fallback to direct download:', shareErr);
          this.downloadKmlDirect();
        }
      } else {
        this.downloadKmlDirect();
      }
    } catch (err) {
      console.error('Error sharing KML:', err);
      this.downloadKmlDirect();
    }
  }

  async downloadKmlDirect() {
    try {
      const features = await window.db.getFeaturesByProject(this.currentProject.id);
      const kmlString = window.kmlExporter.generateKmlString(this.currentProject.name, features, this.currentPdfPlan);
      const { fileName } = window.kmlExporter.getFormattedExportName(this.currentProject.name);

      const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast(`Archivo "${fileName}" descargado`, 'success');
      document.getElementById('modal-export-kml')?.classList.remove('active');
    } catch (err) {
      console.error('Error downloading KML:', err);
      this.showToast('Error generando KML: ' + err.message, 'error');
    }
  }

  /* ==========================================================================
     Point Search & Stakeout Navigation (Replanteo)
     ========================================================================== */
  openPointSearchModal() {
    const modal = document.getElementById('modal-point-search');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('active');
    this.currentSearchFilter = 'all';
    const input = document.getElementById('point-search-input');
    if (input) input.value = '';
    this.renderPointSearchList();
  }

  closePointSearchModal() {
    const modal = document.getElementById('modal-point-search');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
  }

  filterPointSearchList() {
    const query = document.getElementById('point-search-input')?.value || '';
    this.renderPointSearchList(this.currentSearchFilter, query);
  }

  async renderPointSearchList(filterType = 'all', query = '') {
    const container = document.getElementById('point-search-list-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:20px;">Cargando elementos...</div>';

    const features = await window.db.getFeaturesByProject(this.currentProject.id);
    const userPos = window.gpsTracker?.currentPosition;

    // Filter by geometry type
    let filtered = features;
    if (filterType !== 'all') {
      filtered = filtered.filter(f => f.type === filterType);
    }

    // Filter by text search query
    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = filtered.filter(f => {
        const name = (f.properties?.name || '').toLowerCase();
        const desc = (f.properties?.description || '').toLowerCase();
        const cat = (f.properties?.category || '').toLowerCase();
        return name.includes(q) || desc.includes(q) || cat.includes(q);
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:#94a3b8;">
          <div style="font-size:36px; margin-bottom:8px;">🔍</div>
          <div style="font-size:14px; font-weight:700; color:#f8fafc;">No se encontraron elementos</div>
          <div style="font-size:12px; margin-top:4px;">Crea puntos en el mapa o importa un archivo KML.</div>
        </div>
      `;
      return;
    }

    // Calculate distance and bearing for each item from current GPS
    const items = filtered.map(f => {
      let lat = 0, lng = 0;
      if (f.type === 'Point') {
        lat = f.coordinates[0];
        lng = f.coordinates[1];
      } else if (Array.isArray(f.coordinates[0])) {
        lat = f.coordinates[0][0];
        lng = f.coordinates[0][1];
      }

      let distMeters = 999999999;
      let bearing = 0;
      let cardinal = '';

      if (userPos && userPos.lat) {
        distMeters = window.navStakeout.getDistance(userPos.lat, userPos.lng, lat, lng);
        bearing = window.navStakeout.getBearing(userPos.lat, userPos.lng, lat, lng);
        cardinal = window.navStakeout.getCardinal(bearing);
      }

      return {
        feature: f,
        lat,
        lng,
        distMeters,
        bearing,
        cardinal
      };
    });

    // Sort by distance (nearest first) if GPS is available
    if (userPos && userPos.lat) {
      items.sort((a, b) => a.distMeters - b.distMeters);
    }

    // Build Cards HTML
    container.innerHTML = '';
    items.forEach(item => {
      const f = item.feature;
      const props = f.properties || {};
      const typeIcon = f.type === 'Point' ? '📍' : f.type === 'LineString' ? '〰️' : '⬡';
      const color = props.color || '#3b82f6';

      // Format coordinates according to active CRS
      let coordStr = '';
      if (this.currentHudCrs === 'epsg3116') {
        const pt = window.georefEngine.wgs84ToEpsg3116(item.lat, item.lng);
        coordStr = `N: ${pt.norte.toFixed(1)} m | E: ${pt.este.toFixed(1)} m`;
      } else if (this.currentHudCrs === 'epsg9377') {
        const pt = window.georefEngine.wgs84ToEpsg9377(item.lat, item.lng);
        coordStr = `N: ${pt.norte.toFixed(1)} m | E: ${pt.este.toFixed(1)} m`;
      } else {
        coordStr = `Lat: ${item.lat.toFixed(6)}, Lon: ${item.lng.toFixed(6)}`;
      }

      const distBadge = item.distMeters < 9999999
        ? `<span style="background: rgba(16,185,129,0.2); color:#10b981; border:1px solid rgba(16,185,129,0.4); padding:2px 6px; border-radius:4px; font-size:11px; font-weight:800; font-family:monospace;">
            📏 ${item.distMeters >= 1000 ? (item.distMeters/1000).toFixed(2) + ' km' : item.distMeters.toFixed(1) + ' m'} • Az: ${item.bearing.toFixed(0)}° (${item.cardinal})
          </span>`
        : '';

      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(30, 41, 59, 0.85);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.1);
        border-left: 4px solid ${color};
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      `;

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <div>
            <div style="font-weight: 700; font-size: 14px; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
              <span>${typeIcon}</span> <span>${props.name}</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 1px;">
              ${props.category || 'General'}
            </div>
          </div>
          <div>${distBadge}</div>
        </div>

        <div style="font-size: 11px; color: #38bdf8; font-family: monospace; background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 4px;">
          ${coordStr}
        </div>

        ${props.description ? `<div style="font-size: 11px; color: #cbd5e1;">${props.description}</div>` : ''}

        <div style="display: flex; gap: 6px; margin-top: 4px;">
          <button class="btn btn-sm" style="flex: 1.5; background: #10b981; color: #ffffff; font-weight: 700; border: none; border-radius: 6px; padding: 6px 8px; display: flex; align-items: center; justify-content: center; gap: 4px;" onclick="window.app.startNavigationToFeature('${f.id}')">
            <span>🎯</span> <span>Guiar / Navegar</span>
          </button>
          <button class="btn btn-sm btn-secondary" style="flex: 1; border-radius: 6px; padding: 6px 8px;" onclick="window.app.centerOnFeatureAndCloseModal('${f.id}')">
            <span>👁️</span> <span>Ver</span>
          </button>
          <button class="btn btn-sm btn-secondary" style="flex: 1; border-radius: 6px; padding: 6px 8px;" onclick="window.app.editFeatureAndCloseModal('${f.id}')">
            <span>✏️</span> <span>Ficha</span>
          </button>
        </div>
      `;

      container.appendChild(card);
    });
  }

  async startNavigationToFeature(featureId) {
    const f = await window.db.getFeature(featureId);
    if (!f) return;

    this.closePointSearchModal();
    const ok = window.navStakeout.start(f);
    if (ok) {
      this.showToast(`🎯 Guiando hacia: "${f.properties?.name || 'Punto'}"`, 'success');
    }
  }

  stopNavigation() {
    window.navStakeout.stop();
    this.showToast('Navegación / Guía finalizada', 'info');
  }

  async centerOnFeatureAndCloseModal(featureId) {
    const f = await window.db.getFeature(featureId);
    if (!f) return;
    this.closePointSearchModal();

    let lat = 0, lng = 0;
    if (f.type === 'Point') {
      lat = f.coordinates[0];
      lng = f.coordinates[1];
    } else if (Array.isArray(f.coordinates[0])) {
      lat = f.coordinates[0][0];
      lng = f.coordinates[0][1];
    }

    if (window.mapEngine.map) {
      window.mapEngine.map.setView([lat, lng], 18);
    }
  }

  async editFeatureAndCloseModal(featureId) {
    this.closePointSearchModal();
    this.editFeature(featureId);
  }

  /* ==========================================================================
     Projects Modal
     ========================================================================== */
  async openProjectsModal() {
    const listElem = document.getElementById('projects-list-container');
    if (!listElem) return;
    listElem.innerHTML = '';

    const projects = await window.db.getAllProjects();
    projects.forEach(p => {
      const isActive = this.currentProject && this.currentProject.id === p.id;
      const card = document.createElement('div');
      card.className = `btn btn-secondary btn-block ${isActive ? 'active' : ''}`;
      card.style.justifyContent = 'space-between';
      card.style.marginBottom = '8px';
      card.innerHTML = `
        <div style="text-align:left;">
          <div style="font-weight:700; color:${isActive ? '#38bdf8' : '#f8fafc'}">${p.name}</div>
          <div style="font-size:11px; color:#94a3b8;">${new Date(p.updatedAt).toLocaleDateString()}</div>
        </div>
        ${isActive ? '<span style="color:#10b981; font-size:12px;">✓ Activo</span>' : `<button class="btn btn-sm btn-primary" onclick="window.app.switchProject('${p.id}')">Abrir</button>`}
      `;
      listElem.appendChild(card);
    });

    document.getElementById('modal-projects-backdrop')?.classList.add('active');
  }

  async switchProject(projectId) {
    const p = await window.db.getProject(projectId);
    if (p) {
      await this.setActiveProject(p);
      document.getElementById('modal-projects-backdrop')?.classList.remove('active');
      this.showToast(`Proyecto "${p.name}" activado`, 'success');
    }
  }

  async createNewProjectPrompt() {
    const name = prompt('Nombre del nuevo proyecto:');
    if (name && name.trim()) {
      const newProj = await window.db.saveProject({
        name: name.trim(),
        description: 'Creado desde Geowill'
      });
      await this.setActiveProject(newProj);
      document.getElementById('modal-projects-backdrop')?.classList.remove('active');
      this.showToast(`Proyecto "${name}" creado`, 'success');
    }
  }

  /* ==========================================================================
     Layers Modal
     ========================================================================== */
  openLayersModal() {
    document.getElementById('modal-layers-backdrop')?.classList.add('active');
  }

  setMapBase(type) {
    window.mapEngine.setBaseMap(type);
    document.querySelectorAll('.basemap-option-card').forEach(c => {
      c.classList.toggle('active', c.dataset.base === type);
    });
    this.showToast(`Mapa base: ${type}`, 'info');
  }

  /* ==========================================================================
     Toast Notifications
     ========================================================================== */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  /* ==========================================================================
     Service Worker Registration for PWA
     ========================================================================== */
  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('GeoPlan Service Worker registered:', reg.scope);
      }).catch((err) => {
        console.log('Service Worker registration skipped:', err);
      });
    }
  }
}

// Instantiate and start app on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new GeoPlanApp();
  window.app.init();
});
