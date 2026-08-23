// STR-IG LAB · recorte de privacidad + lectura guiada del registro de jornada
(() => {
  'use strict';

  const TARGET_TITLE = 'resumen de variables del mes';
  const FULL_PAGE_MIN_RATIO = 1.15;
  const TOP_CROP_RATIO = 0.152;

  const ALLOWED_VARIABLES = [
    { key: 'comidas_can_guasch', labels: ['comidas can guasch', 'comida can guasch', 'can guasch'] },
    { key: 'plus_turno', labels: ['plus de turno', 'plus turno'] },
    { key: 'plus_nocturno', labels: ['plus nocturno', 'nocturno', 'nocturnidad'] },
    { key: 'plus_festivo', labels: ['plus festivo', 'festivo'] },
    { key: 'turno_12h', labels: ['turno de 12 horas', 'turno 12 horas', '12 horas', '12h'] },
    { key: 'sabado_domingo', labels: ['sábado/domingo', 'sabado/domingo', 'sábado domingo', 'sabado domingo'] },
    { key: 'flexibilizacion', labels: ['flexibilización', 'flexibilizacion'] },
    { key: 'diferencia_grupo_superior', labels: ['diferencia grupo superior', 'grupo superior'] },
    { key: 'festivo_local', labels: ['festivo local'] }
  ];

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const numberFromText = value => {
    const text = String(value || '')
      .replace(/\s/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };

  function findTargetBlock(lines) {
    const normalized = lines.map(normalize);
    const start = normalized.findIndex(line => line.includes(TARGET_TITLE));
    if (start < 0) return null;
    const block = [];
    for (let i = start; i < Math.min(lines.length, start + 45); i += 1) {
      const n = normalized[i];
      if (i > start && /^(detalle|fichajes|marcajes|saldo|resumen diario)/.test(n)) break;
      block.push(lines[i]);
    }
    return block;
  }

  function parseVariables(block) {
    const result = {};
    for (let i = 0; i < block.length; i += 1) {
      const line = String(block[i] || '');
      const n = normalize(line);
      for (const variable of ALLOWED_VARIABLES) {
        if (result[variable.key] != null) continue;
        if (!variable.labels.some(label => n.includes(normalize(label)))) continue;
        let value = numberFromText(line.replace(/^[^:\t-]*[:\t-]?/, ''));
        if (value == null && i + 1 < block.length) value = numberFromText(block[i + 1]);
        if (value != null) result[variable.key] = value;
      }
    }
    return result;
  }

  function extractFromText(rawText) {
    const lines = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const block = findTargetBlock(lines);
    if (!block) {
      return { ok: false, code: 'SUMMARY_NOT_FOUND', message: 'No encuentro la tabla «Resumen de variables del mes».', values: {}, sourceBlock: [] };
    }
    const values = parseVariables(block);
    return {
      ok: Object.keys(values).length > 0,
      code: Object.keys(values).length > 0 ? 'OK' : 'NO_VARIABLES_READ',
      message: Object.keys(values).length > 0 ? 'Resumen de variables leído.' : 'No se pudieron leer los conceptos del resumen.',
      values,
      sourceBlock: block
    };
  }

  function isTimesheetScreen() {
    const title = document.getElementById('document-screen-title');
    return title && normalize(title.textContent).includes('registro de jornada');
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_LOAD_FAILED')); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.94) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('CROP_FAILED')), type, quality);
    });
  }

  async function cropTimesheetHeader(file) {
    const img = await loadImage(file);
    const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
    if (ratio < FULL_PAGE_MIN_RATIO) return file;

    const cropY = Math.round(img.naturalHeight * TOP_CROP_RATIO);
    const cropHeight = Math.max(1, img.naturalHeight - cropY);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, cropY, img.naturalWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas);
    const baseName = (file.name || 'registro-jornada').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}-sin-datos-personales.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  }

  function setCropNotice() {
    const instruction = document.getElementById('instruction-text');
    if (instruction && isTimesheetScreen()) {
      instruction.textContent = 'Sube la hoja completa. El LAB eliminará la cabecera con datos personales y te mostrará el recorte antes de guardarlo.';
    }
  }

  const input = document.getElementById('document-image');
  if (input && typeof DataTransfer !== 'undefined') {
    input.addEventListener('change', async event => {
      if (!isTimesheetScreen() || input.dataset.strigCropReady === '1') {
        delete input.dataset.strigCropReady;
        return;
      }
      const file = event.target.files && event.target.files[0];
      if (!file || !String(file.type || '').startsWith('image/')) return;

      event.stopImmediatePropagation();
      setCropNotice();

      try {
        const cropped = await cropTimesheetHeader(file);
        const dt = new DataTransfer();
        dt.items.add(cropped);
        input.files = dt.files;
        input.dataset.strigCropReady = '1';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        console.error('LAB timesheet crop error', error);
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dataset.strigCropReady = '1';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, true);
  }

  document.getElementById('open-timesheet')?.addEventListener('click', () => setTimeout(setCropNotice, 0));

  window.STRIG_TIMESHEET_READER = {
    extractFromText,
    allowedVariables: ALLOWED_VARIABLES.map(v => v.key)
  };
})();
