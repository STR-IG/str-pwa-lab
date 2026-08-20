(() => {
  'use strict';

  const TARGETS = [
    { key: 'rotation', id: 'analysis-rotation', max: 31, integer: true, labels: [/PLUS\s+ROTATIVIDAD/, /ROTATIVIDAD/, /ROTAT/] },
    { key: 'meals', id: 'analysis-meals', max: 31, integer: true, labels: [/COMIDAS?\s+CAN\s+GUASCH/, /COMIDAS?.*GUASCH/, /CAN\s+GUASCH/, /GUASCH/] },
    { key: 'night', id: 'analysis-night', max: 200, labels: [/PLUS\s+NOCTURNO/, /NOCTURNO/, /NOCT/] },
    { key: 'shift', id: 'analysis-shift', max: 31, integer: true, labels: [/PLUS\s+DE\s+TURNO(?!\s*12)/, /PLUS\s+TURNO(?!\s*12)/, /\bTURNO\b(?!\s*12)/] },
    { key: 'holiday', id: 'analysis-holiday', max: 200, labels: [/PLUS\s+FESTIVO/, /FESTIVO/, /FESTIV/] },
    { key: 'shift12', id: 'analysis-shift12', max: 31, integer: true, labels: [/PLUS\s+(?:DE\s+)?TURNO\s*12\s*(?:H|HORAS?)/, /TURNO\s*12\s*(?:H|HORAS?)/, /TURNO.*12/] },
    { key: 'holidayDiets', id: 'analysis-holidayDiets', max: 31, integer: true, labels: [/DIETAS?\s+FESTIVOS?/, /DIETA.*FESTIV/] },
    { key: 'vacation', id: 'analysis-vacation', max: 31, integer: true, labels: [/PLUSES?\s+VACACIONES?/, /PLUS.*VACAC/, /VACAC/] }
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
      .replace(',', '.')
      .replace(/[^0-9.+-]/g, '');
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value < 0 || value > target.max) return '';
    if (target.integer && !Number.isInteger(value)) return '';
    return String(Math.round(value * 100) / 100).replace('.', ',');
  }

  function numericCandidates(value) {
    return normalize(value).match(/\d+(?:[.,]\d+)?/g) || [];
  }

  function targetForRow(rowText) {
    const text = normalize(rowText);
    // De más específico a más general para evitar confundir Turno 12h con Turno,
    // Dietas festivos con Plus festivo, etc.
    const order = ['shift12', 'holidayDiets', 'vacation', 'rotation', 'meals', 'night', 'shift', 'holiday'];
    for (const key of order) {
      const target = TARGETS.find((item) => item.key === key);
      if (target?.labels.some((regex) => regex.test(text))) return target;
    }
    return null;
  }

  function numberFromRowText(rowText, target) {
    const nums = numericCandidates(rowText);
    if (!nums.length) return '';
    // La cantidad es el último número de la fila. En «Turno 12 horas 4», evita coger el 12.
    for (let i = nums.length - 1; i >= 0; i -= 1) {
      const numeric = Number(String(nums[i]).replace(',', '.'));
      if (target.key === 'shift12' && numeric === 12 && nums.length === 1) return '';
      if (target.key === 'shift' && numeric === 12) continue;
      const value = parseNumber(nums[i], target);
      if (value !== '') return value;
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

  function groupWordsIntoRows(result) {
    const words = Array.isArray(result?.data?.words) ? result.data.words : [];
    const usable = words
      .filter((word) => normalize(word.text))
      .map((word) => ({
        ...word,
        n: normalize(word.text),
        cy: centerY(word),
        cx: centerX(word),
        h: Math.max(1, (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0))
      }))
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    if (!usable.length) return [];

    const heights = usable.map((w) => w.h).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
    const tolerance = Math.max(7, medianHeight * 0.75);
    const rows = [];

    usable.forEach((word) => {
      let row = rows.find((candidate) => Math.abs(candidate.cy - word.cy) <= tolerance);
      if (!row) {
        row = { cy: word.cy, words: [] };
        rows.push(row);
      }
      row.words.push(word);
      row.cy = row.words.reduce((sum, item) => sum + item.cy, 0) / row.words.length;
    });

    return rows
      .map((row) => ({ ...row, words: row.words.sort((a, b) => a.cx - b.cx) }))
      .sort((a, b) => a.cy - b.cy);
  }

  function valuesFromWordRows(result) {
    const values = new Map();
    const rows = groupWordsIntoRows(result);

    rows.forEach((row) => {
      const rowText = row.words.map((word) => word.n).join(' ');
      const target = targetForRow(rowText);
      if (!target || values.has(target.key)) return;

      // Primero intentamos con la fila completa.
      let value = numberFromRowText(rowText, target);

      // Si falla, cogemos solo los tokens numéricos situados claramente en la parte derecha de la fila.
      if (value === '') {
        const minX = row.words.length ? Math.min(...row.words.map((w) => w.cx)) : 0;
        const maxX = row.words.length ? Math.max(...row.words.map((w) => w.cx)) : 0;
        const thresholdX = minX + (maxX - minX) * 0.58;
        const numericRight = row.words
          .filter((word) => word.cx >= thresholdX && /\d/.test(word.n))
          .sort((a, b) => b.cx - a.cx);
        for (const word of numericRight) {
          const candidates = numericCandidates(word.n);
          for (let i = candidates.length - 1; i >= 0; i -= 1) {
            const numeric = Number(String(candidates[i]).replace(',', '.'));
            if (target.key === 'shift12' && numeric === 12) continue;
            if (target.key === 'shift' && numeric === 12) continue;
            value = parseNumber(candidates[i], target);
            if (value !== '') break;
          }
          if (value !== '') break;
        }
      }

      if (value !== '') values.set(target.key, value);
    });

    return values;
  }

  function valuesFromTextLines(rawText) {
    const values = new Map();
    const lines = String(rawText || '').split(/\r?\n/).map(normalize).filter(Boolean);
    lines.forEach((line, index) => {
      const target = targetForRow(line);
      if (!target || values.has(target.key)) return;
      let value = numberFromRowText(line, target);
      if (value === '' && index + 1 < lines.length && !targetForRow(lines[index + 1])) {
        value = numberFromRowText(lines[index + 1], target);
      }
      if (value !== '') values.set(target.key, value);
    });
    return values;
  }

  function mergeValues(primary, secondary) {
    const merged = new Map(primary);
    secondary.forEach((value, key) => {
      if (!merged.has(key)) merged.set(key, value);
    });
    return merged;
  }

  function applyResults(results) {
    let count = 0;
    TARGETS.forEach((target) => {
      const input = document.getElementById(target.id);
      if (!input) return;
      const value = results.get(target.key);
      // No borramos un valor que el lector principal de la app ya hubiera conseguido.
      if (value !== undefined && value !== '') {
        input.value = value;
        input.dataset.labAutoRead = 'true';
      }
      if (input.value.trim()) count += 1;
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

    // La extracción ya no depende del orden ni del número de filas del mes.
    // Clasifica cada fila por su concepto y toma la cantidad de esa misma fila.
    const fromRows = valuesFromWordRows(result);
    const fromLines = valuesFromTextLines(rawText);
    return mergeValues(fromRows, fromLines);
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
    if (message) message.textContent = 'Identificamos cada concepto por su nombre, sin depender del orden de las filas.';

    try {
      const results = await readSummaryByConcept(src);
      const count = applyResults(results);
      if (title) title.textContent = count ? 'Lectura terminada' : 'No hemos podido leer las variables';
      if (message) message.textContent = count
        ? `Se han leído ${count} de ${TARGETS.length} conceptos disponibles. Los que no aparezcan ese mes pueden quedar vacíos.`
        : 'No hemos leído ninguna cantidad con suficiente seguridad. No se ha rellenado ningún valor dudoso.';
    } catch (_) {
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
