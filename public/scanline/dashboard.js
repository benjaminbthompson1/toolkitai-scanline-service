(function () {
  const { escapeHtml, formatDateTime, clamp, api, dataUrlToBlob, loadImage, scanlineSvg, warpPerspective, applyFilterToCanvas, autoDetectQuad, roundRect } = window.Scanline;
  const app = document.getElementById('app');
  const AI_CONFIGURED = !!window.SCANLINE_AI_CONFIGURED;

  const STATE = { screen: 'list', documents: [], currentId: null, currentDoc: null };

  // ================= toast =================
  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  // ================= shell / list / detail =================
  function topbar() {
    return `<div class="topbar">
      <div class="brand" data-nav="list">${scanlineSvg(40)}<div class="brand-text"><h1>Scanline</h1><div class="tag">Scan, sign, and file your documents</div></div></div>
      <div class="topbar-actions">
        <a class="btn btn-ghost btn-sm" href="/">← Toolkit AI</a>
        ${STATE.screen !== 'list' ? '<button class="btn btn-ghost btn-sm" data-nav="list">All scans</button>' : ''}
        <button class="btn btn-primary btn-sm" data-nav="scan">New scan</button>
        <form method="POST" action="/logout" style="display:inline;"><button class="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
      </div></div>`;
  }

  async function render() {
    let html = topbar();
    if (STATE.screen === 'list') html += await renderList();
    else if (STATE.screen === 'detail') html += await renderDetail();
    app.innerHTML = html;
    wireGlobal();
    if (STATE.screen === 'detail') wireDetail();
  }

  function wireGlobal() {
    app.querySelectorAll('[data-nav="list"]').forEach(el => el.addEventListener('click', () => { STATE.screen = 'list'; STATE.currentId = null; render(); }));
    app.querySelectorAll('[data-nav="scan"]').forEach(el => el.addEventListener('click', () => openScanOverlay({})));
  }

  async function renderList() {
    try { STATE.documents = await api('/scanline/api/documents'); }
    catch (e) { return `<p class="banner banner-warn">Could not load your scans: ${escapeHtml(e.message)}</p>`; }
    if (!STATE.documents.length) {
      return `<div class="empty-state">${scanlineSvg(60)}<h2 style="margin-top:14px;">No scans yet</h2>
        <p class="muted" style="max-width:420px; margin:0 auto 20px;">Turn your camera into a scanner for documents, receipts, and IDs — and keep everything in one place.</p>
        <button class="btn btn-primary" data-nav="scan">Scan your first document</button></div>`;
    }
    const rows = STATE.documents.map(d => `<div class="doc-row" data-id="${d.id}">
        <div class="doc-thumb" style="${!d.locked && d.page_count ? `background-image:url('/scanline/api/documents/${d.id}/thumbnail')` : ''}">
          ${d.locked ? lockGlyph() : ''}
        </div>
        <div class="doc-row-main"><h3>${escapeHtml(d.title)}</h3>
          <div class="faint">${d.page_count} page${d.page_count === 1 ? '' : 's'} · updated ${formatDateTime(d.updated_at)}</div>
        </div>
        ${d.locked ? '<span class="badge badge-locked">Locked</span>' : ''}
      </div>`).join('');
    return `<div class="doc-list">${rows}</div>`;
  }
  function lockGlyph() {
    return `<div class="lock-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>`;
  }

  window.addEventListener('click', (e) => {
    const row = e.target.closest('.doc-row');
    if (row && STATE.screen === 'list') openDocument(row.getAttribute('data-id'));
  });

  async function openDocument(id) {
    STATE.currentId = id;
    let doc;
    try { doc = await api('/scanline/api/documents/' + id); }
    catch (e) { toast(e.message || 'Could not open that scan.'); return; }
    if (doc.locked && !doc.page_ids.length && doc.page_count > 0) {
      showUnlockModal(doc, () => openDocument(id));
      return;
    }
    STATE.currentDoc = doc;
    STATE.screen = 'detail';
    render();
  }

  async function renderDetail() {
    const doc = STATE.currentDoc;
    if (!doc) return '<p class="banner banner-warn">Scan not found.</p>';
    const pageThumbs = doc.page_ids.map((pid, i) => `<div class="page-thumb-card" data-page-id="${pid}">
        <img src="/scanline/api/documents/${doc.id}/pages/${pid}" loading="lazy">
        <div class="page-num">${i + 1}</div>
        <button class="page-del-btn" data-action="delete-page" data-page-id="${pid}" title="Delete page">✕</button>
        ${i > 0 ? `<button class="page-order-btn left" data-action="move-page" data-page-id="${pid}" data-dir="-1">‹</button>` : ''}
        ${i < doc.page_ids.length - 1 ? `<button class="page-order-btn right" data-action="move-page" data-page-id="${pid}" data-dir="1">›</button>` : ''}
      </div>`).join('');

    return `<div class="page-card" style="padding:24px 26px;">
      <input type="text" id="docTitleInput" value="${escapeHtml(doc.title)}" placeholder="Untitled scan"
        style="width:100%; background:transparent; border:none; color:var(--ink); font-size:20px; font-weight:600; font-family:'Space Grotesk',sans-serif; padding:4px 0 10px; border-bottom:1px solid var(--card-border);">
      <div class="faint" style="margin-top:8px;">${doc.page_count} page${doc.page_count === 1 ? '' : 's'} · updated ${formatDateTime(doc.updated_at)}${doc.locked ? ' · <span style="color:var(--amber);">Locked</span>' : ''}</div>
      <div class="page-grid">${pageThumbs}</div>

      <div class="section-label">Tools</div>
      <div class="tool-grid">
        <button class="tool-card" data-tool="add-pages">${iconPlus()}<div class="tname">Add pages</div><div class="tsub">Scan more into this document</div></button>
        <button class="tool-card" data-tool="annotate">${iconPen()}<div class="tname">Sign &amp; annotate</div><div class="tsub">Signature, text, shapes</div></button>
        <button class="tool-card" data-tool="pagenum">${iconHash()}<div class="tname">Page numbers</div><div class="tsub">Stamp onto every page</div></button>
        <button class="tool-card" data-tool="ocr">${iconSparkle()}<div class="tname">OCR &amp; summarize</div><div class="tsub">${AI_CONFIGURED ? 'Extract text with AI' : 'Not configured on this server'}</div></button>
        <button class="tool-card" data-tool="lock">${iconLock()}<div class="tname">${doc.locked ? 'Manage password' : 'Lock document'}</div><div class="tsub">${doc.locked ? 'Change or remove password' : 'Protect with a password'}</div></button>
        <button class="tool-card" data-tool="delete">${iconTrash()}<div class="tname">Delete document</div><div class="tsub">Removes all pages permanently</div></button>
      </div>

      <div id="ocrPanel" class="hidden" style="margin-top:28px;">
        <div class="section-label" style="margin-top:0;">OCR &amp; summarize</div>
        <div style="display:flex; gap:10px; margin-bottom:14px;">
          <button class="btn btn-primary btn-sm" id="btnOcrExtract" ${AI_CONFIGURED ? '' : 'disabled'}>Extract text</button>
          <button class="btn btn-sm" id="btnOcrSummarize" ${AI_CONFIGURED ? '' : 'disabled'}>Summarize</button>
        </div>
        <div class="ai-out placeholder" id="ocrOut">${AI_CONFIGURED ? 'Choose an action above.' : 'AI features are not configured on this server.'}</div>
      </div>

      <hr class="hr">
      <a class="btn btn-primary" href="/scanline/api/documents/${doc.id}/download">Download PDF</a>
    </div>`;
  }

  function iconPlus() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`; }
  function iconPen() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`; }
  function iconHash() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>`; }
  function iconSparkle() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.9L19 9.8l-4.9 1.9L12 17l-1.9-5.3L5 9.8l4.9-1.9z"/></svg>`; }
  function iconLock() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`; }
  function iconTrash() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>`; }

  function wireDetail() {
    const doc = STATE.currentDoc;
    const titleInput = document.getElementById('docTitleInput');
    titleInput.addEventListener('change', async () => {
      try { await api(`/scanline/api/documents/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: titleInput.value }) }); toast('Renamed'); }
      catch (e) { toast(e.message || 'Could not rename.'); }
    });

    app.querySelectorAll('[data-action="move-page"]').forEach(btn => btn.addEventListener('click', () => movePage(btn.getAttribute('data-page-id'), parseInt(btn.getAttribute('data-dir')))));
    app.querySelectorAll('[data-action="delete-page"]').forEach(btn => btn.addEventListener('click', () => deletePage(btn.getAttribute('data-page-id'))));

    app.querySelectorAll('[data-tool]').forEach(btn => btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool');
      if (tool === 'add-pages') openScanOverlay({ targetDocId: doc.id });
      else if (tool === 'annotate') pickPageThen(doc, (pageId) => openAnnotateOverlay(doc.id, pageId));
      else if (tool === 'pagenum') applyPageNumbers(doc);
      else if (tool === 'ocr') { document.getElementById('ocrPanel').classList.remove('hidden'); wireOcrPanel(doc); }
      else if (tool === 'lock') openLockFlow(doc);
      else if (tool === 'delete') confirmDeleteDoc(doc);
    }));
  }

  function pickPageThen(doc, cb) {
    if (doc.page_ids.length === 1) { cb(doc.page_ids[0]); return; }
    showSheet(doc.page_ids.map((pid, i) => ({ label: `Page ${i + 1}`, action: () => cb(pid) })), 'Choose a page');
  }

  async function movePage(pageId, dir) {
    const doc = STATE.currentDoc;
    const order = doc.page_ids.slice();
    const i = order.indexOf(pageId), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    doc.page_ids = order;
    render();
    try { await api(`/scanline/api/documents/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_order: order }) }); }
    catch (e) { toast('Could not save the new order.'); }
  }

  async function deletePage(pageId) {
    const doc = STATE.currentDoc;
    if (!confirm('Delete this page?')) return;
    try {
      const r = await api(`/scanline/api/documents/${doc.id}/pages/${pageId}`, { method: 'DELETE' });
      doc.page_ids = r.page_order;
      render();
      toast('Page deleted');
    } catch (e) { toast(e.message || 'Could not delete page.'); }
  }

  async function confirmDeleteDoc(doc) {
    showConfirm('Delete this scan?', 'This permanently removes it and every page. This cannot be undone.', async () => {
      try { await api(`/scanline/api/documents/${doc.id}`, { method: 'DELETE' }); STATE.screen = 'list'; render(); toast('Scan deleted'); }
      catch (e) { toast(e.message || 'Could not delete.'); }
    }, true);
  }

  // ================= OCR panel =================
  function wireOcrPanel(doc) {
    const out = document.getElementById('ocrOut');
    if (doc.ocr_text || doc.summary_text) {
      out.className = 'ai-out';
      out.textContent = doc.summary_text || doc.ocr_text;
    }
    document.getElementById('btnOcrExtract').onclick = () => runOcr(doc, 'text');
    document.getElementById('btnOcrSummarize').onclick = () => runOcr(doc, 'summary');
  }
  async function runOcr(doc, kind) {
    const out = document.getElementById('ocrOut');
    out.className = 'ai-out'; out.innerHTML = '<span class="ai-dots"><span></span><span></span><span></span></span>';
    try {
      const r = await api(`/scanline/api/documents/${doc.id}/ocr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
      out.textContent = r.text;
      if (r.truncated) toast('Only the first 10 pages were analyzed.');
    } catch (e) {
      out.className = 'ai-out placeholder';
      out.textContent = e.message || 'Something went wrong. Please try again.';
    }
  }

  // ================= lock / unlock =================
  function openLockFlow(doc) {
    if (doc.locked) {
      showModal(`
        <h3>Manage password</h3>
        <p class="faint" style="margin-bottom:16px;">This document is locked.</p>
        <div class="modal-actions" style="display:flex; flex-direction:column; gap:8px;">
          <button class="btn btn-primary btn-block" id="btnChangePw">Change password</button>
          <button class="btn btn-danger btn-block" id="btnRemovePw">Remove password</button>
        </div>`, () => {
        document.getElementById('btnChangePw').onclick = () => { closeOverlayModal(); showSetPasswordModal(doc); };
        document.getElementById('btnRemovePw').onclick = async () => {
          try { await api(`/scanline/api/documents/${doc.id}/remove-lock`, { method: 'POST' }); doc.locked = false; closeOverlayModal(); toast('Password removed'); render(); }
          catch (e) { toast(e.message || 'Could not remove password.'); }
        };
      });
    } else {
      showSetPasswordModal(doc);
    }
  }
  function showSetPasswordModal(doc) {
    showModal(`
      <h3>Lock this document</h3>
      <p class="faint" style="margin-bottom:16px;">Requires this password to view or download this scan, even while signed in.</p>
      <div class="field"><label>Password</label><input type="password" id="pw1"></div>
      <div class="field"><label>Confirm password</label><input type="password" id="pw2"></div>
      <div class="banner banner-error hidden" id="pwErr"></div>
      <div style="display:flex; gap:10px; margin-top:6px;"><button class="btn btn-block" id="pwCancel">Cancel</button><button class="btn btn-primary btn-block" id="pwSave">Lock</button></div>
    `, () => {
      document.getElementById('pwCancel').onclick = closeOverlayModal;
      document.getElementById('pwSave').onclick = async () => {
        const a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
        const err = document.getElementById('pwErr');
        if (a.length < 4) { err.textContent = 'Use at least 4 characters.'; err.classList.remove('hidden'); return; }
        if (a !== b) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
        try {
          await api(`/scanline/api/documents/${doc.id}/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: a }) });
          doc.locked = true; closeOverlayModal(); toast('Document locked'); render();
        } catch (e) { err.textContent = e.message || 'Could not lock this document.'; err.classList.remove('hidden'); }
      };
    });
  }
  function showUnlockModal(docSummary, onSuccess) {
    showModal(`
      <h3>Enter password</h3>
      <p class="faint" style="margin-bottom:16px;">"${escapeHtml(docSummary.title)}" is locked.</p>
      <div class="field"><input type="password" id="unlockPw" placeholder="Password"></div>
      <div class="banner banner-error hidden" id="unlockErr"></div>
      <div style="display:flex; gap:10px;"><button class="btn btn-block" id="unlockCancel">Cancel</button><button class="btn btn-primary btn-block" id="unlockGo">Unlock</button></div>
    `, () => {
      document.getElementById('unlockCancel').onclick = () => { closeOverlayModal(); STATE.screen = 'list'; render(); };
      const go = async () => {
        const pw = document.getElementById('unlockPw').value;
        const err = document.getElementById('unlockErr');
        try {
          await api(`/scanline/api/documents/${docSummary.id}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
          closeOverlayModal(); onSuccess();
        } catch (e) { err.textContent = e.message || 'Incorrect password.'; err.classList.remove('hidden'); }
      };
      document.getElementById('unlockGo').onclick = go;
      document.getElementById('unlockPw').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      setTimeout(() => document.getElementById('unlockPw').focus(), 80);
    });
  }

  // ================= page numbers =================
  async function applyPageNumbers(doc) {
    showConfirm('Add page numbers?', `Stamps "page / total" onto the bottom-right corner of all ${doc.page_ids.length} pages.`, async () => {
      toast('Adding page numbers…');
      for (let i = 0; i < doc.page_ids.length; i++) {
        const pid = doc.page_ids[i];
        const img = await loadImage(`/scanline/api/documents/${doc.id}/pages/${pid}`);
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        const label = `${i + 1} / ${doc.page_ids.length}`;
        const fontSize = Math.round(img.width * 0.032);
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        const tw = ctx.measureText(label).width;
        const pad = fontSize * 0.6;
        const bx = img.width - tw - pad * 2 - fontSize * 0.5, by = img.height - fontSize * 2 - fontSize * 0.3;
        ctx.fillStyle = 'rgba(0,0,0,.62)'; roundRect(ctx, bx, by, tw + pad * 2, fontSize * 1.7, 8); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, bx + pad, by + fontSize * 0.85);
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
        const fd = new FormData(); fd.append('page', blob, 'page.jpg');
        await api(`/scanline/api/documents/${doc.id}/pages/${pid}`, { method: 'PUT', body: fd });
      }
      toast('Page numbers added');
      openDocument(doc.id);
    });
  }

  // ================= sheets / modals / confirm (shared full-screen overlay layer) =================
  let modalLayer = null;
  function ensureModalLayer() {
    if (modalLayer) return modalLayer;
    modalLayer = document.createElement('div'); modalLayer.className = 'overlay'; modalLayer.style.display = 'none';
    document.body.appendChild(modalLayer);
    modalLayer.addEventListener('click', (e) => { if (e.target === modalLayer) closeOverlayModal(); });
    return modalLayer;
  }
  function closeOverlayModal() { if (modalLayer) { modalLayer.style.display = 'none'; modalLayer.innerHTML = ''; } }
  function showModal(html, wire) {
    const ov = ensureModalLayer(); ov.style.display = 'flex';
    ov.innerHTML = `<div class="modal">${html}</div>`;
    wire && wire();
  }
  function showSheet(items, title) {
    showModal(`${title ? `<h3>${escapeHtml(title)}</h3>` : ''}<div style="display:flex; flex-direction:column;">${
      items.map((it, i) => `<button class="btn btn-ghost" style="justify-content:flex-start; margin-bottom:6px;" data-i="${i}">${escapeHtml(it.label)}</button>`).join('')
    }</div>`, () => {
      document.querySelectorAll('.overlay .modal [data-i]').forEach(el => el.onclick = () => { const it = items[parseInt(el.getAttribute('data-i'))]; closeOverlayModal(); it.action(); });
    });
  }
  function showConfirm(title, msg, onConfirm, danger) {
    showModal(`<h3>${escapeHtml(title)}</h3><p class="faint" style="margin-bottom:18px;">${escapeHtml(msg)}</p>
      <div style="display:flex; gap:10px;"><button class="btn btn-block" id="cfNo">Cancel</button>
      <button class="btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}" id="cfYes">Confirm</button></div>`, () => {
      document.getElementById('cfNo').onclick = closeOverlayModal;
      document.getElementById('cfYes').onclick = () => { closeOverlayModal(); onConfirm(); };
    });
  }

  // ================= scan overlay (camera + batch) =================
  const PRESETS = [
    { id: 'document', label: 'Document', ratio: null },
    { id: 'id', label: 'ID card', ratio: 1.586 },
    { id: 'passport', label: 'Passport', ratio: 1.42 },
    { id: 'receipt', label: 'Receipt', ratio: 0.38 },
    { id: 'qr', label: 'QR / barcode', ratio: null }
  ];
  let scanCtx = null; // { targetDocId, preset, pages: [Blob], stream, facing, qrTimer, qrDetector }

  function openScanOverlay(opts) {
    scanCtx = { targetDocId: opts.targetDocId || null, preset: 'document', pages: [], stream: null, facing: 'environment', qrTimer: null, qrDetector: null };
    const ov = document.createElement('div'); ov.className = 'scan-overlay'; ov.id = 'scanOverlay';
    ov.innerHTML = `
      <div class="cam-wrap">
        <video id="scanVideo" autoplay playsinline muted></video>
        <div class="cam-dim"></div>
        <div class="cam-off hidden" id="camOff"></div>
        <div class="cam-top">
          <button class="round-ghost" id="btnScanClose">${iconClose()}</button>
          <div style="color:#fff;font-weight:600;font-size:14.5px;">${scanCtx.targetDocId ? 'Add pages' : 'New scan'}</div>
          <button class="round-ghost" id="btnFlipCam">${iconFlip()}</button>
        </div>
        <div class="preset-strip" id="presetStrip"></div>
        <div class="guide-frame" id="guideFrame" style="display:none;"></div>
        <div id="qrResult" class="hidden" style="position:absolute; left:14px; right:14px; bottom:190px; background:var(--card); border:1px solid var(--card-border); border-radius:14px; padding:14px; z-index:4;">
          <div class="faint" id="qrType" style="margin-bottom:4px;"></div>
          <div id="qrText" style="font-size:14px; word-break:break-all; margin-bottom:10px;"></div>
          <div style="display:flex; gap:8px;"><button class="btn btn-sm" id="qrDismiss">Keep scanning</button><button class="btn btn-primary btn-sm" id="qrOpen">Open</button></div>
        </div>
        <div class="cam-bottom">
          <div class="batch-strip hidden" id="batchStrip"></div>
          <div class="cam-controls">
            <div></div>
            <button class="shutter" id="btnShutter"></button>
            <button class="done-btn hidden" id="btnBatchDone">Done</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    renderPresetStrip();
    document.getElementById('btnScanClose').onclick = closeScanOverlay;
    document.getElementById('btnFlipCam').onclick = async () => { scanCtx.facing = scanCtx.facing === 'environment' ? 'user' : 'environment'; await startCamera(); };
    document.getElementById('btnShutter').onclick = onShutter;
    document.getElementById('btnBatchDone').onclick = finishBatch;
    document.getElementById('qrDismiss').onclick = () => document.getElementById('qrResult').classList.add('hidden');
    startCamera();
  }
  function iconClose() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`; }
  function iconFlip() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 12v-2a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 12v2a4 4 0 0 1-4 4H3"/></svg>`; }

  function renderPresetStrip() {
    const strip = document.getElementById('presetStrip'); strip.innerHTML = '';
    for (const p of PRESETS) {
      const chip = document.createElement('div');
      chip.className = 'preset-chip' + (scanCtx.preset === p.id ? ' active' : '');
      chip.textContent = p.label;
      chip.onclick = () => { scanCtx.preset = p.id; renderPresetStrip(); updateGuideFrame(); toggleQrMode(); };
      strip.appendChild(chip);
    }
  }
  function updateGuideFrame() {
    const gf = document.getElementById('guideFrame');
    const preset = PRESETS.find(p => p.id === scanCtx.preset);
    if (!preset || !preset.ratio) { gf.style.display = 'none'; return; }
    const wrap = document.querySelector('#scanOverlay .cam-wrap');
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    let gw = cw * 0.82, gh = gw / preset.ratio;
    if (gh > ch * 0.5) { gh = ch * 0.5; gw = gh * preset.ratio; }
    gf.style.width = gw + 'px'; gf.style.height = gh + 'px';
    gf.style.left = ((cw - gw) / 2) + 'px'; gf.style.top = ((ch - gh) / 2 - 20) + 'px';
    gf.style.display = 'block';
  }
  async function startCamera() {
    const camOff = document.getElementById('camOff'); camOff.classList.add('hidden');
    try {
      if (scanCtx.stream) scanCtx.stream.getTracks().forEach(t => t.stop());
      scanCtx.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: scanCtx.facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      document.getElementById('scanVideo').srcObject = scanCtx.stream;
      toggleQrMode(); updateGuideFrame();
    } catch (e) {
      camOff.classList.remove('hidden');
      camOff.innerHTML = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l22 22M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l1 1.5"/><circle cx="12" cy="13" r="3.5"/></svg>
        <p style="max-width:280px; text-align:center;">${e.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in your browser settings to scan.' : 'Camera is unavailable right now.'}</p>
        <button class="btn btn-primary" id="btnCamRetry">Try again</button>`;
      document.getElementById('btnCamRetry').onclick = startCamera;
    }
  }
  function toggleQrMode() {
    if (scanCtx.qrTimer) { clearInterval(scanCtx.qrTimer); scanCtx.qrTimer = null; }
    document.getElementById('qrResult').classList.add('hidden');
    if (scanCtx.preset === 'qr') {
      if ('BarcodeDetector' in window) startQrScan();
      else toast('Barcode scanning is not supported in this browser.');
    }
  }
  function startQrScan() {
    try { scanCtx.qrDetector = new window.BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'code_39', 'pdf417'] }); }
    catch (e) { return; }
    scanCtx.qrTimer = setInterval(async () => {
      const video = document.getElementById('scanVideo');
      if (!video || video.readyState < 2) return;
      try {
        const codes = await scanCtx.qrDetector.detect(video);
        if (codes && codes.length) {
          const c = codes[0];
          document.getElementById('qrType').textContent = (c.format || 'CODE').toUpperCase().replace('_', ' ') + ' DETECTED';
          document.getElementById('qrText').textContent = c.rawValue;
          document.getElementById('qrResult').classList.remove('hidden');
          document.getElementById('qrOpen').onclick = () => {
            if (/^https?:\/\//i.test(c.rawValue)) window.open(c.rawValue, '_blank');
            else { navigator.clipboard && navigator.clipboard.writeText(c.rawValue).catch(() => {}); toast('Copied to clipboard'); }
          };
        }
      } catch (e) {}
    }, 700);
  }
  function stopCamera() {
    if (scanCtx.stream) { scanCtx.stream.getTracks().forEach(t => t.stop()); scanCtx.stream = null; }
    if (scanCtx.qrTimer) { clearInterval(scanCtx.qrTimer); scanCtx.qrTimer = null; }
  }
  function closeScanOverlay() {
    const proceed = () => {
      stopCamera();
      const ov = document.getElementById('scanOverlay'); if (ov) ov.remove();
      scanCtx = null;
    };
    if (scanCtx && scanCtx.pages.length) {
      showConfirm('Discard scan?', `You have ${scanCtx.pages.length} unsaved page${scanCtx.pages.length === 1 ? '' : 's'}. Leave without saving?`, proceed, true);
    } else proceed();
  }

  function onShutter() {
    if (scanCtx.preset === 'qr') { toast('Point the camera at a code — no photo needed.'); return; }
    const video = document.getElementById('scanVideo');
    if (!video.videoWidth) { toast('Camera still starting…'); return; }
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    openCropOverlay(c.toDataURL('image/jpeg', 0.92), c.width, c.height);
  }

  function renderBatchStrip() {
    const strip = document.getElementById('batchStrip');
    if (!strip) return;
    const hasPages = scanCtx.pages.length > 0;
    strip.classList.toggle('hidden', !hasPages);
    document.getElementById('btnBatchDone').classList.toggle('hidden', !hasPages);
    strip.innerHTML = scanCtx.pages.map(p => `<div class="batch-thumb" style="background-image:url('${p.previewUrl}')"></div>`).join('');
  }

  async function finishBatch() {
    if (!scanCtx.pages.length) return;
    const btn = document.getElementById('btnBatchDone'); btn.disabled = true; btn.textContent = 'Saving…';
    const fd = new FormData();
    if (!scanCtx.targetDocId) {
      const title = suggestTitle();
      fd.append('title', title);
    }
    scanCtx.pages.forEach((p, i) => fd.append('pages', p.blob, `page-${i}.jpg`));
    try {
      let result;
      if (scanCtx.targetDocId) result = await api(`/scanline/api/documents/${scanCtx.targetDocId}/pages`, { method: 'POST', body: fd });
      else result = await api('/scanline/api/documents', { method: 'POST', body: fd });
      const openId = scanCtx.targetDocId || result.id;
      stopCamera();
      document.getElementById('scanOverlay').remove();
      scanCtx = null;
      toast('Saved');
      openDocument(openId);
    } catch (e) {
      toast(e.message || 'Could not save the scan.');
      btn.disabled = false; btn.textContent = 'Done';
    }
  }
  function suggestTitle() {
    const d = new Date();
    return 'Scan ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // ================= crop overlay =================
  const FILTER_MODES = [{ id: 'color', label: 'Color' }, { id: 'gray', label: 'Grayscale' }, { id: 'bw', label: 'B & W' }, { id: 'enhance', label: 'Enhance' }];
  let cropCtx = null;

  async function openCropOverlay(dataUrl, w, h) {
    cropCtx = { dataUrl, w, h, quad: null, filter: 'color' };
    const ov = document.createElement('div'); ov.className = 'crop-overlay'; ov.id = 'cropOverlay';
    ov.innerHTML = `
      <div class="topbar" style="margin-bottom:0; padding:14px 16px;">
        <button class="round-ghost" id="btnCropRetake" style="background:var(--card); border-color:var(--card-border); color:var(--ink);">↺</button>
        <h1 style="font-size:16px;">Adjust edges</h1>
        <button class="round-ghost" id="btnCropAuto" style="background:var(--card); border-color:var(--card-border); color:var(--ink);">✨</button>
      </div>
      <div class="crop-stage" id="cropStage">
        <div class="crop-img-wrap" id="cropImgWrap">
          <img id="cropImg" draggable="false">
          <svg class="crop-svg" id="cropSvg"></svg>
          <div class="corner-dot" id="dotTl"></div><div class="corner-dot" id="dotTr"></div>
          <div class="corner-dot" id="dotBr"></div><div class="corner-dot" id="dotBl"></div>
        </div>
      </div>
      <div class="crop-toolbar">
        <div class="mode-row" id="filterRow"></div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-block" id="btnCropDiscard">Discard</button>
          <button class="btn btn-primary" style="flex:2;" id="btnCropUse">Use page</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    renderFilterRow();
    const img = document.getElementById('cropImg');
    img.src = dataUrl;
    await new Promise(r => img.onload = r);
    layoutCropStage();
    document.getElementById('btnCropRetake').onclick = document.getElementById('btnCropDiscard').onclick = closeCropOverlay;
    document.getElementById('btnCropAuto').onclick = runAutoDetect;
    document.getElementById('btnCropUse').onclick = useCroppedPage;
    window.addEventListener('resize', onCropResize);
  }
  function onCropResize() { if (cropCtx) layoutCropStage(); }
  function closeCropOverlay() {
    window.removeEventListener('resize', onCropResize);
    const ov = document.getElementById('cropOverlay'); if (ov) ov.remove();
    cropCtx = null;
  }
  function renderFilterRow() {
    const row = document.getElementById('filterRow'); row.innerHTML = '';
    for (const f of FILTER_MODES) {
      const pill = document.createElement('div');
      pill.className = 'mode-pill' + (cropCtx.filter === f.id ? ' active' : '');
      pill.textContent = f.label;
      pill.onclick = () => { cropCtx.filter = f.id; renderFilterRow(); };
      row.appendChild(pill);
    }
  }
  function layoutCropStage() {
    const wrap = document.getElementById('cropImgWrap'), img = document.getElementById('cropImg');
    requestAnimationFrame(() => {
      const rect = img.getBoundingClientRect();
      wrap.style.width = rect.width + 'px'; wrap.style.height = rect.height + 'px';
      let quad = autoDetectQuad(img);
      if (!quad) {
        const iX = rect.width * 0.08, iY = rect.height * 0.08;
        quad = { tl: { x: iX, y: iY }, tr: { x: rect.width - iX, y: iY }, br: { x: rect.width - iX, y: rect.height - iY }, bl: { x: iX, y: rect.height - iY } };
      } else {
        const sx = rect.width / cropCtx.w, sy = rect.height / cropCtx.h;
        quad = { tl: { x: quad.tl.x * sx, y: quad.tl.y * sy }, tr: { x: quad.tr.x * sx, y: quad.tr.y * sy }, br: { x: quad.br.x * sx, y: quad.br.y * sy }, bl: { x: quad.bl.x * sx, y: quad.bl.y * sy } };
      }
      cropCtx.quad = quad;
      drawCropOverlay();
    });
  }
  function drawCropOverlay() {
    const svg = document.getElementById('cropSvg'); const { tl, tr, br, bl } = cropCtx.quad;
    svg.innerHTML = `<polygon points="${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}" fill="rgba(226,163,61,.16)" stroke="#5fb98a" stroke-width="2.5"/>`;
    document.getElementById('dotTl').style.left = tl.x + 'px'; document.getElementById('dotTl').style.top = tl.y + 'px';
    document.getElementById('dotTr').style.left = tr.x + 'px'; document.getElementById('dotTr').style.top = tr.y + 'px';
    document.getElementById('dotBr').style.left = br.x + 'px'; document.getElementById('dotBr').style.top = br.y + 'px';
    document.getElementById('dotBl').style.left = bl.x + 'px'; document.getElementById('dotBl').style.top = bl.y + 'px';
  }
  ['Tl', 'Tr', 'Br', 'Bl'].forEach(K => {
    const key = K.toLowerCase();
    const dot = () => document.getElementById('dot' + K);
    let dragging = false;
    document.addEventListener('pointerdown', (e) => { if (e.target === dot()) { dragging = key; e.preventDefault(); } });
    document.addEventListener('pointermove', (e) => {
      if (dragging !== key || !cropCtx) return;
      const rect = document.getElementById('cropImgWrap').getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width), y = clamp(e.clientY - rect.top, 0, rect.height);
      cropCtx.quad[key] = { x, y };
      drawCropOverlay();
    });
    document.addEventListener('pointerup', () => { dragging = false; });
  });
  function runAutoDetect() {
    const img = document.getElementById('cropImg');
    const quad = autoDetectQuad(img);
    if (!quad) { toast('Could not detect edges — adjust corners manually.'); return; }
    const rect = img.getBoundingClientRect();
    const sx = rect.width / cropCtx.w, sy = rect.height / cropCtx.h;
    cropCtx.quad = { tl: { x: quad.tl.x * sx, y: quad.tl.y * sy }, tr: { x: quad.tr.x * sx, y: quad.tr.y * sy }, br: { x: quad.br.x * sx, y: quad.br.y * sy }, bl: { x: quad.bl.x * sx, y: quad.bl.y * sy } };
    drawCropOverlay();
  }
  async function useCroppedPage() {
    const img = document.getElementById('cropImg');
    const rect = img.getBoundingClientRect();
    const sx = cropCtx.w / rect.width, sy = cropCtx.h / rect.height;
    const q = cropCtx.quad;
    const srcQuad = {
      tl: { x: q.tl.x * sx, y: q.tl.y * sy }, tr: { x: q.tr.x * sx, y: q.tr.y * sy },
      br: { x: q.br.x * sx, y: q.br.y * sy }, bl: { x: q.bl.x * sx, y: q.bl.y * sy }
    };
    const wTop = Math.hypot(srcQuad.tr.x - srcQuad.tl.x, srcQuad.tr.y - srcQuad.tl.y);
    const wBot = Math.hypot(srcQuad.br.x - srcQuad.bl.x, srcQuad.br.y - srcQuad.bl.y);
    const hL = Math.hypot(srcQuad.bl.x - srcQuad.tl.x, srcQuad.bl.y - srcQuad.tl.y);
    const hR = Math.hypot(srcQuad.br.x - srcQuad.tr.x, srcQuad.br.y - srcQuad.tr.y);
    let outW = Math.round(Math.max(wTop, wBot)), outH = Math.round(Math.max(hL, hR));
    const maxDim = 2000;
    if (outW > maxDim || outH > maxDim) { const s = maxDim / Math.max(outW, outH); outW = Math.round(outW * s); outH = Math.round(outH * s); }
    outW = Math.max(outW, 80); outH = Math.max(outH, 80);

    const srcCanvas = document.createElement('canvas'); srcCanvas.width = cropCtx.w; srcCanvas.height = cropCtx.h;
    const rawImg = await loadImage(cropCtx.dataUrl);
    srcCanvas.getContext('2d').drawImage(rawImg, 0, 0);

    toast('Processing…');
    await new Promise(r => requestAnimationFrame(r));
    let outCanvas = warpPerspective(srcCanvas, srcQuad, outW, outH);
    outCanvas = applyFilterToCanvas(outCanvas, cropCtx.filter);
    const blob = await new Promise(res => outCanvas.toBlob(res, 'image/jpeg', cropCtx.filter === 'bw' ? 0.82 : 0.88));
    const previewUrl = URL.createObjectURL(blob);

    closeCropOverlay();
    scanCtx.pages.push({ blob, previewUrl });
    renderBatchStrip();
  }

  // ================= annotate overlay =================
  let annoCtx = null;
  async function openAnnotateOverlay(docId, pageId) {
    const img = await loadImage(`/scanline/api/documents/${docId}/pages/${pageId}`);
    const ov = document.createElement('div'); ov.className = 'anno-overlay'; ov.id = 'annoOverlay';
    ov.innerHTML = `
      <div class="topbar" style="margin-bottom:0; padding:14px 16px;">
        <button class="round-ghost" id="btnAnnoCancel" style="background:var(--card); border-color:var(--card-border); color:var(--ink);">✕</button>
        <h1 style="font-size:16px;">Sign &amp; annotate</h1>
        <button class="round-ghost" id="btnAnnoUndo" style="background:var(--card); border-color:var(--card-border); color:var(--ink);">↶</button>
      </div>
      <div class="anno-stage"><div class="anno-canvas-wrap" id="annoCanvasWrap"><canvas id="annoCanvas"></canvas></div></div>
      <div class="anno-toolbar">
        <div class="anno-colors" id="annoColors"></div>
        <div class="anno-tools">
          <button class="anno-tool active" data-tool="pen">✎</button>
          <button class="anno-tool" data-tool="text">T</button>
          <button class="anno-tool" data-tool="rect">▭</button>
          <button class="anno-tool" data-tool="circle">◯</button>
          <button class="anno-tool" data-tool="arrow">↗</button>
          <button class="anno-tool" data-tool="erase">⌫</button>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-block" id="btnAnnoCancel2">Cancel</button>
          <button class="btn btn-primary btn-block" id="btnAnnoDone">Apply to page</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const canvas = document.getElementById('annoCanvas');
    const maxW = Math.min(window.innerWidth - 24, 560), maxH = document.querySelector('.anno-stage').clientHeight || 500;
    const cssScale = Math.min(maxW / img.width, maxH / img.height, 1);
    const cssW = img.width * cssScale, cssH = img.height * cssScale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxScale = Math.min(cssScale * dpr, 1.6);
    canvas.width = img.width * pxScale; canvas.height = img.height * pxScale;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';

    annoCtx = { docId, pageId, img, strokes: [], tool: 'pen', color: '#e2a33d', drawing: false, current: null };
    renderAnnoColors(); redrawAnno(); wireAnnoCanvas();

    document.getElementById('btnAnnoCancel').onclick = document.getElementById('btnAnnoCancel2').onclick = closeAnnoOverlay;
    document.getElementById('btnAnnoUndo').onclick = () => { if (annoCtx.strokes.length) { annoCtx.strokes.pop(); redrawAnno(); } };
    document.getElementById('btnAnnoDone').onclick = applyAnnotation;
    document.querySelectorAll('.anno-tool').forEach(btn => btn.onclick = () => {
      document.querySelectorAll('.anno-tool').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); annoCtx.tool = btn.getAttribute('data-tool');
    });
  }
  function closeAnnoOverlay() { const ov = document.getElementById('annoOverlay'); if (ov) ov.remove(); annoCtx = null; }
  function renderAnnoColors() {
    const colors = ['#e2a33d', '#f3f1ec', '#e2603d', '#5fb98a', '#4f8bd6', '#111215'];
    const wrap = document.getElementById('annoColors'); wrap.innerHTML = '';
    colors.forEach(c => {
      const sw = document.createElement('div'); sw.className = 'swatch' + (c === annoCtx.color ? ' sel' : ''); sw.style.background = c;
      sw.onclick = () => { annoCtx.color = c; renderAnnoColors(); };
      wrap.appendChild(sw);
    });
  }
  function redrawAnno() {
    const canvas = document.getElementById('annoCanvas'); const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(annoCtx.img, 0, 0, canvas.width, canvas.height);
    for (const s of annoCtx.strokes) drawStroke(ctx, s);
  }
  function drawStroke(ctx, s) {
    ctx.save(); ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width || 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.type === 'pen') { ctx.beginPath(); s.points.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)); ctx.stroke(); }
    else if (s.type === 'rect') ctx.strokeRect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
    else if (s.type === 'circle') { const rx = Math.abs(s.x1 - s.x0) / 2, ry = Math.abs(s.y1 - s.y0) / 2; ctx.beginPath(); ctx.ellipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (s.type === 'arrow') drawArrow(ctx, s.x0, s.y0, s.x1, s.y1);
    else if (s.type === 'text') { ctx.font = `600 ${s.size}px Inter, sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(s.text, s.x0, s.y0); }
    ctx.restore();
  }
  function drawArrow(ctx, x0, y0, x1, y1) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    const ang = Math.atan2(y1 - y0, x1 - x0), len = 12;
    ctx.beginPath(); ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - len * Math.cos(ang - 0.4), y1 - len * Math.sin(ang - 0.4));
    ctx.lineTo(x1 - len * Math.cos(ang + 0.4), y1 - len * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }
  function annoPos(e) {
    const canvas = document.getElementById('annoCanvas'); const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    const rx = canvas.width / rect.width, ry = canvas.height / rect.height;
    return { x: (p.clientX - rect.left) * rx, y: (p.clientY - rect.top) * ry };
  }
  function strokeHit(s, pos, tol) {
    if (s.type === 'pen') return s.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < tol);
    if (s.type === 'text') return Math.hypot(s.x0 - pos.x, s.y0 - pos.y) < 40;
    const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
    return Math.hypot(cx - pos.x, cy - pos.y) < Math.max(Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0)) / 2 + tol;
  }
  function wireAnnoCanvas() {
    const canvas = document.getElementById('annoCanvas');
    canvas.onpointerdown = (e) => {
      e.preventDefault();
      const pos = annoPos(e);
      if (annoCtx.tool === 'text') { placeTextInput(pos, e); return; }
      if (annoCtx.tool === 'erase') { annoCtx.strokes = annoCtx.strokes.filter(s => !strokeHit(s, pos, 18)); redrawAnno(); return; }
      annoCtx.drawing = true;
      annoCtx.current = annoCtx.tool === 'pen' ? { type: 'pen', color: annoCtx.color, width: 4, points: [pos] } : { type: annoCtx.tool, color: annoCtx.color, width: 3, x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
    };
    canvas.onpointermove = (e) => {
      if (!annoCtx.drawing) return; e.preventDefault();
      const pos = annoPos(e);
      if (annoCtx.tool === 'pen') annoCtx.current.points.push(pos); else { annoCtx.current.x1 = pos.x; annoCtx.current.y1 = pos.y; }
      redrawAnno(); drawStroke(canvas.getContext('2d'), annoCtx.current);
    };
    const end = () => {
      if (!annoCtx.drawing) return;
      annoCtx.drawing = false;
      if (annoCtx.current) { annoCtx.strokes.push(annoCtx.current); annoCtx.current = null; redrawAnno(); }
    };
    canvas.onpointerup = end; canvas.onpointerleave = end;
  }
  function placeTextInput(pos, srcEvent) {
    const wrap = document.getElementById('annoCanvasWrap'), canvas = document.getElementById('annoCanvas');
    const rect = canvas.getBoundingClientRect(), wrapRect = wrap.getBoundingClientRect();
    const p = srcEvent.touches ? srcEvent.touches[0] : srcEvent;
    const cssX = p.clientX - wrapRect.left, cssY = p.clientY - wrapRect.top;
    const fontCssPx = 26 * (rect.width / canvas.width);
    const inp = document.createElement('input');
    inp.className = 'text-input-overlay';
    inp.style.left = cssX + 'px'; inp.style.top = cssY + 'px'; inp.style.fontSize = Math.max(12, fontCssPx) + 'px'; inp.style.color = annoCtx.color;
    wrap.appendChild(inp); inp.focus();
    const commit = () => {
      const val = inp.value.trim();
      if (inp.parentNode) wrap.removeChild(inp);
      if (val) { annoCtx.strokes.push({ type: 'text', color: annoCtx.color, size: 26, x0: pos.x, y0: pos.y, text: val }); redrawAnno(); }
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  }
  async function applyAnnotation() {
    const canvas = document.getElementById('annoCanvas');
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    const fd = new FormData(); fd.append('page', blob, 'page.jpg');
    try {
      await api(`/scanline/api/documents/${annoCtx.docId}/pages/${annoCtx.pageId}`, { method: 'PUT', body: fd });
      closeAnnoOverlay();
      toast('Applied');
      openDocument(STATE.currentId);
    } catch (e) { toast(e.message || 'Could not save the annotation.'); }
  }

  render();
})();
