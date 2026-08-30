/**
 * GeoPlan Android GIS - Mobile GPS & Sensor Tracker
 * High-precision GPS positioning, compass orientation, accuracy buffer, and auto-follow.
 */

class GpsTracker {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.heading = 0;
    this.isFollowing = false;
    this.isTracking = false;
    
    // Map overlay elements
    this.marker = null;
    this.accuracyCircle = null;
    this.headingArrow = null;
    this.trailLine = null;
    this.trailPoints = [];

    // Tracklog recording state
    this.isRecordingTrack = false;
    this.isRecordingPaused = false;
    this.trackPoints = [];
    this.trackPolyline = null;
    this.trackDistanceMeters = 0;
    this.trackStartTime = null;
    this.trackPausedDurationSec = 0;
    this.trackLastPauseTime = 0;
    this.trackTimerId = null;
    this.screenWakeLock = null;

    // GPS Filters (Anti-Drift & Noise Rejection)
    this.minDistanceFilter = 5.0; // 5 meters minimum step
    this.maxAccuracyFilter = 15.0; // 15 meters maximum accuracy threshold

    // Callbacks
    this.onPositionUpdate = null;
    this.onStatusChange = null;
    this.onTrackUpdate = null;
    this.onHeadingUpdate = null;

    this._initCompass();
  }

  /**
   * Starts recording the GPS path/route (Tracklog) with Background Screen-Lock Support
   */
  startTrackRecording() {
    this.isRecordingTrack = true;
    this.isRecordingPaused = false;
    this.trackPoints = [];
    this.trackDistanceMeters = 0;
    this.trackStartTime = Date.now();
    this.trackPausedDurationSec = 0;
    this.trackLastPauseTime = 0;

    if (this.trackPolyline && this.map) {
      this.map.removeLayer(this.trackPolyline);
    }

    this.trackPolyline = L.polyline([], {
      pane: 'vectorPane',
      color: '#f43f5e',
      weight: 5,
      opacity: 0.95,
      lineJoin: 'round'
    }).addTo(this.map);

    // 1. Trigger Native Android Background Service (Keeps recording when screen is locked)
    if (window.AndroidNative && typeof window.AndroidNative.startBackgroundTracking === 'function') {
      window.AndroidNative.startBackgroundTracking();
    }

    // 2. Request Web Screen WakeLock if available
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(lock => {
        this.screenWakeLock = lock;
      }).catch(err => console.log('Screen WakeLock error:', err));
    }

    // If current position exists, record first point
    if (this.currentPosition) {
      this._recordTrackPoint(this.currentPosition);
    }

    // Interval to update duration timer
    if (this.trackTimerId) clearInterval(this.trackTimerId);
    this.trackTimerId = setInterval(() => {
      if (this.isRecordingTrack && !this.isRecordingPaused && this.onTrackUpdate) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - this.trackStartTime) / 1000) - this.trackPausedDurationSec);
        this.onTrackUpdate({
          isRecording: true,
          isPaused: false,
          pointsCount: this.trackPoints.length,
          distanceMeters: this.trackDistanceMeters,
          durationSec: elapsedSec,
          currentSpeed: this.currentPosition?.speed || '0.0'
        });
      }
    }, 1000);

    return true;
  }

  /**
   * Pauses the current track recording
   */
  pauseTrackRecording() {
    if (!this.isRecordingTrack || this.isRecordingPaused) return false;
    this.isRecordingPaused = true;
    this.trackLastPauseTime = Date.now();

    if (window.AndroidNative && typeof window.AndroidNative.pauseBackgroundTracking === 'function') {
      window.AndroidNative.pauseBackgroundTracking();
    }

    if (this.onTrackUpdate) {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - this.trackStartTime) / 1000) - this.trackPausedDurationSec);
      this.onTrackUpdate({
        isRecording: true,
        isPaused: true,
        pointsCount: this.trackPoints.length,
        distanceMeters: this.trackDistanceMeters,
        durationSec: elapsedSec,
        currentSpeed: '0.0'
      });
    }

    return true;
  }

  /**
   * Resumes the paused track recording
   */
  resumeTrackRecording() {
    if (!this.isRecordingTrack || !this.isRecordingPaused) return false;
    this.isRecordingPaused = false;
    if (this.trackLastPauseTime > 0) {
      this.trackPausedDurationSec += Math.floor((Date.now() - this.trackLastPauseTime) / 1000);
      this.trackLastPauseTime = 0;
    }

    if (window.AndroidNative && typeof window.AndroidNative.resumeBackgroundTracking === 'function') {
      window.AndroidNative.resumeBackgroundTracking();
    }

    if (this.onTrackUpdate) {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - this.trackStartTime) / 1000) - this.trackPausedDurationSec);
      this.onTrackUpdate({
        isRecording: true,
        isPaused: false,
        pointsCount: this.trackPoints.length,
        distanceMeters: this.trackDistanceMeters,
        durationSec: elapsedSec,
        currentSpeed: this.currentPosition?.speed || '0.0'
      });
    }

    return true;
  }

  /**
   * Stops recording the track and returns the recorded route
   */
  stopTrackRecording() {
    this.isRecordingTrack = false;
    if (this.trackTimerId) {
      clearInterval(this.trackTimerId);
      this.trackTimerId = null;
    }

    if (this.isRecordingPaused && this.trackLastPauseTime > 0) {
      this.trackPausedDurationSec += Math.floor((Date.now() - this.trackLastPauseTime) / 1000);
      this.trackLastPauseTime = 0;
    }
    this.isRecordingPaused = false;

    // 1. Stop Native Android Background Service
    if (window.AndroidNative && typeof window.AndroidNative.stopBackgroundTracking === 'function') {
      window.AndroidNative.stopBackgroundTracking();
      // Sync any final buffered points captured in background
      this.syncBufferedNativePoints();
    }

    // 2. Release Screen WakeLock
    if (this.screenWakeLock) {
      this.screenWakeLock.release().catch(() => {});
      this.screenWakeLock = null;
    }

    const durationSec = Math.max(0, Math.floor((Date.now() - (this.trackStartTime || Date.now())) / 1000) - this.trackPausedDurationSec);
    const result = {
      startTime: this.trackStartTime,
      endTime: Date.now(),
      durationSec: durationSec,
      distanceMeters: this.trackDistanceMeters,
      points: [...this.trackPoints],
      coordinates: this.trackPoints.map(p => [p.lat, p.lng])
    };

    if (this.onTrackUpdate) {
      this.onTrackUpdate({
        isRecording: false,
        isPaused: false,
        pointsCount: this.trackPoints.length,
        distanceMeters: this.trackDistanceMeters,
        durationSec: durationSec,
        currentSpeed: '0.0'
      });
    }

    return result;
  }

  /**
   * Called by Native Android Java when a GPS point is fixed in foreground or background
   */
  onBackgroundGpsFix(pos) {
    if (!pos) return;
    this.currentPosition = {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy || 0,
      altitude: pos.altitude || 0,
      speed: pos.speed || '0.0',
      heading: this.heading,
      timestamp: pos.timestamp || Date.now()
    };

    if (this.onStatusChange) this.onStatusChange('active', 'GPS Conectado (Fondo)');
    if (this.onPositionUpdate) this.onPositionUpdate(this.currentPosition);

    this._updateMapDisplay(pos.lat, pos.lng, pos.accuracy || 10);

    if (this.isRecordingTrack) {
      this._recordTrackPoint(this.currentPosition);
    }
  }

  /**
   * Synchronizes any points recorded by Android Background Service while screen was locked
   */
  syncBufferedNativePoints() {
    if (!window.AndroidNative || typeof window.AndroidNative.getBufferedTrackPoints !== 'function') return;

    try {
      const jsonStr = window.AndroidNative.getBufferedTrackPoints();
      if (!jsonStr || jsonStr === '[]') return;

      const pts = JSON.parse(jsonStr);
      if (!Array.isArray(pts) || pts.length === 0) return;

      pts.forEach(pt => {
        // Check if already in trackPoints
        const exists = this.trackPoints.some(p => Math.abs(p.lat - pt.lat) < 1e-7 && Math.abs(p.lng - pt.lng) < 1e-7);
        if (!exists) {
          this._recordTrackPoint(pt);
        }
      });
    } catch (e) {
      console.warn('Error syncing native buffered track points:', e);
    }
  }

  _recordTrackPoint(pos) {
    if (!this.isRecordingTrack || this.isRecordingPaused) return;

    // 1. Accuracy Filter: discard low-precision multipath jitter (accuracy > 15m)
    if (pos.accuracy && pos.accuracy > this.maxAccuracyFilter) {
      return;
    }

    const newPt = {
      lat: pos.lat,
      lng: pos.lng,
      altitude: pos.altitude || 0,
      speed: pos.speed || 0,
      accuracy: pos.accuracy || 0,
      timestamp: pos.timestamp || Date.now()
    };

    if (this.trackPoints.length > 0) {
      const lastPt = this.trackPoints[this.trackPoints.length - 1];
      const d = this._haversineDistance(lastPt.lat, lastPt.lng, newPt.lat, newPt.lng);
      
      // 2. Minimum Movement Filter (Default 5.0 meters):
      // Only record a new point once user has actually moved at least minDistanceFilter
      if (d < this.minDistanceFilter) return;

      // 3. Glitch / Outlier Filter: discard impossible satellite jumps (> 40m in < 3s)
      const timeDeltaSec = Math.max(1, ((newPt.timestamp - (lastPt.timestamp || newPt.timestamp)) / 1000));
      const apparentSpeedKmh = (d / timeDeltaSec) * 3.6;
      if (d > 40 && apparentSpeedKmh > 120) {
        return; // Glitch outlier jump discarded
      }

      this.trackDistanceMeters += d;
    }

    this.trackPoints.push(newPt);

    if (this.trackPolyline) {
      this.trackPolyline.addLatLng([newPt.lat, newPt.lng]);
    }

    if (this.onTrackUpdate) {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - this.trackStartTime) / 1000) - this.trackPausedDurationSec);
      this.onTrackUpdate({
        isRecording: true,
        isPaused: false,
        pointsCount: this.trackPoints.length,
        distanceMeters: this.trackDistanceMeters,
        durationSec: elapsedSec,
        currentSpeed: pos.speed || '0.0'
      });
    }
  }

  _haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
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
   * Initializes device orientation sensor for digital compass heading
   */
  _initCompass() {
    const handleOrientation = (e) => {
      let heading = null;
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        // iOS Safari: 0° is North, rotates clockwise (0 to 360)
        heading = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        // Android Chrome / Standard DeviceOrientation
        // In Android, alpha is 0 at North and increases counter-clockwise
        heading = (360 - e.alpha) % 360;
      }

      if (heading !== null && !isNaN(heading)) {
        // Check if user has toggled 180° compass calibration
        const isCalibrated180 = localStorage.getItem('geowill_compass_invert') === 'true';
        let finalHeading = (heading + (isCalibrated180 ? 180 : 0) + 360) % 360;

        // If not moving fast, use magnetic compass heading
        if (!this.currentPosition || parseFloat(this.currentPosition.speed || '0') < 1.8) {
          this.heading = finalHeading;
          this._updateHeadingIndicator(this.heading);
          if (this.onHeadingUpdate) {
            this.onHeadingUpdate(this.heading);
          }
        }
      }
    };

    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
  }

  /**
   * Starts real-time high-accuracy GPS tracking
   */
  start(map) {
    this.map = map;
    if (!navigator.geolocation) {
      if (this.onStatusChange) this.onStatusChange('error', 'Geolocalización no soportada en este dispositivo.');
      return;
    }

    if (this.onStatusChange) this.onStatusChange('searching', 'Buscando satélites GPS...');
    this.isTracking = true;

    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    };

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handlePositionSuccess(pos),
      (err) => this._handlePositionError(err),
      options
    );
  }

  /**
   * Stops GPS tracking
   */
  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
    this.isFollowing = false;

    if (this.marker && this.map) {
      this.map.removeLayer(this.marker);
      this.marker = null;
    }
    if (this.accuracyCircle && this.map) {
      this.map.removeLayer(this.accuracyCircle);
      this.accuracyCircle = null;
    }

    if (this.onStatusChange) this.onStatusChange('inactive', 'GPS Inactivo');
  }

  _handlePositionSuccess(pos) {
    const { latitude, longitude, accuracy, altitude, speed, heading } = pos.coords;
    const speedKmh = speed !== null && speed >= 0 ? (speed * 3.6).toFixed(1) : '0.0';
    
    // Calculate dynamic Course Over Ground from consecutive GPS fixes
    let currentHeading = this.heading;
    if (heading !== null && !isNaN(heading) && heading >= 0) {
      currentHeading = heading;
    } else if (this.currentPosition && parseFloat(speedKmh) > 1.2) {
      const d = this._haversineDistance(this.currentPosition.lat, this.currentPosition.lng, latitude, longitude);
      if (d >= 1.5) {
        // Physical displacement bearing
        const y = Math.sin(((longitude - this.currentPosition.lng) * Math.PI) / 180) * Math.cos((latitude * Math.PI) / 180);
        const x = Math.cos((this.currentPosition.lat * Math.PI) / 180) * Math.sin((latitude * Math.PI) / 180) -
                  Math.sin((this.currentPosition.lat * Math.PI) / 180) * Math.cos((latitude * Math.PI) / 180) * Math.cos(((longitude - this.currentPosition.lng) * Math.PI) / 180);
        const movBearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
        currentHeading = movBearing;
      }
    }

    this.heading = currentHeading;

    this.currentPosition = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy || 0,
      altitude: altitude !== null ? altitude : 0,
      speed: speedKmh,
      heading: currentHeading,
      timestamp: pos.timestamp
    };

    if (this.onStatusChange) this.onStatusChange('active', 'GPS Conectado');
    if (this.onPositionUpdate) this.onPositionUpdate(this.currentPosition);

    this._updateMapDisplay(latitude, longitude, accuracy);

    // Record track point if tracking is active
    if (this.isRecordingTrack) {
      this._recordTrackPoint(this.currentPosition);
    }

    if (this.isFollowing && this.map) {
      this.map.panTo([latitude, longitude], { animate: true });
    }
  }

  _handlePositionError(err) {
    console.warn('GPS position error:', err.message);
    let msg = 'Error de GPS';
    if (err.code === 1) msg = 'Permiso de ubicación denegado';
    else if (err.code === 2) msg = 'Señal de GPS no disponible';
    else if (err.code === 3) msg = 'Tiempo de espera agotado';

    if (this.onStatusChange) this.onStatusChange('error', msg);
  }

  _updateMapDisplay(lat, lng, accuracy) {
    if (!this.map) return;

    const latLng = [lat, lng];

    // Marker
    if (!this.marker) {
      const customIcon = L.divIcon({
        className: 'user-gps-container',
        html: `
          <div class="user-gps-marker">
            <div class="user-gps-pulse"></div>
            <div class="user-gps-heading" id="gps-heading-arrow"></div>
            <div class="user-gps-dot"></div>
          </div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      this.marker = L.marker(latLng, { pane: 'markerPaneCustom', icon: customIcon, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      this.marker.setLatLng(latLng);
    }

    // Accuracy Circle
    if (!this.accuracyCircle) {
      this.accuracyCircle = L.circle(latLng, {
        pane: 'vectorPane',
        radius: accuracy,
        color: '#0080ff',
        fillColor: '#0080ff',
        fillOpacity: 0.15,
        weight: 1.5,
        interactive: false
      }).addTo(this.map);
    } else {
      this.accuracyCircle.setLatLng(latLng);
      this.accuracyCircle.setRadius(accuracy);
    }

    this._updateHeadingIndicator(this.heading);
  }

  _updateHeadingIndicator(deg) {
    const arrow = document.getElementById('gps-heading-arrow');
    if (arrow) {
      arrow.style.transform = `rotate(${deg}deg)`;
    }
  }

  /**
   * Centers the map on the user's current GPS position
   */
  centerOnUser() {
    if (!this.currentPosition || !this.map) return false;
    this.map.setView([this.currentPosition.lat, this.currentPosition.lng], Math.max(this.map.getZoom(), 17), {
      animate: true
    });
    return true;
  }

  /**
   * Toggles auto-follow mode
   */
  toggleFollow() {
    this.isFollowing = !this.isFollowing;
    if (this.isFollowing && this.currentPosition) {
      this.centerOnUser();
    }
    return this.isFollowing;
  }

  /**
   * Gets a single high-accuracy GPS fix as a Promise
   */
  async getCurrentPositionFix() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
          altitude: pos.coords.altitude || 0
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }
}

// Global Singleton Instance
window.gpsTracker = new GpsTracker();
