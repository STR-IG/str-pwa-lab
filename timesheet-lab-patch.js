(() => {
  'use strict';

  const TARGETS = {
    rotation: { id: 'analysis-rotation', labels: [/PLUS\s+ROT[A-Z]*VIDAD/, /ROTATIVIDAD/], max: 31 },
    meals: { id: 'analysis-meals', labels: [/COMIDAS?\s+CAN\s+GUA?SCH/, /CAN\s+GUA?SCH/], max: 31 },
    night: { id: 'analysis-night', labels: [/PLUS\s+NOCTURN[OA]?/, /NOCTURN[OA]?/], max: 200 },
    shift: { id: 'analysis-shift', labels: [/PLUS\s+(?:DE\s+)?TURNO(?!\s*12)/, /PLUS\s+TURNO(?!\s*12)/], max: 31 },
    holiday: { id: 'analysis-holiday', labels: [/PLUS(?:ES)?\s+FESTIVO/, /PLUS\s+FEST/], max: 200 },
    shift12: { id: 'analysis-shift12', labels: [/PLUS\s+(?:DE\s+)?TURNO\s*12\s*(?:HORAS?|H)?/, /TURNO\s*12\s*(?:HORAS?|H)?/], max: 31, exclude: [12] },
    holidayDiets: { id: 'analysis-holidayDiets', labels: [/DIETAS?\s+FESTIVOS?/, /DIET.*FEST/], max: 31 },
    vacation: { id: 'analysis-vacation', labels: [/PLUSES?\s+VACACIONES?/, /PLUS\s+VACACIONES?/, /VACACIONES?/], max: 31 },
    unpaidNight: { id: 'analysis-unpaidNight', labels: [/NOPAGA.*NOCTURN/, /PNOCTURN/], max: 24 },
    unpaidHoliday: { id: 'analysis-unpaidHoliday', labels: [/NOPAGA.*FESTIVO/, /PFESTIVO/], max: 24 }
  };

  let running = false;
  let doneForSrc = '';

  const norm = v => String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[|\[\]{}‘’“”]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const nums = v => (norm(v).match(/[-+]?\d+(?:[.,]\d+)?/g) || [])
    .map(x => Number(x.replace(',', '.'))).filter(Number.isFinite);

  function findValue(text, cfg) {
    const lines = String(text || '').split(/\r?\n/).map(norm).filter(Boolean);
    const summary = lines.findIndex(l => /RESUMEN\s+DE\s+VARIABLES/.test(l));
    const pool = summary >= 0 ? lines.slice(summary + 1) : lines;
    const balances = pool.findIndex(l => /^SALDOS?$/.test(l));
    const relevant = balances >= 0 ? pool.slice(0, balances) : pool;

    for (let i = 0; i < relevant.length; i++) {
      const line = relevant[i];
      const pattern = cfg.labels.find(re => re.test(line));
      if (!pattern) continue;
      const match = pattern.exec(line);
      const tail = match ? line.slice(match.index + match[0].length) : line;
      const candidates = [...nums(tail), ...nums(relevant[i + 1] || '')];
      const value = candidates.find(v => v >= 0 && v <= cfg.max && !(cfg.exclude || []).includes(v));
      if (Number.isFinite(value)) return String(Math.round(value * 100) / 100).replace('.', ',');
    }
    return '';
  }

  function safeWording() {
    document.querySelectorAll('input[id^="analysis-"]').forEach(i => {
      if (!i.value.trim()) i.placeholder = 'No leído automáticamente';
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function preprocess(img, region, threshold = false) {
    const sx = Math.round(img.naturalWidth * region.x);
    const sy = Math.round(img.naturalHeight * region.y);
    const sw = Math.max(1, Math.round(img.naturalWidth * region.w));
    const sh = Math.max(1, Math.round(img.naturalHeight * region.h));
    const scale = Math.max(2, Math.min(5, 2600 / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < data.data.length; p += 4) {
      const g = .299 * data.data[p] + .587 * data.data[p + 1] + .114 * data.data[p + 2];
      const v = threshold ? (g > 175 ? 255 : 0) : Math.max(0, Math.min(255, (g - 128) * 2.2 + 128));
      data.data[p] = data.data[p + 1] = data.data[p + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function makeVariants(src) {
    const img = await loadImage(src);
    // La captura válida ya viene recortada. Priorizamos la hoja completa ampliada
    // y la zona central donde está el Resumen de variables del mes.
    const regions = [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: .06, y: .08, w: .78, h: .58 },
      { x: .08, y: .14, w: .72, h: .48 },
      { x: .08, y: .18, w: .72, h: .42 }
    ];
    const variants = [];
    for (const region of regions) {
      variants.push(preprocess(img, region, false));
      variants.push(preprocess(img, region, true));
    }
    return variants;
  }

  async function readVariant(src, psm) {
    try {
      const result = await window.Tesseract.recognize(src, 'spa', {
        logger: () => undefined,
        tessedit_pageseg_mode: String(psm),
        preserve_interword_spaces: '1'
      });
      return result?.data?.text || '';
    } catch (_) {
      return '';
    }
  }

  async function reread() {
    safeWording();
    const screen = document.getElementById('analysis-screen');
    if (!screen || screen.hidden) return;
    const image = document.getElementById('analysis-reference-image');
    const src = image?.src || '';
    if (!src || running || doneForSrc === src || !window.Tesseract?.recognize) return;

    running = true;
    const title = document.getElementById('analysis-progress-title');
    const msg = document.getElementById('analysis-progress-message');
    if (title) title.textContent = 'Leyendo el resumen mensual…';
    if (msg) msg.textContent = 'Ampliamos la captura válida y leemos fila por fila los conceptos y cantidades.';

    try {
      const variants = await makeVariants(src);
      let recovered = 0;
      const modes = ['6', '11'];

      for (const variant of variants) {
        for (const mode of modes) {
          const text = await readVariant(variant, mode);
          if (!text) continue;
          for (const cfg of Object.values(TARGETS)) {
            const input = document.getElementById(cfg.id);
            if (!input || input.value.trim()) continue;
            const value = findValue(text, cfg);
            if (value !== '') {
              input.value = value;
              input.dataset.labAutoRead = 'true';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              recovered++;
            }
          }
          const remaining = [...document.querySelectorAll('input[id^="analysis-"]')].filter(i => !i.value.trim()).length;
          if (remaining <= 1) break;
        }
      }

      const filled = [...document.querySelectorAll('input[id^="analysis-"]')].filter(i => i.value.trim()).length;
      const counter = document.getElementById('analysis-detected-count');
      if (counter) counter.textContent = `${filled} cantidades leídas automáticamente`;
      if (title) title.textContent = recovered ? 'Lectura mejorada' : 'Lectura terminada';
      if (msg) msg.textContent = recovered
        ? `Se han recuperado ${recovered} cantidades adicionales. Comprueba cada cifra antes de confirmar.`
        : 'No se han podido recuperar más cifras con suficiente seguridad.';
    } catch (_) {
      if (title) title.textContent = 'Lectura terminada';
      if (msg) msg.textContent = 'No hemos podido completar la lectura automática.';
    } finally {
      doneForSrc = src;
      running = false;
      safeWording();
    }
  }

  const observer = new MutationObserver(() => {
    safeWording();
    if (!document.getElementById('analysis-screen')?.hidden) setTimeout(reread, 350);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('input', safeWording, true);
  safeWording();
})();
