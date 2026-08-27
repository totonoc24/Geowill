/**
 * GeoPlan Android GIS - PDF Document Processor & GeoPDF Parser
 * Handles loading, high-DPI rasterization, thumbnail generation, and GeoPDF metadata extraction.
 */

class PdfLoader {
  constructor() {
    // Configure PDF.js local worker
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/libs/pdf.worker.min.js';
    }
    this.pdfDoc = null;
    this.currentPage = 1;
    this.numPages = 0;
    this.currentCanvas = null;
  }

  /**
   * Loads a PDF file from an ArrayBuffer or File object
   * @param {ArrayBuffer|File|Blob} fileData 
   */
  async loadPdf(fileData) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library is not loaded.');
    }

    let data;
    if (fileData instanceof Blob || fileData instanceof File) {
      data = await fileData.arrayBuffer();
    } else {
      data = fileData;
    }

    // CLONE the buffer for our GeoPDF metadata scanner so PDF.js Web Worker transfer does not detach it!
    const clonedBytes = new Uint8Array(data.slice(0));
    this._rawBuffer = clonedBytes;

    // Extract GeoPDF metadata FIRST from our cloned buffer
    const geoMetadata = await this.extractGeoPdfMetadata();

    try {
      // Pass the original buffer or a copy to PDF.js
      const pdfJsData = new Uint8Array(data.slice(0));
      const loadingTask = window.pdfjsLib.getDocument({
        data: pdfJsData,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true
      });

      this.pdfDoc = await loadingTask.promise;
      this.numPages = this.pdfDoc.numPages;
      this.currentPage = 1;

      return {
        numPages: this.numPages,
        geoMetadata
      };
    } catch (err) {
      console.error('Error loading PDF file:', err);
      throw new Error('No se pudo abrir el archivo PDF. Asegúrese de que sea un archivo válido.');
    }
  }

  /**
   * Renders a specific PDF page onto an HTML Canvas element
   * @param {number} pageNum - 1-based page index
   * @param {HTMLCanvasElement} canvas - Target canvas
   * @param {number} scale - Render scale (default 2.0 for sharp high-DPI display)
   */
  async renderPageToCanvas(pageNum, canvas, scale = 2.0) {
    if (!this.pdfDoc) throw new Error('No hay ningún PDF cargado.');
    
    if (pageNum < 1 || pageNum > this.numPages) {
      pageNum = 1;
    }
    this.currentPage = pageNum;

    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderContext).promise;
    this.currentCanvas = canvas;

    return {
      width: viewport.width,
      height: viewport.height,
      scale: scale,
      originalWidth: viewport.width / scale,
      originalHeight: viewport.height / scale
    };
  }

  /**
   * Scans PDF structure and raw bytes for Geospatial metadata (GeoPDF ISO 32000 / OGC / TerraGo tags)
   */
  async extractGeoPdfMetadata() {
    if (!this._rawBuffer) return null;

    try {
      let geoInfo = {
        hasGeoMetadata: false,
        title: 'Plano Topográfico',
        gpts: null,
        lpts: null,
        bbox: null,
        mediabox: null,
        bounds: null
      };

      if (this.pdfDoc) {
        const metadata = await this.pdfDoc.getMetadata().catch(() => null);
        if (metadata?.info?.Title) {
          geoInfo.title = metadata.info.Title;
        }
      }

      // Convert Uint8Array to binary string safely in 16KB chunks
      let pdfText = '';
      const u8 = this._rawBuffer;
      const len = u8.length;
      const chunkSize = 16384;
      for (let i = 0; i < len; i += chunkSize) {
        pdfText += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunkSize, len)));
      }

      // Search for /VP viewport dictionary
      const vpRegex = /\/VP\s*\[\s*<<([\s\S]*?)>>\s*\]/i;
      const vpMatch = pdfText.match(vpRegex);

      if (vpMatch) {
        const vpContent = vpMatch[1];
        const bboxMatch = vpContent.match(/\/BBox\s*\[\s*([\d\.\s]+)\]/i);
        const gptsMatch = vpContent.match(/\/GPTS\s*\[\s*([-\d\.\s]+)\]/i);
        const lptsMatch = vpContent.match(/\/LPTS\s*\[\s*([-\d\.\s]+)\]/i);
        const mediaMatch = pdfText.match(/\/MediaBox\s*\[\s*([\d\.\s]+)\]/i);

        if (bboxMatch && gptsMatch) {
          const bbox = bboxMatch[1].trim().split(/\s+/).map(Number);
          const gpts = gptsMatch[1].trim().split(/\s+/).map(Number);
          const lpts = lptsMatch ? lptsMatch[1].trim().split(/\s+/).map(Number) : [0, 0, 0, 1, 1, 1, 1, 0];
          const mediabox = mediaMatch ? mediaMatch[1].trim().split(/\s+/).map(Number) : [0, 0, bbox[2], bbox[3]];

          geoInfo.hasGeoMetadata = true;
          geoInfo.bbox = bbox;
          geoInfo.gpts = gpts;
          geoInfo.lpts = lpts;
          geoInfo.mediabox = mediabox;

          const lats = [gpts[0], gpts[2], gpts[4], gpts[6]].filter(n => !isNaN(n));
          const lngs = [gpts[1], gpts[3], gpts[5], gpts[7]].filter(n => !isNaN(n));

          geoInfo.bounds = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)]
          ];

          // Compute canvas GCPs for any given render scale
          geoInfo.getCanvasGcps = (scale = 2.0) => {
            const pageH = mediabox[3];
            const [bxMin, byMin, bxMax, byMax] = bbox;
            return [
              { name: 'Bottom-Left', pdfX: bxMin * scale, pdfY: (pageH - byMin) * scale, lat: gpts[0], lng: gpts[1] },
              { name: 'Top-Left', pdfX: bxMin * scale, pdfY: (pageH - byMax) * scale, lat: gpts[2], lng: gpts[3] },
              { name: 'Top-Right', pdfX: bxMax * scale, pdfY: (pageH - byMax) * scale, lat: gpts[4], lng: gpts[5] }
            ];
          };
        }
      }

      return geoInfo;
    } catch (e) {
      console.warn('GeoPDF metadata scan error:', e);
      return null;
    }
  }

  /**
   * Converts the currently rendered canvas into a High-Quality Data URL / Blob
   */
  getRenderDataUrl(canvas = null, quality = 0.92) {
    const target = canvas || this.currentCanvas;
    if (!target) return null;
    return target.toDataURL('image/jpeg', quality);
  }
}

// Global Singleton Instance
window.pdfLoader = new PdfLoader();
