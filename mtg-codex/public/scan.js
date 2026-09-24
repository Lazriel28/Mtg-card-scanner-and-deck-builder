'use strict';
/* Scan view: live camera, snap a card photo, OCR, confirm the match.
   Rendered by app.js's router (renderScan). */

// camera state is module-level so re-entering the view can resume cleanly
let _stream = null;
let _video = null;

function stopCamera() {
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  if (_video) { _video.srcObject = null; _video = null; }
}
window.addEventListener('pagehide', stopCamera);

async function renderScan() {
  const view = $('#view-scan');
  view.textContent = '';

  view.append(el('h1', {}, 'Scan cards'));
  view.append(el('p', { class: 'muted' }, 'Point the camera at a card — the name is read and matched against the catalog. Snap → confirm → it lands in your collection, auto-categorized.'));

  if (!lastStatus || !lastStatus.catalog.synced) {
    view.append(el('p', { class: 'panel' }, 'The card catalog is not synced yet — sync it first (banner at the top).'));
    return;
  }

  const wrap = el('div', { class: 'camera-wrap' });
  const video = el('video', { playsinline: '', autoplay: '', muted: '' });
  const preview = el('img', { class: 'preview hidden' });
  const frame = el('div', { class: 'scan-frame' });
  const hint = el('div', { class: 'scan-hint' }, 'fit the card inside the frame');
  wrap.append(video, preview, frame, hint);

  const snapBtn = el('button', { class: 'primary', disabled: '' }, '📷 Snap card');
  const filePick = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const fileBtn = el('button', {}, 'Upload photo instead');
  fileBtn.onclick = () => filePick.click();

  const manual = el('input', { placeholder: '…or type the card name' });
  const candidates = el('div', { class: 'candidates' });
  const statusLine = el('p', { class: 'muted small' }, 'camera starting…');

  view.append(el('div', { class: 'row', style: 'align-items:flex-start' },
    wrap,
    el('div', { class: 'grow', style: 'min-width:260px' },
      statusLine,
      el('div', { class: 'row' }, snapBtn, fileBtn),
      filePick,
      el('div', { class: 'row', style: 'margin-top:10px' }, manual),
      candidates)));

  // ---- camera ----
  const startCamera = async () => {
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      _video = video;
      video.srcObject = _stream;
      await video.play().catch(() => {});
      statusLine.textContent = 'Ready. Fill the frame with the card and snap.';
      snapBtn.disabled = false;
    } catch (e) {
      statusLine.textContent = 'Camera unavailable (' + e.name + ') — use "Upload photo instead" or type the name.';
      snapBtn.disabled = true;
    }
  };
  startCamera();

  // capture the current frame, downscaled so upload stays fast
  const grabFrame = () => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  };

  const runScan = async dataUrl => {
    candidates.textContent = 'Reading the card…';
    try {
      const r = await api('/api/scan', { method: 'POST', body: { imageDataUrl: dataUrl } });
      showCandidates(r);
    } catch (e) {
      candidates.textContent = '';
      candidates.append(el('p', { class: 'muted' }, 'Scan failed: ' + e.message));
    }
  };

  function showCandidates(r) {
    candidates.textContent = '';
    if (!r.candidates.length) {
      candidates.append(el('p', { class: 'muted' }, 'No confident match. Try better lighting, or type the name below.'));
    }
    for (const cand of r.candidates) {
      const row = el('div', { class: 'candidate' },
        el('img', { src: '/api/cards/thumb?name=' + encodeURIComponent(cand.name), alt: '' }),
        el('div', { class: 'cinfo' },
          el('div', { class: 'cname' }, cand.name),
          el('div', { class: 'csub' }, 'confidence ' + (cand.score * 100).toFixed(0) + '%')),
        el('div', { class: 'confidence' }, (cand.score * 100).toFixed(0) + '%'));
      row.addEventListener('click', async () => {
        try {
          await api('/api/collection/add', {
            method: 'POST',
            body: { name: cand.name, qty: 1, photo: r.photo },
          });
          toast('Added ' + cand.name + ' to collection');
          candidates.textContent = '';
          refreshStatus();
        } catch (e) { toast(e.message, true); }
      });
      candidates.append(row);
    }
  }

  snapBtn.onclick = () => {
    const d = grabFrame();
    if (!d) { toast('Camera not ready yet', true); return; }
    preview.src = d;
    preview.classList.remove('hidden');
    runScan(d);
  };

  filePick.onchange = () => {
    const f = filePick.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = reader.result;
      preview.classList.remove('hidden');
      runScan(reader.result);
    };
    reader.readAsDataURL(f);
  };

  manual.addEventListener('keydown', async ev => {
    if (ev.key === 'Enter' && manual.value.trim()) {
      try {
        const r = await api('/api/cards/get?name=' + encodeURIComponent(manual.value));
        showCandidates({ candidates: [{ name: r.name, score: 1 }], photo: null });
      } catch (e) { toast(e.message, true); }
      manual.value = '';
    }
  });
}
