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

  let running = false;
  let doneForSrc = '';

  function norm(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[|\[\]{}‘’“”]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function nums(value) {
    const raw = norm(value).match(/[-+]?\d+(?:[.,]\d+)?/g) || [];
    return raw.map(v => Number(v.replace(',', '.'))).filter(Number.isFinite);
  }

  function findValue(text, cfg) {
    const lines = String(text || '').split(/\r?\n/).map(norm).filter(Boolean);
    const summary = lines.findIndex(line => /RESUMEN\s+DE\s+VARIABLES/.test(line));
    const pool = summary >= 0 ? lines.slice(summary + 1) : lines;
    const balances = pool.findIndex(line => /^SALDOS?$/.test(line));
    const relevant = balances >= 0 ? pool.slice(0, balances) : pool;

    for (let i = 0; i < relevant.length; i += 1) {
      const line = relevant[i];
      const pattern = cfg.labels.find(re => re.test(line));
      if (!pattern) continue;
      const match = pattern.exec(line);
      const tail = match ? line.slice(match.index + match[0].length) : line;
      const candidates = [
        ...nums(tail),
        ...nums(relevant[i + 1] || ''),
        ...nums(relevant[i + 2] || '')
      ];
      const value = candidates.find(v => v >= 0 && v <= cfg.max && !(cfg.exclude || []).includes(v));
      if (Number.isFinite(value)) return String(Math.round(value * 100) / 100).replace('.', ',');
    }
    return '';
  }

  function safeWording() {
    document.querySelectorAll('input[id^="analysis-"]').forEach(input => {
      if (!input.value.trim()) input.placeholder = 'No leído automáticamente';
    });
  }

  async function reread() {
    safeWording();
    const screen = document.getElementById('analysis-screen');
    if (!screen || screen.hidden) return;
    const image = document.getElementById('analysis-reference-image');
    const src = image?.src || '';
    if (!src || running || doneForSrc === src || !window.Tesseract?.recognize) return;

    const missing = Object.values(TARGETS).filter(cfg => {
      const input = document.getElementById(cfg.id);
      return input && !input.value.trim();
    });
    if (!missing.length) { doneForSrc = src; return; }

    running = true;
    const progressTitle = document.getElementById('analysis-progress-title');
    const progressMessage = document.getElementById('analysis-progress-message');
    if (progressTitle) progressTitle.textContent = 'Afinando la lectura del resumen…';
    if (progressMessage) progressMessage.textContent = 'Hacemos una segunda lectura centrada en «Resumen de variables del mes».';

    try {
      const result = await window.Tesseract.recognize(src, 'spa', { logger: () => undefined });
      const text = result?.data?.text || '';
      let recovered = 0;
      for (const cfg of missing) {
        const input = document.getElementById(cfg.id);
        const value = findValue(text, cfg);
        if (input && !input.value.trim() && value !== '') {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dataset.labAutoRead = 'true';
          recovered += 1;
        }
      }
      safeWording();
      const counter = document.getElementById('analysis-detected-count');
      if (counter) {
        const count = [...document.querySelectorAll('input[id^="analysis-"]')].filter(i => i.value.trim()).length;
        counter.textContent = `${count} cantidades leídas automáticamente`;
      }
      if (progressTitle) progressTitle.textContent = recovered ? 'Lectura mejorada' : 'Lectura terminada';
      if (progressMessage) progressMessage.textContent = recovered
        ? `Se han recuperado ${recovered} cantidades más. Comprueba las cifras antes de confirmar.`
        : 'No se han podido recuperar más cifras automáticamente. Puedes introducirlas manualmente.';
    } catch {
      if (progressTitle) progressTitle.textContent = 'Lectura terminada';
      if (progressMessage) progressMessage.textContent = 'La segunda lectura no pudo completarse. Puedes introducir las cantidades manualmente.';
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
