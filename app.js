'use strict';

const fileInput      = document.getElementById('fileInput');
const uploadSection  = document.getElementById('uploadSection');
const resultSection  = document.getElementById('resultSection');
const resultCanvas   = document.getElementById('resultCanvas');
const shareBtn       = document.getElementById('shareBtn');
const saveBtn        = document.getElementById('saveBtn');
const resetBtn       = document.getElementById('resetBtn');

let outputBlob = null;

// ── File selection ───────────────────────────────────────────────────────────

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) processFile(file);
});

async function processFile(file) {
  showLoading();
  try {
    const bitmap = await createImageBitmap(file);
    renderCircleCrop(bitmap);
    bitmap.close();
  } catch (err) {
    hideLoading();
    showToast('Could not load image — please try another.');
    console.error('Image load error:', err);
  }
}

// ── Circle crop ──────────────────────────────────────────────────────────────

function renderCircleCrop(bitmap) {
  // Largest centered square
  const size = Math.min(bitmap.width, bitmap.height);
  const srcX = (bitmap.width  - size) / 2;
  const srcY = (bitmap.height - size) / 2;

  resultCanvas.width  = size;
  resultCanvas.height = size;

  const ctx = resultCanvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Circular clip
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  ctx.drawImage(bitmap, srcX, srcY, size, size, 0, 0, size, size);

  resultCanvas.toBlob((blob) => {
    outputBlob = blob;
    hideLoading();
    uploadSection.hidden = true;
    resultSection.hidden = false;
  }, 'image/png');
}

// ── Actions ──────────────────────────────────────────────────────────────────

shareBtn.addEventListener('click', async () => {
  if (!outputBlob) return;
  const file = new File([outputBlob], 'circle-crop.png', { type: 'image/png' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Circle Crop' });
    } catch (err) {
      // AbortError means user dismissed the sheet — that's fine
      if (err.name !== 'AbortError') {
        downloadBlob();
      }
    }
  } else {
    downloadBlob();
  }
});

saveBtn.addEventListener('click', downloadBlob);

resetBtn.addEventListener('click', () => {
  outputBlob = null;
  fileInput.value = '';
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

// ── UI helpers ───────────────────────────────────────────────────────────────

function showLoading() {
  if (document.getElementById('loadingOverlay')) return;
  const overlay  = document.createElement('div');
  overlay.id     = 'loadingOverlay';
  overlay.className = 'loading-overlay';
  const spinner  = document.createElement('div');
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

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}
