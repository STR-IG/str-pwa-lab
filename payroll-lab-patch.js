(() => {
  'use strict';

  const TARGETS = {
    shift12: {
      ids: ['comparison-shift12'],
      labels: [
        /PLUS\s+(?:DE\s+)?TURNO\s*12\s*(?:H|HORAS?)/,
        /TURNO\s*12\s*(?:H|HORAS?)/,
        /PLUS.*12\s*(?:H|HORAS?)/
      ],
      max: 31,
      exclude: [12]
    },
    holidayDiets: {
      ids: ['comparison-holidayDiets'],
      labels: [
        /DIETAS?\s+FESTIVOS?/, /DIETA\s+FESTIVO/, /DIET.*FEST/
      ],
      max: 31,
      exclude: []
    },
    vacation: {
      ids: ['comparison-vacation'],
      labels: [
        /PLUSES?\s+VACACIONES?/, /PLUS\s+VACACIONES?/, /PLUS.*VACAC/, /VACACIONES?/
      ],
      max: 31,
      exclude: []
    }
  };

  let payrollScanRunning = false;
  let payrollScanDoneForSrc = '';

  function normalizeLine(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[|\[\]{}‘’“”]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function numericCandidates(value) {
    return (normalizeLine(value).match(/[-+]?\d+(?:[.,]\d+)?/g) || [])
      .map((raw) => Number(raw.replace(',', '.')))
      .filter(Number.isFinite);
  }

  function findQuantity(text, config) {
    const lines = String(text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const pattern = config.labels.find((regex) => regex.test(line));
      if (!pattern) continue;

      const match = pattern.exec(line);
      const tail = match ? line.slice(match.index + match[0].length) : line;
      const candidates = [...numericCandidates(tail), ...numericCandidates(lines[i + 1] || '')];
      const quantity = candidates.find((value) =>
        value >= 0 && value <= config.max && !config.exclude.includes(value)
      );
      if (Number.isFinite(quantity)) return String(Math.round(quantity * 100) / 100).replace('.', ',');
    }
    return '';
  }

  function markAsAutoRead(input, value) {
    if (!input || input.value.trim() || !value) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dataset.labAutoRead = 'true';
    return true;
  }

  function updateSafeWording() {
    document.querySelectorAll('input[id^="comparison-"]').forEach((input) => {
      if (!input.value.trim()) input.placeholder = 'No leído automáticamente';
    });

    document.querySelectorAll('.comparison-difference').forEach((item) => {
      if (item.textContent.trim() === 'Confirma la cifra para calcular el desfase.') {
        item.textContent = 'Comprueba la nómina. Si la lectura automática falla, introduce la cantidad manualmente.';
      }
    });
  }

  async function improvePayrollReading() {
    updateSafeWording();
    const image = document.getElementById('comparison-reference-image');
    const src = image?.src || '';
    if (!src || payrollScanRunning || payrollScanDoneForSrc === src) return;

    const missing = Object.values(TARGETS).filter((config) => {
      const input = config.ids.map((id) => document.getElementById(id)).find(Boolean);
      return input && !input.value.trim();
    });
    if (!missing.length || !window.Tesseract?.recognize) {
      payrollScanDoneForSrc = src;
      return;
    }

    payrollScanRunning = true;
    try {
      const result = await window.Tesseract.recognize(src, 'spa', {
        logger: () => undefined
      });
      const text = result?.data?.text || '';
      let recovered = 0;
      for (const config of missing) {
        const input = config.ids.map((id) => document.getElementById(id)).find(Boolean);
        const value = findQuantity(text, config);
        if (markAsAutoRead(input, value)) recovered += 1;
      }

      updateSafeWording();
      const counter = document.getElementById('comparison-detected-count');
      if (recovered && counter) {
        counter.textContent = `${document.querySelectorAll('input[id^="comparison-"]').length - document.querySelectorAll('input[id^="comparison-"]:placeholder-shown').length} cantidades leídas automáticamente de la nómina`;
      }
    } catch {
      // La revisión manual sigue disponible; nunca interpretamos un fallo OCR como ausencia.
    } finally {
      payrollScanDoneForSrc = src;
      payrollScanRunning = false;
      updateSafeWording();
    }
  }

  function guardSavingUnknownValues(event) {
    const button = event.target.closest?.('#confirm-comparison');
    if (!button || button.dataset.action === 'back' || button.dataset.action === 'replace-payroll') return;

    const unknown = [...document.querySelectorAll('input[id^="comparison-"]')]
      .filter((input) => !input.value.trim());
    if (!unknown.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const error = document.getElementById('comparison-error');
    if (error) {
      error.textContent = 'Hay conceptos que no se han leído automáticamente. Comprueba la nómina e introduce la cantidad. Escribe 0 únicamente si has comprobado que ese concepto realmente no aparece en la nómina.';
      error.hidden = false;
      error.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    unknown[0]?.focus();
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById('comparison-screen')?.hidden) {
      updateSafeWording();
      setTimeout(improvePayrollReading, 250);
    }
  });

  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('click', guardSavingUnknownValues, true);
  document.addEventListener('input', updateSafeWording, true);
  updateSafeWording();
})();
