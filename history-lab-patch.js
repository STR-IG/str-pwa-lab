(() => {
  const style = document.createElement('style');
  style.textContent = `
    .history-review-summary {
      display: block;
      margin-top: 11px;
      padding: 10px 11px;
      border-radius: 11px;
      color: #205b38;
      background: #edf8f3;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.45;
    }
    .history-review-summary.pending {
      color: #6f5a12;
      background: #fff8df;
    }
    .history-review-summary.issue {
      color: #8a1d24;
      background: #fff0f1;
    }
    .history-review-detail {
      display: block;
      margin-top: 5px;
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);

  function historyVariableLabel(key) {
    const variable = PAYROLL_VARIABLES.find((item) => item.key === key);
    return variable?.label || key;
  }

  function historyQuantity(value) {
    return formatQuantity(Number(value || 0));
  }

  function createReviewSummary(entry, reviewed, incidents) {
    const summary = document.createElement('span');
    summary.className = 'history-review-summary';

    if (!entry.timesheet || !entry.payroll) {
      summary.classList.add('pending');
      summary.textContent = 'Falta uno de los dos documentos para poder hacer la revisión.';
      return summary;
    }

    if (!reviewed) {
      summary.classList.add('pending');
      summary.textContent = 'Registro y nómina guardados. Falta analizarlos y guardar la revisión mensual.';
      return summary;
    }

    const mismatches = Object.entries(entry.review?.comparisons || {})
      .filter(([, item]) => item?.status === 'mismatch');

    if (!incidents) {
      summary.textContent = '✓ Revisión completada: todos los conceptos comparados coinciden.';
      return summary;
    }

    summary.classList.add('issue');
    summary.textContent = `⚠ ${incidents} posible${incidents === 1 ? '' : 's'} incidencia${incidents === 1 ? '' : 's'} detectada${incidents === 1 ? '' : 's'}.`;

    mismatches.slice(0, 3).forEach(([key, result]) => {
      const detail = document.createElement('span');
      detail.className = 'history-review-detail';
      const difference = Math.abs(Number(result?.difference || 0));
      detail.textContent = `${historyVariableLabel(key)}: registro ${historyQuantity(result?.register)} · nómina ${historyQuantity(result?.payroll)} · diferencia ${historyQuantity(difference)}.`;
      summary.appendChild(detail);
    });

    return summary;
  }

  renderPrivateHistory = function renderPrivateHistoryPatched() {
    historyList.textContent = '';
    historyCount.textContent = historyEntries.length === 1
      ? '1 periodo guardado'
      : `${historyEntries.length} periodos guardados`;
    historyLoading.hidden = true;
    historyError.hidden = true;
    historyList.hidden = historyEntries.length === 0;
    historyEmpty.hidden = historyEntries.length !== 0;

    historyEntries.forEach((entry) => {
      const complete = entry.timesheet && entry.payroll;
      const reviewed = entry.review?.status === 'complete';
      const incidents = monthlyIncidentCount(entry.review);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `history-card${complete ? ' complete' : ''}${incidents ? ' has-alert' : ''}`;
      card.setAttribute('aria-label', `Abrir ${monthNames[entry.month - 1]} de ${entry.year}`);

      const top = document.createElement('span');
      top.className = 'history-card-top';

      const title = document.createElement('strong');
      title.className = 'history-period-title';
      title.textContent = `${monthNames[entry.month - 1][0].toUpperCase()}${monthNames[entry.month - 1].slice(1)} de ${entry.year}`;

      const status = document.createElement('span');
      status.className = 'history-period-status';
      status.textContent = !complete
        ? '1 de 2'
        : (!reviewed
          ? 'Pendiente revisar'
          : (incidents
            ? `⚠ ${incidents} incidencia${incidents === 1 ? '' : 's'}`
            : '✓ Todo correcto'));

      top.appendChild(title);
      top.appendChild(status);

      const chips = document.createElement('span');
      chips.className = 'history-document-chips';
      chips.appendChild(createHistoryChip('Registro de jornada', entry.timesheet));
      chips.appendChild(createHistoryChip('Nómina', entry.payroll));
      if (complete) {
        chips.appendChild(createHistoryChip(
          reviewed ? (incidents ? `${incidents} incidencia${incidents === 1 ? '' : 's'}` : 'Revisión completada') : 'Pendiente de comparar',
          reviewed && !incidents,
          reviewed && Boolean(incidents)
        ));
      }

      const summary = createReviewSummary(entry, reviewed, incidents);

      const openLabel = document.createElement('span');
      openLabel.className = 'history-open-label';
      openLabel.textContent = reviewed ? 'Ver revisión ›' : 'Abrir periodo ›';

      card.appendChild(top);
      card.appendChild(chips);
      card.appendChild(summary);
      card.appendChild(openLabel);
      card.addEventListener('click', () => openHistoryPeriod(entry.year, entry.month));
      historyList.appendChild(card);
    });
  };
})();
