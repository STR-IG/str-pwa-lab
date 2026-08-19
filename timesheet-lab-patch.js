(() => {
  'use strict';

  // LAB: el registro de jornada se lee por NOMBRE DE CONCEPTO, no por posición de fila.
  // Así funciona aunque «Comidas Can Guasch» aparezca antes o después de «Plus rotatividad»
  // y aunque un mes tenga menos filas que otro.
  const TARGETS = [
    {
      key: 'rotation',
      id: 'analysis-rotation',
      max: 31,
      integer: true,
      labels: [/PLUS\s+ROTATIVIDAD/, /ROTATIVIDAD/]
    },
    {
      key: 'meals',
      id: 'analysis-meals',
      max: 31,
      integer: true,
      labels: [/COMIDAS?\s+CAN\s+GUASCH/, /COMIDAS?.*GUASCH/, /CAN\s+GUASCH/]
    },
    {
      key: 'night',
      id: 'analysis-night',
      max: 200,
      labels: [/PLUS\s+NOCTURNO/, /NOCTURNO/]
    },
    {
      key: 'shift',
      id: 'analysis-shift',
      max: 31,
      integer: true,
      labels: [/PLUS\s+DE\s+TURNO(?!\s*12)/, /PLUS\s+TURNO(?!\s*12)/]
    },
    {
      key: 'holiday',
      id: 'analysis-holiday',
      max: 200,
      labels: [/PLUS\s+FESTIVO(?!\s+TEOR)/, /PLUS\s+FESTIVO/]
    },
    {
      key: 'unpaidNight',
      id: 'analysis-unpaidNight',
      max: 24,
      labels: [/NOPAGA\s+P?NOCTURN.*TEOR/, /NOPAGA.*NOCTURN/]
    },
    {
      key: 'unpaidHoliday',
      id: 'analysis-unpaidHoliday',
      max: 24,
      labels: [/NOPAGA\s+P?FESTIVO.*TEOR/, /NOPAGA.*FESTIVO/]
    },
    {
      key: 'shift12',
      id: 'analysis-shift12',
      max: 31,
      integer: true,
      labels: [/PLUS\s+(?:DE\s+)?TURNO\s*12\s*(?:H|HORAS?)/, /TURNO\s*12\s*(?:H|HORAS?)/]
    },
    {
      key: 'holidayDiets',
      id: 'analysis-holidayDiets',
      max: 31,
      integer: true,
      labels: [/DIETAS?\s+FESTIVOS?/, /DIETA.*FESTIVO/]
    },
    {
      key: 'vacation',
      id: 'analysis-vacation',
      max: 31,
      integer: true,
      labels: [/PLUSES?\s+VACACIONES?/, /PLUS.*VACAC/]
    }
  ];

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

  function safeWording() {
    document.querySelectorAll('input[id^="analysis-"]').forEach((input) => {
      if (!input.value.trim()) input.placeholder = 'No leído automáticamente';
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
    return (normalize(value).match(/\d+(?:[.,]\d+)?/g) || []);
  }

  function findValueInLines(lines, target) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const pattern = target.labels.find((regex) => regex.test(line));
      if (!pattern) continue;

      const match = pattern.exec(line);
      const tail = match ? line.slice(match.index + match[0].length) : line;
      // La cantidad está normalmente al final de la misma fila. Si Tesseract la
      // separa, probamos también la línea siguiente.
      const candidates = [
        ...numericCandidates(tail),
        ...numericCandidates(lines[i + 1] || '')
      ];
      for (const raw of candidates) {
        const value = parseNumber(raw, target);
        if (value !== '') return value;
      }
    }
    return '';
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
    if (counter) counter.textContent = `${count} cantidades leídas automáticamente`;
    return count;
  }

  async function readSummaryByConcept(src) {
    const result = await window.Tesseract.recognize(src, 'spa', {
      logger: () => undefined,
      preserve_interword_spaces: '1'
    });

    const rawText = result?.data?.text || '';
    const normalizedText = normalize(rawText);

    // Solo damos por válida la lectura si reconocemos el bloque que nos interesa.
    // Ignoramos TOTAL HORAS PERIODO, TEÓRICAS, AUSENCIAS y SALDOS.
    if (!/RESUMEN\s+DE\s+VARIABLES/.test(normalizedText) && !/PLUS\s+(?:DE\s+)?TURNO|COMIDAS?.*GUASCH|PLUS\s+ROTATIVIDAD/.test(normalizedText)) {
      return new Map();
    }

    const lines = rawText
      .split(/\r?\n/)
      .map(normalize)
      .filter(Boolean);

    const values = new Map();
    TARGETS.forEach((target) => {
      const value = findValueInLines(lines, target);
      if (value !== '') values.set(target.key, value);
    });
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
    if (message) message.textContent = 'Buscamos cada concepto por su nombre y leemos únicamente su cantidad. Ignoramos horas teóricas, ausencias y saldos.';

    try {
      const results = await readSummaryByConcept(src);
      const count = applyResults(results);

      if (title) title.textContent = count ? 'Lectura terminada' : 'No hemos podido leer las variables';
      if (message) message.textContent = count
        ? `Se han leído ${count} cantidades del resumen mensual. Comprueba las cifras antes de confirmar.`
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

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden']
  });

  document.addEventListener('input', safeWording, true);
  safeWording();
})();
