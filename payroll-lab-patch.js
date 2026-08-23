(() => {
  'use strict';

  // LAB: leemos únicamente las CANTIDADES de los conceptos variables que
  // se comparan con el «Resumen de variables del mes» del registro de jornada.
  const TARGETS = {
    rotation: {
      ids: ['comparison-rotation'],
      labels: [/PLUS\s+ROTATIVIDAD/, /ROTATIVIDAD/],
      max: 31,
      integer: true,
      exclude: []
    },
    meals: {
      ids: ['comparison-meals'],
      labels: [
        /PRF\s+COMIDAS?\s+C\.?\s*GUASCH(?:\s+EX\.?)?/,
        /COMIDAS?.*GUASCH/,
        /CAN\s+GUASCH/
      ],
      max: 31,
      integer: true,
      exclude: []
    },
    night: {
      ids: ['comparison-night'],
      labels: [/PLUS\s+NOCTURNO/, /NOCTURNO/],
      max: 200,
      integer: false,
      exclude: []
    },
    shift: {
      ids: ['comparison-shift'],
      labels: [/PLUS\s+DE\s+TURNO(?!\s*12)/, /PLUS\s+TURNO(?!\s*12)/],
      max: 31,
      integer: true,
      exclude: []
    },
    holiday: {
      ids: ['comparison-holiday'],
      labels: [/PLUS\s+FESTIVO/, /FESTIVO/],
      max: 200,
      integer: false,
      exclude: []
    },
    shift12: {
      ids: ['comparison-shift12'],
      labels: [
        /PLUS\s+(?:DE\s+)?TURNO\s*12\s*(?:H|HORAS?)/,
        /TURNO\s*12\s*(?:H|HORAS?)/,
        /PLUS.*12\s*(?:H|HORAS?)/
      ],
      max: 31,
      integer: true,
      exclude: [12]
    },
    holidayDiets: {
      ids: ['comparison-holidayDiets'],
      labels: [/DIETAS?\s+FESTIVOS?/, /DIETA\s+FESTIVO/, /DIET.*FEST/],
      max: 31,
      integer: true,
      exclude: []
    },
    vacation: {
      ids: ['comparison-vacation'],
      labels: [/PLUSES?\s+VACACIONES?/, /PLUS\s+VACACIONES?/, /PLUS.*VACAC/],
      max: 31,
      integer: true,
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

  function normalizedScreenTitle() {
    return normalizeLine(document.getElementById('document-screen-title')?.textContent || '');
  }

  function isPayrollScreen() {
    return normalizedScreenTitle().includes('NOMINA');
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

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.95) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('CROP_FAILED')), type, quality);
    });
  }

  async function cropPayroll(file) {
    const img = await loadImage(file);
    const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
    if (ratio < 1.08) return file;

    // Nómina Grifols: conservamos la franja central de «Devengos y deducciones».
    // Se elimina la cabecera identificativa y la zona inferior con datos ajenos
    // a la comparación mensual.
    const startY = Math.round(img.naturalHeight * 0.35);
    const endY = Math.round(img.naturalHeight * 0.82);
    const cropHeight = Math.max(1, endY - startY);

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, startY, img.naturalWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas);
    const baseName = (file.name || 'nomina').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}-solo-devengos.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  }

  function setPayrollCropNotice() {
    const instruction = document.getElementById('instruction-text');
    if (instruction && isPayrollScreen()) {
      instruction.textContent = 'Sube la nómina completa. El LAB eliminará la cabecera con datos personales y conservará la zona «Devengos y deducciones» para que la revises antes de guardarla.';
    }
  }

  const documentInput = document.getElementById('document-image');
  if (documentInput && typeof DataTransfer !== 'undefined') {
    documentInput.addEventListener('change', async event => {
      if (!isPayrollScreen() || documentInput.dataset.strigPayrollCropReady === '1') {
        delete documentInput.dataset.strigPayrollCropReady;
        return;
      }

      const file = event.target.files && event.target.files[0];
      if (!file || !String(file.type || '').startsWith('image/')) return;

      // Interceptamos antes del lector principal para que privacidad y OCR reciban
      // únicamente el recorte anonimizado, nunca la nómina completa.
      event.stopImmediatePropagation();
      setPayrollCropNotice();

      try {
        const cropped = await cropPayroll(file);
        const dt = new DataTransfer();
        dt.items.add(cropped);
        documentInput.files = dt.files;
        documentInput.dataset.strigPayrollCropReady = '1';
        documentInput.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        console.error('LAB payroll crop error', error);
        const dt = new DataTransfer();
        dt.items.add(file);
        documentInput.files = dt.files;
        documentInput.dataset.strigPayrollCropReady = '1';
        documentInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, true);
  }

  document.getElementById('open-payroll')?.addEventListener('click', () => {
    setTimeout(setPayrollCropNotice, 0);
  });

  function rawNumericCandidates(value) {
    return (normalizeLine(value).match(/[-+]?\d+(?:[.,]\d+)?/g) || []);
  }

  function parseCandidate(raw, config) {
    if (!raw) return null;
    const cleaned = String(raw)
      .replace(/[OoQD]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[Ss]/g, '5')
      .replace(',', '.');
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value < 0 || value > config.max) return null;
    if (config.integer && !Number.isInteger(value)) return null;
    if (config.exclude.includes(value)) return null;
    return value;
  }

  function findQuantity(text, config) {
    const lines = String(text || '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const pattern = config.labels.find((regex) => regex.test(line));
      if (!pattern) continue;

      const match = pattern.exec(line);
      const tail = match ? line.slice(match.index + match[0].length) : line;
      const candidates = [
        ...rawNumericCandidates(tail),
        ...rawNumericCandidates(lines[i + 1] || '')
      ];

      for (const raw of candidates) {
        const value = parseCandidate(raw, config);
        if (Number.isFinite(value)) {
          return String(Math.round(value * 100) / 100).replace('.', ',');
        }
      }
    }
    return '';
  }

  function markAsAutoRead(input, value) {
    if (!input || input.value.trim() || value === '') return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dataset.labAutoRead = 'true';
    return true;
  }

  function updateSafeWording() {
    document.querySelectorAll('input[id^="analysis-"]').forEach((input) => {
      if (!input.value.trim()) input.placeholder = 'No leído automáticamente';
    });

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
        logger: () => undefined,
        preserve_interword_spaces: '1'
      });
      const text = result?.data?.text || '';

      for (const config of missing) {
        const input = config.ids.map((id) => document.getElementById(id)).find(Boolean);
        const value = findQuantity(text, config);
        markAsAutoRead(input, value);
      }

      updateSafeWording();
      const counter = document.getElementById('comparison-detected-count');
      if (counter) {
        const filled = [...document.querySelectorAll('input[id^="comparison-"]')]
          .filter((input) => input.value.trim()).length;
        counter.textContent = `${filled} cantidades leídas automáticamente de la nómina`;
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
    updateSafeWording();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden']
  });

  document.addEventListener('click', guardSavingUnknownValues, true);
  document.addEventListener('input', updateSafeWording, true);
  updateSafeWording();
})();
