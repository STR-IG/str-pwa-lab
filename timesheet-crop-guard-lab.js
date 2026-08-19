(() => {
  'use strict';

  const fileInput = document.getElementById('document-image');
  const confirmButton = document.getElementById('confirm-image');
  const privacyScan = document.getElementById('privacy-scan');
  const privacyIcon = document.getElementById('privacy-scan-icon');
  const privacyTitle = document.getElementById('privacy-scan-title');
  const privacyMessage = document.getElementById('privacy-scan-message');
  const preview = document.getElementById('image-preview');
  const previewStatus = document.getElementById('preview-status-text');
  const changeButton = document.getElementById('change-image');
  const screenTitle = document.getElementById('document-screen-title');
  if (!fileInput || !confirmButton) return;

  let state = 'idle'; // idle | checking | valid | invalid
  let version = 0;

  function isTimesheetScreen() {
    return (screenTitle?.textContent || '').trim().toLowerCase().includes('registro de jornada');
  }

  function normalize(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function classify(text) {
    const t = normalize(text);
    const summaryMarkers = [
      /RESUMEN\s+DE\s+VARIABLES(?:\s+DEL\s+MES)?/,
      /PLUS\s+ROT[A-Z]*VIDAD/,
      /COMIDAS?\s+CAN\s+GUA?SCH/,
      /PLUS\s+NOCTURN/,
      /PLUS\s+(?:DE\s+)?TURNO/,
      /PLUS(?:ES)?\s+FESTIVO/,
      /DIETAS?\s+FESTIVOS?/,
      /PLUS(?:ES)?\s+VACACIONES?/
    ];
    const knownVariables = summaryMarkers.slice(1).filter(re => re.test(t)).length;
    const hasSummaryHeading = summaryMarkers[0].test(t);
    const hasSupportBlock = /TOTAL\s+HORAS\s+PERIODO/.test(t) || /\bSALDOS?\b/.test(t);

    const dailyMarkers = [
      /\bFECHA\b/, /\bDIA\b/, /\bHORARIO\b/, /HORA\s+INICIO/, /HORA\s+FIN/, /HORAS?\s+TEOR/, /\bDIAS\b/
    ].filter(re => re.test(t)).length;
    const dateRows = (t.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g) || []).length;

    const looksLikeSummary = hasSummaryHeading || (knownVariables >= 3 && hasSupportBlock);
    const includesDailyRegister = dailyMarkers >= 3 || dateRows >= 3;
    return { looksLikeSummary, includesDailyRegister, knownVariables, dailyMarkers, dateRows };
  }

  function showInvalid(reason) {
    state = 'invalid';
    if (privacyScan) {
      privacyScan.hidden = false;
      privacyScan.className = 'privacy-scan blocked';
    }
    if (privacyIcon) privacyIcon.textContent = '!';
    if (privacyTitle) privacyTitle.textContent = 'Recorte del registro no válido';
    if (privacyMessage) privacyMessage.textContent = reason || 'Recorta la hoja dejando «Total horas periodo», «Resumen de variables del mes» y «Saldos». No debe aparecer la tabla diaria con fechas y horarios.';
    if (preview) preview.classList.add('scan-blocked');
    if (previewStatus) previewStatus.textContent = 'Imagen no aceptada: recorta el resumen mensual';
    confirmButton.disabled = true;
    confirmButton.textContent = 'Imagen no aceptada';
    if (changeButton) changeButton.textContent = 'Recortar o cambiar imagen';
  }

  function showChecking() {
    state = 'checking';
    if (privacyScan) {
      privacyScan.hidden = false;
      privacyScan.className = 'privacy-scan checking';
    }
    if (privacyIcon) privacyIcon.textContent = '🔎';
    if (privacyTitle) privacyTitle.textContent = 'Comprobando el recorte…';
    if (privacyMessage) privacyMessage.textContent = 'Verificamos que sea el resumen mensual y que no incluya la tabla diaria de fechas y horarios.';
    confirmButton.disabled = true;
  }

  async function validateFile(file, myVersion) {
    if (!isTimesheetScreen() || !file) {
      state = 'idle';
      return;
    }
    showChecking();
    try {
      if (!window.Tesseract?.recognize) throw new Error('OCR unavailable');
      const result = await window.Tesseract.recognize(file, 'spa', { logger: () => undefined });
      if (myVersion !== version) return;
      const c = classify(result?.data?.text || '');
      if (c.includesDailyRegister) {
        showInvalid('Has incluido la tabla diaria del registro de jornada (fechas, horarios o fichajes). Recorta la imagen dejando únicamente «Total horas periodo», «Resumen de variables del mes» y «Saldos».');
        return;
      }
      if (!c.looksLikeSummary) {
        showInvalid('No podemos confirmar que esta sea la captura correcta. Deben verse «Resumen de variables del mes» y sus conceptos/cantidades; también pueden verse «Total horas periodo» y «Saldos».');
        return;
      }
      state = 'valid';
      // No forzamos el botón: la comprobación original de privacidad debe superarse también.
    } catch (_) {
      if (myVersion !== version) return;
      showInvalid('No hemos podido comprobar el recorte. Prueba con una captura JPG o PNG donde se vea claramente el resumen mensual.');
    }
  }

  fileInput.addEventListener('change', (event) => {
    if (!isTimesheetScreen()) { state = 'idle'; return; }
    const file = event.target.files?.[0];
    const myVersion = ++version;
    setTimeout(() => validateFile(file, myVersion), 40);
  }, true);

  confirmButton.addEventListener('click', (event) => {
    if (!isTimesheetScreen()) return;
    if (state === 'valid') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state === 'checking') {
      if (privacyTitle) privacyTitle.textContent = 'Comprobando el recorte…';
      if (privacyMessage) privacyMessage.textContent = 'Espera unos segundos a que termine la comprobación.';
      return;
    }
    showInvalid();
  }, true);
})();
