(() => {
  'use strict';

  const SUPABASE_URL = 'https://icneigdnuntzugisexaz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_apKjcPClIBTHS2wwN6qPsA_6Vm4tk9m';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/lab-read-timesheet-summary`;

  const FIELD_MAP = {
    rotation: 'analysis-rotation',
    meals: 'analysis-meals',
    night: 'analysis-night',
    shift: 'analysis-shift',
    holiday: 'analysis-holiday',
    shift12: 'analysis-shift12',
    holidayDiets: 'analysis-holidayDiets',
    vacation: 'analysis-vacation',
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

  function setProgress(kind, titleText, messageText) {
    const box = document.getElementById('analysis-progress');
    const icon = document.getElementById('analysis-progress-icon');
    const title = document.getElementById('analysis-progress-title');
    const message = document.getElementById('analysis-progress-message');
    if (box) box.className = `analysis-progress ${kind}`;
    if (icon) icon.textContent = kind === 'ready' ? '✓' : (kind === 'warning' ? '!' : '🔎');
    if (title) title.textContent = titleText;
    if (message) message.textContent = messageText;
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
      const id = FIELD_MAP[key];
      const input = document.getElementById(id);
      const value = String(item?.value || '').trim();
      if (!input || !value) continue;
      input.value = value;
      input.dataset.labAutoRead = 'vision';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      seen.add(key);
      count += 1;
    }

    const counter = document.getElementById('analysis-detected-count');
    if (counter) counter.textContent = `${count} cantidades leídas automáticamente`;
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

  async function runVisionRead() {
    const screen = document.getElementById('analysis-screen');
    const img = document.getElementById('analysis-reference-image');
    if (!screen || screen.hidden || !img?.src || running || completedForSrc === img.src) return;

    running = true;
    const src = img.src;
    setProgress('checking', 'Leyendo el resumen con visión…', 'Analizamos las filas por su nombre y la cantidad de esa misma fila.');

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

      if (!response.ok) {
        if (data?.error === 'OPENAI_API_KEY_NOT_CONFIGURED') {
          setProgress('warning', 'Falta activar el lector visual', 'El LAB ya está preparado. Falta configurar de forma segura la clave del servicio de visión en Supabase.');
          return;
        }
        throw new Error(data?.error || `HTTP_${response.status}`);
      }

      if (data?.isMonthlySummary !== true) {
        clearAndApply([]);
        setProgress('warning', 'No se reconoce el resumen mensual', 'La imagen no parece contener con suficiente claridad la tabla «Resumen de variables del mes».');
        completedForSrc = src;
        return;
      }

      const count = clearAndApply(data?.concepts || []);
      setProgress(
        count ? 'ready' : 'warning',
        count ? 'Lectura visual terminada' : 'No se han podido leer las cantidades',
        count ? `Se han leído ${count} conceptos del resumen mensual. Comprueba las cifras antes de confirmar.` : 'No se ha rellenado ningún valor dudoso.'
      );
      completedForSrc = src;
    } catch (error) {
      console.error('LAB vision read error', error);
      setProgress('warning', 'No se ha podido completar la lectura visual', 'No se han modificado los datos. Vuelve a intentarlo cuando haya conexión.');
    } finally {
      running = false;
    }
  }

  const observer = new MutationObserver(() => {
    const screen = document.getElementById('analysis-screen');
    if (screen && !screen.hidden) setTimeout(runVisionRead, 2200);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'src'] });
})();
