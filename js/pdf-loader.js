/**
 * GeoPlan / Geowill GIS - Advanced PDF Document Processor & GeoPDF Parser
 * Handles high-DPI PDF rasterization, thumbnail generation, and comprehensive
 * GeoPDF metadata extraction (ISO 32000-1 / Adobe GeoPDF, OGC TerraGo, GDAL GeoPDF).
 * Fully offline, standalone parser supporting Flate decompression, Object Streams (/ObjStm),
 * indirect PDF object resolution, and projected CRS conversion.
 */

class FastInflate {
  static async decompress(uint8Arr) {
    // 1. Try native Web API DecompressionStream if available
    if (typeof DecompressionStream !== 'undefined') {
      try {
        // Try deflate (zlib wrapped) first
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(uint8Arr);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks = [];
        let totalLen = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLen += value.length;
        }
        const out = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        return out;
      } catch (e) {
        // Try raw deflate (without zlib header)
        try {
          const dsRaw = new DecompressionStream('deflate-raw');
          const writer = dsRaw.writable.getWriter();
          writer.write(uint8Arr);
          writer.close();
          const reader = dsRaw.readable.getReader();
          const chunks = [];
          let totalLen = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
          }
          const out = new Uint8Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
          }
          return out;
        } catch (e2) {
          // Fall back to pure JS inflate
        }
      }
    }

    // 2. Pure JS RFC 1951 Inflate Fallback
    try {
      return FastInflate.inflateRaw(uint8Arr);
    } catch (err) {
      console.warn('FastInflate error:', err);
      return null;
    }
  }

  static inflateRaw(data) {
    let offset = 0;
    // Check and skip zlib header if present (e.g. 0x78 0x01, 0x78 0x9c, 0x78 0xda, 0x78 0x5e)
    if (data.length > 2 && data[0] === 0x78 && ((data[0] * 256 + data[1]) % 31 === 0)) {
      offset = 2;
    }

    let bitBuf = 0;
    let bitLen = 0;

    const readBit = () => {
      if (bitLen === 0) {
        if (offset >= data.length) return 0;
        bitBuf = data[offset++];
        bitLen = 8;
      }
      const bit = bitBuf & 1;
      bitBuf >>= 1;
      bitLen--;
      return bit;
    };

    const readBits = (n) => {
      let res = 0;
      for (let i = 0; i < n; i++) {
        res |= (readBit() << i);
      }
      return res;
    };

    const outChunks = [];
    let outChunk = new Uint8Array(65536);
    let outPos = 0;

    const pushByte = (b) => {
      if (outPos >= outChunk.length) {
        outChunks.push(outChunk);
        outChunk = new Uint8Array(65536);
        outPos = 0;
      }
      outChunk[outPos++] = b;
    };

    const pushBytesFromDist = (dist, len) => {
      for (let i = 0; i < len; i++) {
        let backIndex = outPos - dist;
        let b;
        if (backIndex >= 0) {
          b = outChunk[backIndex];
        } else {
          // Look back in previous chunks
          let seek = -backIndex;
          for (let c = outChunks.length - 1; c >= 0; c--) {
            const chunk = outChunks[c];
            if (seek <= chunk.length) {
              b = chunk[chunk.length - seek];
              break;
            }
            seek -= chunk.length;
          }
        }
        pushByte(b !== undefined ? b : 0);
      }
    };

    // Build Huffman Tree helper
    const buildHuffTree = (lengths) => {
      const numSymbols = lengths.length;
      let maxLen = 0;
      for (let i = 0; i < numSymbols; i++) {
        if (lengths[i] > maxLen) maxLen = lengths[i];
      }
      const blCount = new Uint32Array(maxLen + 1);
      for (let i = 0; i < numSymbols; i++) {
        if (lengths[i] > 0) blCount[lengths[i]]++;
      }
      const nextCode = new Uint32Array(maxLen + 1);
      let code = 0;
      blCount[0] = 0;
      for (let bits = 1; bits <= maxLen; bits++) {
        code = (code + blCount[bits - 1]) << 1;
        nextCode[bits] = code;
      }
      const tree = {};
      for (let i = 0; i < numSymbols; i++) {
        const len = lengths[i];
        if (len !== 0) {
          const c = nextCode[len]++;
          tree[(len << 16) | c] = i;
        }
      }
      return { tree, maxLen };
    };

    const decodeSymbol = (huff) => {
      let code = 0;
      for (let len = 1; len <= huff.maxLen; len++) {
        code = (code << 1) | readBit();
        const key = (len << 16) | code;
        if (huff.tree[key] !== undefined) {
          return huff.tree[key];
        }
      }
      return -1;
    };

    // Fixed Huffman trees
    const fixedLitLengths = new Uint8Array(288);
    for (let i = 0; i <= 143; i++) fixedLitLengths[i] = 8;
    for (let i = 144; i <= 255; i++) fixedLitLengths[i] = 9;
    for (let i = 256; i <= 279; i++) fixedLitLengths[i] = 7;
    for (let i = 280; i <= 287; i++) fixedLitLengths[i] = 8;
    const fixedLitHuff = buildHuffTree(fixedLitLengths);

    const fixedDistLengths = new Uint8Array(32);
    for (let i = 0; i < 32; i++) fixedDistLengths[i] = 5;
    const fixedDistHuff = buildHuffTree(fixedDistLengths);

    // Length base & extra bits
    const lenBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const lenExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

    // Distance base & extra bits
    const distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

    // Code length alphabet order
    const clOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    let isFinal = 0;
    while (!isFinal && offset <= data.length + 4) {
      isFinal = readBit();
      const btype = readBits(2);

      if (btype === 0) {
        // Stored / Uncompressed
        bitBuf = 0;
        bitLen = 0;
        if (offset + 4 > data.length) break;
        const len = data[offset] | (data[offset + 1] << 8);
        offset += 4; // skip LEN and NLEN
        for (let i = 0; i < len && offset < data.length; i++) {
          pushByte(data[offset++]);
        }
      } else if (btype === 1 || btype === 2) {
        // 1 = Fixed Huffman, 2 = Dynamic Huffman
        let litHuff, distHuff;
        if (btype === 1) {
          litHuff = fixedLitHuff;
          distHuff = fixedDistHuff;
        } else {
          const hlit = readBits(5) + 257;
          const hdist = readBits(5) + 1;
          const hclen = readBits(4) + 4;

          const clLengths = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) {
            clLengths[clOrder[i]] = readBits(3);
          }
          const clHuff = buildHuffTree(clLengths);

          const totalCodes = hlit + hdist;
          const treeLengths = new Uint8Array(totalCodes);
          let codeIdx = 0;
          while (codeIdx < totalCodes) {
            const sym = decodeSymbol(clHuff);
            if (sym < 0) break;
            if (sym < 16) {
              treeLengths[codeIdx++] = sym;
            } else if (sym === 16) {
              const repeat = readBits(2) + 3;
              const prev = codeIdx > 0 ? treeLengths[codeIdx - 1] : 0;
              for (let r = 0; r < repeat && codeIdx < totalCodes; r++) {
                treeLengths[codeIdx++] = prev;
              }
            } else if (sym === 17) {
              const repeat = readBits(3) + 3;
              for (let r = 0; r < repeat && codeIdx < totalCodes; r++) {
                treeLengths[codeIdx++] = 0;
              }
            } else if (sym === 18) {
              const repeat = readBits(7) + 11;
              for (let r = 0; r < repeat && codeIdx < totalCodes; r++) {
                treeLengths[codeIdx++] = 0;
              }
            }
          }

          litHuff = buildHuffTree(treeLengths.subarray(0, hlit));
          distHuff = buildHuffTree(treeLengths.subarray(hlit, totalCodes));
        }

        while (true) {
          const sym = decodeSymbol(litHuff);
          if (sym === 256 || sym < 0) break; // End of block or error
          if (sym < 256) {
            pushByte(sym);
          } else {
            const lenIndex = sym - 257;
            const extraLen = lenExtra[lenIndex] > 0 ? readBits(lenExtra[lenIndex]) : 0;
            const matchLen = lenBase[lenIndex] + extraLen;

            const distSym = decodeSymbol(distHuff);
            if (distSym < 0) break;
            const extraDist = distExtra[distSym] > 0 ? readBits(distExtra[distSym]) : 0;
            const matchDist = distBase[distSym] + extraDist;

            pushBytesFromDist(matchDist, matchLen);
          }
        }
      } else {
        // Error or reserved btype
        break;
      }
    }

    // Assemble final output Uint8Array
    let totalLength = 0;
    for (const c of outChunks) totalLength += c.length;
    totalLength += outPos;

    const result = new Uint8Array(totalLength);
    let curOffset = 0;
    for (const c of outChunks) {
      result.set(c, curOffset);
      curOffset += c.length;
    }
    result.set(outChunk.subarray(0, outPos), curOffset);
    return result;
  }
}

class PdfLoader {
  constructor() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/libs/pdf.worker.min.js';
    }
    this.pdfDoc = null;
    this.currentPage = 1;
    this.numPages = 0;
    this.currentCanvas = null;
    this._rawBuffer = null;
  }

  /**
   * Loads a PDF file from an ArrayBuffer, File, or Blob
   */
  async loadPdf(fileData) {
    if (!window.pdfjsLib) {
      throw new Error('La librería PDF.js no está cargada.');
    }

    let data;
    if (fileData instanceof Blob || fileData instanceof File) {
      data = await fileData.arrayBuffer();
    } else {
      data = fileData;
    }

    // Clone the buffer for our offline GeoPDF structural scanner
    const clonedBytes = new Uint8Array(data.slice(0));
    this._rawBuffer = clonedBytes;

    // Extract GeoPDF metadata from buffer
    const geoMetadata = await this.extractGeoPdfMetadata();

    try {
      const pdfJsData = new Uint8Array(data.slice(0));
      const loadingTask = window.pdfjsLib.getDocument({
        data: pdfJsData,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
        cMapPacked: true
      });

      this.pdfDoc = await loadingTask.promise;
      this.numPages = this.pdfDoc.numPages;
      this.currentPage = 1;

      // Also try to read document title from PDF.js metadata if not found
      if (geoMetadata && (!geoMetadata.title || geoMetadata.title === 'Plano Topográfico')) {
        try {
          const meta = await this.pdfDoc.getMetadata();
          if (meta?.info?.Title) geoMetadata.title = meta.info.Title;
        } catch (_) {}
      }

      return {
        numPages: this.numPages,
        geoMetadata
      };
    } catch (err) {
      console.error('Error al abrir archivo PDF:', err);
      throw new Error('No se pudo abrir el archivo PDF. Asegúrese de que sea un archivo válido.');
    }
  }

  /**
   * Renders a specific PDF page onto an HTML Canvas element
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
   * Complete GeoPDF metadata extraction engine
   * Scans PDF objects, decompresses Flate streams, parses Object Streams (/ObjStm),
   * resolves indirect references, extracts ISO 32000-1 (/VP, /Measure), OGC TerraGo (/LGIDict),
   * GDAL GeoPDF metadata, and converts projected coordinates to WGS84.
   */
  async extractGeoPdfMetadata() {
    if (!this._rawBuffer) return null;

    try {
      const rawBytes = this._rawBuffer;
      const decoder = new TextDecoder('latin1');
      const rawString = decoder.decode(rawBytes);

      // Object storage map: objNum -> text definition
      const objectMap = new Map();
      const allDecompressedTexts = [];

      // 1. Scan and index uncompressed objects: "X Y obj ... endobj"
      const objRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
      let objMatch;
      while ((objMatch = objRegex.exec(rawString)) !== null) {
        const objNum = parseInt(objMatch[1], 10);
        const objBody = objMatch[3];
        objectMap.set(objNum, objBody);
      }

      // 2. Scan and decompress all PDF streams (especially FlateDecode and ObjStm)
      const streamHeaderRegex = /(\d+)\s+(\d+)\s+obj\s*<<([\s\S]*?)>>\s*stream[\r\n]{1,2}/gi;
      let streamMatch;

      while ((streamMatch = streamHeaderRegex.exec(rawString)) !== null) {
        const objNum = parseInt(streamMatch[1], 10);
        const dictStr = streamMatch[3];
        const streamDataStart = streamHeaderRegex.lastIndex;

        // Find endstream
        const endStreamIdx = rawString.indexOf('endstream', streamDataStart);
        if (endStreamIdx > streamDataStart) {
          const streamRawBytes = rawBytes.subarray(streamDataStart, endStreamIdx);

          // Check if stream is Flate compressed
          if (dictStr.includes('/FlateDecode') || (streamRawBytes.length > 2 && streamRawBytes[0] === 0x78)) {
            const decompressed = await FastInflate.decompress(streamRawBytes);
            if (decompressed && decompressed.length > 0) {
              const decompText = decoder.decode(decompressed);
              allDecompressedTexts.push(decompText);

              // If stream is an Object Stream (/ObjStm), unpack embedded objects
              if (dictStr.includes('/ObjStm')) {
                const nMatch = dictStr.match(/\/N\s+(\d+)/);
                const firstMatch = dictStr.match(/\/First\s+(\d+)/);
                if (nMatch && firstMatch) {
                  const numObjs = parseInt(nMatch[1], 10);
                  const firstOffset = parseInt(firstMatch[1], 10);

                  const headerStr = decompText.substring(0, firstOffset).trim();
                  const headerTokens = headerStr.split(/\s+/).map(Number);

                  for (let k = 0; k < numObjs && (k * 2 + 1) < headerTokens.length; k++) {
                    const subObjNum = headerTokens[k * 2];
                    const subOffset = firstOffset + headerTokens[k * 2 + 1];
                    const nextSubOffset = (k + 1 < numObjs && (k * 2 + 3) < headerTokens.length)
                      ? firstOffset + headerTokens[k * 2 + 3]
                      : decompText.length;

                    const subBody = decompText.substring(subOffset, nextSubOffset).trim();
                    objectMap.set(subObjNum, subBody);
                  }
                }
              }
            }
          }
        }
      }

      // Combine all searchable text for deep inspection
      const allTextCorp = [rawString, ...allDecompressedTexts].join('\n');

      // Helper to resolve an indirect object reference string like "15 0 R"
      const resolveObject = (refStr) => {
        if (!refStr) return null;
        const refMatch = String(refStr).match(/(\d+)\s+\d+\s+R/);
        if (refMatch) {
          const num = parseInt(refMatch[1], 10);
          return objectMap.get(num) || null;
        }
        return null;
      };

      let geoInfo = {
        hasGeoMetadata: false,
        title: 'Plano Topográfico',
        crsName: 'WGS 84 (GPS)',
        epsgCode: 4326,
        bbox: null,
        mediabox: null,
        gpts: null,
        lpts: null,
        bounds: null,
        gcps: []
      };

      // Extract MediaBox
      const mediaBoxMatch = allTextCorp.match(/\/MediaBox\s*\[\s*([\d\.\s\-]+)\]/i);
      let mediaBox = [0, 0, 595.28, 841.89];
      if (mediaBoxMatch) {
        mediaBox = mediaBoxMatch[1].trim().split(/\s+/).map(Number);
      }
      geoInfo.mediabox = mediaBox;

      // Extract Document Title if available
      const titleMatch = allTextCorp.match(/\/Title\s*\(([^)]+)\)/i);
      if (titleMatch) {
        geoInfo.title = titleMatch[1].trim();
      }

      let rawGpts = null;
      let rawLpts = null;
      let rawBbox = null;
      let rawCrsDef = null;

      // =========================================================================
      // Strategy 1: ISO 32000-1 / Adobe GeoPDF Viewports (/VP & /Measure)
      // =========================================================================
      
      // Look for /VP references or inline definitions across all objects and texts
      for (const [objNum, objText] of objectMap.entries()) {
        if (objText.includes('/Viewport') || objText.includes('/VP') || objText.includes('/Measure')) {
          // Check for BBox
          const bbM = objText.match(/\/BBox\s*\[\s*([\d\.\s\-]+)\]/i);
          if (bbM && !rawBbox) {
            rawBbox = bbM[1].trim().split(/\s+/).map(Number);
          }

          // Check for GPTS & LPTS directly in this object
          const gptsM = objText.match(/\/GPTS\s*\[\s*([\d\.\s\-]+)\]/i);
          if (gptsM && !rawGpts) {
            rawGpts = gptsM[1].trim().split(/\s+/).map(Number);
          }

          const lptsM = objText.match(/\/LPTS\s*\[\s*([\d\.\s\-]+)\]/i);
          if (lptsM && !rawLpts) {
            rawLpts = lptsM[1].trim().split(/\s+/).map(Number);
          }

          // Check for Measure indirect reference
          const measureRefM = objText.match(/\/Measure\s+(\d+\s+\d+\s+R)/i);
          if (measureRefM) {
            const measureObj = resolveObject(measureRefM[1]);
            if (measureObj) {
              const mGpts = measureObj.match(/\/GPTS\s*\[\s*([\d\.\s\-]+)\]/i);
              if (mGpts && !rawGpts) rawGpts = mGpts[1].trim().split(/\s+/).map(Number);

              const mLpts = measureObj.match(/\/LPTS\s*\[\s*([\d\.\s\-]+)\]/i);
              if (mLpts && !rawLpts) rawLpts = mLpts[1].trim().split(/\s+/).map(Number);

              if (measureObj.includes('/GCS') || measureObj.includes('/PROJCS') || measureObj.includes('/EPSG')) {
                rawCrsDef = measureObj;
              }
            }
          }

          // Check for VP indirect reference array on Page: /VP [ 4 0 R ] or /VP 4 0 R
          const vpRefM = objText.match(/\/VP\s*(?:\[\s*)?(\d+\s+\d+\s+R)/i);
          if (vpRefM) {
            const vpObj = resolveObject(vpRefM[1]);
            if (vpObj) {
              const vBbox = vpObj.match(/\/BBox\s*\[\s*([\d\.\s\-]+)\]/i);
              if (vBbox && !rawBbox) rawBbox = vBbox[1].trim().split(/\s+/).map(Number);

              const vGpts = vpObj.match(/\/GPTS\s*\[\s*([\d\.\s\-]+)\]/i);
              if (vGpts && !rawGpts) rawGpts = vGpts[1].trim().split(/\s+/).map(Number);

              const vLpts = vpObj.match(/\/LPTS\s*\[\s*([\d\.\s\-]+)\]/i);
              if (vLpts && !rawLpts) rawLpts = vLpts[1].trim().split(/\s+/).map(Number);

              const vMeasRef = vpObj.match(/\/Measure\s+(\d+\s+\d+\s+R)/i);
              if (vMeasRef) {
                const mObj = resolveObject(vMeasRef[1]);
                if (mObj) {
                  const mGpts = mObj.match(/\/GPTS\s*\[\s*([\d\.\s\-]+)\]/i);
                  if (mGpts && !rawGpts) rawGpts = mGpts[1].trim().split(/\s+/).map(Number);

                  const mLpts = mObj.match(/\/LPTS\s*\[\s*([\d\.\s\-]+)\]/i);
                  if (mLpts && !rawLpts) rawLpts = mLpts[1].trim().split(/\s+/).map(Number);

                  if (!rawCrsDef) rawCrsDef = mObj;
                }
              }
            }
          }
        }
      }

      // Fallback global search over all decompressed text
      if (!rawGpts) {
        const globalGptsM = allTextCorp.match(/\/GPTS\s*\[\s*([\d\.\s\-]+)\]/i);
        if (globalGptsM) {
          rawGpts = globalGptsM[1].trim().split(/\s+/).map(Number);
        }
      }
      if (!rawLpts) {
        const globalLptsM = allTextCorp.match(/\/LPTS\s*\[\s*([\d\.\s\-]+)\]/i);
        if (globalLptsM) {
          rawLpts = globalLptsM[1].trim().split(/\s+/).map(Number);
        }
      }
      if (!rawBbox) {
        const globalBboxM = allTextCorp.match(/\/BBox\s*\[\s*([\d\.\s\-]+)\]/i);
        if (globalBboxM) {
          rawBbox = globalBboxM[1].trim().split(/\s+/).map(Number);
        }
      }

      // =========================================================================
      // Strategy 2: OGC TerraGo GeoPDF (/LGIDict)
      // =========================================================================
      if (!rawGpts && allTextCorp.includes('/LGIDict')) {
        const regMatch = allTextCorp.match(/\/Registration\s*\[\s*([\d\.\s\-]+)\]/i);
        const neatMatch = allTextCorp.match(/\/Neatline\s*\[\s*([\d\.\s\-]+)\]/i);

        if (regMatch) {
          const regVals = regMatch[1].trim().split(/\s+/).map(Number);
          // TerraGo Registration is tuples: [lx, ly, gx, gy, ...]
          if (regVals.length >= 8) {
            const lptsArr = [];
            const gptsArr = [];
            for (let i = 0; i + 3 < regVals.length; i += 4) {
              lptsArr.push(regVals[i], regVals[i + 1]);
              gptsArr.push(regVals[i + 3], regVals[i + 2]); // lat, lng
            }
            rawLpts = lptsArr;
            rawGpts = gptsArr;
          }
        }

        if (neatMatch && !rawBbox) {
          const nVals = neatMatch[1].trim().split(/\s+/).map(Number);
          if (nVals.length >= 4) {
            const xs = [nVals[0], nVals[2], nVals[4] || nVals[0], nVals[6] || nVals[2]];
            const ys = [nVals[1], nVals[3], nVals[5] || nVals[1], nVals[7] || nVals[3]];
            rawBbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          }
        }
      }

      // =========================================================================
      // Process extracted coordinates and CRS
      // =========================================================================
      if (rawGpts && rawGpts.length >= 6) {
        const bbox = rawBbox || [0, 0, mediaBox[2], mediaBox[3]];
        // Default LPTS: Top-Left (0,1), Bottom-Left (0,0), Bottom-Right (1,0), Top-Right (1,1)
        const lpts = (rawLpts && rawLpts.length >= rawGpts.length)
          ? rawLpts
          : [0, 1, 0, 0, 1, 0, 1, 1];

        // CRS Detection
        let detectedCrs = 'wgs84';
        let crsLabel = 'WGS 84 (GPS)';
        let epsg = 4326;

        const crsSearchText = (rawCrsDef || '') + '\n' + allTextCorp;

        if (crsSearchText.match(/9377|ORIGEN[\s_]*NACIONAL|CTM12/i)) {
          detectedCrs = 'epsg9377';
          crsLabel = '🇨🇴 MAGNA-SIRGAS Origen Nacional (EPSG:9377)';
          epsg = 9377;
        } else if (crsSearchText.match(/3116|BOGOTA/i)) {
          detectedCrs = 'epsg3116';
          crsLabel = '🇨🇴 MAGNA-SIRGAS Bogotá (EPSG:3116)';
          epsg = 3116;
        } else if (crsSearchText.match(/3857|900913|WEB\s*MERCATOR/i)) {
          detectedCrs = 'epsg3857';
          crsLabel = '🌐 Web Mercator (EPSG:3857)';
          epsg = 3857;
        } else {
          const epsgMatch = crsSearchText.match(/\/EPSG\s+(\d+)/i) || crsSearchText.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
          if (epsgMatch) {
            epsg = parseInt(epsgMatch[1], 10);
            if (epsg === 9377) {
              detectedCrs = 'epsg9377';
              crsLabel = '🇨🇴 MAGNA-SIRGAS Origen Nacional (EPSG:9377)';
            } else if (epsg === 3116) {
              detectedCrs = 'epsg3116';
              crsLabel = '🇨🇴 MAGNA-SIRGAS Bogotá (EPSG:3116)';
            } else if (epsg >= 32601 && epsg <= 32660) {
              const zone = epsg - 32600;
              detectedCrs = `UTM ${zone}N`;
              crsLabel = `🌐 UTM Zona ${zone}N (EPSG:${epsg})`;
            } else if (epsg >= 32701 && epsg <= 32760) {
              const zone = epsg - 32700;
              detectedCrs = `UTM ${zone}S`;
              crsLabel = `🌐 UTM Zona ${zone}S (EPSG:${epsg})`;
            }
          }
        }

        // Convert GPTS to WGS84 Lat/Lng if coordinates are in projected meters
        const numPoints = Math.floor(rawGpts.length / 2);
        const wgs84Points = [];

        for (let i = 0; i < numPoints; i++) {
          const c1 = rawGpts[2 * i];
          const c2 = rawGpts[2 * i + 1];

          let lat, lng;

          // Check if coordinates are projected meters (e.g. > 360 or < -360)
          if (Math.abs(c1) > 360 || Math.abs(c2) > 360) {
            // Projected coordinates
            const conv = window.georefEngine?.projectedToWgs84(c1, c2, detectedCrs)
              || window.georefEngine?.projectedToWgs84(c2, c1, detectedCrs);

            if (conv) {
              lat = conv.lat;
              lng = conv.lng;
            } else {
              lat = c1;
              lng = c2;
            }
          } else {
            // Geographic coordinates (degrees)
            // ISO 32000-1 specification: [lat0, lon0, lat1, lon1, ...]
            if (Math.abs(c1) <= 90 && Math.abs(c2) <= 180) {
              lat = c1;
              lng = c2;
            } else if (Math.abs(c2) <= 90 && Math.abs(c1) <= 180) {
              lat = c2;
              lng = c1;
            } else {
              lat = c1;
              lng = c2;
            }
          }

          wgs84Points.push({
            index: i,
            lx: lpts[2 * i] !== undefined ? lpts[2 * i] : (i === 0 ? 0 : 1),
            ly: lpts[2 * i + 1] !== undefined ? lpts[2 * i + 1] : (i === 0 ? 1 : 0),
            lat: lat,
            lng: lng
          });
        }

        const validLats = wgs84Points.map(p => p.lat).filter(n => typeof n === 'number' && !isNaN(n));
        const validLngs = wgs84Points.map(p => p.lng).filter(n => typeof n === 'number' && !isNaN(n));

        if (validLats.length >= 3 && validLngs.length >= 3) {
          geoInfo.hasGeoMetadata = true;
          geoInfo.bbox = bbox;
          geoInfo.gpts = rawGpts;
          geoInfo.lpts = lpts;
          geoInfo.mediabox = mediaBox;
          geoInfo.crsName = crsLabel;
          geoInfo.epsgCode = epsg;
          geoInfo.detectedCrs = detectedCrs;

          geoInfo.bounds = [
            [Math.min(...validLats), Math.min(...validLngs)],
            [Math.max(...validLats), Math.max(...validLngs)]
          ];

          // Compute canvas GCPs dynamically based on exact LPTS and MediaBox
          geoInfo.getCanvasGcps = (scale = 2.0) => {
            const [bxMin, byMin, bxMax, byMax] = bbox;
            const [mxMin, myMin, mxMax, myMax] = mediaBox;
            const pageH = myMax - myMin;

            return wgs84Points.map((pt, idx) => {
              // PDF point in points (0,0 is lower-left of MediaBox)
              const pdfPtX = bxMin + pt.lx * (bxMax - bxMin);
              const pdfPtY_fromBottom = byMin + pt.ly * (byMax - byMin);

              // Canvas pixel coordinates (0,0 is top-left of canvas)
              const canvasX = (pdfPtX - mxMin) * scale;
              const canvasY = (myMax - pdfPtY_fromBottom) * scale;

              let cornerName = `Punto ${idx + 1}`;
              if (pt.lx === 0 && pt.ly === 1) cornerName = 'Esquina Sup-Izq';
              else if (pt.lx === 0 && pt.ly === 0) cornerName = 'Esquina Inf-Izq';
              else if (pt.lx === 1 && pt.ly === 0) cornerName = 'Esquina Inf-Der';
              else if (pt.lx === 1 && pt.ly === 1) cornerName = 'Esquina Sup-Der';

              return {
                name: cornerName,
                pdfX: canvasX,
                pdfY: canvasY,
                lat: pt.lat,
                lng: pt.lng
              };
            });
          };
        }
      }

      return geoInfo;
    } catch (e) {
      console.warn('Error durante escaneo de metadatos GeoPDF:', e);
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
