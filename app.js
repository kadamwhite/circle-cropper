'use strict';

// ── DOM references ────────────────────────────────────────────────────────────

const fileInput     = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const editorSection = document.getElementById('editorSection');
const editorCanvas  = document.getElementById('editorCanvas');
const cropBtn       = document.getElementById('cropBtn');
const cancelBtn     = document.getElementById('cancelBtn');
const resultSection = document.getElementById('resultSection');
const resultImg     = document.getElementById('resultImg');
const saveBtn       = document.getElementById('saveBtn');
const resetBtn      = document.getElementById('resetBtn');

let outputBlob     = null;
let displayBlobUrl = null;

// ── Editor state ──────────────────────────────────────────────────────────────

let editorImg   = null;   // source HTMLImageElement (kept for final render)
let editorCtx   = null;   // 2d context of the interactive canvas
let editorThumb = null;   // offscreen canvas: image pre-drawn at display size
let editorCssW  = 0;      // CSS width of the interactive canvas
let editorCssH  = 0;      // CSS height of the interactive canvas
let editorScale = 1;      // CSS pixels per image pixel (uniform — aspect preserved)

// Crop circle in image-space pixels
const crop = { cx: 0, cy: 0, r: 0 };

// ── File selection ────────────────────────────────────────────────────────────

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) processFile(file);
});

function processFile(file) {
  showLoading();
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    hideLoading();
    uploadSection.hidden = true;
    editorSection.hidden = false; // must be visible before initEditor measures clientWidth
    initEditor(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    hideLoading();
    showToast('Could not load image — please try another.');
  };
  img.src = url;
}

// ── Editor initialisation ─────────────────────────────────────────────────────

function initEditor(img) {
  editorImg = img;
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;

  // Fit the canvas to the available column width; cap height at 65dvh
  const maxCssW = editorCanvas.parentElement.clientWidth;
  const maxCssH = Math.round(window.innerHeight * 0.65);
  const aspect  = imgW / imgH;

  let cssW = maxCssW;
  let cssH = Math.round(cssW / aspect);
  if (cssH > maxCssH) {
    cssH = maxCssH;
    cssW = Math.round(cssH * aspect);
  }

  editorCssW  = cssW;
  editorCssH  = cssH;
  editorScale = cssW / imgW; // image px → CSS px

  // Physical canvas pixels = CSS size × DPR for sharp rendering
  const dpr = window.devicePixelRatio || 1;
  editorCanvas.width        = Math.round(cssW * dpr);
  editorCanvas.height       = Math.round(cssH * dpr);
  editorCanvas.style.width  = cssW + 'px';
  editorCanvas.style.height = cssH + 'px';

  editorCtx = editorCanvas.getContext('2d');
  editorCtx.scale(dpr, dpr); // work in CSS pixel coordinates from here

  // Pre-render the source image at display resolution once.
  // Every subsequent draw blits this offscreen canvas rather than
  // scaling the full-resolution source image on each frame.
  const thumb = document.createElement('canvas');
  thumb.width  = Math.round(cssW * dpr);
  thumb.height = Math.round(cssH * dpr);
  const tCtx = thumb.getContext('2d');
  tCtx.imageSmoothingEnabled = true;
  tCtx.imageSmoothingQuality = 'high';
  tCtx.drawImage(img, 0, 0, thumb.width, thumb.height);
  editorThumb = thumb;

  // Default: largest centred circle
  crop.r  = Math.min(imgW, imgH) / 2;
  crop.cx = imgW / 2;
  crop.cy = imgH / 2;

  drawEditor();
}

// ── Editor rendering ──────────────────────────────────────────────────────────

let rafPending = false;

function scheduleRedraw() {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; drawEditor(); });
  }
}

function drawEditor() {
  const ctx = editorCtx;
  const W   = editorCssW;
  const H   = editorCssH;
  const sc  = editorScale;

  // Blit pre-rendered thumbnail (fast: 1-to-1 pixel copy, no rescaling)
  ctx.drawImage(editorThumb, 0, 0, W, H);

  // Darkened overlay with circular hole.
  // evenodd fill rule: the rect covers the whole canvas; the
  // counterclockwise arc subtracts the circle, leaving a clear window.
  const cx = crop.cx * sc;
  const cy = crop.cy * sc;
  const r  = crop.r  * sc;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cx, cy, r, 0, Math.PI * 2, /* counterclockwise */ true);
  ctx.fill('evenodd');

  // Crisp white ring on the crop boundary
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

// ── Crop constraints ──────────────────────────────────────────────────────────

function clampCrop(cx, cy, r) {
  const imgW = editorImg.naturalWidth;
  const imgH = editorImg.naturalHeight;
  const minR = Math.min(imgW, imgH) * 0.05;
  const maxR = Math.min(imgW, imgH) / 2;
  r  = Math.max(minR, Math.min(maxR, r));
  cx = Math.max(r, Math.min(imgW - r, cx));
  cy = Math.max(r, Math.min(imgH - r, cy));
  return { cx, cy, r };
}

// ── Touch interaction ─────────────────────────────────────────────────────────

let touchState = null;

function clientToEditor(clientX, clientY) {
  const rect = editorCanvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function touchesCenter(touches) {
  if (touches.length === 1) return clientToEditor(touches[0].clientX, touches[0].clientY);
  const a = clientToEditor(touches[0].clientX, touches[0].clientY);
  const b = clientToEditor(touches[1].clientX, touches[1].clientY);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function touchesSpan(touches) {
  if (touches.length < 2) return 0;
  const a = clientToEditor(touches[0].clientX, touches[0].clientY);
  const b = clientToEditor(touches[1].clientX, touches[1].clientY);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

editorCanvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  touchState = {
    startCrop:   { ...crop },
    startCenter: touchesCenter(e.touches),
    startSpan:   touchesSpan(e.touches),
    isPinch:     e.touches.length >= 2,
  };
}, { passive: false });

editorCanvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!touchState) return;
  const sc = editorScale;

  if (touchState.isPinch && e.touches.length >= 2) {
    const span        = touchesSpan(e.touches);
    const center      = touchesCenter(e.touches);
    const scaleDelta  = touchState.startSpan > 0 ? span / touchState.startSpan : 1;
    const dx = (center.x - touchState.startCenter.x) / sc;
    const dy = (center.y - touchState.startCenter.y) / sc;

    const clamped = clampCrop(
      touchState.startCrop.cx + dx,
      touchState.startCrop.cy + dy,
      touchState.startCrop.r  * scaleDelta,
    );
    crop.cx = clamped.cx;
    crop.cy = clamped.cy;
    crop.r  = clamped.r;

  } else if (!touchState.isPinch && e.touches.length === 1) {
    const center = touchesCenter(e.touches);
    const dx = (center.x - touchState.startCenter.x) / sc;
    const dy = (center.y - touchState.startCenter.y) / sc;

    const clamped = clampCrop(
      touchState.startCrop.cx + dx,
      touchState.startCrop.cy + dy,
      crop.r,
    );
    crop.cx = clamped.cx;
    crop.cy = clamped.cy;
  }

  scheduleRedraw();
}, { passive: false });

editorCanvas.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    touchState = null;
  } else if (e.touches.length === 1 && touchState?.isPinch) {
    // One finger lifted after a pinch — restart pan from current state
    touchState = {
      startCrop:   { ...crop },
      startCenter: touchesCenter(e.touches),
      startSpan:   0,
      isPinch:     false,
    };
  }
});

// ── Mouse interaction (desktop) ───────────────────────────────────────────────

let mouseState = null;

editorCanvas.addEventListener('mousedown', (e) => {
  mouseState = { startCrop: { ...crop }, startX: e.clientX, startY: e.clientY };
});

window.addEventListener('mousemove', (e) => {
  if (!mouseState) return;
  const sc = editorScale;
  const dx = (e.clientX - mouseState.startX) / sc;
  const dy = (e.clientY - mouseState.startY) / sc;
  const clamped = clampCrop(mouseState.startCrop.cx + dx, mouseState.startCrop.cy + dy, crop.r);
  crop.cx = clamped.cx;
  crop.cy = clamped.cy;
  scheduleRedraw();
});

window.addEventListener('mouseup', () => { mouseState = null; });

// Scroll wheel resizes the circle on desktop
editorCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Use a relative scale so speed feels consistent at any radius size
  const ticks  = e.deltaY / 100;
  const factor = Math.pow(0.95, ticks); // ±5 % per 100-unit scroll tick
  const clamped = clampCrop(crop.cx, crop.cy, crop.r * factor);
  crop.cx = clamped.cx;
  crop.cy = clamped.cy;
  crop.r  = clamped.r;
  scheduleRedraw();
}, { passive: false });

// ── Editor actions ────────────────────────────────────────────────────────────

cropBtn.addEventListener('click', () => {
  showLoading();
  renderCircleCrop(editorImg, crop.cx, crop.cy, crop.r);
});

cancelBtn.addEventListener('click', () => {
  editorSection.hidden = true;
  uploadSection.hidden = false;
});

// ── Final circle crop render ──────────────────────────────────────────────────

function renderCircleCrop(img, cx, cy, r) {
  // Work in whole pixels; the crop geometry is already constrained to the image
  const diameter = Math.round(r * 2);
  const srcX     = Math.round(cx - r);
  const srcY     = Math.round(cy - r);

  const canvas  = document.createElement('canvas');
  canvas.width  = diameter;
  canvas.height = diameter;

  // Display P3 preserves wide-gamut iPhone colours; unsupporting browsers fall back to sRGB
  const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, diameter, diameter);

  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.drawImage(img, srcX, srcY, diameter, diameter, 0, 0, diameter, diameter);

  canvas.toBlob((blob) => {
    hideLoading(); // always dismiss spinner first — a throw below must not leave it up

    if (!blob) {
      // iOS can pass null when the canvas exceeds its memory budget
      showToast('Could not encode image — try a smaller crop area.');
      return;
    }

    outputBlob = blob;
    if (displayBlobUrl) URL.revokeObjectURL(displayBlobUrl);
    displayBlobUrl = URL.createObjectURL(blob);
    resultImg.src  = displayBlobUrl;
    editorSection.hidden = true;
    resultSection.hidden = false;
  }, 'image/png');
}

// ── Result actions ────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', shareOrDownload);

async function shareOrDownload() {
  if (!outputBlob) return;

  // Prefer the native share sheet (iOS → "Save Image" lands in Photos).
  // Attempt it directly; if the browser rejects for any reason other than
  // the user dismissing, fall back to a plain blob download.
  if (navigator.share) {
    const file = new File([outputBlob], 'circle-crop.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user dismissed — nothing to do
      // Any other error (NotAllowedError, DataError, …): fall through to download
    }
  }

  downloadBlob();
}

resetBtn.addEventListener('click', () => {
  outputBlob = null;
  if (displayBlobUrl) {
    URL.revokeObjectURL(displayBlobUrl);
    displayBlobUrl = null;
  }
  resultImg.src = '';
  fileInput.value = '';
  editorSection.hidden = true;
  resultSection.hidden = true;
  uploadSection.hidden = false;
});

function downloadBlob() {
  if (!outputBlob) return;
  const url = URL.createObjectURL(outputBlob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = 'circle-crop.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function showLoading() {
  if (document.getElementById('loadingOverlay')) return;
  const overlay     = document.createElement('div');
  overlay.id        = 'loadingOverlay';
  overlay.className = 'loading-overlay';
  const spinner     = document.createElement('div');
  spinner.className = 'spinner';
  overlay.appendChild(spinner);
  document.body.appendChild(overlay);
}

function hideLoading() {
  document.getElementById('loadingOverlay')?.remove();
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast       = document.createElement('div');
  toast.className   = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}
