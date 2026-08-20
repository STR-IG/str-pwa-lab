(() => {
  'use strict';

  // LAB: primera versión centrada en jornada sin reducción.
  // Leemos únicamente los 8 conceptos habituales del «Resumen de variables del mes».
  const TARGETS = [
    { key: 'rotation', id: 'analysis-rotation', max: 31, integer: true, labels: [/PLUS\s+ROTATIVIDAD/, /ROTATIVIDAD/] },
    { key: 'meals', id: 'analysis-meals', max: 31, integer: true, labels: [/COMIDAS?\s+CAN\s+GUASCH/, /COMIDAS?.*GUASCH/, /CAN\s+GUASCH/] },
    { key: 'night', id: 'analysis-night', max: 200, labels: [/PLUS\s+NOCTURNO/, /NOCTURNO/] },
    { key: 'shift', id: 'analysis-shift', max: 31, integer: true, labels: [/PLUS\s+DE\s+TURNO(?!\s*12)/, /PLUS\s+TURNO(?!\s*12)/, /\bTURNO\b(?!\s*12)/] },
    { key: 'holiday', id: 'analysis-holiday', max: 200, labels: [/PLUS\s+FESTIVO/, /FESTIVO/] },
    { key: 'shift12', id: 'analysis-shift12', max: 31, integer: true, labels: [/PLUS\s+(?:DE\s+)?TURNO\s*12\s*(?:H|HORAS?)/, /TURNO\s*12\s*(?:H|HORAS?)/] },
    { key: 'holidayDiets', id: 'analysis-holidayDiets', max: 31, integer: true, labels: [/DIETAS?\s+FESTIVOS?/, /DIETA.*FESTIVO/] },
    { key: 'vacation', id: 'analysis-vacation', max: 31, integer: true, labels: [/PLUSES?\s+VACACIONES?/, /PLUS.*VACAC/] }
  ];

  const LEGACY_REDUCTION_IDS = ['analysis-unpaidNight', 'analysis-unpaidHoliday'];
  let running = false;
  let doneForSrc = '';

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[|\[\]{}‘’“”]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hideReductionFields() {
    LEGACY_REDUCTION_IDS.forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      const wrapper = input.closest('.analysis-field, .field, .analysis-row, .variable-row') || input.parentElement;
      if (wrapper) wrapper.style.display = 'none';
    });
  }

  function safeWording() {
    hideReductionFields();
    TARGETS.forEach((target) => {
      const input = document.getElementById(target.id);
      if (input && !input.value.trim()) input.placeholder = 'No leído automáticamente';
    });
  }

  function parseNumber(raw, target) {
    if (!raw) return '';
    const cleaned = String(raw)
      .replace(/[OoQD]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(',', '.');
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value < 0 || value > target.max) return '';
    if (target.integer && !Number.isInteger(value)) return '';
    return String(Math.round(value * 100) / 100).replace('.', ',');
  }

  function numericCandidates(value) {
    return normalize(value).match(/\d+(?:[.,]\d+)?/g) || [];
  }

  function findValueInLines(lines, target) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const pattern = target.labels.find((regex) => regex.test(line));
      if (!pattern) continue;
      if (target.key === 'shift' && /TURNO\s*12|12\s*HORAS?/.test(line)) continue;
      const match = pattern.exec(line);
      const tail = match ? line.slice(match.index + match[0].length) : line;
      const candidates = target.key === 'shift'
        ? numericCandidates(tail)
        : [...numericCandidates(tail), ...numericCandidates(lines[i + 1] || '')];
      for (const raw of candidates) {
        if (target.key === 'shift' && Number(String(raw).replace(',', '.')) === 12) continue;
        const value = parseNumber(raw, target);
        if (value !== '') return value;
      }
    }
    return '';
  }

  function centerY(word) {
    const box = word?.bbox || {};
    return ((box.y0 || 0) + (box.y1 || 0)) / 2;
  }

  function centerX(word) {
    const box = word?.bbox || {};
    return ((box.x0 || 0) + (box.x1 || 0)) / 2;
  }

  function findValueByGeometry(result, target) {
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    if (!words.length) return '';
    const usable = words
      .filter((word) => normalize(word.text))
      .map((word) => ({ ...word, n: normalize(word.text), cy: centerY(word), cx: centerX(word) }));

    for (const anchor of usable) {
      if (!/TURNO|ROTATIVIDAD|GUASCH|NOCTURNO|FESTIVO|VACACIONES?/.test(anchor.n)) continue;
      const height = Math.max(10, (anchor.bbox?.y1 || 0) - (anchor.bbox?.y0 || 0));
      const band = usable
        .filter((word) => Math.abs(word.cy - anchor.cy) <= height * 0.8)
        .sort((a, b) => a.cx - b.cx);
      const rowText = band.map((word) => word.n).join(' ');
      if (!target.labels.some((regex) => regex.test(rowText))) continue;
      if (target.key === 'shift' && /TURNO\s*12|12\s*HORAS?/.test(rowText)) continue;
      const numericWords = band.filter((word) => /\d/.test(word.n)).sort((a, b) => b.cx - a.cx);
      for (const word of numericWords) {
        for (const raw of numericCandidates(word.n)) {
          const numeric = Number(String(raw).replace(',', '.'));
          if (target.key === 'shift' && numeric === 12) continue;
          const value = parseNumber(raw, target);
          if (value !== '') return value;
        }
      }
    }
    return '';
  }

  function findShiftValueByNeighbourRows(result) {
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    if (!words.length) return '';
    const usable = words
      .filter((word) => normalize(word.text))
      .map((word) => ({ ...word, n: normalize(word.text), cy: centerY(word), cx: centerX(word) }));

    const nightWords = usable.filter((w) => /NOCTURNO/.test(w.n));
    const holidayWords = usable.filter((w) => /FESTIVO/.test(w.n) && !/DIETA/.test(w.n));
    if (!nightWords.length || !holidayWords.length) return '';

    const nightY = nightWords.sort((a, b) => a.cy - b.cy)[0].cy;
    const holidayY = holidayWords.filter((w) => w.cy > nightY).sort((a, b) => a.cy - b.cy)[0]?.cy;
    if (!Number.isFinite(nightY) || !Number.isFinite(holidayY) || holidayY <= nightY) return '';

    const midpoint = (nightY + holidayY) / 2;
    const tolerance = Math.max(8, (holidayY - nightY) * 0.38);
    const rowWords = usable
      .filter((w) => Math.abs(w.cy - midpoint) <= tolerance)
      .sort((a, b) => a.cx - b.cx);

    const rowText = rowWords.map((w) => w.n).join(' ');
    if (!/TURNO/.test(rowText) || /TURNO\s*12|12\s*HORAS?/.test(rowText)) return '';

    const numericWords = rowWords
      .filter((w) => /\d/.test(w.n))
      .sort((a, b) => b.cx - a.cx);
    const target = TARGETS.find((t) => t.key === 'shift');
    for (const word of numericWords) {
      for (const raw of numericCandidates(word.n)) {
        const numeric = Number(String(raw).replace(',', '.'));
        if (!Number.isInteger(numeric) || numeric === 12) continue;
        const value = parseNumber(raw, target);
        if (value !== '') return value;
      }
    }
    return '';
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function makeShiftCellCanvas(image, result, extraPad = 0) {
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    const usable = words
      .filter((word) => normalize(word.text))
      .map((word) => ({ ...word, n: normalize(word.text), cy: centerY(word) }));
    const night = usable.filter((w) => /NOCTURNO/.test(w.n)).sort((a, b) => a.cy - b.cy)[0];
    const holiday = usable.filter((w) => /FESTIVO/.test(w.n) && !/DIETA/.test(w.n) && (!night || w.cy > night.cy)).sort((a, b) => a.cy - b.cy)[0];
    if (!night || !holiday || holiday.cy <= night.cy) return null;

    const rowY = (night.cy + holiday.cy) / 2;
    const gap = holiday.cy - night.cy;
    const y0 = Math.max(0, Math.round(rowY - gap * (0.34 + extraPad)));
    const y1 = Math.min(image.naturalHeight, Math.round(rowY + gap * (0.34 + extraPad)));
    const x0 = Math.round(image.naturalWidth * 0.60);
    const x1 = Math.round(image.naturalWidth * 0.92);
    const sw = Math.max(1, x1 - x0);
    const sh = Math.max(1, y1 - y0);
    const scale = Math.max(5, Math.min(10, 1200 / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, x0, y0, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < data.data.length; p += 4) {
      const g = .299 * data.data[p] + .587 * data.data[p + 1] + .114 * data.data[p + 2];
      const v = g > 180 ? 255 : 0;
      data.data[p] = data.data[p + 1] = data.data[p + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  async function readShiftFromOwnCell(src, result) {
    const image = await loadImage(src);
    const target = TARGETS.find((t) => t.key === 'shift');
    const votes = [];
    for (const pad of [0, 0.08, 0.16]) {
      const canvas = makeShiftCellCanvas(image, result, pad);
      if (!canvas) continue;
      for (const psm of ['7', '10']) {
        try {
          const ocr = await window.Tesseract.recognize(canvas, 'eng', {
            logger: () => undefined,
            tessedit_pageseg_mode: psm,
            tessedit_char_whitelist: '0123456789'
          });
          const candidates = numericCandidates(ocr?.data?.text || '');
          for (const raw of candidates) {
            const value = parseNumber(raw, target);
            if (value !== '' && value !== '12') votes.push(value);
          }
        } catch (_) {}
      }
    }
    if (!votes.length) return '';
    const counts = new Map();
    votes.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : '';
  }

  function applyResults(results) {
    let count = 0;
    TARGETS.forEach((target) => {
      const input = document.getElementById(target.id);
      if (!input) return;
      const value = results.get(target.key) || '';
      input.value = value;
      if (value !== '') {
        input.dataset.labAutoRead = 'true';
        count += 1;
      } else {
        delete input.dataset.labAutoRead;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const counter = document.getElementById('analysis-detected-count');
    if (counter) counter.textContent = `${count} de ${TARGETS.length} cantidades leídas automáticamente`;
    return count;
  }

  async function readSummaryByConcept(src) {
    const result = await window.Tesseract.recognize(src, 'spa', {
      logger: () => undefined,
      preserve_interword_spaces: '1'
    });
    const rawText = result?.data?.text || '';
    const normalizedText = normalize(rawText);
    if (!/RESUMEN\s+DE\s+VARIABLES/.test(normalizedText) && !/PLUS\s+(?:DE\s+)?TURNO|COMIDAS?.*GUASCH|PLUS\s+ROTATIVIDAD/.test(normalizedText)) {
      return new Map();
    }
    const lines = rawText.split(/\r?\n/).map(normalize).filter(Boolean);
    const values = new Map();
    TARGETS.forEach((target) => {
      let value = findValueInLines(lines, target);
      if (value === '') value = findValueByGeometry(result, target);
      if (target.key === 'shift' && value === '') value = findShiftValueByNeighbourRows(result);
      if (value !== '') values.set(target.key, value);
    });

    // Si «Plus de turno» sigue vacío, hacemos OCR exclusivamente sobre su celda CANTIDAD.
    if (!values.has('shift')) {
      const shiftValue = await readShiftFromOwnCell(src, result);
      if (shiftValue !== '') values.set('shift', shiftValue);
    }
    return values;
  }

  async function reread() {
    safeWording();
    const screen = document.getElementById('analysis-screen');
    if (!screen || screen.hidden) return;
    const reference = document.getElementById('analysis-reference-image');
    const src = reference?.src || '';
    if (!src || running || doneForSrc === src || !window.Tesseract?.recognize) return;

    running = true;
    const title = document.getElementById('analysis-progress-title');
    const message = document.getElementById('analysis-progress-message');
    if (title) title.textContent = 'Leyendo «Resumen de variables del mes»…';
    if (message) message.textContent = 'Buscamos los 8 conceptos habituales y leemos «Plus de turno» directamente desde su propia celda.';

    try {
      const results = await readSummaryByConcept(src);
      const count = applyResults(results);
      if (title) title.textContent = count === TARGETS.length ? 'Lectura completa' : (count ? 'Lectura terminada' : 'No hemos podido leer las variables');
      if (message) message.textContent = count
        ? `Se han leído ${count} de ${TARGETS.length} cantidades del resumen mensual. Comprueba las cifras antes de confirmar.`
        : 'No hemos leído ninguna cantidad con suficiente seguridad. No se ha rellenado ningún valor dudoso.';
    } catch (_) {
      applyResults(new Map());
      if (title) title.textContent = 'Lectura terminada';
      if (message) message.textContent = 'No hemos podido completar la lectura automática. Puedes introducir las cantidades manualmente.';
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
