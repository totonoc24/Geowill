/**
 * GeoPlan Android GIS - Georeferencing Mathematical Engine
 * Solves 2D Affine transformations from 3 Ground Control Points (GCPs)
 * Handles coordinate conversions: WGS84 Lat/Lng, Web Mercator EPSG:3857, UTM, DMS.
 */

class GeorefEngine {
  constructor() {
    this.R = 6378137.0; // Earth radius in meters (WGS84 Sphere/Mercator)
  }

  /* ==========================================================================
     Coordinate Projections
     ========================================================================== */

  /**
   * Converts WGS84 [Lat, Lng] in degrees to Web Mercator [X, Y] in meters (EPSG:3857)
   */
  latLngToMercator(lat, lng) {
    const d2r = Math.PI / 180;
    const x = this.R * (lng * d2r);
    const latClamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const sin = Math.sin(latClamped * d2r);
    const y = (this.R / 2) * Math.log((1 + sin) / (1 - sin));
    return { x, y };
  }

  /**
   * Converts Web Mercator [X, Y] in meters to WGS84 [Lat, Lng] in degrees
   */
  mercatorToLatLng(x, y) {
    const r2d = 180 / Math.PI;
    const lng = (x / this.R) * r2d;
    const lat = (2 * Math.atan(Math.exp(y / this.R)) - Math.PI / 2) * r2d;
    return { lat, lng };
  }

  /**
   * Parses DMS string (e.g. 04°36'35.12"N, 74°04'54.3"W) into Decimal Degrees
   */
  parseDMSToDecimal(dmsStr) {
    if (typeof dmsStr === 'number') return dmsStr;
    const clean = dmsStr.trim().toUpperCase();
    
    // Check if already decimal
    if (/^[-+]?[0-9]*\.?[0-9]+$/.test(clean)) {
      return parseFloat(clean);
    }

    const regex = /([0-9]+)[\s°ºdD]+([0-9]+)[\s'mM]+([0-9]+(?:\.[0-9]+)?)[\s"sS]*([NSEW])?/i;
    const match = clean.match(regex);
    if (!match) return NaN;

    const deg = parseFloat(match[1]);
    const min = parseFloat(match[2]);
    const sec = parseFloat(match[3]);
    const dir = match[4];

    let dec = deg + min / 60 + sec / 3600;
    if (dir === 'S' || dir === 'W' || clean.startsWith('-')) {
      dec = -Math.abs(dec);
    }
    return dec;
  }

  /**
   * Formats Decimal Degrees to readable DMS string
   */
  formatDecimalToDMS(dec, isLat = true) {
    const dir = isLat ? (dec >= 0 ? 'N' : 'S') : (dec >= 0 ? 'E' : 'W');
    const abs = Math.abs(dec);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d - m / 60) * 3600).toFixed(2);
    return `${d}°${m.toString().padStart(2, '0')}'${s.padStart(5, '0')}"${dir}`;
  }

  /* ==========================================================================
     Colombian Coordinate Reference Systems: EPSG:3116 & EPSG:9377
     ========================================================================== */

  /**
   * Generic Transverse Mercator Forward Projection (Lat/Lng -> Este/Norte)
   * Ellipsoid GRS80 (a = 6378137.0, f = 1/298.257222101)
   */
  _transverseMercatorForward(latDeg, lonDeg, lat0Deg, lon0Deg, k0, x0, y0) {
    const a = 6378137.0;
    const f = 1 / 298.257222101;
    const e2 = 2 * f - f * f;
    const ep2 = e2 / (1 - e2);

    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const lat0 = (lat0Deg * Math.PI) / 180;
    const lon0 = (lon0Deg * Math.PI) / 180;

    const dLon = lon - lon0;

    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    const T = Math.tan(lat) * Math.tan(lat);
    const C = ep2 * Math.cos(lat) * Math.cos(lat);
    const A = Math.cos(lat) * dLon;

    // Meridian arc calculation M
    const M_func = (phi) => {
      return a * (
        (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
        - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
        + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
        - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
      );
    };

    const M = M_func(lat);
    const M0 = M_func(lat0);

    const x = x0 + k0 * N * (
      A + (1 - T + C) * Math.pow(A, 3) / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120
    );

    const y = y0 + k0 * (
      M - M0 + N * Math.tan(lat) * (
        A * A / 2
        + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
        + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720
      )
    );

    return { este: x, norte: y };
  }

  /**
   * Generic Transverse Mercator Inverse Projection (Este/Norte -> Lat/Lng)
   */
  _transverseMercatorInverse(este, norte, lat0Deg, lon0Deg, k0, x0, y0) {
    const a = 6378137.0;
    const f = 1 / 298.257222101;
    const e2 = 2 * f - f * f;
    const ep2 = e2 / (1 - e2);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

    const lat0 = (lat0Deg * Math.PI) / 180;
    const lon0 = (lon0Deg * Math.PI) / 180;

    const M_func = (phi) => {
      return a * (
        (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
        - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
        + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
        - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
      );
    };

    const M0 = M_func(lat0);
    const M = M0 + (norte - y0) / k0;

    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));

    const phi1 = mu
      + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
      + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
      + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

    const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1));
    const T1 = Math.tan(phi1) * Math.tan(phi1);
    const C1 = ep2 * Math.cos(phi1) * Math.cos(phi1);
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
    const D = (este - x0) / (N1 * k0);

    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
      D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720
    );

    const lon = lon0 + (
      D
      - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120
    ) / Math.cos(phi1);

    return {
      lat: (lat * 180) / Math.PI,
      lng: (lon * 180) / Math.PI
    };
  }

  /**
   * EPSG:3116 - MAGNA-SIRGAS / Colombia Bogota zone (Central: Lon -74.077508, Lat 4.596200, False East: 1000000, False North: 1000000)
   */
  wgs84ToEpsg3116(lat, lng) {
    return this._transverseMercatorForward(
      lat, lng,
      4.59620041666667, -74.07750791666666,
      1.0, 1000000.0, 1000000.0
    );
  }

  epsg3116ToWgs84(este, norte) {
    return this._transverseMercatorInverse(
      este, norte,
      4.59620041666667, -74.07750791666666,
      1.0, 1000000.0, 1000000.0
    );
  }

  /**
   * EPSG:9377 - MAGNA-SIRGAS 2018 / Origen Nacional CTM12 (Central: Lon -73.0, Lat 4.0, False East: 5000000, False North: 2000000, k0: 0.9992)
   */
  wgs84ToEpsg9377(lat, lng) {
    return this._transverseMercatorForward(
      lat, lng,
      4.0, -73.0,
      0.9992, 5000000.0, 2000000.0
    );
  }

  epsg9377ToWgs84(este, norte) {
    return this._transverseMercatorInverse(
      este, norte,
      4.0, -73.0,
      0.9992, 5000000.0, 2000000.0
    );
  }

  /**
   * Universal coordinate parser converting input into {lat, lng} based on selected CRS
   */
  parseCoordinateInput(val1, val2, crs = 'wgs84') {
    if (crs === 'epsg3116') {
      const norte = typeof val1 === 'number' ? val1 : parseFloat(val1);
      const este = typeof val2 === 'number' ? val2 : parseFloat(val2);
      if (isNaN(norte) || isNaN(este)) return null;
      return this.epsg3116ToWgs84(este, norte);
    } else if (crs === 'epsg9377') {
      const norte = typeof val1 === 'number' ? val1 : parseFloat(val1);
      const este = typeof val2 === 'number' ? val2 : parseFloat(val2);
      if (isNaN(norte) || isNaN(este)) return null;
      return this.epsg9377ToWgs84(este, norte);
    } else {
      // WGS84 (Lat, Lng) either decimal or DMS
      const lat = this.parseDMSToDecimal(val1);
      const lng = this.parseDMSToDecimal(val2);
      if (isNaN(lat) || isNaN(lng)) return null;
      return { lat, lng };
    }
  }

  /* ==========================================================================
     3-Point Affine Georeferencing Solver
     ========================================================================== */

  /**
   * Solves 2D Affine Transformation Matrix from 3 Ground Control Points (GCPs).
   * @param {Array<{pdfX: number, pdfY: number, lat: number, lng: number}>} gcps - Array of 3 points
   * @param {number} pdfWidth - Width of the PDF in pixels
   * @param {number} pdfHeight - Height of the PDF in pixels
   */
  calculateAffineTransformation(gcps, pdfWidth, pdfHeight) {
    if (!gcps || gcps.length !== 3) {
      throw new Error('Se requieren exactamente 3 puntos de control (GCP) para la calibración afín.');
    }

    // Convert geographic coordinates to projected Web Mercator (meters)
    const points = gcps.map(p => {
      const merc = this.latLngToMercator(p.lat, p.lng);
      return {
        u: p.pdfX,
        v: p.pdfY,
        x: merc.x,
        y: merc.y
      };
    });

    const [p1, p2, p3] = points;

    // Determinant of the 3x3 matrix [u, v, 1]
    const det = p1.u * (p2.v - p3.v) - p1.v * (p2.u - p3.u) + (p2.u * p3.v - p3.u * p2.v);

    if (Math.abs(det) < 1e-7) {
      throw new Error('Los 3 puntos seleccionados son colineales o están demasiado juntos. Seleccione 3 puntos que formen un triángulo amplio sobre el plano.');
    }

    // Solve for X coefficients: x = a*u + b*v + c
    const a = (p1.x * (p2.v - p3.v) + p2.x * (p3.v - p1.v) + p3.x * (p1.v - p2.v)) / det;
    const b = (p1.x * (p3.u - p2.u) + p2.x * (p1.u - p3.u) + p3.x * (p2.u - p1.u)) / det;
    const c = (p1.x * (p2.u * p3.v - p3.u * p2.v) + p2.x * (p3.u * p1.v - p1.u * p3.v) + p3.x * (p1.u * p2.v - p2.u * p1.v)) / det;

    // Solve for Y coefficients: y = d*u + e*v + f
    const d = (p1.y * (p2.v - p3.v) + p2.y * (p3.v - p1.v) + p3.y * (p1.v - p2.v)) / det;
    const e = (p1.y * (p3.u - p2.u) + p2.y * (p1.u - p3.u) + p3.y * (p2.u - p1.u)) / det;
    const f = (p1.y * (p2.u * p3.v - p3.u * p2.v) + p2.y * (p3.u * p1.v - p1.u * p3.v) + p3.y * (p1.u * p2.v - p2.u * p1.v)) / det;

    const matrix = { a, b, c, d, e, f };

    // Function to transform PDF (u, v) -> Web Mercator (x, y)
    const transformPoint = (u, v) => ({
      x: a * u + b * v + c,
      y: d * u + e * v + f
    });

    // Calculate 4 geographic corners of the PDF sheet
    const cornersPdf = [
      { name: 'topLeft', u: 0, v: 0 },
      { name: 'topRight', u: pdfWidth, v: 0 },
      { name: 'bottomRight', u: pdfWidth, v: pdfHeight },
      { name: 'bottomLeft', u: 0, v: pdfHeight }
    ];

    const cornersGeo = cornersPdf.map(cp => {
      const merc = transformPoint(cp.u, cp.v);
      const ll = this.mercatorToLatLng(merc.x, merc.y);
      return {
        name: cp.name,
        u: cp.u,
        v: cp.v,
        x: merc.x,
        y: merc.y,
        lat: ll.lat,
        lng: ll.lng
      };
    });

    // Calculate Center
    const centerMerc = transformPoint(pdfWidth / 2, pdfHeight / 2);
    const centerGeo = this.mercatorToLatLng(centerMerc.x, centerMerc.y);

    // Calculate Bounding Box
    const lats = cornersGeo.map(c => c.lat);
    const lngs = cornersGeo.map(c => c.lng);
    const bounds = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    ];

    // Calculate Scale, Rotation and Skew
    const scaleX = Math.sqrt(a * a + d * d); // meters per pixel X
    const scaleY = Math.sqrt(b * b + e * e); // meters per pixel Y
    const rotationRad = Math.atan2(d, a);
    const rotationDeg = (rotationRad * 180) / Math.PI;

    // Inverse affine matrix: (u, v) = inv(M) * (x, y)
    const invDet = a * e - b * d;
    const invMatrix = {
      a: e / invDet,
      b: -b / invDet,
      c: (b * f - c * e) / invDet,
      d: -d / invDet,
      e: a / invDet,
      f: (c * d - a * f) / invDet
    };

    // Calculate RMS error on GCPs
    let totalResidualSq = 0;
    gcps.forEach(gcp => {
      const computedMerc = transformPoint(gcp.pdfX, gcp.pdfY);
      const actualMerc = this.latLngToMercator(gcp.lat, gcp.lng);
      const dx = computedMerc.x - actualMerc.x;
      const dy = computedMerc.y - actualMerc.y;
      totalResidualSq += dx * dx + dy * dy;
    });
    const rmse = Math.sqrt(totalResidualSq / 3);

    return {
      matrix,
      invMatrix,
      cornersGeo,
      centerGeo,
      bounds,
      scaleX,
      scaleY,
      rotationDeg,
      rmse,
      pdfWidth,
      pdfHeight
    };
  }

  /**
   * Converts any LatLng coordinate to the corresponding (u, v) pixel coordinate on the PDF.
   */
  latLngToPdfPixel(lat, lng, invMatrix) {
    const merc = this.latLngToMercator(lat, lng);
    return {
      u: invMatrix.a * merc.x + invMatrix.b * merc.y + invMatrix.c,
      v: invMatrix.d * merc.x + invMatrix.e * merc.y + invMatrix.f
    };
  }

  /**
   * Converts any PDF pixel (u, v) to geographic LatLng
   */
  pdfPixelToLatLng(u, v, matrix) {
    const x = matrix.a * u + matrix.b * v + matrix.c;
    const y = matrix.d * u + matrix.e * v + matrix.f;
    return this.mercatorToLatLng(x, y);
  }
}

// Global Singleton Instance
window.georefEngine = new GeorefEngine();
