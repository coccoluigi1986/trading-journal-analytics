/* Trade Journal Analytics — calendar.js
   Builds the "Calendario delle performance" month grid HTML (Chiudi il
   giro: Lun-Ven di default, con toggle per includere il weekend).
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./metrics.js'));
  else root.TJCalendar = factory(root.TJMetrics);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const MONTHS_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const DAY_LABELS = { 1: 'LUN', 2: 'MAR', 3: 'MER', 4: 'GIO', 5: 'VEN', 6: 'SAB', 0: 'DOM' };

  function pnlClass(pnl) {
    if (pnl > 0) return 'pill-green';
    if (pnl < 0) return 'pill-red';
    return 'pill-amber';
  }
  function fmtPct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7; // 0=Mon
    d.setDate(d.getDate() - day + 3);
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    const diff = (d - firstThursday) / 86400000;
    return `${d.getFullYear()}-W${1 + Math.round(diff / 7)}`;
  }

  function buildMonthGridRobust(byDate, year, month, showWeekend, dayCols) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks = [];
    let current = null;
    let weekIndex = -1;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dow = dateObj.getDay();
      const mondayIndex = (dow + 6) % 7; // 0=Mon
      if (mondayIndex === 0 || current === null) {
        current = { cells: new Array(dayCols.length).fill(null), weekPnL: 0, hasAny: false };
        weeks.push(current);
      }
      if (!showWeekend && (dow === 0 || dow === 6)) continue;
      const colIdx = dayCols.indexOf(dow);
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = byDate.get(iso);
      current.cells[colIdx] = { day: d, date: iso, trades: info ? info.trades : [], pnl: info ? info.pnl : 0 };
      if (info) { current.weekPnL += info.pnl; current.hasAny = true; }
    }
    return weeks;
  }

  function renderMonthHtml(trades, year, month, showWeekend) {
    const dayCols = showWeekend ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5];
    const weeks = buildMonthGridRobust(new Map(M.calendarMonth(trades, year, month).days.map((d) => [d.date, d])), year, month, showWeekend, dayCols);
    const gridClass = showWeekend ? 'calendar-grid' : 'calendar-grid no-weekend';

    let html = `<div class="${gridClass}">`;
    for (const dow of dayCols) html += `<div class="calendar-head-cell">${DAY_LABELS[dow]}</div>`;
    html += `<div class="calendar-head-cell">Totale</div>`;

    weeks.forEach((w, wi) => {
      for (const cell of w.cells) {
        if (!cell) { html += `<div class="calendar-cell empty"></div>`; continue; }
        let chips = '';
        const shown = cell.trades.slice(0, 3);
        shown.forEach((t) => {
          const pnl = M.pnlOf(t);
          chips += `<span class="calendar-chip ${pnlClass(pnl)}" title="${(t.symbol || '')} ${t.time || ''}">${fmtPct(pnl)} ${t.symbol || ''}</span>`;
        });
        if (cell.trades.length > 3) chips += `<span class="calendar-chip-more">+${cell.trades.length - 3} altri</span>`;
        html += `<div class="calendar-cell" data-date="${cell.date}">
          <div class="calendar-day-num">${cell.day}</div>
          ${chips}
        </div>`;
      }
      const label = `SETT. ${wi + 1}`;
      const cls = w.weekPnL > 0 ? 'pill-green' : (w.weekPnL < 0 ? 'pill-red' : 'pill-muted');
      html += `<div class="calendar-cell total">
        <div class="calendar-day-num">${label}</div>
        <div class="calendar-week-total"><span class="pill ${cls}">${fmtPct(w.weekPnL)}</span></div>
      </div>`;
    });
    html += `</div>`;

    const monthTotal = weeks.reduce((a, w) => a + w.weekPnL, 0);
    const totalCls = monthTotal > 0 ? 'pill-green' : (monthTotal < 0 ? 'pill-red' : 'pill-muted');
    html += `<div class="calendar-footer">
      <span style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">Totale equity mensile</span>
      <span class="pill ${totalCls}" style="font-size:15px;padding:6px 14px;">${fmtPct(monthTotal)}</span>
    </div>`;
    return html;
  }

  function weekRecap(trades, isoWeekOfDate) {
    const targetKey = isoWeekKey(isoWeekOfDate);
    const inWeek = trades.filter((t) => t.date && isoWeekKey(t.date) === targetKey);
    const k = M.kpis(inWeek);
    const sorted = M.sortByDateTime(inWeek).reverse();
    return { key: targetKey, trades: inWeek, kpis: k, recent: sorted.slice(0, 6) };
  }

  return { MONTHS_IT, DAY_LABELS, renderMonthHtml, weekRecap, isoWeekKey };
});
