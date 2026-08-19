(() => {
  'use strict';

  const ROWS = [
    { key: 'rotation', id: 'analysis-rotation', max: 31 },
    { key: 'meals', id: 'analysis-meals', max: 31 },
    { key: 'night', id: 'analysis-night', max: 200 },
    { key: 'shift', id: 'analysis-shift', max: 31 },
    { key: 'holiday', id: 'analysis-holiday', max: 200 },
    { key: 'unpaidNight', id: 'analysis-unpaidNight', max: 24 },
    { key: 'unpaidHoliday', id: 'analysis-unpaidHoliday', max: 24 },
    { key: 'shift12', id: 'analysis-shift12', max: 31 },
    { key: 'holidayDiets', id: 'analysis-holidayDiets', max: 31 },
    { key: 'vacation', id: 'analysis-vacation', max: 31 }
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

  function makeCellCanvas(image, rowIndex, geometry, threshold) {
    const x = geometry.x;
    const y = geometry.firstY + rowIndex * geometry.stepY;
    const w = geometry.w;
    const h = geometry.h;
    const sx = Math.round(image.naturalWidth * x);
    const sy = Math.round(image.naturalHeight * y);
    const sw = Math.max(1, Math.round(image.naturalWidth * w));
    const sh = Math.max(1, Math.round(image.naturalHeight * h));
    const scale = Math.max(5, Math.min(10, 1000 / sw));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < data.data.length; p += 4) {
      const g = .299 * data.data[p] + .587 * data.data[p + 1] + .114 * data.data[p + 2];
      const v = threshold ? (g > 185 ? 255 : 0) : Math.max(0, Math.min(255, (g - 128) * 2.5 + 128));
      data.data[p] = data.data[p + 1] = data.data[p + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function parseQuantity(text, row) {
    const cleaned = String(text || '')
      .toUpperCase()
      .replace(/[OQD]/g, '0')
      .replace(/[IL|]/g, '1')
      .replace(/S/g, '5')
      .replace(/[^0-9,.-]/g, '');
    const matches = cleaned.match(/\d+(?:[.,]\d+)?/g) || [];
    for (const raw of matches) {
      const value = Number(raw.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || value > row.max) continue;
      if (['rotation', 'meals', 'shift', 'shift12', 'holidayDiets', 'vacation'].includes(row.key) && !Number.isInteger(value)) continue;
      return String(Math.round(value * 100) / 100).replace('.', ',');
    }
    return '';
  }

  async function readCell(source) {
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

  async function readTemplate(image) {
    // Dos geometrías muy próximas para tolerar pequeños márgenes distintos en la captura válida.
    const geometries = [
      { x: .605, w: .165, firstY: .252, stepY: .0342, h: .032 },
      { x: .600, w: .170, firstY: .248, stepY: .0348, h: .034 }
    ];
    const votes = new Map();

    for (const geometry of geometries) {
      for (let index = 0; index < ROWS.length; index += 1) {
        const row = ROWS[index];
        if (!votes.has(row.key)) votes.set(row.key, []);
        for (const threshold of [false, true]) {
          const cell = makeCellCanvas(image, index, geometry, threshold);
          const text = await readCell(cell);
          const value = parseQuantity(text, row);
          if (value !== '') votes.get(row.key).push(value);
        }
      }
    }

    const results = new Map();
    ROWS.forEach((row) => {
      const values = votes.get(row.key) || [];
      if (!values.length) return;
      const counts = new Map();
      values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      // Exigimos al menos dos lecturas coincidentes para evitar saltar a la fila vecina.
      if (best && best[1] >= 2) results.set(row.key, best[0]);
    });
    return results;
  }

  function applyResults(results) {
    let count = 0;
    ROWS.forEach((row) => {
      const input = document.getElementById(row.id);
      if (!input) return;
      const value = results.get(row.key) || '';
      input.value = value;
      if (value) {
        input.dataset.labAutoRead = 'true';
        count += 1;
      } else {
        delete input.dataset.labAutoRead;
      }
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
    if (title) title.textContent = 'Leyendo cada fila del resumen…';
    if (message) message.textContent = 'Leemos únicamente la celda «Cantidad» de cada fila para evitar mezclar cifras entre conceptos.';

    try {
      const image = await loadImage(src);
      const results = await readTemplate(image);
      const count = applyResults(results);
      if (title) title.textContent = count ? 'Lectura por filas terminada' : 'Lectura terminada';
      if (message) message.textContent = count
        ? `Se han leído ${count} cantidades por su propia fila. Comprueba las cifras antes de confirmar.`
        : 'No hemos leído ninguna cifra con suficiente seguridad. No se ha rellenado ningún valor dudoso.';
    } catch (_) {
      if (title) title.textContent = 'Lectura terminada';
      if (message) message.textContent = 'No hemos podido completar la lectura por filas.';
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
