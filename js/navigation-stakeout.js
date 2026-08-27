/**
 * Geowill Android GIS - Stakeout & Point Navigation Engine
 * Real-time geodetic distance, azimuth/bearing calculation, turn guidance,
 * interactive compass needle, and dynamic map ray vectoring to target point.
 */

class NavigationStakeout {
  constructor() {
    this.map = null;
    this.targetFeature = null;
    this.targetLatLng = null;
    this.isActive = false;
    
    // Layers
    this.guideLineLayer = null;
    this.targetMarkerLayer = null;

    // Config & Thresholds
    this.arrivalThresholdMeters = 3.0;
    this.hasAlertedArrival = false;
    this.lastStats = null;

    // Callback
    this.onNavUpdate = null;
  }

  init(map) {
    this.map = map;
  }

  /**
   * Starts navigation / stakeout towards a specific feature or coordinate
   * @param {Object} feature - Feature object from database / vector editor
   */
  start(feature) {
    if (!feature || !feature.coordinates) {
      console.warn('NavigationStakeout: Feature no válida para navegación');
      return false;
    }

    this.stop(); // Clear any previous active navigation

    this.targetFeature = feature;

    // Determine target lat/lng
    if (feature.type === 'Point') {
      this.targetLatLng = [feature.coordinates[0], feature.coordinates[1]];
    } else if (Array.isArray(feature.coordinates[0])) {
      // For Line or Polygon, use first vertex or center
      this.targetLatLng = [feature.coordinates[0][0], feature.coordinates[0][1]];
    } else {
      this.targetLatLng = [feature.coordinates[0], feature.coordinates[1]];
    }

    this.isActive = true;
    this.hasAlertedArrival = false;

    // 1. Create Target Pulsing Halo Marker on Map
    const targetIcon = L.divIcon({
      className: 'nav-target-halo-icon',
      html: `
        <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 36px; height: 36px; border-radius: 50%; background: rgba(16, 185, 129, 0.35); border: 2px solid #10b981; animation: nav-pulse 1.5s infinite;"></div>
          <div style="width: 16px; height: 16px; border-radius: 50%; background: #10b981; border: 2px solid #ffffff; box-shadow: 0 0 10px #10b981; z-index: 2;"></div>
          <div style="position: absolute; top: -18px; background: rgba(15, 23, 42, 0.9); color: #10b981; font-weight: 800; font-size: 10px; padding: 2px 6px; border-radius: 4px; border: 1px solid #10b981; white-space: nowrap;">
            🎯 ${feature.properties?.name || 'Objetivo'}
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    this.targetMarkerLayer = L.marker(this.targetLatLng, {
      pane: 'markerPaneCustom',
      icon: targetIcon,
      zIndexOffset: 1000
    }).addTo(this.map);

    // 2. Create Dynamic Guide Ray Polyline (Dashed Lime-Cyan)
    this.guideLineLayer = L.polyline([], {
      pane: 'vectorPane',
      color: '#10b981',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.95,
      lineCap: 'round'
    }).addTo(this.map);

    // 3. If User GPS is available, zoom to frame both user and target
    const currentPos = window.gpsTracker?.currentPosition;
    if (currentPos && this.map) {
      this.updateUserPosition(currentPos);
      try {
        const bounds = L.latLngBounds([
          [currentPos.lat, currentPos.lng],
          this.targetLatLng
        ]);
        this.map.fitBounds(bounds, { padding: [70, 70], maxZoom: 19 });
      } catch (e) {}
    } else if (this.map) {
      this.map.setView(this.targetLatLng, 18);
    }

    // 4. Show HUD
    const hud = document.getElementById('nav-guidance-hud');
    if (hud) {
      hud.style.display = 'flex';
    }

    return true;
  }

  /**
   * Stops active stakeout navigation and cleans up map layers
   */
  stop() {
    this.isActive = false;
    this.targetFeature = null;
    this.targetLatLng = null;
    this.hasAlertedArrival = false;
    this.lastStats = null;

    if (this.guideLineLayer && this.map) {
      this.map.removeLayer(this.guideLineLayer);
      this.guideLineLayer = null;
    }

    if (this.targetMarkerLayer && this.map) {
      this.map.removeLayer(this.targetMarkerLayer);
      this.targetMarkerLayer = null;
    }

    const hud = document.getElementById('nav-guidance-hud');
    if (hud) {
      hud.style.display = 'none';
    }

    if (this.onNavUpdate) {
      this.onNavUpdate(null);
    }
  }

  /**
   * Called on every GPS fix update from GPS Tracker
   * @param {Object} pos - GPS position { lat, lng, altitude, heading, speed, accuracy }
   */
  updateUserPosition(pos) {
    if (!this.isActive || !this.targetLatLng || !pos) return;

    const userLat = pos.lat;
    const userLng = pos.lng;
    const targetLat = this.targetLatLng[0];
    const targetLng = this.targetLatLng[1];

    // 1. Calculate Geodesic Distance
    const distanceMeters = this.getDistance(userLat, userLng, targetLat, targetLng);

    // 2. Calculate Azimuth (Bearing) from User to Target (0° - 360°)
    const bearing = this.getBearing(userLat, userLng, targetLat, targetLng);
    const cardinal = this.getCardinal(bearing);

    // 3. User Compass / Motion Heading
    const userHeading = (pos.heading !== undefined && pos.heading !== null && !isNaN(pos.heading))
      ? pos.heading
      : (window.gpsTracker?.heading || 0);

    // 4. Calculate Turn Guidance Relative to Operator's Heading
    const turnInfo = this.getTurnInstruction(bearing, userHeading);

    // 5. Update Dynamic Guide Ray on Map
    if (this.guideLineLayer) {
      this.guideLineLayer.setLatLngs([
        [userLat, userLng],
        [targetLat, targetLng]
      ]);
    }

    // 6. Proximity / Arrival Check (< 3 meters)
    const isArrived = distanceMeters <= this.arrivalThresholdMeters;
    if (isArrived && !this.hasAlertedArrival) {
      this.hasAlertedArrival = true;
      this._triggerArrivalFeedback();
    }

    this.lastStats = {
      targetName: this.targetFeature?.properties?.name || 'Punto Objetivo',
      targetCategory: this.targetFeature?.properties?.category || 'General',
      targetLatLng: this.targetLatLng,
      distanceMeters: distanceMeters,
      bearing: bearing,
      cardinal: cardinal,
      userHeading: userHeading,
      turnAngle: turnInfo.angle,
      turnText: turnInfo.text,
      turnIcon: turnInfo.icon,
      isArrived: isArrived
    };

    // Update UI HUD
    this._renderHud(this.lastStats);

    if (this.onNavUpdate) {
      this.onNavUpdate(this.lastStats);
    }
  }

  /**
   * Called on device compass orientation update
   * @param {number} heading - Compass direction in degrees (0 = North)
   */
  updateCompassHeading(heading) {
    if (!this.isActive || !this.lastStats) return;

    this.lastStats.userHeading = heading;
    const turnInfo = this.getTurnInstruction(this.lastStats.bearing, heading);
    this.lastStats.turnAngle = turnInfo.angle;
    this.lastStats.turnText = turnInfo.text;
    this.lastStats.turnIcon = turnInfo.icon;

    this._renderHud(this.lastStats);
  }

  /* ==========================================================================
     UI Rendering
     ========================================================================== */

  _renderHud(stats) {
    if (!stats) return;

    const nameElem = document.getElementById('nav-hud-target-name');
    const distElem = document.getElementById('nav-hud-distance');
    const bearingElem = document.getElementById('nav-hud-bearing');
    const turnElem = document.getElementById('nav-hud-turn');
    const needleElem = document.getElementById('nav-compass-needle');
    const arrivedBanner = document.getElementById('nav-hud-arrived-alert');

    if (nameElem) nameElem.textContent = stats.targetName;

    if (distElem) {
      if (stats.distanceMeters >= 1000) {
        distElem.textContent = `${(stats.distanceMeters / 1000).toFixed(2)} km`;
      } else {
        distElem.textContent = `${stats.distanceMeters.toFixed(1)} m`;
      }

      // Color coding based on proximity
      if (stats.distanceMeters <= 3.0) {
        distElem.style.color = '#10b981'; // Green (Arrived)
      } else if (stats.distanceMeters <= 15.0) {
        distElem.style.color = '#38bdf8'; // Cyan (Close)
      } else {
        distElem.style.color = '#f8fafc'; // White
      }
    }

    if (bearingElem) {
      bearingElem.textContent = `${stats.bearing.toFixed(0).padStart(3, '0')}° (${stats.cardinal})`;
    }

    if (turnElem) {
      turnElem.textContent = `${stats.turnIcon} ${stats.turnText}`;
      if (stats.turnText.includes('Frente')) {
        turnElem.style.color = '#10b981';
      } else {
        turnElem.style.color = '#f59e0b';
      }
    }

    // Rotate compass needle arrow: Points to relative turn angle
    if (needleElem) {
      needleElem.style.transform = `rotate(${stats.turnAngle}deg)`;
    }

    // Arrival Alert Banner
    if (arrivedBanner) {
      arrivedBanner.style.display = stats.isArrived ? 'flex' : 'none';
    }
  }

  _triggerArrivalFeedback() {
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
    window.app?.showToast('🎉 ¡HAS LLEGADO AL PUNTO OBJETIVO! (Distancia < 3m)', 'success');
  }

  /* ==========================================================================
     Geodesic Math Helpers
     ========================================================================== */

  /**
   * Distance between 2 lat/lng points in meters (Haversine Formula)
   */
  getDistance(lat1, lon1, lat2, lon2) {
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
   * Initial bearing (Azimuth) from point 1 to point 2 in degrees (0 - 360)
   */
  getBearing(lat1, lon1, lat2, lon2) {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);

    return ((θ * 180) / Math.PI + 360) % 360;
  }

  /**
   * 16-wind compass cardinal direction string from bearing
   */
  getCardinal(bearing) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(bearing / 22.5) % 16;
    return directions[index];
  }

  /**
   * Calculates turn instruction relative to user heading
   * @param {number} targetBearing - Azimuth to target (0 - 360)
   * @param {number} userHeading - Direction user is facing (0 - 360)
   */
  getTurnInstruction(targetBearing, userHeading) {
    let diff = (targetBearing - userHeading + 540) % 360 - 180; // Range: -180 to +180

    const absDiff = Math.abs(diff);
    if (absDiff <= 8) {
      return { angle: diff, text: '¡Sigue de Frente!', icon: '⬆️' };
    } else if (diff > 0) {
      return { angle: diff, text: `Gira ${absDiff.toFixed(0)}° a la Derecha`, icon: '➡️' };
    } else {
      return { angle: diff, text: `Gira ${absDiff.toFixed(0)}° a la Izquierda`, icon: '⬅️' };
    }
  }
}

// Global Singleton Instance
window.navStakeout = new NavigationStakeout();
