(() => {
  'use strict';

  const FILE_INPUT_SELECTOR = '#v-payroll-file, [data-file-index]';
  let activeInput = null;
  let sourceFile = null;
  let sourceImage = null;
  let sourceUrl = '';

  const style = document.createElement('style');
  style.textContent = `
    .privacy-crop-modal { position:fixed; inset:0; z-index:10000; display:none; align-items:flex-end; justify-content:center; padding:12px; background:rgba(0,0,0,.72); }
    .privacy-crop-modal.open { display:flex; }
    .privacy-crop-dialog { width:min(100%,560px); max-height:calc(100vh - 24px); overflow:auto; padding:20px; border-radius:24px; background:#fff; box-shadow:0 20px 60px rgba(0,0,0,.35); }
    .privacy-crop-dialog h2 { margin:0 0 7px; font-size:22px; }
    .privacy-crop-dialog > p { margin:0 0 14px; color:#5f5f65; font-size:14px; line-height:1.4; }
    .privacy-crop-stage { position:relative; width:100%; height:min(46vh,420px); min-height:210px; overflow:hidden; border-radius:14px; background:#1d1d1f; }
    .privacy-crop-stage img { display:block; width:100%; height:100%; max-height:46vh; object-fit:contain; }
    .privacy-crop-box { position:absolute; border:3px solid #e30613; box-shadow:0 0 0 9999px rgba(0,0,0,.55); pointer-events:none; }
    .privacy-crop-grid { position:absolute; inset:0; background:linear-gradient(90deg,transparent 33%,rgba(255,255,255,.6) 33%,rgba(255,255,255,.6) 33.5%,transparent 33.5%,transparent 66%,rgba(255,255,255,.6) 66%,rgba(255,255,255,.6) 66.5%,transparent 66.5%),linear-gradient(transparent 33%,rgba(255,255,255,.6) 33%,rgba(255,255,255,.6) 33.5%,transparent 33.5%,transparent 66%,rgba(255,255,255,.6) 66%,rgba(255,255,255,.6) 66.5%,transparent 66.5%); }
    .privacy-crop-controls { display:grid; grid-template-columns:1fr 1fr; gap:10px 14px; margin-top:15px; }
    .privacy-crop-controls label { margin:0; color:#343438; font-size:12px; font-weight:800; }
    .privacy-crop-controls input { width:100%; min-height:30px; padding:0; accent-color:#e30613; }
    .privacy-crop-confirm { display:flex; gap:10px; align-items:flex-start; margin:15px 0 0; padding:12px; border-radius:13px; background:#fff4f5; color:#333; font-size:13px; line-height:1.4; }
    .privacy-crop-confirm input { flex:0 0 auto; width:20px; min-height:20px; margin:0; accent-color:#e30613; }
    .privacy-crop-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; }
    .privacy-crop-actions button { min-height:48px; border-radius:999px; font-weight:800; cursor:pointer; }
    .privacy-crop-cancel { border:1px solid #cfcfd3; background:#fff; color:#18181b; }
    .privacy-crop-save { border:0; background:#e30613; color:#fff; }
    .privacy-crop-save:disabled { cursor:not-allowed; opacity:.45; }
    .privacy-crop-error { min-height:18px; margin:9px 2px 0 !important; color:#b9000b !important; font-size:12px !important; }
    @media (min-width:620px) { .privacy-crop-modal { align-items:center; } }
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'privacy-crop-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'privacy-crop-title');
  modal.innerHTML = `
    <div class="privacy-crop-dialog">
      <h2 id="privacy-crop-title">Recorta la zona necesaria</h2>
      <p>Deja dentro del marco únicamente los conceptos, cantidades y devengos. Excluye nombre, DNI, número de empleado, cuenta bancaria, dirección, fechas y códigos personales.</p>
      <div class="privacy-crop-stage">
        <img alt="Vista previa de la nómina para recortar">
        <div class="privacy-crop-box" aria-hidden="true"><div class="privacy-crop-grid"></div></div>
      </div>
      <div class="privacy-crop-controls">
        <label>Izquierda<input data-edge="left" type="range" min="0" max="80" value="0"></label>
        <label>Derecha<input data-edge="right" type="range" min="20" max="100" value="100"></label>
        <label>Arriba<input data-edge="top" type="range" min="0" max="80" value="35"></label>
        <label>Abajo<input data-edge="bottom" type="range" min="20" max="100" value="100"></label>
      </div>
      <label class="privacy-crop-confirm"><input type="checkbox">He comprobado que dentro del marco no aparecen datos personales.</label>
      <p class="privacy-crop-error" role="alert"></p>
      <div class="privacy-crop-actions">
        <button class="privacy-crop-cancel" type="button">Cancelar</button>
        <button class="privacy-crop-save" type="button" disabled>Usar este recorte</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const preview = modal.querySelector('img');
  const stage = modal.querySelector('.privacy-crop-stage');
  const cropBox = modal.querySelector('.privacy-crop-box');
  const checkbox = modal.querySelector('.privacy-crop-confirm input');
  const saveButton = modal.querySelector('.privacy-crop-save');
  const cancelButton = modal.querySelector('.privacy-crop-cancel');
  const errorBox = modal.querySelector('.privacy-crop-error');
  const sliders = Object.fromEntries([...modal.querySelectorAll('[data-edge]')].map((input) => [input.dataset.edge, input]));

  function values() {
    return Object.fromEntries(Object.entries(sliders).map(([key, input]) => [key, Number(input.value)]));
  }

  function validCrop(rect) {
    return rect.right - rect.left >= 20 && rect.bottom - rect.top >= 15;
  }

  function renderCrop() {
    const rect = values();
    const valid = validCrop(rect);
    if (sourceImage?.naturalWidth && stage.clientWidth && stage.clientHeight) {
      const scale = Math.min(stage.clientWidth / sourceImage.naturalWidth, stage.clientHeight / sourceImage.naturalHeight);
      const imageWidth = sourceImage.naturalWidth * scale;
      const imageHeight = sourceImage.naturalHeight * scale;
      const offsetX = (stage.clientWidth - imageWidth) / 2;
      const offsetY = (stage.clientHeight - imageHeight) / 2;
      cropBox.style.left = `${offsetX + imageWidth * rect.left / 100}px`;
      cropBox.style.top = `${offsetY + imageHeight * rect.top / 100}px`;
      cropBox.style.width = `${imageWidth * Math.max(0, rect.right - rect.left) / 100}px`;
      cropBox.style.height = `${imageHeight * Math.max(0, rect.bottom - rect.top) / 100}px`;
    }
    errorBox.textContent = valid ? '' : 'El recorte es demasiado pequeño o los límites se cruzan.';
    saveButton.disabled = !valid || !checkbox.checked;
  }

  function cleanupSource() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = '';
    sourceImage = null;
    sourceFile = null;
  }

  function closeModal(clearInput) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    if (clearInput && activeInput) activeInput.value = '';
    activeInput = null;
    cleanupSource();
  }

  function openCrop(input, file) {
    activeInput = input;
    sourceFile = file;
    checkbox.checked = false;
    sliders.left.value = '0';
    sliders.right.value = '100';
    sliders.top.value = '35';
    sliders.bottom.value = '100';
    errorBox.textContent = '';
    sourceUrl = URL.createObjectURL(file);
    preview.onload = () => {
      sourceImage = preview;
      renderCrop();
    };
    preview.onerror = () => {
      errorBox.textContent = 'No se ha podido abrir esta imagen.';
      saveButton.disabled = true;
    };
    preview.src = sourceUrl;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  async function createCroppedFile() {
    if (!activeInput || !sourceFile || !sourceImage) throw new Error('Imagen no disponible');
    const rect = values();
    if (!validCrop(rect)) throw new Error('Recorte no válido');
    const sx = Math.round(sourceImage.naturalWidth * rect.left / 100);
    const sy = Math.round(sourceImage.naturalHeight * rect.top / 100);
    const sw = Math.max(1, Math.round(sourceImage.naturalWidth * (rect.right - rect.left) / 100));
    const sh = Math.max(1, Math.round(sourceImage.naturalHeight * (rect.bottom - rect.top) / 100));
    const scale = Math.min(1, 1800 / sw, 1800 / sh);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('No se ha podido crear el recorte');
    const baseName = sourceFile.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'nomina';
    return new File([blob], `${baseName}-recortada.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  }

  document.addEventListener('change', (event) => {
    const input = event.target.closest?.(FILE_INPUT_SELECTOR);
    if (!input) return;
    if (input.dataset.privacyCropped === 'ready') {
      delete input.dataset.privacyCropped;
      return;
    }
    const file = input.files?.[0];
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCrop(input, file);
  }, true);

  Object.values(sliders).forEach((input) => input.addEventListener('input', renderCrop));
  window.addEventListener('resize', renderCrop);
  checkbox.addEventListener('change', renderCrop);
  cancelButton.addEventListener('click', () => closeModal(true));
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(true); });

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    saveButton.textContent = 'Preparando recorte…';
    errorBox.textContent = '';
    try {
      const input = activeInput;
      const croppedFile = await createCroppedFile();
      const transfer = new DataTransfer();
      transfer.items.add(croppedFile);
      input.files = transfer.files;
      input.dataset.privacyCropped = 'ready';
      closeModal(false);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      errorBox.textContent = error?.message || 'No se ha podido crear el recorte.';
      saveButton.disabled = false;
    } finally {
      saveButton.textContent = 'Usar este recorte';
    }
  });
})();
