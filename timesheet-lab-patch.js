(() => {
  'use strict';

  const ROWS = [
    { key: 'rotation', id: 'analysis-rotation', max: 31, integer: true },
    { key: 'meals', id: 'analysis-meals', max: 31, integer: true },
    { key: 'night', id: 'analysis-night', max: 200 },
    { key: 'shift', id: 'analysis-shift', max: 31, integer: true },
    { key: 'holiday', id: 'analysis-holiday', max: 200 },
    { key: 'unpaidNight', id: 'analysis-unpaidNight', max: 24 },
    { key: 'unpaidHoliday', id: 'analysis-unpaidHoliday', max: 24 },
    { key: 'shift12', id: 'analysis-shift12', max: 31, integer: true },
    { key: 'holidayDiets', id: 'analysis-holidayDiets', max: 31, integer: true },
    { key: 'vacation', id: 'analysis-vacation', max: 31, integer: true }
  ];

  let running = false;
  let doneForSrc = '';

  function safeWording() {
    document.querySelectorAll('input[id^="analysis-"]').forEach((input) => {
      if (!input.value.trim()) input.placeholder = 'No leído automáticamente';
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function grayscaleCanvas(image) {
    const canvas = document.createElement('canvas');
    const maxWidth = 1400;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  }

  function groupPositions(values, tolerance = 2) {
    if (!values.length) return [];
    const groups = [[values[0]]];
    for (let i = 1; i < values.length; i += 1) {
      const group = groups[groups.length - 1];
      if (values[i] - group[group.length - 1] <= tolerance) group.push(values[i]);
      else groups.push([values[i]]);
    }
    return groups.map((group) => Math.round(group.reduce((a, b) => a + b, 0) / group.length));
  }

  function detectHorizontalLines(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    const x0 = Math.round(width * .07);
    const x1 = Math.round(width * .84);
    const candidates = [];
    for (let y = Math.round(height * .12); y < Math.round(height * .72); y += 1) {
      let dark = 0;
      for (let x = x0; x < x1; x += 2) {
        const p = (y * width + x) * 4;
        if (data[p] < 90 && data[p + 1] < 90 && data[p + 2] < 90) dark += 1;
      }
      const ratio = dark / Math.max(1, Math.ceil((x1 - x0) / 2));
      if (ratio > .48) candidates.push(y);
    }
    return groupPositions(candidates, 2);
  }

  function bestTableSequence(lines, height) {
    let best = null;
    // El resumen tiene cabecera + 10 conceptos = 12 líneas horizontales.
    for (let start = 0; start < lines.length; start += 1) {
      for (let end = start + 10; end < lines.length; end += 1) {
        const slice = lines.slice(start, end + 1);
        if (slice.length < 11 || slice.length > 13) continue;
        const diffs = slice.slice(1).map((v, i) => v - slice[i]);
        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        if (avg < height * .018 || avg > height * .055) continue;
        const spread = Math.max(...diffs.map(d => Math.abs(d - avg)));
        const expectedSpan = avg * (slice.length - 1);
        const score = spread + Math.abs(slice.length - 12) * 10 + Math.abs((slice[slice.length - 1] - slice[0]) - expectedSpan);
        if (!best || score < best.score) best = { lines: slice, score };
      }
    }
    if (!best) return null;
    let seq = best.lines;
    if (seq.length === 11) {
      const avg = (seq[seq.length - 1] - seq[0]) / (seq.length - 1);
      seq = [...seq, Math.round(seq[seq.length - 1] + avg)];
    }
    if (seq.length > 12) seq = seq.slice(0, 12);
    return seq;
  }

  function detectVerticalLines(ctx, width, yTop, yBottom) {
    const data = ctx.getImageData(0, 0, width, ctx.canvas.height).data;
    const candidates = [];
    for (let x = Math.round(width * .08); x < Math.round(width * .88); x += 1) {
      let dark = 0;
      for (let y = yTop; y <= yBottom; y += 2) {
        const p = (y * width + x) * 4;
        if (data[p] < 100 && data[p + 1] < 100 && data[p + 2] < 100) dark += 1;
      }
      const ratio = dark / Math.max(1, Math.ceil((yBottom - yTop + 1) / 2));
      if (ratio > .55) candidates.push(x);
    }
    return groupPositions(candidates, 2);
  }

  function detectGeometry(image) {
    const { canvas, ctx } = grayscaleCanvas(image);
    const horizontal = detectHorizontalLines(ctx, canvas.width, canvas.height);
    const rows = bestTableSequence(horizontal, canvas.height);
    if (!rows || rows.length < 12) return null;
    const vertical = detectVerticalLines(ctx, canvas.width, rows[0], rows[rows.length - 1]);
    if (vertical.length < 3) return null;
    const plausible = vertical.filter(x => x > canvas.width * .45 && x < canvas.width * .88);
    if (plausible.length < 2) return null;
    const right = plausible[plausible.length - 1];
    const left = plausible[plausible.length - 2];
    if (right - left < canvas.width * .08) return null;
    return {
      scaleX: image.naturalWidth / canvas.width,
      scaleY: image.naturalHeight / canvas.height,
      rowLines: rows,
      amountLeft: left,
      amountRight: right
    };
  }

  function cellCanvas(image, geometry, rowIndex, threshold) {
    // rowIndex 0 es el primer concepto; la fila 0 de la tabla es la cabecera.
    const topLine = geometry.rowLines[rowIndex + 1];
    const bottomLine = geometry.rowLines[rowIndex + 2];
    const padX = Math.max(2, Math.round((geometry.amountRight - geometry.amountLeft) * .08));
    const padY = 2;
    const sx = Math.round((geometry.amountLeft + padX) * geometry.scaleX);
    const sy = Math.round((topLine + padY) * geometry.scaleY);
    const sw = Math.max(1, Math.round((geometry.amountRight - geometry.amountLeft - padX * 2) * geometry.scaleX));
    const sh = Math.max(1, Math.round((bottomLine - topLine - padY * 2) * geometry.scaleY));
    const scale = Math.max(6, Math.min(14, 950 / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < pixels.data.length; p += 4) {
      const g = .299 * pixels.data[p] + .587 * pixels.data[p + 1] + .114 * pixels.data[p + 2];
      const v = threshold ? (g > threshold ? 255 : 0) : Math.max(0, Math.min(255, (g - 128) * 2.6 + 128));
      pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = v;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  }

  async function readDigits(source) {
    try {
      const result = await window.Tesseract.recognize(source, 'eng', {
        logger: () => undefined,
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: '0123456789,.'
      });
      return result?.data?.text || '';
    } catch (_) {
      return '';
    }
  }

  function parseQuantity(text, row) {
    let cleaned = String(text || '').trim().replace(/\s+/g, '');
    cleaned = cleaned.replace(/[OoQD]/g, '0').replace(/[Il|]/g, '1').replace(/[Ss]/g, '5');
    const match = cleaned.match(/\d+(?:[.,]\d+)?/);
    if (!match) return '';
    const value = Number(match[0].replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > row.max) return '';
    if (row.integer && !Number.isInteger(value)) return '';
    return String(Math.round(value * 100) / 100).replace('.', ',');
  }

  async function readRows(image, geometry) {
    const results = new Map();
    for (let i = 0; i < ROWS.length; i += 1) {
      const row = ROWS[i];
      const votes = [];
      for (const threshold of [0, 160, 180, 200]) {
        const source = cellCanvas(image, geometry, i, threshold || false);
        const value = parseQuantity(await readDigits(source), row);
        if (value !== '') votes.push(value);
      }
      const counts = new Map();
      votes.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      // Dos lecturas coincidentes como mínimo; si hay empate no rellenamos.
      if (ranked[0] && ranked[0][1] >= 2 && (!ranked[1] || ranked[0][1] > ranked[1][1])) {
        results.set(row.key, ranked[0][0]);
      }
    }
    return results;
  }

  function applyResults(results) {
    let count = 0;
    ROWS.forEach((row) => {
      const input = document.getElementById(row.id);
      if (!input) return;
      const value = results.get(row.key) || '';
      input.value = value;
      if (value) { input.dataset.labAutoRead = 'true'; count += 1; }
      else delete input.dataset.labAutoRead;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const counter = document.getElementById('analysis-detected-count');
    if (counter) counter.textContent = `${count} cantidades leídas automáticamente`;
    return count;
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
    if (title) title.textContent = 'Localizando la tabla mensual…';
    if (message) message.textContent = 'Detectamos las líneas reales de la tabla y leemos solo la celda «Cantidad» de cada fila.';

    try {
      const image = await loadImage(src);
      const geometry = detectGeometry(image);
      if (!geometry) {
        applyResults(new Map());
        if (title) title.textContent = 'No hemos localizado bien la tabla';
        if (message) message.textContent = 'La captura es válida, pero no hemos podido ubicar con precisión las filas. No se ha rellenado ningún dato dudoso.';
        return;
      }
      const results = await readRows(image, geometry);
      const count = applyResults(results);
      if (title) title.textContent = count ? 'Lectura por celdas terminada' : 'Lectura terminada';
      if (message) message.textContent = count
        ? `Se han leído ${count} cantidades usando la posición real de cada fila. Comprueba las cifras antes de confirmar.`
        : 'No hemos leído ninguna cantidad con suficiente seguridad. No se ha rellenado ningún valor dudoso.';
    } catch (_) {
      applyResults(new Map());
      if (title) title.textContent = 'Lectura terminada';
      if (message) message.textContent = 'No hemos podido completar la lectura por celdas.';
    } finally {
      doneForSrc = src;
      running = false;
      safeWording();
    }
  }

  const observer = new MutationObserver(() => {
    safeWording();
    if (!document.getElementById('analysis-screen')?.hidden) setTimeout(reread, 450);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('input', safeWording, true);
  safeWording();
})();
