// STR-IG LAB · lectura guiada del registro de jornada
// Objetivo: leer SOLO la zona útil «Resumen de variables del mes» y evitar
// que columnas irrelevantes (p. ej. horas teóricas) contaminen la extracción.

(() => {
  'use strict';

  const TARGET_TITLE = 'resumen de variables del mes';
  const ALLOWED_VARIABLES = [
    { key: 'comidas_can_guasch', labels: ['comidas can guasch', 'comida can guasch', 'can guasch'] },
    { key: 'plus_turno', labels: ['plus de turno', 'plus turno'] },
    { key: 'plus_nocturno', labels: ['plus nocturno', 'nocturno', 'nocturnidad'] },
    { key: 'plus_festivo', labels: ['plus festivo', 'festivo'] },
    { key: 'turno_12h', labels: ['turno de 12 horas', 'turno 12 horas', '12 horas', '12h'] },
    { key: 'sabado_domingo', labels: ['sábado/domingo', 'sabado/domingo', 'sábado domingo', 'sabado domingo'] },
    { key: 'flexibilizacion', labels: ['flexibilización', 'flexibilizacion'] },
    { key: 'diferencia_grupo_superior', labels: ['diferencia grupo superior', 'grupo superior'] },
    { key: 'festivo_local', labels: ['festivo local'] }
  ];

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const numberFromText = value => {
    const text = String(value || '')
      .replace(/\s/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };

  function findTargetBlock(lines) {
    const normalized = lines.map(normalize);
    const start = normalized.findIndex(line => line.includes(TARGET_TITLE));
    if (start < 0) return null;

    // El resumen normalmente ocupa pocas líneas. Cortamos antes de entrar en
    // otra sección para no mezclar fichajes, horas teóricas u otros totales.
    const block = [];
    for (let i = start; i < Math.min(lines.length, start + 45); i += 1) {
      const n = normalized[i];
      if (i > start && /^(detalle|fichajes|marcajes|saldo|resumen diario|horas teoricas|horas teóricas)/.test(n)) break;
      block.push(lines[i]);
    }
    return block;
  }

  function parseVariables(block) {
    const result = {};
    const warnings = [];

    for (let i = 0; i < block.length; i += 1) {
      const line = String(block[i] || '');
      const n = normalize(line);

      for (const variable of ALLOWED_VARIABLES) {
        if (result[variable.key] != null) continue;
        if (!variable.labels.some(label => n.includes(normalize(label)))) continue;

        let value = numberFromText(line.replace(/^[^:\t-]*[:\t-]?/, ''));

        // Si la etiqueta y el valor han quedado partidos por la extracción del PDF,
        // probamos la línea siguiente, pero nunca más allá de una línea.
        if (value == null && i + 1 < block.length) {
          value = numberFromText(block[i + 1]);
        }

        if (value != null) result[variable.key] = value;
      }
    }

    if (Object.keys(result).length === 0) {
      warnings.push('Se encontró «Resumen de variables del mes», pero no se pudieron leer sus conceptos.');
    }

    return { values: result, warnings };
  }

  function extractFromText(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const block = findTargetBlock(lines);
    if (!block) {
      return {
        ok: false,
        code: 'SUMMARY_NOT_FOUND',
        message: 'No encuentro la tabla «Resumen de variables del mes». Usa un PDF donde esa tabla sea visible.',
        values: {},
        sourceBlock: []
      };
    }

    const parsed = parseVariables(block);
    return {
      ok: Object.keys(parsed.values).length > 0,
      code: Object.keys(parsed.values).length > 0 ? 'OK' : 'NO_VARIABLES_READ',
      message: Object.keys(parsed.values).length > 0
        ? 'Resumen de variables leído.'
        : parsed.warnings[0],
      values: parsed.values,
      sourceBlock: block,
      warnings: parsed.warnings
    };
  }

  // API estable para el resto del laboratorio.
  window.STRIG_TIMESHEET_READER = {
    extractFromText,
    allowedVariables: ALLOWED_VARIABLES.map(v => v.key)
  };
})();
