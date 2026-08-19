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
    vacation: { id: 'analysis-vacation', labels: [/PLUSES?\s+VACACIONES?/, /PLUS\s+VACACIONES?/, /VACACIONES?/], max: 31 }
  };
  let running = false, doneForSrc = '';

  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[|\[\]{}‘’“”]/g, ' ').replace(/\s+/g, ' ').trim();
  const nums = v => (norm(v).match(/[-+]?\d+(?:[.,]\d+)?/g) || []).map(x => Number(x.replace(',', '.'))).filter(Number.isFinite);

  function findValue(text, cfg) {
    const lines = String(text || '').split(/\r?\n/).map(norm).filter(Boolean);
    const summary = lines.findIndex(l => /RESUMEN\s+DE\s+VARIABLES/.test(l));
    const pool = summary >= 0 ? lines.slice(summary + 1) : lines;
    const balances = pool.findIndex(l => /^SALDOS?$/.test(l));
    const relevant = balances >= 0 ? pool.slice(0, balances) : pool;
    for (let i = 0; i < relevant.length; i++) {
      const line = relevant[i], pattern = cfg.labels.find(re => re.test(line));
      if (!pattern) continue;
      const match = pattern.exec(line), tail = match ? line.slice(match.index + match[0].length) : line;
      const candidates = [...nums(tail), ...nums(relevant[i + 1] || ''), ...nums(relevant[i + 2] || '')];
      const value = candidates.find(v => v >= 0 && v <= cfg.max && !(cfg.exclude || []).includes(v));
      if (Number.isFinite(value)) return String(Math.round(value * 100) / 100).replace('.', ',');
    }
    return '';
  }

  function safeWording() {
    document.querySelectorAll('input[id^="analysis-"]').forEach(i => { if (!i.value.trim()) i.placeholder = 'No leído automáticamente'; });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  }

  async function makeVariants(src) {
    const img = await loadImage(src), variants = [src];
    // El resumen está en la zona inferior de la hoja. Recortarlo hace que el texto sea mucho mayor para OCR.
    const crops = [
      { y: .60, h: .32 }, { y: .66, h: .27 }, { y: .70, h: .23 }
    ];
    for (const crop of crops) {
      const canvas = document.createElement('canvas');
      const sx = Math.round(img.naturalWidth * .05), sy = Math.round(img.naturalHeight * crop.y);
      const sw = Math.round(img.naturalWidth * .90), sh = Math.round(img.naturalHeight * crop.h);
      const scale = Math.max(2, Math.min(4, 2400 / Math.max(sw, 1)));
      canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let p = 0; p < data.data.length; p += 4) {
        const g = .299 * data.data[p] + .587 * data.data[p + 1] + .114 * data.data[p + 2];
        const v = g > 190 ? 255 : g < 135 ? 0 : Math.max(0, Math.min(255, (g - 128) * 2.1 + 128));
        data.data[p] = data.data[p + 1] = data.data[p + 2] = v;
      }
      ctx.putImageData(data, 0, 0);
      variants.push(canvas.toDataURL('image/jpeg', .94));
    }
    return variants;
  }

  async function readVariant(src) {
    const attempts = [];
    for (const lang of ['spa', 'eng']) {
      try {
        const result = await window.Tesseract.recognize(src, lang, { logger: () => undefined });
        attempts.push(result?.data?.text || '');
      } catch (_) {}
      if (attempts.some(t => /ROTAT|GUA.?SCH|NOCTURN|TURNO|FESTIV|VACACION/i.test(t))) break;
    }
    return attempts.join('\n');
  }

  async function reread() {
    safeWording();
    const screen = document.getElementById('analysis-screen'); if (!screen || screen.hidden) return;
    const image = document.getElementById('analysis-reference-image'), src = image?.src || '';
    if (!src || running || doneForSrc === src || !window.Tesseract?.recognize) return;
    const missing = Object.values(TARGETS).filter(c => document.getElementById(c.id) && !document.getElementById(c.id).value.trim());
    if (!missing.length) { doneForSrc = src; return; }
    running = true;
    const title = document.getElementById('analysis-progress-title'), msg = document.getElementById('analysis-progress-message');
    if (title) title.textContent = 'Leyendo el resumen mensual…';
    if (msg) msg.textContent = 'Ampliamos automáticamente la zona «Resumen de variables del mes» para leer mejor las cifras.';
    try {
      const variants = await makeVariants(src); let recovered = 0;
      for (const variant of variants) {
        const text = await readVariant(variant);
        for (const cfg of missing) {
          const input = document.getElementById(cfg.id); if (!input || input.value.trim()) continue;
          const value = findValue(text, cfg);
          if (value !== '') { input.value = value; input.dataset.labAutoRead = 'true'; input.dispatchEvent(new Event('input', { bubbles: true })); recovered++; }
        }
        if ([...document.querySelectorAll('input[id^="analysis-"]')].filter(i => !i.value.trim()).length === 0) break;
      }
      const count = [...document.querySelectorAll('input[id^="analysis-"]')].filter(i => i.value.trim()).length;
      const counter = document.getElementById('analysis-detected-count'); if (counter) counter.textContent = `${count} cantidades leídas automáticamente`;
      if (title) title.textContent = recovered ? 'Lectura mejorada' : 'Lectura terminada';
      if (msg) msg.textContent = recovered ? `Se han recuperado ${recovered} cantidades. Comprueba las cifras antes de confirmar.` : 'No hemos podido leer las cifras con suficiente seguridad. Puedes introducirlas manualmente mirando la imagen guardada.';
    } catch (_) {
      if (title) title.textContent = 'Lectura terminada'; if (msg) msg.textContent = 'No hemos podido completar la lectura automática. Puedes introducir las cantidades manualmente.';
    } finally { doneForSrc = src; running = false; safeWording(); }
  }

  const observer = new MutationObserver(() => { safeWording(); if (!document.getElementById('analysis-screen')?.hidden) setTimeout(reread, 300); });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('input', safeWording, true); safeWording();
})();
