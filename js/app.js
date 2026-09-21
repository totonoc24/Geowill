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

    // Google Earth Attribute Inspector & Info Mode State
    this.isInfoMode = false;
    this.currentInfoFeature = null;
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
      if (pos.heading !== undefined && pos.heading !== null) {
        window.mapEngine.setHeadingRotation(pos.heading);
      }
    };
    window.gpsTracker.onHeadingUpdate = (heading) => {
      window.mapEngine.setHeadingRotation(heading);
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

    // 7. Check for incoming KML opened directly from WhatsApp, Telegram, Gmail, File Manager
    if (window.AndroidNative && typeof window.AndroidNative.notifyAppLoaded === 'function') {
      window.AndroidNative.notifyAppLoaded();
    }
    if (window.AndroidNative && typeof window.AndroidNative.getPendingImportKml === 'function') {
      try {
        const rawPending = window.AndroidNative.getPendingImportKml();
        if (rawPending && rawPending.trim().length > 0) {
          const parsed = JSON.parse(rawPending);
          if (parsed.kml) {
            setTimeout(() => {
              this.importExternalKmlText(parsed.kml, parsed.name || 'Archivo.kml');
            }, 800);
          }
        }
      } catch (e) {
        console.warn('Error checking pending KML:', e);
      }
    }

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

    // Auto-resolve qualities for existing features (e.g. Collar_Cordero points)
    setTimeout(() => {
      this.autoUpgradeCollarCorderoFeatures();
    }, 400);

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

    // Auto-Rotate / Heading-Up & Compass widget toggle
    const toggleHeadingMode = () => {
      const isHeadingUp = window.mapEngine.toggleHeadingUpMode();
      this.showToast(
        isHeadingUp 
          ? '🧭 Orientación: Rumbo Adelante (Giro Automático)' 
          : '🧭 Orientación: Norte Arriba (Fijo)',
        'info'
      );
    };

    document.getElementById('compass-north-widget')?.addEventListener('click', toggleHeadingMode);
    document.getElementById('btn-map-heading-lock')?.addEventListener('click', toggleHeadingMode);

    document.getElementById('btn-quick-gps-point')?.addEventListener('click', () => {
      window.vectorEditor.addPointAtCurrentGps();
    });

    // Close Info Modal on backdrop click
    document.getElementById('modal-info-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-info-backdrop') {
        this.closeInfoModal();
      }
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

    // Tutorial & User Guide Modal Controls
    document.getElementById('btn-open-tutorial')?.addEventListener('click', () => this.openTutorialModal());
    document.getElementById('btn-side-tutorial')?.addEventListener('click', () => this.openTutorialModal());
    document.getElementById('btn-close-tutorial')?.addEventListener('click', () => this.closeTutorialModal());

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

    // Point Search & Stakeout Coordinate Navigation Events
    document.getElementById('nav-coord-crs-select')?.addEventListener('change', () => this._updateNavCoordInputsUI());
    document.getElementById('nav-coord-c1-input')?.addEventListener('input', () => this._calculateNavCoordPreview());
    document.getElementById('nav-coord-c2-input')?.addEventListener('input', () => this._calculateNavCoordPreview());
    document.getElementById('btn-start-nav-from-coords')?.addEventListener('click', () => this.startNavigationFromCoordinates());
    document.getElementById('btn-save-and-nav-coords')?.addEventListener('click', () => this.saveAndNavigateCoordinates());
    document.getElementById('btn-view-map-coords')?.addEventListener('click', () => this.viewCoordinatesOnMap());

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

    // Get compressed jpeg con calidad alta
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    this.tempFeaturePhotos.push(photoDataUrl);
    this._renderPhotoThumbnails();

    // Guardar también en la galería de fotos del dispositivo
    if (window.AndroidNative && typeof window.AndroidNative.savePhotoToGallery === 'function') {
      window.AndroidNative.savePhotoToGallery(photoDataUrl, 'FOTO_CAMPO');
    }

    this.closeLiveCamera();
    this.showToast('📸 Fotografía de campo capturada y guardada en galería', 'success');
  }

  /* ==========================================================================
     Tutorial & User Guide In-App Modal
     ========================================================================== */
  openTutorialModal() {
    const modal = document.getElementById('modal-tutorial');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  closeTutorialModal() {
    const modal = document.getElementById('modal-tutorial');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
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
      document.body.classList.add('track-recording-active');
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
        statusLbl.textContent = 'REC:';
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
      document.body.classList.remove('track-recording-active');
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

    // Toggle and prefill Point Symbology options
    const pointSymbolGroup = document.getElementById('feature-point-symbol-group');
    if (pointSymbolGroup) {
      if (feature.type === 'Point') {
        pointSymbolGroup.style.display = 'block';
        const symSelect = document.getElementById('feature-symbol-select');
        const sizeSelect = document.getElementById('feature-symbol-size-select');
        if (symSelect) symSelect.value = feature.properties?.symbol || 'circle';
        if (sizeSelect) sizeSelect.value = feature.properties?.symbolSize || 'md';
      } else {
        pointSymbolGroup.style.display = 'none';
      }
    }

    // Render Rich Coordinates Card for Point / Line / Polygon
    this._renderFeatureCoordsCard(feature);

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

  _renderFeatureCoordsCard(feature) {
    const coordsCard = document.getElementById('feature-coords-card');
    if (!coordsCard) return;

    if (!feature || !feature.coordinates) {
      coordsCard.style.display = 'none';
      return;
    }

    if (feature.type === 'Point') {
      let lat = null, lng = null;
      if (Array.isArray(feature.coordinates)) {
        lat = parseFloat(feature.coordinates[0]);
        lng = parseFloat(feature.coordinates[1]);
      } else if (typeof feature.coordinates === 'object') {
        lat = parseFloat(feature.coordinates.lat);
        lng = parseFloat(feature.coordinates.lng);
      }

      if (lat === null || isNaN(lat) || lng === null || isNaN(lng)) {
        coordsCard.style.display = 'none';
        return;
      }

      // Default or saved coordinate system preference
      let activeSystem = localStorage.getItem('geowill_preferred_coords_sys') || 'wgs84';

      // Calculations
      const latStr = lat.toFixed(7);
      const lngStr = lng.toFixed(7);
      const dmsLat = window.georefEngine ? window.georefEngine.formatDecimalToDMS(lat, true) : '';
      const dmsLng = window.georefEngine ? window.georefEngine.formatDecimalToDMS(lng, false) : '';
      const magna9377 = window.georefEngine ? window.georefEngine.wgs84ToEpsg9377(lat, lng) : null;
      const magna3116 = window.georefEngine ? window.georefEngine.wgs84ToEpsg3116(lat, lng) : null;

      const currentGps = window.gpsTracker?.currentPosition;
      const alt = feature.properties?.altitude !== undefined ? feature.properties.altitude : currentGps?.altitude;
      const acc = feature.properties?.accuracy !== undefined ? feature.properties.accuracy : currentGps?.accuracy;
      const altText = (alt !== undefined && alt !== null && alt !== 0) ? `${parseFloat(alt).toFixed(1)} m` : '--';
      const accText = (acc !== undefined && acc !== null && acc !== 0) ? `±${parseFloat(acc).toFixed(1)} m` : '--';

      const renderCardContent = (sys) => {
        let displayHtml = '';
        let copyText = '';

        if (sys === 'wgs84') {
          displayHtml = `
            <div class="coords-val-box">
              <span class="coords-val-label">Latitud (WGS84)</span>
              <span class="coords-val-text highlight">${latStr}°</span>
            </div>
            <div class="coords-val-box">
              <span class="coords-val-label">Longitud (WGS84)</span>
              <span class="coords-val-text highlight">${lngStr}°</span>
            </div>
          `;
          copyText = `Lat: ${latStr}, Lon: ${lngStr}`;
        } else if (sys === 'dms') {
          displayHtml = `
            <div class="coords-val-box coords-item-full">
              <span class="coords-val-label">Grados, Minutos y Segundos (DMS)</span>
              <span class="coords-val-text highlight">${dmsLat}, ${dmsLng}</span>
            </div>
          `;
          copyText = `${dmsLat} ${dmsLng}`;
        } else if (sys === 'epsg9377') {
          const n = magna9377 ? magna9377.norte.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m' : '--';
          const e = magna9377 ? magna9377.este.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m' : '--';
          displayHtml = `
            <div class="coords-val-box">
              <span class="coords-val-label">Norte (N) - EPSG:9377</span>
              <span class="coords-val-text highlight">${n}</span>
            </div>
            <div class="coords-val-box">
              <span class="coords-val-label">Este (E) - EPSG:9377</span>
              <span class="coords-val-text highlight">${e}</span>
            </div>
          `;
          copyText = `EPSG:9377 -> N: ${n}, E: ${e}`;
        } else if (sys === 'epsg3116') {
          const n = magna3116 ? magna3116.norte.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m' : '--';
          const e = magna3116 ? magna3116.este.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m' : '--';
          displayHtml = `
            <div class="coords-val-box">
              <span class="coords-val-label">Norte (N) - EPSG:3116</span>
              <span class="coords-val-text highlight">${n}</span>
            </div>
            <div class="coords-val-box">
              <span class="coords-val-label">Este (E) - EPSG:3116</span>
              <span class="coords-val-text highlight">${e}</span>
            </div>
          `;
          copyText = `EPSG:3116 -> N: ${n}, E: ${e}`;
        }

        coordsCard.innerHTML = `
          <div class="feature-coords-header">
            <span class="feature-coords-title">
              <span>📍</span> <span>Coordenadas</span>
            </span>
            <button type="button" class="btn-copy-coords" id="btn-copy-feature-coords" title="Copiar coordenadas">
              <span>📋</span> <span>Copiar</span>
            </button>
          </div>

          <div class="coords-system-pills" id="coords-system-selector">
            <button type="button" class="coords-pill ${sys === 'wgs84' ? 'active' : ''}" data-sys="wgs84">WGS84</button>
            <button type="button" class="coords-pill ${sys === 'dms' ? 'active' : ''}" data-sys="dms">DMS</button>
            <button type="button" class="coords-pill ${sys === 'epsg9377' ? 'active' : ''}" data-sys="epsg9377">Magna 9377</button>
            <button type="button" class="coords-pill ${sys === 'epsg3116' ? 'active' : ''}" data-sys="epsg3116">Magna 3116</button>
          </div>

          <div class="coords-display-single">
            ${displayHtml}
          </div>

          <div class="coords-meta-row">
            <span>Altitud: <b>${altText}</b></span>
            <span>Precisión: <b>${accText}</b></span>
          </div>
        `;

        // Bind system selector pills
        document.querySelectorAll('#coords-system-selector .coords-pill').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const chosen = btn.getAttribute('data-sys');
            localStorage.setItem('geowill_preferred_coords_sys', chosen);
            renderCardContent(chosen);
          });
        });

        // Bind copy button
        document.getElementById('btn-copy-feature-coords')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.copyToClipboard(copyText);
        });
      };

      renderCardContent(activeSystem);
      coordsCard.style.display = 'flex';
    } else if (feature.type === 'LineString' || feature.type === 'Polygon') {
      const coords = feature.coordinates || [];
      const count = coords.length;
      const startCoord = coords[0] ? (Array.isArray(coords[0]) ? `${coords[0][0].toFixed(6)}°, ${coords[0][1].toFixed(6)}°` : '') : '--';

      coordsCard.innerHTML = `
        <div class="feature-coords-header">
          <span class="feature-coords-title">
            <span>${feature.type === 'LineString' ? '📏' : '⬡'}</span> 
            <span>${feature.type === 'LineString' ? 'Vértices de Línea' : 'Vértices de Polígono'}</span>
          </span>
          <span style="font-size: 9.5px; color: #38bdf8; font-family: monospace; font-weight: 700;">${count} vértices</span>
        </div>
        <div class="coords-display-single">
          <div class="coords-val-box coords-item-full">
            <span class="coords-val-label">Vértice Inicial (Latitud, Longitud)</span>
            <span class="coords-val-text highlight">${startCoord}</span>
          </div>
        </div>
      `;
      coordsCard.style.display = 'flex';
    } else {
      coordsCard.style.display = 'none';
    }
  }

  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('📋 Coordenadas copiadas al portapapeles', 'success');
      }).catch(() => {
        this._fallbackCopyText(text);
      });
    } else {
      this._fallbackCopyText(text);
    }
  }

  _fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      this.showToast('📋 Coordenadas copiadas al portapapeles', 'success');
    } catch (err) {
      this.showToast('No se pudo copiar automáticamente', 'warning');
    }
    document.body.removeChild(textArea);
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
        <img src="${imgSrc}" title="Toca para ver en pantalla completa" onclick="window.app.openPhotoViewer('${imgSrc}', 'Foto de Campo #${idx + 1}', ${idx})" />
        <button class="photo-rotate-btn" title="Girar 90° a la derecha" onclick="event.stopPropagation(); window.app.rotatePhotoAtIndex(${idx})">🔄</button>
        <button class="photo-delete-btn" title="Eliminar foto" onclick="event.stopPropagation(); window.app.removePhoto(${idx})">✕</button>
      `;
      gallery.appendChild(box);
    });
  }

  /**
   * Rotates a base64 / dataUrl image by given degrees (default 90 clockwise)
   */
  async rotateDataUrl(dataUrl, degrees = 90) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const isOrthogonal = Math.abs(degrees % 180) === 90;
          canvas.width = isOrthogonal ? img.height : img.width;
          canvas.height = isOrthogonal ? img.width : img.height;

          const ctx = canvas.getContext('2d');
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((degrees * Math.PI) / 180);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);

          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }

  /**
   * Rotate a specific photo in the form's temporary photo list by 90 deg clockwise
   */
  async rotatePhotoAtIndex(index, degrees = 90) {
    if (this.tempFeaturePhotos && this.tempFeaturePhotos[index]) {
      try {
        const rotated = await this.rotateDataUrl(this.tempFeaturePhotos[index], degrees);
        this.tempFeaturePhotos[index] = rotated;
        this._renderPhotoThumbnails();
        this.showToast('📸 Foto girada 90° a la derecha', 'success');
      } catch (err) {
        console.error('Error rotating photo:', err);
        this.showToast('No se pudo girar la foto', 'danger');
      }
    }
  }

  /**
   * Rotate the photo currently displayed in the Lightbox viewer
   */
  async rotateCurrentLightboxPhoto(degrees = 90) {
    const img = document.getElementById('lightbox-image');
    if (!img || !img.src) return;

    try {
      const rotated = await this.rotateDataUrl(img.src, degrees);
      img.src = rotated;
      this.resetLightboxZoom();

      // If viewing a photo from the active feature form draft
      if (this.currentLightboxIndex !== null && this.currentLightboxIndex !== undefined && this.tempFeaturePhotos[this.currentLightboxIndex]) {
        this.tempFeaturePhotos[this.currentLightboxIndex] = rotated;
        this._renderPhotoThumbnails();
      }
      this.showToast('📸 Foto girada 90° a la derecha', 'success');
    } catch (err) {
      console.error('Error rotating lightbox image:', err);
      this.showToast('No se pudo girar la foto', 'danger');
    }
  }

  /* ==========================================================================
     Fullscreen Photo Lightbox Viewer (Pinch-to-Zoom, Pan & Double-Tap)
     ========================================================================== */
  openPhotoViewer(imgSrc, title = 'Fotografía de Terreno', photoIndex = null) {
    const modal = document.getElementById('modal-photo-lightbox');
    const img = document.getElementById('lightbox-image');
    const titleElem = document.getElementById('lightbox-title');
    const subElem = document.getElementById('lightbox-subtitle');

    if (!modal || !img) return;

    this.currentLightboxIndex = photoIndex;
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
    this.currentLightboxIndex = null;
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
    const isCameraInput = e.target.id === 'camera-direct-input';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let compressedBase64 = await this._compressImage(file);

      // If photo was taken with camera while phone is held in portrait, but image is landscape (width > height), rotate 90° clockwise
      if (isCameraInput) {
        try {
          const img = new Image();
          await new Promise((res) => { img.onload = res; img.onerror = res; img.src = compressedBase64; });
          if (img.width > img.height && window.innerHeight > window.innerWidth) {
            compressedBase64 = await this.rotateDataUrl(compressedBase64, 90);
          }
        } catch (err) {
          console.warn('Auto-rotation check failed:', err);
        }
      }

      this.tempFeaturePhotos.push(compressedBase64);

      // Si fue tomada directamente con la cámara, asegurar guardado en la galería del dispositivo
      if (isCameraInput && window.AndroidNative && typeof window.AndroidNative.savePhotoToGallery === 'function') {
        window.AndroidNative.savePhotoToGallery(compressedBase64, 'FOTO_CAMPO');
      }
    }
    this._renderPhotoThumbnails();
    e.target.value = ''; // Reset
  }

  /**
   * Compresses uploaded photo using createImageBitmap with EXIF orientation support
   */
  async _compressImage(file, maxDimension = 1920, quality = 0.90) {
    // Attempt 1: Modern W3C createImageBitmap with automatic EXIF orientation
    if (typeof window.createImageBitmap === 'function') {
      try {
        const bitmap = await window.createImageBitmap(file, { imageOrientation: 'from-image' });
        let width = bitmap.width;
        let height = bitmap.height;

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
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        return canvas.toDataURL('image/jpeg', quality);
      } catch (e) {
        console.warn('createImageBitmap with EXIF failed, falling back to FileReader:', e);
      }
    }

    // Attempt 2: Fallback with FileReader + Image
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
        img.onerror = () => resolve('');
        img.src = readerEvent.target.result;
      };
      reader.onerror = () => resolve('');
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
        symbol: this.currentFeatureDraft.type === 'Point' 
          ? (document.getElementById('feature-symbol-select')?.value || 'circle') 
          : undefined,
        symbolSize: this.currentFeatureDraft.type === 'Point' 
          ? (document.getElementById('feature-symbol-size-select')?.value || 'md') 
          : undefined,
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
     Google Earth Feature Info & Attribute Inspector
     ========================================================================== */
  async showFeatureInfo(featureOrId) {
    let feature = typeof featureOrId === 'string' ? await window.db.getFeature(featureOrId) : featureOrId;
    if (!feature) {
      this.showToast('Elemento no encontrado', 'warning');
      return;
    }

    this.currentInfoFeature = feature;
    const props = feature.properties || {};
    const titleElem = document.getElementById('info-modal-title');
    const bodyElem = document.getElementById('info-modal-body');
    const modal = document.getElementById('modal-info-backdrop');
    if (!bodyElem || !modal) return;

    // 1. Gather all qualities / attributes
    let qualities = props.extendedData && typeof props.extendedData === 'object' && Object.keys(props.extendedData).length > 0
      ? { ...props.extendedData }
      : {};

    if (Object.keys(qualities).length === 0 && props.description) {
      const parsed = this._parseAttributesFromDescription(props.description);
      parsed.forEach(p => { qualities[p.key] = p.val; });
    }

    const displayName = props.name || qualities['Hole_numbe'] || qualities['Name'] || 'Punto';
    const safeName = displayName.replace(/'/g, "\\'");
    const typeLabel = feature.type === 'Point' ? 'Punto' : feature.type === 'LineString' ? 'Línea' : 'Polígono';
    const typeIcon = feature.type === 'Point' ? '📍' : feature.type === 'LineString' ? '📏' : '⬡';

    if (titleElem) {
      titleElem.innerHTML = `
        <span style="font-size: 20px;">${typeIcon}</span>
        <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left;">
          <span style="font-weight: 700; color: #f8fafc; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${displayName}</span>
          <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">${props.category || 'General'} • ${typeLabel}</span>
        </div>
      `;
    }

    let attributes = [];
    for (const [key, val] of Object.entries(qualities)) {
      attributes.push({ key, val: String(val !== undefined && val !== null ? val : '') });
    }

    // 3. Spatial and geometry fields
    const spatialFields = [];
    if (feature.type === 'Point' && Array.isArray(feature.coordinates)) {
      const lat = parseFloat(feature.coordinates[0]);
      const lng = parseFloat(feature.coordinates[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        spatialFields.push({ key: 'Latitud (WGS84)', val: lat.toFixed(7) + '°' });
        spatialFields.push({ key: 'Longitud (WGS84)', val: lng.toFixed(7) + '°' });
        if (props.altitude !== undefined && props.altitude !== null && props.altitude !== 0) {
          spatialFields.push({ key: 'Altitud', val: parseFloat(props.altitude).toFixed(1) + ' m' });
        }
      }
    } else if (feature.type === 'LineString' && props.length) {
      spatialFields.push({ key: 'Longitud', val: props.length > 1000 ? (props.length / 1000).toFixed(3) + ' km' : props.length.toFixed(1) + ' m' });
    } else if (feature.type === 'Polygon' && props.area) {
      spatialFields.push({ key: 'Área', val: (props.area / 10000).toFixed(2) + ' ha (' + props.area.toFixed(1) + ' m²)' });
      if (props.perimeter) spatialFields.push({ key: 'Perímetro', val: props.perimeter.toFixed(1) + ' m' });
    }

    // Build Google Earth table rows
    let tableRows = '';
    if (attributes.length > 0) {
      attributes.forEach((attr, idx) => {
        const bg = idx % 2 === 0 ? 'rgba(30, 41, 59, 0.4)' : 'rgba(15, 23, 42, 0.6)';
        tableRows += `
          <tr style="background: ${bg}; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
            <td style="padding: 7px 10px; font-weight: 700; color: #38bdf8; font-size: 12px; width: 42%; vertical-align: middle; word-break: break-word;">${attr.key}</td>
            <td style="padding: 7px 10px; color: #f1f5f9; font-size: 12px; vertical-align: middle; word-break: break-word; font-family: monospace;">${attr.val || '<span style="color:#64748b; font-style:italic;">(vacío)</span>'}</td>
          </tr>
        `;
      });
    }

    let spatialRows = '';
    spatialFields.forEach((sf, idx) => {
      const bg = idx % 2 === 0 ? 'rgba(30, 41, 59, 0.3)' : 'transparent';
      spatialRows += `
        <tr style="background: ${bg}; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
          <td style="padding: 6px 10px; font-weight: 600; color: #94a3b8; font-size: 11px; width: 42%; vertical-align: middle;">${sf.key}</td>
          <td style="padding: 6px 10px; color: #e2e8f0; font-size: 11px; vertical-align: middle; font-family: monospace;">${sf.val}</td>
        </tr>
      `;
    });

    let photosHtml = '';
    if (props.photos && props.photos.length > 0) {
      photosHtml = `
        <div style="margin-top: 14px;">
          <div style="font-size: 12px; font-weight: 700; color: #38bdf8; margin-bottom: 6px;">📸 Fotos Asociadas (${props.photos.length})</div>
          <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px;">
            ${props.photos.map(p => `
              <img src="${p}" style="height: 75px; width: 75px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.4); cursor: pointer;" onclick="window.app.openPhotoViewer('${p}', '${safeName.replace(/'/g, "\\'")}')">
            `).join('')}
          </div>
        </div>
      `;
    }

    const showDescBlock = props.description && !props.description.includes('<table') && (!props.extendedData || Object.keys(props.extendedData).length === 0 || props.description !== props.name);

    bodyElem.innerHTML = `
      ${attributes.length > 0 ? `
        <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #38bdf8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px;">
            <span>📋</span> Cualidades del Punto (${attributes.length})
          </span>
          <button class="btn btn-sm btn-secondary" style="font-size: 10px; padding: 2px 8px;" onclick="window.app.copyFeatureAttributesToClipboard()">📋 Copiar Cualidades</button>
        </div>
        <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; overflow: hidden; max-height: 42vh; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      ` : `
        <div style="padding: 12px; background: rgba(30, 41, 59, 0.45); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 8px; margin-bottom: 8px; font-size: 12px; color: #94a3b8; text-align: center;">
          ℹ️ Este elemento no contiene atributos o cualidades adicionales. A continuación se detallan sus propiedades espaciales:
        </div>
      `}

      <!-- Geometry & Coordinates -->
      <div style="margin-top: 12px;">
        <span style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">📍 Geometría y Coordenadas</span>
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 8px; overflow: hidden; margin-top: 4px;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <tbody>
              ${spatialRows}
            </tbody>
          </table>
        </div>
      </div>

      ${showDescBlock ? `
        <div style="margin-top: 12px;">
          <span style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">📝 Descripción</span>
          <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 8px; padding: 8px 10px; font-size: 12px; color: #cbd5e1; margin-top: 4px; line-height: 1.4; word-break: break-word;">
            ${props.description}
          </div>
        </div>
      ` : ''}

      ${photosHtml}
    `;

    // Footer actions
    const btnEdit = document.getElementById('btn-info-edit');
    if (btnEdit) {
      btnEdit.onclick = () => {
        this.closeInfoModal();
        this.editFeature(feature.id);
      };
    }

    const btnNav = document.getElementById('btn-info-navigate');
    if (btnNav) {
      btnNav.onclick = () => {
        this.closeInfoModal();
        this.startNavigationToFeature(feature.id);
      };
    }

    modal.classList.add('active');
  }

  closeInfoModal() {
    const modal = document.getElementById('modal-info-backdrop');
    if (modal) modal.classList.remove('active');
    this.currentInfoFeature = null;
  }

  copyFeatureAttributesToClipboard() {
    if (!this.currentInfoFeature) return;
    const f = this.currentInfoFeature;
    const props = f.properties || {};
    let text = `=== ${props.name || 'Punto'} ===\n`;
    text += `Categoría: ${props.category || 'General'}\n`;
    if (f.type === 'Point' && Array.isArray(f.coordinates)) {
      text += `Coordenadas: Lat ${f.coordinates[0]}, Lng ${f.coordinates[1]}\n`;
      if (props.altitude) text += `Altitud: ${props.altitude} m\n`;
    }
    if (props.extendedData && typeof props.extendedData === 'object' && Object.keys(props.extendedData).length > 0) {
      text += `\n--- Cualidades del Punto ---\n`;
      for (const [k, v] of Object.entries(props.extendedData)) {
        text += `${k}: ${v}\n`;
      }
    } else if (props.description) {
      text += `\nDescripción: ${props.description}\n`;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('📋 Atributos copiados al portapapeles', 'success');
      }).catch(() => {
        this.showToast('No se pudo copiar al portapapeles', 'warning');
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.showToast('📋 Atributos copiados al portapapeles', 'success');
    }
  }

  _parseAttributesFromDescription(desc) {
    if (!desc) return [];
    const attributes = [];
    
    if (desc.includes('<table')) {
      try {
        const temp = document.createElement('div');
        temp.innerHTML = desc;
        const rows = temp.getElementsByTagName('tr');
        for (let i = 0; i < rows.length; i++) {
          const cells = rows[i].children;
          if (cells.length >= 2) {
            const k = cells[0].textContent.trim();
            const v = cells[1].textContent.trim();
            if (k) attributes.push({ key: k, val: v });
          }
        }
      } catch (e) {
        console.warn('Error parsing table from description:', e);
      }
    }

    if (attributes.length === 0) {
      const lines = desc.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0 && colonIdx < trimmed.length - 1) {
          const key = trimmed.substring(0, colonIdx).trim();
          const val = trimmed.substring(colonIdx + 1).trim();
          if (key.length < 35) {
            attributes.push({ key, val });
          }
        }
      }
    }

    return attributes;
  }

  /**
   * Sanitizes user features that may have been falsely tagged with drill hole qualities,
   * and preserves qualities only for legitimate Collar_Cordero drill holes.
   */
  async autoUpgradeCollarCorderoFeatures() {
    if (!this.currentProject) return;
    try {
      const features = await window.db.getFeaturesByProject(this.currentProject.id);
      let updatedCount = 0;

      for (const feat of features) {
        const props = feat.properties || {};
        const isUserPoint = props.category === 'General' || (props.name && /^Punto\s+\d+/i.test(props.name.trim()));

        // Sanitización: si un punto creado por el usuario fue contaminado con atributos de pozo minero
        if (isUserPoint && props.extendedData && (props.extendedData.Hole_numbe || props.extendedData.Mining_Tit)) {
          feat.properties.extendedData = {};
          await window.db.saveFeature(feat);
          updatedCount++;
          continue;
        }

        // Solo actualizar si es explícitamente un punto de perforación KML sin nombre resuelto
        const needsName = props.name && props.name.startsWith('Elemento');
        if (props.category === 'Collar_Cordero' && needsName && window.findCollarCorderoQualities) {
          const cached = window.findCollarCorderoQualities(feat);
          if (cached) {
            feat.properties.extendedData = { ...cached, ...(props.extendedData || {}) };
            if (cached.Hole_numbe) {
              feat.properties.name = cached.Hole_numbe;
            }
            await window.db.saveFeature(feat);
            updatedCount++;
          }
        }
      }

      if (updatedCount > 0) {
        console.log(`Puntos verificados y saneados en IndexedDB (${updatedCount} actualizados).`);
        await window.vectorEditor.loadProjectFeatures();
      }
    } catch (err) {
      console.warn('AutoUpgrade Collar_Cordero notice:', err);
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

    this.pdfViewerState = {
      scale: 1.0,
      panX: 0,
      panY: 0,
      minScale: 0.01,
      maxScale: 20.0,
      isDragging: false,
      hasMoved: false,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0,
      initialPinchDist: 0,
      initialScale: 1.0,
      pinchMidX: 0,
      pinchMidY: 0,
      lastTapTime: 0
    };

    this._updateGcpTabsUI();
    this.applyPdfViewerTransform();
  }

  applyPdfViewerTransform() {
    const wrapper = document.getElementById('pdf-canvas-wrapper');
    if (!wrapper || !this.pdfViewerState) return;
    const s = this.pdfViewerState;
    wrapper.style.transform = `translate(${s.panX}px, ${s.panY}px) scale(${s.scale})`;
    
    const badge = document.getElementById('pdf-zoom-badge');
    if (badge) {
      badge.textContent = `${Math.round(s.scale * 100)}%`;
    }
  }

  fitPdfToScreen() {
    const viewport = document.getElementById('pdf-canvas-viewport');
    const canvas = document.getElementById('pdf-render-canvas');
    if (!viewport || !canvas || canvas.width === 0 || canvas.height === 0) return;

    const vRect = viewport.getBoundingClientRect();
    const vWidth = vRect.width || viewport.clientWidth || 360;
    const vHeight = vRect.height || viewport.clientHeight || 300;

    if (vWidth <= 0 || vHeight <= 0) return;

    const padding = 16;
    const scaleX = (vWidth - padding * 2) / canvas.width;
    const scaleY = (vHeight - padding * 2) / canvas.height;
    const fitScale = Math.min(scaleX, scaleY);

    if (!this.pdfViewerState) {
      this._resetCalibrationState();
    }
    const s = this.pdfViewerState;
    s.scale = Math.max(s.minScale, Math.min(s.maxScale, fitScale));
    s.panX = Math.round((vWidth - canvas.width * s.scale) / 2);
    s.panY = Math.round((vHeight - canvas.height * s.scale) / 2);

    this.applyPdfViewerTransform();
  }

  adjustPdfZoom(deltaFactor, clientCenterX = null, clientCenterY = null) {
    const viewport = document.getElementById('pdf-canvas-viewport');
    const canvas = document.getElementById('pdf-render-canvas');
    if (!viewport || !canvas || !this.pdfViewerState) return;

    const s = this.pdfViewerState;
    const vRect = viewport.getBoundingClientRect();
    
    // Default pivot point to center of viewport
    const pivotX = (clientCenterX !== null ? clientCenterX : (vRect.left + vRect.width / 2)) - vRect.left;
    const pivotY = (clientCenterY !== null ? clientCenterY : (vRect.top + vRect.height / 2)) - vRect.top;

    const oldScale = s.scale;
    let newScale = oldScale * deltaFactor;
    newScale = Math.max(s.minScale, Math.min(s.maxScale, newScale));

    if (Math.abs(newScale - oldScale) < 0.0001) return;

    // Keep the pivot point stationary under the zoom
    s.panX = pivotX - (pivotX - s.panX) * (newScale / oldScale);
    s.panY = pivotY - (pivotY - s.panY) * (newScale / oldScale);
    s.scale = newScale;

    this.applyPdfViewerTransform();
  }

  resetPdfZoom() {
    if (!this.pdfViewerState) return;
    const s = this.pdfViewerState;
    const viewport = document.getElementById('pdf-canvas-viewport');
    const canvas = document.getElementById('pdf-render-canvas');
    if (viewport && canvas) {
      const vRect = viewport.getBoundingClientRect();
      s.scale = 1.0;
      s.panX = Math.round((vRect.width - canvas.width) / 2);
      s.panY = Math.round((vRect.height - canvas.height) / 2);
    } else {
      s.scale = 1.0;
      s.panX = 0;
      s.panY = 0;
    }
    this.applyPdfViewerTransform();
  }

  initPdfViewerGestures() {
    const viewport = document.getElementById('pdf-canvas-viewport');
    const canvas = document.getElementById('pdf-render-canvas');
    if (!viewport || !canvas || this._pdfViewerGesturesBound) return;
    this._pdfViewerGesturesBound = true;

    // Zoom Toolbar buttons
    document.getElementById('btn-pdf-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.adjustPdfZoom(1.35);
    });

    document.getElementById('btn-pdf-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.adjustPdfZoom(0.74);
    });

    document.getElementById('btn-pdf-zoom-fit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fitPdfToScreen();
    });

    document.getElementById('btn-pdf-zoom-reset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetPdfZoom();
    });

    const getDistance = (t1, t2) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Touch events for mobile (pinch-to-zoom and drag pan)
    viewport.addEventListener('touchstart', (e) => {
      const s = this.pdfViewerState;
      if (!s) return;

      if (e.touches.length === 2) {
        // Pinch zoom
        s.initialPinchDist = getDistance(e.touches[0], e.touches[1]);
        s.initialScale = s.scale;
        s.pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        s.pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        s.isDragging = false;
        s.hasMoved = true;
      } else if (e.touches.length === 1) {
        s.isDragging = true;
        s.hasMoved = false;
        s.startX = e.touches[0].clientX;
        s.startY = e.touches[0].clientY;
        s.startPanX = s.panX;
        s.startPanY = s.panY;
      }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
      const s = this.pdfViewerState;
      if (!s) return;

      if (e.touches.length === 2 && s.initialPinchDist > 0) {
        e.preventDefault();
        const currentDist = getDistance(e.touches[0], e.touches[1]);
        const scaleFactor = currentDist / s.initialPinchDist;
        const targetScale = Math.max(s.minScale, Math.min(s.maxScale, s.initialScale * scaleFactor));
        const delta = targetScale / s.scale;
        this.adjustPdfZoom(delta, s.pinchMidX, s.pinchMidY);
        s.hasMoved = true;
      } else if (e.touches.length === 1 && s.isDragging) {
        const dx = e.touches[0].clientX - s.startX;
        const dy = e.touches[0].clientY - s.startY;
        if (Math.hypot(dx, dy) > 6) {
          s.hasMoved = true;
          e.preventDefault();
          s.panX = s.startPanX + dx;
          s.panY = s.startPanY + dy;
          this.applyPdfViewerTransform();
        }
      }
    }, { passive: false });

    viewport.addEventListener('touchend', (e) => {
      const s = this.pdfViewerState;
      if (!s) return;

      if (e.touches.length < 2) {
        s.initialPinchDist = 0;
      }

      if (e.touches.length === 0) {
        if (s.isDragging && !s.hasMoved && e.changedTouches && e.changedTouches.length > 0) {
          // Tap detected! Check double-tap vs single tap
          const now = Date.now();
          const t = e.changedTouches[0];
          if (now - s.lastTapTime < 300) {
            // Double tap zoom
            this.adjustPdfZoom(2.0, t.clientX, t.clientY);
            s.lastTapTime = 0;
          } else {
            s.lastTapTime = now;
            this._handlePdfCanvasPointClick(t.clientX, t.clientY);
          }
        }
        s.isDragging = false;
      }
    });

    // Mouse events for desktop/laptop
    viewport.addEventListener('mousedown', (e) => {
      if (e.target.closest('.pdf-zoom-controls')) return;
      const s = this.pdfViewerState;
      if (!s) return;

      s.isDragging = true;
      s.hasMoved = false;
      s.startX = e.clientX;
      s.startY = e.clientY;
      s.startPanX = s.panX;
      s.startPanY = s.panY;
    });

    window.addEventListener('mousemove', (e) => {
      const s = this.pdfViewerState;
      if (!s || !s.isDragging) return;

      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (Math.hypot(dx, dy) > 5) {
        s.hasMoved = true;
        s.panX = s.startPanX + dx;
        s.panY = s.startPanY + dy;
        this.applyPdfViewerTransform();
      }
    });

    window.addEventListener('mouseup', (e) => {
      const s = this.pdfViewerState;
      if (!s || !s.isDragging) return;
      
      const wasInsideViewport = viewport.contains(e.target) || e.target === viewport;
      if (!s.hasMoved && wasInsideViewport && !e.target.closest('.pdf-zoom-controls')) {
        this._handlePdfCanvasPointClick(e.clientX, e.clientY);
      }
      s.isDragging = false;
    });

    // Mouse Wheel zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      this.adjustPdfZoom(factor, e.clientX, e.clientY);
    }, { passive: false });
  }

  _handlePdfCanvasPointClick(clientX, clientY) {
    const canvas = document.getElementById('pdf-render-canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;

    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return; // Click outside canvas area
    }

    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    // Scale back to real canvas pixels accurately
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const pdfPixelX = clickX * scaleX;
    const pdfPixelY = clickY * scaleY;

    const idx = this.calibrationState.activeGcpIndex;
    this.calibrationState.gcps[idx].pdfX = pdfPixelX;
    this.calibrationState.gcps[idx].pdfY = pdfPixelY;

    this._renderGcpCanvasMarkers();
    this._updateGcpInputsFromState();
    this.showToast(`Punto P${idx + 1} marcado en el plano (X: ${pdfPixelX.toFixed(0)}, Y: ${pdfPixelY.toFixed(0)})`, 'info');
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

      // Auto fit on tab switch if PDF was already loaded
      setTimeout(() => {
        if (this.pdfViewerState && this.calibrationState.pdfDimensions?.width > 0) {
          this.fitPdfToScreen();
        }
      }, 60);
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

    // Initialize gesture listeners
    this.initPdfViewerGestures();

    // Coordinate System Selector (WGS84, EPSG:3116, EPSG:9377)
    document.getElementById('wizard-crs-select')?.addEventListener('change', (e) => {
      this.selectedWizardCrs = e.target.value;
      const lbl1 = document.getElementById('lbl-gcp-c1');
      const lbl2 = document.getElementById('lbl-gcp-c2');
      const inp1 = document.getElementById('gcp-lat-input');
      const inp2 = document.getElementById('gcp-lng-input');
      const hint = document.getElementById('crs-format-hint');

      if (this.selectedWizardCrs === 'epsg3116') {
        if (lbl1) lbl1.textContent = 'Coordenada Norte (Y en metros - Bogotá):';
        if (lbl2) lbl2.textContent = 'Coordenada Este (X en metros - Bogotá):';
        if (inp1) inp1.placeholder = 'ej. 1000000.00';
        if (inp2) inp2.placeholder = 'ej. 1000000.00';
        if (hint) hint.textContent = 'Metros (MAGNA Bogotá)';
      } else if (this.selectedWizardCrs === 'epsg9377') {
        if (lbl1) lbl1.textContent = 'Coordenada Norte (Y en metros - Origen Nal.):';
        if (lbl2) lbl2.textContent = 'Coordenada Este (X en metros - Origen Nal.):';
        if (inp1) inp1.placeholder = 'ej. 2000000.00';
        if (inp2) inp2.placeholder = 'ej. 5000000.00';
        if (hint) hint.textContent = 'Metros (MAGNA Origen Nal.)';
      } else {
        if (lbl1) lbl1.textContent = 'Latitud (WGS84 o DMS):';
        if (lbl2) lbl2.textContent = 'Longitud (WGS84 o DMS):';
        if (inp1) inp1.placeholder = 'ej. 4.609712 ó 4°36\'35"N';
        if (inp2) inp2.placeholder = 'ej. -74.081734 ó 74°04\'54"W';
        if (hint) hint.textContent = 'Grados decimales o DMS';
      }

      this._updateGcpInputsFromState();
    });

    // Real-time Coordinate Input Listener (input, change, blur)
    const updateGcpFromInputs = () => {
      const idx = this.calibrationState.activeGcpIndex;
      const val1 = document.getElementById('gcp-lat-input')?.value.trim();
      const val2 = document.getElementById('gcp-lng-input')?.value.trim();

      if (val1 && val2) {
        const converted = window.georefEngine.parseCoordinateInput(val1, val2, this.selectedWizardCrs);
        if (converted) {
          this.calibrationState.gcps[idx].lat = converted.lat;
          this.calibrationState.gcps[idx].lng = converted.lng;
        } else {
          this.calibrationState.gcps[idx].lat = null;
          this.calibrationState.gcps[idx].lng = null;
        }
      } else {
        this.calibrationState.gcps[idx].lat = null;
        this.calibrationState.gcps[idx].lng = null;
      }
      this._updateGcpTabsUI();
    };

    ['input', 'change', 'blur'].forEach(evt => {
      document.getElementById('gcp-lat-input')?.addEventListener(evt, updateGcpFromInputs);
      document.getElementById('gcp-lng-input')?.addEventListener(evt, updateGcpFromInputs);
    });

    // "Usar mi ubicación GPS actual para este punto"
    document.getElementById('btn-gcp-use-gps')?.addEventListener('click', () => {
      this.assignGpsToGcp(this.calibrationState.activeGcpIndex);
    });

    // "Seleccionar en el mapa satelital"
    document.getElementById('btn-gcp-pick-map')?.addEventListener('click', () => {
      this.startMapPickForGcp(this.calibrationState.activeGcpIndex);
    });

    // Navigation buttons (Prev / Next point)
    document.getElementById('btn-gcp-prev')?.addEventListener('click', () => {
      if (this.calibrationState.activeGcpIndex > 0) {
        this.calibrationState.activeGcpIndex--;
        this._updateGcpTabsUI();
      }
    });

    document.getElementById('btn-gcp-next')?.addEventListener('click', () => {
      if (this.calibrationState.activeGcpIndex < 2) {
        this.calibrationState.activeGcpIndex++;
        this._updateGcpTabsUI();
      } else {
        this._applyGeoreferencingCalibration();
      }
    });

    // Full 3-Point Table Modal Triggers
    document.getElementById('btn-open-gcp-table')?.addEventListener('click', () => this.openGcpTableModal());
    document.getElementById('btn-close-gcp-table')?.addEventListener('click', () => this.closeGcpTableModal());
    document.getElementById('btn-save-gcp-table')?.addEventListener('click', () => this.saveGcpTableModal());
    document.getElementById('btn-apply-from-gcp-table')?.addEventListener('click', () => {
      this.saveGcpTableModal();
      this._applyGeoreferencingCalibration();
    });

    // Table modal CRS selector
    document.getElementById('table-crs-select')?.addEventListener('change', (e) => {
      this.selectedWizardCrs = e.target.value;
      const wizardSelect = document.getElementById('wizard-crs-select');
      if (wizardSelect) wizardSelect.value = e.target.value;
      this.openGcpTableModal(); // Refresh table inputs formatting
    });

    // Map picker cancel button
    document.getElementById('btn-cancel-map-picker')?.addEventListener('click', () => this.cancelMapPick());

    // Apply Georeferencing
    document.getElementById('btn-apply-georef')?.addEventListener('click', () => this._applyGeoreferencingCalibration());
  }

  /* ==========================================================================
     3-Point Calibration Full Table Modal & Map Picker Handlers
     ========================================================================== */
  openGcpTableModal() {
    const modal = document.getElementById('modal-gcp-table-backdrop');
    if (!modal) return;

    // Sync CRS selector
    const tableCrs = document.getElementById('table-crs-select');
    if (tableCrs) tableCrs.value = this.selectedWizardCrs;

    // Populate each row (P1, P2, P3)
    const crs = this.selectedWizardCrs;
    [0, 1, 2].forEach(i => {
      const gcp = this.calibrationState.gcps[i];
      const pNum = i + 1;
      
      const pixelBadge = document.getElementById(`table-p${pNum}-pixel`);
      if (pixelBadge) {
        pixelBadge.textContent = gcp.pdfX !== null 
          ? `Pixel: (${gcp.pdfX.toFixed(0)}, ${gcp.pdfY.toFixed(0)})` 
          : 'Pixel: Sin fijar en plano';
        pixelBadge.style.color = gcp.pdfX !== null ? '#10b981' : '#94a3b8';
      }

      const inp1 = document.getElementById(`table-p${pNum}-c1`);
      const inp2 = document.getElementById(`table-p${pNum}-c2`);
      const lbl1 = document.getElementById(`lbl-table-p${pNum}-c1`);
      const lbl2 = document.getElementById(`lbl-table-p${pNum}-c2`);

      if (crs === 'epsg3116') {
        if (lbl1) lbl1.textContent = 'Norte (Y en metros - Bogotá):';
        if (lbl2) lbl2.textContent = 'Este (X en metros - Bogotá):';
        if (inp1) inp1.placeholder = 'ej. 1000000.00';
        if (inp2) inp2.placeholder = 'ej. 1000000.00';
      } else if (crs === 'epsg9377') {
        if (lbl1) lbl1.textContent = 'Norte (Y en metros - Origen Nal.):';
        if (lbl2) lbl2.textContent = 'Este (X en metros - Origen Nal.):';
        if (inp1) inp1.placeholder = 'ej. 2000000.00';
        if (inp2) inp2.placeholder = 'ej. 5000000.00';
      } else {
        if (lbl1) lbl1.textContent = 'Latitud (WGS84 / DMS):';
        if (lbl2) lbl2.textContent = 'Longitud (WGS84 / DMS):';
        if (inp1) inp1.placeholder = 'ej. 4.609712 ó 4°36\'35"N';
        if (inp2) inp2.placeholder = 'ej. -74.081734 ó 74°04\'54"W';
      }

      if (gcp.lat !== null && gcp.lng !== null) {
        if (crs === 'epsg3116') {
          const pt = window.georefEngine.wgs84ToEpsg3116(gcp.lat, gcp.lng);
          if (inp1) inp1.value = pt.norte.toFixed(2);
          if (inp2) inp2.value = pt.este.toFixed(2);
        } else if (crs === 'epsg9377') {
          const pt = window.georefEngine.wgs84ToEpsg9377(gcp.lat, gcp.lng);
          if (inp1) inp1.value = pt.norte.toFixed(2);
          if (inp2) inp2.value = pt.este.toFixed(2);
        } else {
          if (inp1) inp1.value = gcp.lat.toFixed(6);
          if (inp2) inp2.value = gcp.lng.toFixed(6);
        }
      } else {
        if (inp1) inp1.value = '';
        if (inp2) inp2.value = '';
      }
    });

    modal.classList.add('active');
  }

  closeGcpTableModal() {
    const modal = document.getElementById('modal-gcp-table-backdrop');
    if (modal) modal.classList.remove('active');
  }

  saveGcpTableModal() {
    const crs = document.getElementById('table-crs-select')?.value || this.selectedWizardCrs;
    this.selectedWizardCrs = crs;
    const wizardSelect = document.getElementById('wizard-crs-select');
    if (wizardSelect) wizardSelect.value = crs;

    [0, 1, 2].forEach(i => {
      const pNum = i + 1;
      const val1 = document.getElementById(`table-p${pNum}-c1`)?.value.trim();
      const val2 = document.getElementById(`table-p${pNum}-c2`)?.value.trim();

      if (val1 && val2) {
        const converted = window.georefEngine.parseCoordinateInput(val1, val2, crs);
        if (converted) {
          this.calibrationState.gcps[i].lat = converted.lat;
          this.calibrationState.gcps[i].lng = converted.lng;
        }
      }
    });

    this.closeGcpTableModal();
    this._updateGcpTabsUI();
    this.showToast('Coordenadas de los 3 puntos actualizadas', 'success');
  }

  assignGpsToGcp(pointIndex) {
    if (!window.gpsTracker || !window.gpsTracker.currentPosition) {
      this.showToast('No hay señal GPS disponible en este momento', 'warning');
      return;
    }
    const { lat, lng } = window.gpsTracker.currentPosition;
    this.calibrationState.gcps[pointIndex].lat = lat;
    this.calibrationState.gcps[pointIndex].lng = lng;
    this._updateGcpTabsUI();

    // If table modal is open, refresh table modal inputs as well
    const tableModal = document.getElementById('modal-gcp-table-backdrop');
    if (tableModal && tableModal.classList.contains('active')) {
      this.openGcpTableModal();
    }

    this.showToast(`📍 Coordenadas GPS asignadas al Punto P${pointIndex + 1}`, 'success');
  }

  startMapPickForGcp(pointIndex) {
    this.calibrationState.activeGcpIndex = pointIndex;
    
    // Close modals
    this.closeGcpTableModal();
    document.getElementById('modal-georef-wizard')?.classList.remove('active');

    // Show floating banner
    const banner = document.getElementById('banner-gcp-map-picker');
    const title = document.getElementById('map-picker-title');
    if (title) title.textContent = `Modo Selección: Punto P${pointIndex + 1}`;
    if (banner) banner.style.display = 'flex';

    this.showToast(`Toque sobre el mapa satelital para capturar la coordenada de P${pointIndex + 1}`, 'info');

    // Attach single map click listener
    const map = window.mapEngine?.map;
    if (map) {
      const onMapClick = (e) => {
        const { lat, lng } = e.latlng;
        this.calibrationState.gcps[pointIndex].lat = lat;
        this.calibrationState.gcps[pointIndex].lng = lng;

        if (banner) banner.style.display = 'none';
        document.getElementById('modal-georef-wizard')?.classList.add('active');
        this._updateGcpTabsUI();
        this.showToast(`🗺️ Coordenada asignada al Punto P${pointIndex + 1} desde el mapa`, 'success');
      };

      this._activeMapPickHandler = onMapClick;
      map.once('click', onMapClick);
    }
  }

  cancelMapPick() {
    const banner = document.getElementById('banner-gcp-map-picker');
    if (banner) banner.style.display = 'none';

    const map = window.mapEngine?.map;
    if (map && this._activeMapPickHandler) {
      map.off('click', this._activeMapPickHandler);
      this._activeMapPickHandler = null;
    }

    document.getElementById('modal-georef-wizard')?.classList.add('active');
    this.showToast('Selección en mapa cancelada', 'info');
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
        const crsName = loadResult.geoMetadata.crsName || 'WGS84 (GPS)';
        statusDetails.innerHTML = `<div style="margin-bottom: 4px;"><b>Sistema de Referencia (CRS):</b> <span style="color:#38bdf8; font-weight:700;">${crsName}</span></div>` +
          `<div><b>Límites geográficos:</b> Lat [${b[0][0].toFixed(6)}, ${b[1][0].toFixed(6)}], Lon [${b[0][1].toFixed(6)}, ${b[1][1].toFixed(6)}]</div>`;

        // Pre-fill BBox inputs as well
        document.getElementById('bbox-north-input').value = b[1][0].toFixed(6);
        document.getElementById('bbox-south-input').value = b[0][0].toFixed(6);
        document.getElementById('bbox-west-input').value = b[0][1].toFixed(6);
        document.getElementById('bbox-east-input').value = b[1][1].toFixed(6);

        this.showToast(`¡GeoPDF detectado con éxito! (${crsName})`, 'success');
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

    try {
      this.showToast('Proyectando plano en el mapa...', 'info');
      const { file, name, renderDim, renderDataUrl, geoMetadata } = this.currentGeoPdfData;

      if (!this.currentProject) {
        await this._loadOrCreateDefaultProject();
      }

      if (geoMetadata && geoMetadata.hasGeoMetadata && typeof geoMetadata.getCanvasGcps === 'function') {
        const gcps = geoMetadata.getCanvasGcps(renderDim.scale || 2.0);
        const georefResult = window.georefEngine.calculateAffineTransformation(gcps, renderDim.width, renderDim.height);

        const planRecord = {
          projectId: this.currentProject ? this.currentProject.id : 'default_project',
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

        if (georefResult.bounds) {
          window.mapEngine?.map?.fitBounds(georefResult.bounds, { padding: [30, 30] });
        }

        this.showToast(`Plano GeoPDF "${name}" proyectado en el mapa con éxito`, 'success');
      } else {
        await this._applyBboxGeoref();
      }
    } catch (err) {
      console.error('Error in _applyAutoGeoPdf:', err);
      this.showToast('Error al proyectar plano: ' + (err.message || err), 'error');
    }
  }

  async _applyBboxGeoref() {
    if (!this.currentGeoPdfData) {
      this.showToast('Por favor seleccione primero un archivo PDF.', 'warning');
      return;
    }

    try {
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

      if (!this.currentProject) {
        await this._loadOrCreateDefaultProject();
      }

      // Build 3 GCPs from BBox
      const gcps = [
        { pdfX: 0, pdfY: 0, lat: north, lng: west }, // Top-Left
        { pdfX: renderDim.width, pdfY: 0, lat: north, lng: east }, // Top-Right
        { pdfX: 0, pdfY: renderDim.height, lat: south, lng: west }  // Bottom-Left
      ];

      const georefResult = window.georefEngine.calculateAffineTransformation(gcps, renderDim.width, renderDim.height);

      const planRecord = {
        projectId: this.currentProject ? this.currentProject.id : 'default_project',
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

      if (georefResult.bounds) {
        window.mapEngine?.map?.fitBounds(georefResult.bounds, { padding: [30, 30] });
      }

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

      this.initPdfViewerGestures();
      setTimeout(() => {
        this.fitPdfToScreen();
      }, 50);

      if (loadResult.geoMetadata && loadResult.geoMetadata.hasGeoMetadata && typeof loadResult.geoMetadata.getCanvasGcps === 'function') {
        const autoGcps = loadResult.geoMetadata.getCanvasGcps(renderDim.scale || 2.0);
        this.calibrationState.gcps = [
          { pdfX: autoGcps[0].pdfX, pdfY: autoGcps[0].pdfY, lat: autoGcps[0].lat, lng: autoGcps[0].lng },
          { pdfX: autoGcps[1].pdfX, pdfY: autoGcps[1].pdfY, lat: autoGcps[1].lat, lng: autoGcps[1].lng },
          { pdfX: autoGcps[2].pdfX, pdfY: autoGcps[2].pdfY, lat: autoGcps[2].lat, lng: autoGcps[2].lng }
        ];

        if (loadResult.geoMetadata.detectedCrs === 'epsg9377') {
          this.selectedWizardCrs = 'epsg9377';
          const sel = document.getElementById('wizard-crs-select');
          if (sel) sel.value = 'epsg9377';
        } else if (loadResult.geoMetadata.detectedCrs === 'epsg3116') {
          this.selectedWizardCrs = 'epsg3116';
          const sel = document.getElementById('wizard-crs-select');
          if (sel) sel.value = 'epsg3116';
        }

        this._renderGcpCanvasMarkers();
        this._updateGcpTabsUI();
        const crsName = loadResult.geoMetadata.crsName || 'WGS84';
        this.showToast(`✨ GeoPDF detectado (${crsName}): Puntos P1, P2 y P3 calibrados automáticamente. Presione "Aplicar al Mapa".`, 'success');
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
    
    // Update pills and badges
    [0, 1, 2].forEach(pIdx => {
      const pill = document.getElementById(`pill-gcp-0`)?.parentElement?.querySelector(`[data-gcp="${pIdx}"]`);
      const badge = document.getElementById(`badge-gcp-${pIdx}`);
      const gcp = this.calibrationState.gcps[pIdx];

      if (pill) {
        pill.classList.toggle('active', pIdx === idx);
        const isComplete = gcp.pdfX !== null && gcp.lat !== null && gcp.lng !== null;
        pill.classList.toggle('completed', isComplete);
      }

      if (badge) {
        if (gcp.pdfX !== null && gcp.lat !== null && gcp.lng !== null) {
          badge.textContent = '✅';
        } else if (gcp.pdfX !== null) {
          badge.textContent = '📍';
        } else if (gcp.lat !== null && gcp.lng !== null) {
          badge.textContent = '🌐';
        } else {
          badge.textContent = '⚠️';
        }
      }
    });

    // Update active point title
    const activeTitle = document.getElementById('gcp-active-title');
    if (activeTitle) {
      activeTitle.textContent = `Punto ${idx + 1} (P${idx + 1})`;
    }

    // Update Next Button Text
    const btnNext = document.getElementById('btn-gcp-next');
    if (btnNext) {
      if (idx < 2) {
        btnNext.innerHTML = `Sig. Punto (P${idx + 2}) ➡️`;
      } else {
        btnNext.innerHTML = `🚀 Aplicar Calibración`;
      }
    }

    this._updateGcpInputsFromState();
  }

  _updateGcpInputsFromState() {
    const idx = this.calibrationState.activeGcpIndex;
    const gcp = this.calibrationState.gcps[idx];

    const latInput = document.getElementById('gcp-lat-input');
    const lngInput = document.getElementById('gcp-lng-input');
    const pixelInfo = document.getElementById('gcp-pixel-info');
    const statusBox = document.getElementById('gcp-coord-status-box');

    if (gcp.lat !== null && gcp.lng !== null) {
      if (this.selectedWizardCrs === 'epsg3116') {
        const pt = window.georefEngine.wgs84ToEpsg3116(gcp.lat, gcp.lng);
        if (latInput && document.activeElement !== latInput) latInput.value = pt.norte.toFixed(2);
        if (lngInput && document.activeElement !== lngInput) lngInput.value = pt.este.toFixed(2);
        if (statusBox) {
          statusBox.innerHTML = `<span style="color: #10b981; font-weight: 700;">✓ N: ${pt.norte.toFixed(2)}m, E: ${pt.este.toFixed(2)}m</span>`;
        }
      } else if (this.selectedWizardCrs === 'epsg9377') {
        const pt = window.georefEngine.wgs84ToEpsg9377(gcp.lat, gcp.lng);
        if (latInput && document.activeElement !== latInput) latInput.value = pt.norte.toFixed(2);
        if (lngInput && document.activeElement !== lngInput) lngInput.value = pt.este.toFixed(2);
        if (statusBox) {
          statusBox.innerHTML = `<span style="color: #10b981; font-weight: 700;">✓ N: ${pt.norte.toFixed(2)}m, E: ${pt.este.toFixed(2)}m</span>`;
        }
      } else {
        if (latInput && document.activeElement !== latInput) latInput.value = gcp.lat.toFixed(6);
        if (lngInput && document.activeElement !== lngInput) lngInput.value = gcp.lng.toFixed(6);
        if (statusBox) {
          statusBox.innerHTML = `<span style="color: #10b981; font-weight: 700;">✓ Lat ${gcp.lat.toFixed(6)}°, Lon ${gcp.lng.toFixed(6)}°</span>`;
        }
      }
    } else {
      if (latInput && document.activeElement !== latInput) latInput.value = '';
      if (lngInput && document.activeElement !== lngInput) lngInput.value = '';
      if (statusBox) {
        statusBox.innerHTML = `<span style="color: #f59e0b;">⚠️ Ingrese las coordenadas reales de P${idx + 1}</span>`;
      }
    }

    if (pixelInfo) {
      pixelInfo.textContent = gcp.pdfX !== null 
        ? `Pixel: (${gcp.pdfX.toFixed(0)}, ${gcp.pdfY.toFixed(0)})` 
        : 'Toque en el plano para definir pixel';
      pixelInfo.style.color = gcp.pdfX !== null ? '#10b981' : '#94a3b8';
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
      if (!this.currentProject) {
        await this._loadOrCreateDefaultProject();
      }

      const { width, height } = this.calibrationState.pdfDimensions;
      const georefResult = window.georefEngine.calculateAffineTransformation(gcps, width, height);

      // Render Canvas to DataURL
      const renderDataUrl = window.pdfLoader.getRenderDataUrl();

      const planRecord = {
        projectId: this.currentProject ? this.currentProject.id : 'default_project',
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

      if (georefResult.bounds) {
        window.mapEngine?.map?.fitBounds(georefResult.bounds, { padding: [30, 30] });
      }

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

      // Initialize or hide point symbology section based on whether KML contains points
      const symbologyCard = document.getElementById('kml-import-symbology-card');
      if (symbologyCard) {
        if (result.stats.points > 0) {
          symbologyCard.style.display = 'block';
          this._initKmlSymbologyControls(result.stats.points);
        } else {
          symbologyCard.style.display = 'none';
        }
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
      let pointsCount = 0;
      const allBounds = [];

      for (const feat of feats) {
        feat.projectId = this.currentProject.id;
        feat.properties = feat.properties || {};

        if (feat.type === 'Point') {
          pointsCount++;
          // Apply chosen point symbology, color, and size
          if (this.kmlImportSymbology) {
            feat.properties.symbol = this.kmlImportSymbology.shape || 'circle';
            feat.properties.symbolSize = this.kmlImportSymbology.size || 'md';
            if (!this.kmlImportSymbology.useOriginalColors || !feat.properties.color) {
              feat.properties.color = this.kmlImportSymbology.color || '#06b6d4';
            }
          }
          allBounds.push(feat.coordinates);
        } else if (Array.isArray(feat.coordinates[0])) {
          feat.coordinates.forEach(c => allBounds.push(c));
        }

        await window.db.saveFeature(feat);
        count++;
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

      const pointDetail = pointsCount > 0 ? ` (${pointsCount} puntos con simbología personalizada)` : '';
      this.showToast(`✅ Se importaron ${count} elementos con éxito al proyecto actual${pointDetail}.`, 'success', 5000);
    } catch (err) {
      console.error('Error saving imported features:', err);
      this.showToast('Error guardando entidades KML: ' + err.message, 'error');
    }
  }

  _initKmlSymbologyControls(pointsCount) {
    if (!window.pointSymbology) return;

    // Default configuration for KML points
    this.kmlImportSymbology = {
      shape: 'circle',
      color: '#06b6d4',
      size: 'md',
      useOriginalColors: false
    };

    // Update badge
    const badge = document.getElementById('kml-symbology-points-badge');
    if (badge) {
      badge.textContent = `${pointsCount} ${pointsCount === 1 ? 'punto' : 'puntos'}`;
    }

    // Render Shapes Grid
    const shapesGrid = document.getElementById('kml-shapes-grid');
    if (shapesGrid) {
      const symbols = window.pointSymbology.POINT_SYMBOLS;
      shapesGrid.innerHTML = Object.keys(symbols).map(key => {
        const s = symbols[key];
        const isActive = key === this.kmlImportSymbology.shape;
        const svgIcon = window.pointSymbology.renderSvg(key, '#38bdf8', 18);
        return `
          <button type="button" class="symbology-shape-btn ${isActive ? 'active' : ''}" data-symbol="${key}" title="${s.description}">
            <div class="symbology-shape-icon">${svgIcon}</div>
            <span class="symbology-shape-label">${s.name}</span>
          </button>
        `;
      }).join('');

      // Bind shape button clicks
      shapesGrid.querySelectorAll('.symbology-shape-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const chosenShape = btn.getAttribute('data-symbol');
          this.kmlImportSymbology.shape = chosenShape;
          shapesGrid.querySelectorAll('.symbology-shape-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._updateKmlSymbologyLivePreview();
        });
      });
    }

    // Color Swatches Palette
    const colorContainer = document.getElementById('kml-color-picker-container');
    if (colorContainer) {
      const palette = [
        '#ef4444', // Rojo
        '#f97316', // Naranja
        '#eab308', // Amarillo
        '#10b981', // Verde Esmeralda
        '#06b6d4', // Cian Geowill
        '#3b82f6', // Azul Eléctrico
        '#8b5cf6', // Violeta
        '#ec4899', // Rosa Magenta
        '#ffffff', // Blanco
        '#1e293b'  // Negro Carbón
      ];

      colorContainer.innerHTML = palette.map(hex => `
        <div class="symbology-color-chip ${hex === this.kmlImportSymbology.color ? 'active' : ''}" data-color="${hex}" style="background-color: ${hex};" title="Color ${hex}"></div>
      `).join('') + `
        <label class="symbology-custom-color-btn" title="Selector de color personalizado">
          <input type="color" id="kml-custom-color-input" value="${this.kmlImportSymbology.color}">
          <span>Libre</span>
        </label>
      `;

      // Bind color swatch clicks
      colorContainer.querySelectorAll('.symbology-color-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          const chosenColor = chip.getAttribute('data-color');
          this.kmlImportSymbology.color = chosenColor;
          colorContainer.querySelectorAll('.symbology-color-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          const customInp = document.getElementById('kml-custom-color-input');
          if (customInp) customInp.value = chosenColor;
          this._updateKmlSymbologyLivePreview();
        });
      });

      // Bind custom color input
      const customInp = document.getElementById('kml-custom-color-input');
      if (customInp) {
        customInp.addEventListener('input', (e) => {
          const chosenColor = e.target.value;
          this.kmlImportSymbology.color = chosenColor;
          colorContainer.querySelectorAll('.symbology-color-chip').forEach(c => c.classList.remove('active'));
          this._updateKmlSymbologyLivePreview();
        });
      }
    }

    // Bind Color Mode Toggle
    const btnModeCustom = document.getElementById('kml-color-mode-custom');
    const btnModeOriginal = document.getElementById('kml-color-mode-original');
    const colorPickerContainer = document.getElementById('kml-color-picker-container');
    const originalNotice = document.getElementById('kml-color-original-notice');

    const updateColorMode = (useOriginal) => {
      this.kmlImportSymbology.useOriginalColors = useOriginal;
      if (useOriginal) {
        btnModeOriginal?.classList.add('active');
        btnModeCustom?.classList.remove('active');
        if (originalNotice) originalNotice.style.display = 'block';
        if (colorPickerContainer) colorPickerContainer.style.opacity = '0.4';
      } else {
        btnModeCustom?.classList.add('active');
        btnModeOriginal?.classList.remove('active');
        if (originalNotice) originalNotice.style.display = 'none';
        if (colorPickerContainer) colorPickerContainer.style.opacity = '1';
      }
      this._updateKmlSymbologyLivePreview();
    };

    if (btnModeCustom && btnModeOriginal) {
      const newCustom = btnModeCustom.cloneNode(true);
      const newOriginal = btnModeOriginal.cloneNode(true);
      btnModeCustom.parentNode.replaceChild(newCustom, btnModeCustom);
      btnModeOriginal.parentNode.replaceChild(newOriginal, btnModeOriginal);

      newCustom.addEventListener('click', () => updateColorMode(false));
      newOriginal.addEventListener('click', () => updateColorMode(true));
    }

    // Bind Size Pills
    const sizeContainer = document.getElementById('kml-size-segmented');
    if (sizeContainer) {
      const newSizeContainer = sizeContainer.cloneNode(true);
      sizeContainer.parentNode.replaceChild(newSizeContainer, sizeContainer);

      newSizeContainer.querySelectorAll('.symbology-size-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const chosenSize = pill.getAttribute('data-size');
          this.kmlImportSymbology.size = chosenSize;
          newSizeContainer.querySelectorAll('.symbology-size-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          this._updateKmlSymbologyLivePreview();
        });
      });
    }

    this._updateKmlSymbologyLivePreview();
  }

  _updateKmlSymbologyLivePreview() {
    if (!this.kmlImportSymbology || !window.pointSymbology) return;

    const { shape, color, size, useOriginalColors } = this.kmlImportSymbology;
    const symDef = window.pointSymbology.POINT_SYMBOLS[shape] || window.pointSymbology.POINT_SYMBOLS.circle;
    const sizeDef = window.pointSymbology.POINT_SIZES[size] || window.pointSymbology.POINT_SIZES.md;

    // Render Preview Icon (slightly enlarged for clarity in preview card)
    const previewWrapper = document.getElementById('kml-symbology-preview-wrapper');
    if (previewWrapper) {
      previewWrapper.innerHTML = window.pointSymbology.renderSvg(shape, color, sizeDef.px + 4);
    }

    // Render Name
    const nameElem = document.getElementById('kml-symbology-preview-name');
    if (nameElem) {
      nameElem.innerHTML = `${symDef.icon} ${symDef.name}`;
    }

    // Render Color info
    const dotElem = document.getElementById('kml-symbology-preview-color-dot');
    const hexElem = document.getElementById('kml-symbology-preview-color-hex');
    if (dotElem) dotElem.style.backgroundColor = color;
    if (hexElem) {
      hexElem.textContent = useOriginalColors ? 'Color del KML' : color.toUpperCase();
    }

    // Render Size info
    const sizeElem = document.getElementById('kml-symbology-preview-size-text');
    if (sizeElem) {
      sizeElem.textContent = `${sizeDef.label} (${sizeDef.px}px)`;
    }
  }

  /**
   * Automatically imports an external KML string received from WhatsApp / Android Intent
   */
  async importExternalKmlText(kmlText, sourceName = 'KML Externo') {
    if (!kmlText || typeof kmlText !== 'string') return;
    try {
      this.showToast(`📥 Procesando KML recibido: ${sourceName}...`, 'info');

      if (!this.currentProject) {
        await this._loadOrCreateDefaultProject();
      }

      const result = window.kmlImporter.parseKmlString(kmlText, this.currentProject.id, sourceName);
      if (!result.features || result.features.length === 0) {
        this.showToast('El archivo KML recibido no contiene geometrías válidas.', 'warning');
        return;
      }

      let count = 0;
      const allBounds = [];

      for (const feat of result.features) {
        feat.projectId = this.currentProject.id;
        await window.db.saveFeature(feat);
        count++;

        if (feat.type === 'Point' && Array.isArray(feat.coordinates)) {
          allBounds.push(feat.coordinates);
        } else if (Array.isArray(feat.coordinates) && Array.isArray(feat.coordinates[0])) {
          feat.coordinates.forEach(c => {
            if (Array.isArray(c)) allBounds.push(c);
          });
        }
      }

      await window.vectorEditor.loadProjectFeatures();

      if (allBounds.length > 0 && window.mapEngine && window.mapEngine.map) {
        try {
          window.mapEngine.map.fitBounds(L.latLngBounds(allBounds), { padding: [40, 40], maxZoom: 18 });
        } catch (e) {}
      }

      this.showToast(`✅ Se importaron ${count} entidades de "${sourceName}" en ${this.currentProject.name}`, 'success', 6000);
    } catch (err) {
      console.error('Error importing external KML:', err);
      this.showToast('Error al importar KML: ' + err.message, 'error');
    }
  }

  async shareKmlWhatsApp() {
    this.closeExportKmlModal();
    if (!this.currentProject) {
      this.showToast('Seleccione un proyecto primero', 'warning');
      return;
    }
    this.showToast('Preparando archivo KML optimizado...', 'info');

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
      this.showToast('Levantamiento KML listo para enviar / abrir', 'success');
    }
  }

  async downloadKmlDirect() {
    this.closeExportKmlModal();
    if (!this.currentProject) {
      this.showToast('Seleccione un proyecto primero', 'warning');
      return;
    }
    this.showToast('Descargando archivo KML optimizado...', 'info');

    const features = await window.db.getFeaturesByProject(this.currentProject.id);
    if (features.length === 0 && !this.currentPdfPlan) {
      this.showToast('No hay entidades digitalizadas ni plano para exportar.', 'warning');
      return;
    }

    const res = await window.kmlExporter.downloadDirect(
      this.currentProject.name,
      features,
      this.currentPdfPlan
    );

    if (res.success) {
      this.showToast(`Archivo "${res.fileName}" descargado con éxito`, 'success');
    }
  }

  /* ==========================================================================
     Point Search & Stakeout Navigation (Replanteo)
     ========================================================================== */
  openPointSearchModal(tab = 'list') {
    const modal = document.getElementById('modal-point-search');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('active');
    this.currentSearchFilter = 'all';
    const input = document.getElementById('point-search-input');
    if (input) input.value = '';
    this.switchPointSearchTab(tab);
  }

  closePointSearchModal() {
    const modal = document.getElementById('modal-point-search');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
  }

  switchPointSearchTab(tab = 'list') {
    const btnList = document.getElementById('tab-nav-mode-list');
    const btnCoords = document.getElementById('tab-nav-mode-coords');
    const panelList = document.getElementById('panel-search-list-mode');
    const panelCoords = document.getElementById('panel-search-coords-mode');

    if (tab === 'list') {
      if (btnList) {
        btnList.style.background = 'rgba(56, 189, 248, 0.2)';
        btnList.style.color = '#38bdf8';
        btnList.style.borderColor = '#38bdf8';
      }
      if (btnCoords) {
        btnCoords.style.background = 'transparent';
        btnCoords.style.color = '#94a3b8';
        btnCoords.style.borderColor = 'rgba(255,255,255,0.1)';
      }
      if (panelList) panelList.style.display = 'flex';
      if (panelCoords) panelCoords.style.display = 'none';
      this.renderPointSearchList();
    } else {
      if (btnCoords) {
        btnCoords.style.background = 'rgba(56, 189, 248, 0.2)';
        btnCoords.style.color = '#38bdf8';
        btnCoords.style.borderColor = '#38bdf8';
      }
      if (btnList) {
        btnList.style.background = 'transparent';
        btnList.style.color = '#94a3b8';
        btnList.style.borderColor = 'rgba(255,255,255,0.1)';
      }
      if (panelList) panelList.style.display = 'none';
      if (panelCoords) panelCoords.style.display = 'block';
      this._updateNavCoordInputsUI();
    }
  }

  _updateNavCoordInputsUI() {
    const crs = document.getElementById('nav-coord-crs-select')?.value || 'wgs84';
    const lbl1 = document.getElementById('lbl-nav-coord-c1');
    const lbl2 = document.getElementById('lbl-nav-coord-c2');
    const inp1 = document.getElementById('nav-coord-c1-input');
    const inp2 = document.getElementById('nav-coord-c2-input');

    if (crs === 'epsg9377') {
      if (lbl1) lbl1.textContent = 'Norte (Y) en metros:';
      if (lbl2) lbl2.textContent = 'Este (X) en metros:';
      if (inp1) inp1.placeholder = 'ej. 2000000.00';
      if (inp2) inp2.placeholder = 'ej. 5000000.00';
    } else if (crs === 'epsg3116') {
      if (lbl1) lbl1.textContent = 'Norte (Y) en metros:';
      if (lbl2) lbl2.textContent = 'Este (X) en metros:';
      if (inp1) inp1.placeholder = 'ej. 1000000.00';
      if (inp2) inp2.placeholder = 'ej. 1000000.00';
    } else {
      if (lbl1) lbl1.textContent = 'Latitud (Y):';
      if (lbl2) lbl2.textContent = 'Longitud (X):';
      if (inp1) inp1.placeholder = 'ej. 4.609712 ó 4°36\'35"N';
      if (inp2) inp2.placeholder = 'ej. -74.081734 ó 74°04\'54"W';
    }

    this._calculateNavCoordPreview();
  }

  _getParsedNavCoordTarget() {
    const crs = document.getElementById('nav-coord-crs-select')?.value || 'wgs84';
    const c1 = document.getElementById('nav-coord-c1-input')?.value?.trim();
    const c2 = document.getElementById('nav-coord-c2-input')?.value?.trim();

    if (!c1 || !c2) return null;

    const parsed = window.georefEngine.parseCoordinateInput(c1, c2, crs);
    if (!parsed || isNaN(parsed.lat) || isNaN(parsed.lng)) return null;

    return parsed;
  }

  _calculateNavCoordPreview() {
    const previewBox = document.getElementById('nav-coord-preview-box');
    const distElem = document.getElementById('nav-coord-preview-dist');
    const bearingElem = document.getElementById('nav-coord-preview-bearing');

    const target = this._getParsedNavCoordTarget();
    const userPos = window.gpsTracker?.currentPosition;

    if (!target) {
      if (previewBox) previewBox.style.display = 'none';
      return;
    }

    if (userPos && userPos.lat) {
      const dist = window.navStakeout.getDistance(userPos.lat, userPos.lng, target.lat, target.lng);
      const bearing = window.navStakeout.getBearing(userPos.lat, userPos.lng, target.lat, target.lng);
      const cardinal = window.navStakeout.getCardinal(bearing);

      if (distElem) distElem.textContent = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${dist.toFixed(1)} m`;
      if (bearingElem) bearingElem.textContent = `${bearing.toFixed(0).padStart(3, '0')}° (${cardinal})`;
      if (previewBox) previewBox.style.display = 'block';
    } else {
      if (distElem) distElem.textContent = 'Esperando GPS...';
      if (bearingElem) bearingElem.textContent = `Lat: ${target.lat.toFixed(5)}, Lng: ${target.lng.toFixed(5)}`;
      if (previewBox) previewBox.style.display = 'block';
    }
  }

  async startNavigationFromCoordinates() {
    const target = this._getParsedNavCoordTarget();
    if (!target) {
      this.showToast('Por favor ingresa coordenadas válidas en los campos.', 'warning');
      return;
    }

    const name = document.getElementById('nav-coord-name-input')?.value?.trim() || `Coord: ${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`;
    const category = document.getElementById('nav-coord-category-input')?.value || 'Vértice Topográfico';

    const tempFeature = {
      id: 'coord_' + Date.now(),
      projectId: this.currentProject.id,
      type: 'Point',
      coordinates: [target.lat, target.lng],
      properties: {
        name: name,
        category: category,
        color: '#10b981',
        description: `Búsqueda por coordenadas directas (${target.lat.toFixed(7)}, ${target.lng.toFixed(7)})`
      }
    };

    this.closePointSearchModal();
    window.navStakeout.start(tempFeature);
    this.showToast(`🎯 Guiando hacia: "${name}"`, 'success');
  }

  async saveAndNavigateCoordinates() {
    const target = this._getParsedNavCoordTarget();
    if (!target) {
      this.showToast('Por favor ingresa coordenadas válidas en los campos.', 'warning');
      return;
    }

    const name = document.getElementById('nav-coord-name-input')?.value?.trim() || `Punto ${new Date().toLocaleTimeString()}`;
    const category = document.getElementById('nav-coord-category-input')?.value || 'Vértice Topográfico';

    const feature = {
      projectId: this.currentProject.id,
      type: 'Point',
      coordinates: [target.lat, target.lng],
      properties: {
        name: name,
        category: category,
        color: '#06b6d4',
        description: `Creado desde ingreso de coordenadas directas (${target.lat.toFixed(7)}, ${target.lng.toFixed(7)})`,
        photos: []
      }
    };

    const saved = await window.db.saveFeature(feature);
    await window.vectorEditor.loadProjectFeatures(this.currentProject.id);

    this.closePointSearchModal();
    window.navStakeout.start(saved);
    this.showToast(`💾 Punto "${name}" guardado en el proyecto e iniciando guía`, 'success');
  }

  viewCoordinatesOnMap() {
    const target = this._getParsedNavCoordTarget();
    if (!target) {
      this.showToast('Por favor ingresa coordenadas válidas en los campos.', 'warning');
      return;
    }

    this.closePointSearchModal();
    if (window.mapEngine.map) {
      window.mapEngine.map.setView([target.lat, target.lng], 19);
      L.popup()
        .setLatLng([target.lat, target.lng])
        .setContent(`
          <div style="font-family: sans-serif; text-align: center; padding: 4px; min-width: 180px;">
            <b style="color: #38bdf8;">📍 Coordenada Ubicada</b>
            <div style="font-size: 11px; margin-top: 4px; color: #f8fafc; font-family: monospace;">${target.lat.toFixed(6)}, ${target.lng.toFixed(6)}</div>
            <button class="btn btn-sm btn-primary" style="margin-top: 8px; width: 100%; font-weight: 700;" onclick="window.app.startNavigationToFeature({ coordinates: [${target.lat}, ${target.lng}], properties: { name: 'Punto Ubicado' } })">
              🎯 Iniciar Replanteo
            </button>
          </div>
        `)
        .openOn(window.mapEngine.map);
    }
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
          <button class="btn btn-sm" style="flex: 1.4; background: #10b981; color: #ffffff; font-weight: 700; border: none; border-radius: 6px; padding: 6px 8px; display: flex; align-items: center; justify-content: center; gap: 4px;" onclick="window.app.startNavigationToFeature('${f.id}')">
            <span>🎯</span> <span>Guiar</span>
          </button>
          <button class="btn btn-sm btn-secondary" style="flex: 1; border-radius: 6px; padding: 6px 8px;" onclick="window.app.centerOnFeatureAndCloseModal('${f.id}')">
            <span>👁️</span> <span>Ver</span>
          </button>
          <button class="btn btn-sm" style="flex: 1; background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid #fbbf24; border-radius: 6px; padding: 6px 8px;" onclick="window.app.showFeatureInfoAndCloseSearch('${f.id}')">
            <span>ℹ️</span> <span>Info</span>
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

  async showFeatureInfoAndCloseSearch(featureId) {
    this.closePointSearchModal();
    this.showFeatureInfo(featureId);
  }

  /* ==========================================================================
     Projects Modal
     ========================================================================== */
  async openProjectsModal() {
    const listElem = document.getElementById('projects-list-container');
    if (!listElem) return;
    listElem.innerHTML = '';

    const projects = await window.db.getAllProjects();
    if (!projects || projects.length === 0) {
      listElem.innerHTML = `
        <div style="text-align: center; padding: 24px 12px; color: #94a3b8; font-size: 13px;">
          <div style="font-size: 32px; margin-bottom: 8px;">📂</div>
          No hay proyectos creados.<br>Pulsa <b>➕ Nuevo Proyecto</b> para comenzar.
        </div>
      `;
      document.getElementById('modal-projects-backdrop')?.classList.add('active');
      return;
    }

    for (const p of projects) {
      const isActive = this.currentProject && this.currentProject.id === p.id;
      
      let featCount = 0;
      try {
        const feats = await window.db.getFeaturesByProject(p.id);
        featCount = feats ? feats.length : 0;
      } catch (e) {
        console.warn('Error al obtener entidades del proyecto:', e);
      }

      const card = document.createElement('div');
      card.className = `project-item-card ${isActive ? 'active' : ''}`;
      
      const safeName = this._escapeHtml(p.name || 'Sin título');
      const dateFormatted = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'Reciente');

      card.innerHTML = `
        <div class="project-card-info" onclick="window.app.switchProject('${p.id}')">
          <div class="project-card-name">
            <span style="font-size: 15px;">${isActive ? '📂' : '📁'}</span>
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${safeName}</span>
          </div>
          <div class="project-card-meta">
            <span>📅 ${dateFormatted}</span>
            <span>•</span>
            <span style="color: ${featCount > 0 ? '#38bdf8' : '#64748b'};">📍 ${featCount} punto${featCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div class="project-card-actions">
          ${isActive 
            ? `<span style="color: #10b981; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px;">✓ Activo</span>` 
            : `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); window.app.switchProject('${p.id}')" style="padding: 5px 11px; font-size: 11px; font-weight: 600;">Abrir</button>`
          }
          <button class="btn btn-sm btn-delete-project" onclick="event.stopPropagation(); window.app.deleteProjectPrompt('${p.id}')" title="Eliminar proyecto" aria-label="Eliminar proyecto">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      `;
      listElem.appendChild(card);
    }

    document.getElementById('modal-projects-backdrop')?.classList.add('active');
  }

  async switchProject(projectId) {
    if (this.currentProject && this.currentProject.id === projectId) {
      document.getElementById('modal-projects-backdrop')?.classList.remove('active');
      return;
    }
    const p = await window.db.getProject(projectId);
    if (p) {
      if (window.vectorEditor) window.vectorEditor.cancelDrawing();
      if (typeof this.stopNavigation === 'function') this.stopNavigation();
      await this.setActiveProject(p);
      document.getElementById('modal-projects-backdrop')?.classList.remove('active');
      this.showToast(`Proyecto "${p.name}" activado`, 'success');
    }
  }

  async deleteProjectPrompt(projectId) {
    const p = await window.db.getProject(projectId);
    if (!p) {
      this.showToast('Proyecto no encontrado', 'error');
      return;
    }

    const allProjects = await window.db.getAllProjects();
    const isOnly = allProjects.length <= 1;
    const isActive = this.currentProject && this.currentProject.id === projectId;

    let confirmMsg = `¿Está seguro de que desea eliminar el proyecto "${p.name}"?\n\nEsta acción borrará de forma permanente:\n- Todos los puntos, líneas y polígonos del proyecto\n- Los planos PDF y calibraciones asociadas`;
    
    if (isOnly) {
      confirmMsg += `\n\n⚠️ Este es tu único proyecto. Al eliminarlo, se creará automáticamente un nuevo proyecto en blanco.`;
    } else if (isActive) {
      confirmMsg += `\n\n⚠️ Este proyecto está activo actualmente. Al eliminarlo, el sistema abrirá automáticamente otro proyecto disponible.`;
    }

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      if (isActive) {
        if (window.vectorEditor) window.vectorEditor.cancelDrawing();
        if (typeof this.stopNavigation === 'function') this.stopNavigation();
      }

      await window.db.deleteProject(projectId);

      if (isActive) {
        const remaining = await window.db.getAllProjects();
        if (remaining.length > 0) {
          await this.setActiveProject(remaining[0]);
        } else {
          const defaultProj = await window.db.saveProject({
            name: 'Levantamiento Predial',
            description: 'Proyecto de campo y georreferenciación'
          });
          await this.setActiveProject(defaultProj);
        }
      }

      this.showToast(`Proyecto "${p.name}" eliminado`, 'success');
      await this.openProjectsModal();
    } catch (err) {
      console.error('Error al eliminar proyecto:', err);
      this.showToast('Error al eliminar el proyecto', 'error');
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

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
        reg.update();
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
