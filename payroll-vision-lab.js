(() => {
  'use strict';

  const SUPABASE_URL = 'https://icneigdnuntzugisexaz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_apKjcPClIBTHS2wwN6qPsA_6Vm4tk9m';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/lab-read-payroll-variables`;

  const FIELD_MAP = {
    rotation: 'comparison-rotation',
    meals: 'comparison-meals',
    night: 'comparison-night',
    shift: 'comparison-shift',
    holiday: 'comparison-holiday',
    shift12: 'comparison-shift12',
    holidayDiets: 'comparison-holidayDiets',
    vacation: 'comparison-vacation',
  };

  let running = false;
  let completedForSrc = '';

  function norm(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function conceptKey(name) {
    const n = norm(name);
    if (!n) return '';
    if ((n.includes('turno') || n.includes('turo')) && n.includes('12')) return 'shift12';
    if (n.includes('dieta') && n.includes('festiv')) return 'holidayDiets';
    if (n.includes('comida') || n.includes('guasch')) return 'meals';
    if (n.includes('rotat')) return 'rotation';
    if (n.includes('noct')) return 'night';
    if (n.includes('vacaci')) return 'vacation';
    if (n.includes('festiv')) return 'holiday';
    if (n.includes('turno') || n.includes('turo')) return 'shift';
    return '';
  }

  function markAsRead(input) {
    if (!input?.value?.trim()) return;
    let node = input.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const badge = [...node.querySelectorAll('span, div')].find((el) => {
        const text = el.textContent.trim().toUpperCase();
        return text === 'REVISADO' || text === 'DETECTADO' || text === 'COMPROBAR';
      });
      if (badge) {
        badge.textContent = 'LEÍDO';
        return;
      }
    }
  }

  function setPayrollProgress(kind, title, message) {
    const box = document.getElementById('comparison-progress');
    const icon = document.getElementById('comparison-progress-icon');
    const titleEl = document.getElementById('comparison-progress-title');
    const messageEl = document.getElementById('comparison-progress-message');
    if (box) box.className = `analysis-progress ${kind}`;
    if (icon) icon.textContent = kind === 'ready' ? '✓' : (kind === 'warning' ? '!' : '🔎');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
  }

  async function imageToJpegDataUrl(img) {
    if (!img?.naturalWidth || !img?.naturalHeight) {
      await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', reject, { once: true });
      });
    }
    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  function clearAndApply(concepts) {
    Object.values(FIELD_MAP).forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = '';
      input.placeholder = 'No leído automáticamente';
      delete input.dataset.labAutoRead;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    let count = 0;
    const seen = new Set();
    for (const item of concepts || []) {
      const key = conceptKey(item?.name);
      if (!key || seen.has(key)) continue;
      const input = document.getElementById(FIELD_MAP[key]);
      const value = String(item?.value || '').trim();
      if (!input || !value) continue;
      input.value = value;
      input.dataset.labAutoRead = 'vision';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      markAsRead(input);
      setTimeout(() => markAsRead(input), 0);
      setTimeout(() => markAsRead(input), 150);
      seen.add(key);
      count += 1;
    }

    const counter = document.getElementById('comparison-detected-count');
    if (counter) counter.textContent = `${count} cantidades leídas automáticamente de la nómina`;
    return count;
  }

  async function getSession() {
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const client = mod.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true }
    });
    const { data: { session } } = await client.auth.getSession();
    return session;
  }

  async function runPayrollVisionRead() {
    const screen = document.getElementById('comparison-screen');
    const img = document.getElementById('comparison-reference-image');
    if (!screen || screen.hidden || !img?.src || running || completedForSrc === img.src) return;

    running = true;
    const src = img.src;
    setPayrollProgress('checking', 'Leyendo la nómina con visión…', 'Buscamos las cantidades de los mismos conceptos variables del registro de jornada.');

    try {
      const [session, imageDataUrl] = await Promise.all([getSession(), imageToJpegDataUrl(img)]);
      if (!session?.access_token) throw new Error('NO_SESSION');

      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ imageDataUrl })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data?.error || `HTTP_${response.status}`);

      if (data?.isPayroll !== true) {
        clearAndApply([]);
        setPayrollProgress('warning', 'No se reconoce la nómina', 'La imagen no permite identificar con seguridad los conceptos variables de la nómina.');
        completedForSrc = src;
        return;
      }

      const count = clearAndApply(data?.concepts || []);
      setPayrollProgress(
        count ? 'ready' : 'warning',
        count ? 'Lectura de nómina terminada' : 'No se han podido leer las cantidades de la nómina',
        count ? `Se han leído ${count} conceptos de la nómina. Comprueba las cifras antes de comparar.` : 'No se ha rellenado ningún valor dudoso.'
      );
      completedForSrc = src;
    } catch (error) {
      console.error('LAB payroll vision read error', error);
      setPayrollProgress('warning', 'No se ha podido completar la lectura de la nómina', 'No se han modificado los datos. Vuelve a intentarlo cuando haya conexión.');
    } finally {
      running = false;
    }
  }

  const observer = new MutationObserver(() => {
    const screen = document.getElementById('comparison-screen');
    if (screen && !screen.hidden) setTimeout(runPayrollVisionRead, 2200);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'src'] });
})();
