window.Scanline = (function () {
  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatDateTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
    if (!res.ok) {
      let msg = 'Request failed';
      try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res;
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = meta.match(/data:(.*);base64/)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  }

  function scanlineSvg(size, extraClass) {
    size = size || 40;
    return `<svg class="app-icon-svg ${extraClass || ''}" width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="scanGradIcon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#F0B44E"/><stop offset="100%" stop-color="#C97F2B"/>
      </linearGradient></defs>
      <rect x="4" y="4" width="92" height="92" rx="20" fill="#1B1D22" stroke="url(#scanGradIcon)" stroke-width="2"/>
      <path d="M26 32h48a4 4 0 0 1 4 4v34" fill="none" stroke="#4B4E58" stroke-width="3" stroke-linecap="round"/>
      <path d="M22 30 L22 66 A6 6 0 0 0 28 72 L72 72" fill="none" stroke="url(#scanGradIcon)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="28" cy="30" r="3.5" fill="url(#scanGradIcon)"/>
      <circle cx="72" cy="72" r="3.5" fill="url(#scanGradIcon)"/>
      <line x1="34" y1="50" x2="66" y2="50" stroke="#F0B44E" stroke-width="3" stroke-linecap="round" opacity="0.9"/>
    </svg>`;
  }

  // ---------------- perspective warp (Heckbert square-to-quad) ----------------
  function squareToQuadCoeffs(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx1 = x1 - x2, dy1 = y1 - y2, dx2 = x3 - x2, dy2 = y3 - y2;
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dy1 * dx2;
    let g = 0, h = 0;
    if (Math.abs(den) > 1e-10) { g = (sx * dy2 - sy * dx2) / den; h = (dx1 * sy - dy1 * sx) / den; }
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
    const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
    return { a, b, c, d, e, f, g, h };
  }
  function warpPerspective(srcCanvas, quad, outW, outH) {
    const { a, b, c, d, e, f, g, h } = squareToQuadCoeffs(
      quad.tl.x, quad.tl.y, quad.tr.x, quad.tr.y, quad.br.x, quad.br.y, quad.bl.x, quad.bl.y
    );
    const sctx = srcCanvas.getContext('2d');
    const sw = srcCanvas.width, sh = srcCanvas.height;
    const src = sctx.getImageData(0, 0, sw, sh).data;
    const out = document.createElement('canvas'); out.width = outW; out.height = outH;
    const octx = out.getContext('2d');
    const outImg = octx.createImageData(outW, outH);
    const od = outImg.data;
    for (let py = 0; py < outH; py++) {
      const v = py / outH;
      for (let px = 0; px < outW; px++) {
        const u = px / outW;
        const wgt = g * u + h * v + 1;
        const sx = (a * u + b * v + c) / wgt, sy = (d * u + e * v + f) / wgt;
        const di = (py * outW + px) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) { od[di + 3] = 0; continue; }
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x0 + 1) * 4, i01 = ((y0 + 1) * sw + x0) * 4, i11 = ((y0 + 1) * sw + x0 + 1) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx;
          const bot = src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx;
          od[di + ch] = top * (1 - fy) + bot * fy;
        }
        od[di + 3] = 255;
      }
    }
    octx.putImageData(outImg, 0, 0);
    return out;
  }

  function applyFilterToCanvas(canvas, mode) {
    if (mode === 'color') return canvas;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    if (mode === 'gray' || mode === 'enhance') {
      for (let i = 0; i < d.length; i += 4) {
        let gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        if (mode === 'enhance') gray = clamp((gray - 128) * 1.35 + 128 + 14, 0, 255);
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
    } else if (mode === 'bw') {
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const mean = sum / (d.length / 4);
      const thresh = clamp(mean * 0.86, 90, 200);
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const v = gray > thresh ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // ---------------- lightweight foreground-based auto-detect ----------------
  function autoDetectQuad(img) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const sw = 200, sh = Math.round(sw * H / W);
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const lum = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) lum[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    let bsum = 0, bn = 0; const ring = 3;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (x < ring || y < ring || x >= sw - ring || y >= sh - ring) { bsum += lum[y * sw + x]; bn++; }
    const bg = bsum / bn;
    const mask = new Uint8Array(sw * sh);
    let fgCount = 0;
    for (let i = 0; i < sw * sh; i++) if (Math.abs(lum[i] - bg) > 28) { mask[i] = 1; fgCount++; }
    if (fgCount < sw * sh * 0.04) return null;
    const visited = new Uint8Array(sw * sh);
    let best = null, bestSize = 0;
    const qx = new Int32Array(sw * sh), qy = new Int32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const idx = y * sw + x;
      if (!mask[idx] || visited[idx]) continue;
      let qh = 0, qt = 0; qx[qt] = x; qy[qt] = y; qt++; visited[idx] = 1;
      let minx = x, maxx = x, miny = y, maxy = y, size = 0;
      while (qh < qt) {
        const cx = qx[qh], cy = qy[qh]; qh++; size++;
        if (cx < minx) minx = cx; if (cx > maxx) maxx = cx; if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
        const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          const nidx = ny * sw + nx;
          if (mask[nidx] && !visited[nidx]) { visited[nidx] = 1; qx[qt] = nx; qy[qt] = ny; qt++; }
        }
      }
      if (size > bestSize) { bestSize = size; best = { minx, maxx, miny, maxy }; }
    }
    if (!best || bestSize < sw * sh * 0.04) return null;
    const pad = 0.01;
    const x0 = clamp(best.minx / sw - pad, 0, 1) * W, x1 = clamp(best.maxx / sw + pad, 0, 1) * W;
    const y0 = clamp(best.miny / sh - pad, 0, 1) * H, y1 = clamp(best.maxy / sh + pad, 0, 1) * H;
    return { tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, br: { x: x1, y: y1 }, bl: { x: x0, y: y1 } };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  return {
    escapeHtml, formatDateTime, clamp, api, dataUrlToBlob, loadImage, scanlineSvg,
    warpPerspective, applyFilterToCanvas, autoDetectQuad, roundRect
  };
})();
