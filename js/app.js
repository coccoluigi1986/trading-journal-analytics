/* Trade Journal Analytics — app.js
   Main controller: tab navigation, upload flow, rendering of every tab.
   Pure client-side app — trades never leave the browser (localStorage only).
*/
(function () {
  'use strict';
  const M = window.TJMetrics, I = window.TJInsights, P = window.TJParser, DB = window.TJDB, CAL = window.TJCalendar, CH = window.TJCharts;

  const state = {
    trades: DB.getAllTrades(),
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    showWeekend: DB.getSettings().weekendVisible,
    pendingImport: null, // { headers, rows, mapping }
    tradeFilter: '',
    editingTradeId: null
  };

  function latestTradeDate(trades) {
    if (!trades.length) return null;
    return M.sortByDateTime(trades).filter((t) => t.date).slice(-1)[0]?.date || null;
  }

  // Default the calendar to the month of the most recent trade, not the
  // real current month, since journals are reviewed after the fact.
  (function initCalendarDefault() {
    const latest = latestTradeDate(state.trades);
    if (latest) {
      const d = new Date(latest + 'T00:00:00');
      state.calYear = d.getFullYear();
      state.calMonth = d.getMonth();
    }
  })();

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/d' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
  function fmtNum(n, d) { return n === null || n === undefined || !Number.isFinite(n) ? 'n/d' : n.toFixed(d ?? 2); }

  // ---------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- tabs
  function switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tab === tab));
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'calendar') renderCalendarTab();
    if (tab === 'insights') renderInsightsTab();
    if (tab === 'trades') renderTradesTab();
    localStorage.setItem('tj_last_tab', tab);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn && (btn.classList.contains('tab-btn') || btn.closest('.bottom-nav'))) switchTab(btn.dataset.tab);
  });

  // ------------------------------------------------------------ dashboard
  function renderDashboard() {
    const trades = state.trades;
    const el = document.getElementById('panel-dashboard');
    if (!trades.length) { el.innerHTML = emptyState('Carica il tuo journal per vedere qui la dashboard completa.'); return; }
    const k = M.kpis(trades);
    const pips = M.pipsStats(trades);

    el.innerHTML = `
      <div class="grid grid-4">
        ${kpiTile('Trade totali', k.totalTrades)}
        ${kpiTile('Win rate', fmtPct(k.winRate).replace('+', ''), k.winRate >= 50 ? 'pos' : 'neg')}
        ${kpiTile('Profit factor', Number.isFinite(k.profitFactor) ? k.profitFactor.toFixed(2) : '∞', k.profitFactor >= 1 ? 'pos' : 'neg')}
        ${kpiTile('Aspettativa media', fmtPct(k.expectancy), k.expectancy >= 0 ? 'pos' : 'neg')}
        ${kpiTile('R:R medio', k.avgRR !== null ? k.avgRR.toFixed(2) + 'R' : 'n/d', '', k.rrOutliersExcluded > 0 ? `${k.rrOutliersExcluded} valore/i anomalo/i escluso/i` : '')}
        ${kpiTile('MAE medio', fmtPct(k.avgMAE))}
        ${kpiTile('MFE medio', fmtPct(k.avgMFE))}
        ${kpiTile('Drawdown massimo', fmtPct(k.maxDrawdown), 'neg')}
        ${kpiTile('Serie vincenti massima', k.bestWinStreak, 'pos')}
        ${kpiTile('Serie perdenti massima', k.worstLossStreak, 'neg')}
        ${kpiTile('Pips totali', fmtNum(pips.totalPips, 1))}
        ${kpiTile('Trade in BE', k.breakevens)}
      </div>

      <div class="card">
        <div class="card-title">📈 Curva Equity</div>
        <div class="card-subtitle">Andamento cumulato del risultato (%), trade dopo trade</div>
        <div class="chart-wrap tall"><canvas id="chart-equity"></canvas></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">📅 Performance per giorno</div>
          <div class="card-subtitle">Win rate per giorno della settimana</div>
          <div class="chart-wrap"><canvas id="chart-weekday"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">🕐 Performance per orario</div>
          <div class="card-subtitle">Win rate per fascia oraria di ingresso</div>
          <div class="chart-wrap"><canvas id="chart-hour"></canvas></div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">🎯 Take Profit / Stop Loss / Breakeven</div>
          <div class="chart-wrap"><canvas id="chart-donut"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">↕️ Long vs Short</div>
          <div class="card-subtitle">Win rate per direzione</div>
          <div class="chart-wrap"><canvas id="chart-direction"></canvas></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🌊 MAE / MFE medi</div>
        <div class="card-subtitle">Escursione avversa e favorevole media prima del risultato finale del trade</div>
        <div class="chart-wrap"><canvas id="chart-maemfe"></canvas></div>
        ${maeMfeEfficiencyNote(trades)}
      </div>

      <div class="card">
        <div class="card-title">📆 Confronto mensile</div>
        <div class="card-subtitle">P&amp;L e Win Rate mese per mese</div>
        <div class="chart-wrap"><canvas id="chart-monthly"></canvas></div>
      </div>
    `;

    CH.equityCurve('chart-equity', M.equityCurve(trades));
    CH.weekdayBar('chart-weekday', M.byWeekday(trades));
    const hourRows = M.byHour(trades);
    CH.hourBar('chart-hour', hourRows.length ? hourRows : [{ label: 'n/d', winRate: 0, n: 0 }]);
    CH.winLossDonut('chart-donut', k);
    const dirRows = M.byDirection(trades);
    CH.directionBar('chart-direction', dirRows.length ? dirRows : [{ key: 'long', winRate: 0 }, { key: 'short', winRate: 0 }]);
    CH.maeMfeBar('chart-maemfe', k.avgMAE, k.avgMFE);
    CH.monthlyComparison('chart-monthly', monthlyRows(trades));
  }

  function maeMfeEfficiencyNote(trades) {
    const eff = M.maeMfeEfficiency(trades);
    if (!eff) return `<p class="kpi-sub" style="margin-top:10px;">Dati MAE/MFE non presenti nel journal caricato.</p>`;
    return `<p class="kpi-sub" style="margin-top:10px;">Efficienza di cattura del movimento: in media catturi il ${eff.avgCaptureRatio.toFixed(0)}% del massimo movimento favorevole (MFE) su ${eff.n} trade con dati disponibili.</p>`;
  }

  function monthlyRows(trades) {
    const byMonth = new Map();
    for (const t of M.sortByDateTime(trades)) {
      if (!t.date) continue;
      const key = t.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(t);
    }
    return [...byMonth.entries()].map(([key, list]) => {
      const k = M.kpis(list);
      const [y, m] = key.split('-');
      return { label: `${CAL.MONTHS_IT[parseInt(m, 10) - 1].slice(0, 3)} ${y}`, pnl: k.totalPnL, winRate: k.winRate };
    });
  }

  function kpiTile(label, value, cls, sub) {
    return `<div class="kpi-tile"><div class="kpi-label">${esc(label)}</div><div class="kpi-value ${cls || ''}">${esc(value)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
  }

  function emptyState(msg) {
    return `<div class="empty-state"><div class="big">📭</div><p>${esc(msg)}</p>
      <button class="btn btn-primary" onclick="TJSwitchTab('upload')">Carica journal</button></div>`;
  }

  // -------------------------------------------------------------- calendar
  function renderCalendarTab() {
    const el = document.getElementById('panel-calendar');
    if (!state.trades.length) { el.innerHTML = emptyState('Carica il tuo journal per vedere il calendario delle performance.'); return; }
    const label = `${CAL.MONTHS_IT[state.calMonth]} ${state.calYear}`;
    el.innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <div class="card-title" style="margin-bottom:0;">🗓️ Calendario<div class="card-subtitle" style="margin:0 0 0 10px;font-weight:400;">Il tuo mese di trading, giorno per giorno</div></div>
          <div class="calendar-nav">
            <button class="btn btn-sm" id="btn-weekend">${state.showWeekend ? 'Nascondi weekend' : 'Weekend'}</button>
            <button class="btn btn-sm" id="btn-prev-month">‹</button>
            <span style="font-weight:700;min-width:130px;text-align:center;display:inline-block;">${label}</span>
            <button class="btn btn-sm" id="btn-next-month">›</button>
            <button class="btn btn-sm" id="btn-today">Oggi</button>
          </div>
        </div>
        <div id="calendar-grid-host">${CAL.renderMonthHtml(state.trades, state.calYear, state.calMonth, state.showWeekend)}</div>
      </div>
      <div class="card">
        <div class="card-title">🏆 Migliori e peggiori giornate</div>
        ${bestWorstDaysHtml(state.trades)}
      </div>
      <div class="card" id="week-recap-host"></div>
    `;
    document.getElementById('btn-prev-month').onclick = () => { changeMonth(-1); };
    document.getElementById('btn-next-month').onclick = () => { changeMonth(1); };
    document.getElementById('btn-today').onclick = () => {
      const now = new Date(); state.calYear = now.getFullYear(); state.calMonth = now.getMonth(); renderCalendarTab();
    };
    document.getElementById('btn-weekend').onclick = () => {
      state.showWeekend = !state.showWeekend; DB.saveSettings({ weekendVisible: state.showWeekend }); renderCalendarTab();
    };
    document.querySelectorAll('.calendar-cell[data-date]').forEach((c) => {
      c.style.cursor = 'pointer';
      c.onclick = () => renderWeekRecap(c.dataset.date);
    });
    const anchor = latestTradeDate(state.trades) || new Date().toISOString().slice(0, 10);
    renderWeekRecap(anchor);
  }

  function changeMonth(delta) {
    state.calMonth += delta;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendarTab();
  }

  function bestWorstDaysHtml(trades) {
    const { best, worst } = M.bestWorstDays(trades, 5);
    function rows(list, cls) {
      if (!list.length) return `<p class="kpi-sub">Dati insufficienti.</p>`;
      return `<ul class="simple-list">${list.map((d) => `<li><span class="pill ${cls}">${fmtPct(d.pnl)}</span> ${d.date} · ${d.n} trade · ${d.winRate.toFixed(0)}% win rate</li>`).join('')}</ul>`;
    }
    return `<div class="grid grid-2">
      <div><h4 style="margin:0 0 8px;font-size:13px;color:var(--green);">Giorni migliori</h4>${rows(best, 'pill-green')}</div>
      <div><h4 style="margin:0 0 8px;font-size:13px;color:var(--red);">Giorni peggiori</h4>${rows(worst, 'pill-red')}</div>
    </div>`;
  }

  function renderWeekRecap(dateStr) {
    const host = document.getElementById('week-recap-host');
    if (!host) return;
    const recap = CAL.weekRecap(state.trades, dateStr);
    const k = recap.kpis;
    if (!recap.trades.length) { host.innerHTML = `<div class="card-title">📋 Recap settimanale</div><p class="kpi-sub">Nessun trade in questa settimana.</p>`; return; }
    host.innerHTML = `
      <div class="card-title">📋 Recap settimanale <span class="pill pill-muted">${recap.key}</span></div>
      <div class="grid grid-4" style="margin-bottom:14px;">
        ${kpiTile('Trade totali', k.totalTrades)}
        ${kpiTile('P&L', fmtPct(k.totalPnL), k.totalPnL >= 0 ? 'pos' : 'neg')}
        ${kpiTile('Win rate', k.winRate.toFixed(1) + '%', k.winRate >= 50 ? 'pos' : 'neg')}
        ${kpiTile('Win / Loss / BE', `${k.wins}/${k.losses}/${k.breakevens}`)}
      </div>
      <h4 style="margin:0 0 8px;font-size:13px;color:var(--text-muted);">Ultimi trade</h4>
      <ul class="simple-list">
        ${recap.recent.map((t) => `<li><span class="pill ${M.isWin(t) ? 'pill-green' : M.isLoss(t) ? 'pill-red' : 'pill-amber'}">${fmtPct(M.pnlOf(t))}</span> ${esc(t.symbol || '')} · ${t.date} ${t.time || ''}</li>`).join('')}
      </ul>
    `;
  }

  // -------------------------------------------------------------- insights
  function renderInsightsTab() {
    const el = document.getElementById('panel-insights');
    if (!state.trades.length) { el.innerHTML = emptyState('Carica il tuo journal per generare l\'analisi completa.'); return; }
    const trades = state.trades;
    const recs = I.buildRecommendations(trades);
    const pc = I.buildProsCons(trades);
    const watch = I.watchlist(trades);
    const general = I.generalInterpretation(trades);
    const confl = M.confluenceStats(trades);
    const mistakes = M.mistakeStats(trades);
    const marketCond = M.byMarketCondition(trades);
    const mentalStates = M.byMentalState(trades);
    const pattern = M.journalPatternReading(trades, 6);
    const postLoss = M.postLossPerformance(trades);
    const pips = M.pipsStats(trades);
    const hourly = I.hourlyNarrative(trades);
    const playbook = I.confluencePlaybook(trades);

    el.innerHTML = `
      <div class="card">
        <div class="card-title">🧭 Interpretazione generale</div>
        <p style="line-height:1.6;font-size:14px;">${esc(general)}</p>
      </div>

      <div class="card">
        <div class="card-title">🕐 Analisi oraria — dove operi e dove evitare</div>
        ${hourly ? `
          <ul class="simple-list">${hourly.narrative.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
          ${hourly.toAvoid.length ? `<p class="kpi-sub" style="margin-top:8px;">Fasce da evitare (win rate ≤ 40%): ${hourly.toAvoid.map((h) => `${h.label} (${h.winRate.toFixed(0)}%)`).join(', ')}.</p>` : ''}
          <div class="table-scroll" style="margin-top:12px;"><table>
            <thead><tr><th>Fascia oraria</th><th>Trade</th><th>Win rate</th></tr></thead>
            <tbody>${[...hourly.hours].sort((a, b) => a.key - b.key).map((h) => `<tr><td>${h.label}</td><td>${h.n}</td><td><span class="pill ${h.winRate >= 50 ? 'pill-green' : 'pill-red'}">${h.winRate.toFixed(0)}%</span></td></tr>`).join('')}</tbody>
          </table></div>
        ` : '<p class="kpi-sub">Nessun orario disponibile nel journal caricato.</p>'}
      </div>

      <div class="card">
        <div class="card-title">💡 Consigli personalizzati</div>
        ${recs.length ? recs.map(recCard).join('') : '<p class="kpi-sub">Non emergono ancora pattern statisticamente rilevanti: carica più trade per consigli mirati.</p>'}
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title" style="color:var(--green);">✅ Punti di forza</div>
          <ul class="simple-list">${pc.pros.map((p) => `<li class="bullet-pro">${esc(p)}</li>`).join('') || '<li>Nessun punto di forza rilevante ancora individuato.</li>'}</ul>
        </div>
        <div class="card">
          <div class="card-title" style="color:var(--red);">⚠️ Punti deboli</div>
          <ul class="simple-list">${pc.cons.map((c) => `<li class="bullet-con">${esc(c)}</li>`).join('') || '<li>Nessuna criticità grave individuata.</li>'}</ul>
        </div>
      </div>

      <div class="card">
        <div class="card-title">👁️ Cosa tenere d'occhio</div>
        <ul class="simple-list">${watch.map((w) => `<li class="bullet-watch">${esc(w)}</li>`).join('') || '<li>Niente da monitorare al momento.</li>'}</ul>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">🧩 Pattern di confluenza</div>
          <div class="chart-wrap"><canvas id="chart-confluence"></canvas></div>
          ${playbook.hasData ? `
            <h4 style="margin:14px 0 8px;font-size:13px;color:var(--green);">✅ Cerca sempre</h4>
            <ul class="simple-list">${playbook.searchFor.length ? playbook.searchFor.map((s) => `<li class="bullet-pro">${esc(s)}</li>`).join('') : '<li>Nessuna confluenza ancora abbastanza forte da consigliare sempre.</li>'}</ul>
            <h4 style="margin:14px 0 8px;font-size:13px;color:var(--red);">🚫 Evita sempre</h4>
            <ul class="simple-list">${playbook.avoid.length ? playbook.avoid.map((s) => `<li class="bullet-con">${esc(s)}</li>`).join('') : '<li>Nessuna confluenza ancora identificata come pericolosa.</li>'}</ul>
          ` : '<p class="kpi-sub" style="margin-top:10px;">Nessuna confluenza taggata nel journal: aggiungile ai singoli trade nel Registro per attivare questa analisi.</p>'}
        </div>
        <div class="card">
          <div class="card-title">🔁 Errori ricorrenti</div>
          ${mistakes.length ? `<ul class="simple-list">${mistakes.map((m) => `<li><span class="pill pill-red">${m.n}×</span> ${esc(m.tag)} · ${fmtPct(m.avgPnL)} medio, ${m.winRate.toFixed(0)}% win rate</li>`).join('')}</ul>` : '<p class="kpi-sub">Nessun errore taggato nel journal.</p>'}
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">🌤️ Condizioni di mercato</div>
          ${marketCond.length ? `<ul class="simple-list">${marketCond.map((c) => `<li><span class="pill ${c.winRate >= 50 ? 'pill-green' : 'pill-red'}">${c.winRate.toFixed(0)}%</span> ${esc(c.key)} · ${c.n} trade · ${fmtPct(c.pnl)}</li>`).join('')}</ul>` : '<p class="kpi-sub">Nessuna condizione di mercato taggata.</p>'}
        </div>
        <div class="card">
          <div class="card-title">🧠 Stati mentali</div>
          ${mentalStates.length ? `<ul class="simple-list">${mentalStates.map((c) => `<li><span class="pill ${c.winRate >= 50 ? 'pill-green' : 'pill-red'}">${c.winRate.toFixed(0)}%</span> ${esc(c.key)} · ${c.n} trade · ${fmtPct(c.pnl)}</li>`).join('')}</ul>` : '<p class="kpi-sub">Nessuno stato mentale taggato.</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card-title">📝 Lettura pattern dal journal</div>
        <div class="card-subtitle">Parole ricorrenti nelle note, distinte tra trade vincenti e perdenti</div>
        <div class="grid grid-2">
          <div><h4 style="margin:0 0 8px;font-size:13px;color:var(--red);">Ricorrenti nelle perdite</h4>
            ${pattern.wordsInLosses.length ? `<ul class="simple-list">${pattern.wordsInLosses.map((w) => `<li class="bullet-con">"${esc(w.word)}" · ${w.count}×</li>`).join('')}</ul>` : '<p class="kpi-sub">Note insufficienti.</p>'}
          </div>
          <div><h4 style="margin:0 0 8px;font-size:13px;color:var(--green);">Ricorrenti nelle vincite</h4>
            ${pattern.wordsInWins.length ? `<ul class="simple-list">${pattern.wordsInWins.map((w) => `<li class="bullet-pro">"${esc(w.word)}" · ${w.count}×</li>`).join('')}</ul>` : '<p class="kpi-sub">Note insufficienti.</p>'}
          </div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">🔄 Performance dopo una loss</div>
          <p style="font-size:14px;">Su <b>${postLoss.n}</b> trade eseguiti subito dopo una perdita, il win rate è <b class="${postLoss.delta < 0 ? 'kpi-value neg' : 'kpi-value pos'}" style="font-size:14px;">${postLoss.winRateAfterLoss.toFixed(1)}%</b> contro una media generale del ${postLoss.baselineWinRate.toFixed(1)}%.</p>
        </div>
        <div class="card">
          <div class="card-title">📏 Gestione delle pips</div>
          <p style="font-size:14px;">Totale: <b>${fmtNum(pips.totalPips, 1)}</b> pips su ${pips.n} trade con dato disponibile.<br>
          Media in vincita: <b class="kpi-value pos" style="font-size:14px;">${fmtNum(pips.avgPipsWin, 1)}</b> · Media in perdita: <b class="kpi-value neg" style="font-size:14px;">${fmtNum(pips.avgPipsLoss, 1)}</b></p>
          ${pips.bySymbolPips.length ? `<ul class="simple-list">${pips.bySymbolPips.map((s) => `<li>${esc(s.symbol)}: ${fmtNum(s.totalPips, 1)} pips (${s.n} trade)</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    `;

    if (confl.all.length) CH.confluenceBar('chart-confluence', confl.all);
  }

  function recCard(r) {
    const prColor = r.priority === 'alta' ? 'pill-red' : r.priority === 'media' ? 'pill-amber' : 'pill-blue';
    return `<div class="rec-card">
      <div class="rec-top">
        <div class="rec-title">${esc(r.title)}</div>
        <span class="pill ${prColor}">${r.priority.toUpperCase()} PRIORITÀ</span>
      </div>
      <div class="rec-desc">${esc(r.description)}</div>
      <div class="rec-line">→ <b>${esc(r.action)}</b></div>
      <div class="rec-line">✓ ${esc(r.check)}</div>
      <div class="rec-metric"><span class="dot"></span>${esc(r.metricLabel)}: <b>${esc(r.metricValue)}</b></div>
    </div>`;
  }

  // ---------------------------------------------------------------- trades
  function renderTradesTab() {
    const el = document.getElementById('panel-trades');
    const trades = M.sortByDateTime(state.trades).reverse();
    const filtered = state.tradeFilter
      ? trades.filter((t) => JSON.stringify(t).toLowerCase().includes(state.tradeFilter.toLowerCase()))
      : trades;

    el.innerHTML = `
      <div class="card">
        <div class="card-header-row">
          <div class="card-title" style="margin-bottom:0;">📒 Registro trade (${filtered.length})</div>
          <input type="text" id="trade-filter" placeholder="Cerca simbolo, tag, nota…" style="max-width:240px;" value="${esc(state.tradeFilter)}">
        </div>
        ${trades.length ? `<div class="table-scroll"><table>
          <thead><tr><th>Data</th><th>Ora</th><th>Simbolo</th><th>Dir.</th><th>Esito</th><th>Risultato</th><th>R:R</th><th>Confluenze</th><th>Note</th><th></th></tr></thead>
          <tbody>${filtered.map(tradeRow).join('')}</tbody>
        </table></div>` : emptyState('Nessun trade caricato ancora.')}
      </div>
    `;
    const filterInput = document.getElementById('trade-filter');
    if (filterInput) filterInput.oninput = (e) => { state.tradeFilter = e.target.value; renderTradesTab(); };
    document.querySelectorAll('[data-edit-id]').forEach((b) => b.onclick = () => openTradeEditor(b.dataset.editId));
    document.querySelectorAll('[data-del-id]').forEach((b) => b.onclick = () => {
      if (confirm('Eliminare questo trade dal journal?')) { state.trades = DB.deleteTrade(b.dataset.delId); refreshAll(); }
    });
    document.querySelectorAll('[data-img-url]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openImageModal(a.dataset.imgUrl); });
  }

  function tradeRow(t) {
    const outcomeCls = M.isWin(t) ? 'pill-green' : M.isLoss(t) ? 'pill-red' : 'pill-amber';
    const outcomeLabel = M.isWin(t) ? 'Win' : M.isLoss(t) ? 'Loss' : 'BE';
    return `<tr>
      <td>${t.date || ''}</td><td>${t.time || ''}</td><td>${esc(t.symbol || '')}</td>
      <td>${t.direction ? esc(t.direction) : ''}</td>
      <td><span class="pill ${outcomeCls}">${outcomeLabel}</span></td>
      <td>${fmtPct(M.pnlOf(t))}</td>
      <td>${t.rrRealized ?? t.rrPlanned ?? '—'}</td>
      <td>${(t.confluences || []).map((c) => `<span class="pill pill-muted">${esc(c)}</span>`).join(' ')}</td>
      <td style="max-width:220px;white-space:normal;">${esc(t.notes || '')} ${t.imageUrlPre ? `<a href="#" data-img-url="${esc(t.imageUrlPre)}" title="Screenshot pre-trade">🖼️PRE</a>` : ''} ${t.imageUrlPost ? `<a href="#" data-img-url="${esc(t.imageUrlPost)}" title="Screenshot post-trade">🖼️POST</a>` : ''} ${!t.imageUrlPre && !t.imageUrlPost && t.imageUrl ? `<a href="#" data-img-url="${esc(t.imageUrl)}">🖼️</a>` : ''}</td>
      <td><button class="btn btn-sm" data-edit-id="${t.id}">✎</button> <button class="btn btn-sm btn-danger" data-del-id="${t.id}">🗑</button></td>
    </tr>`;
  }

  function openImageModal(url) {
    document.getElementById('modal-title').textContent = 'Screenshot del trade';
    document.getElementById('modal-body').innerHTML = `<img src="${esc(url)}" style="width:100%;border-radius:10px;" alt="Screenshot trade">
      <p class="kpi-sub" style="margin-top:10px;">L'immagine viene solo mostrata: annota manualmente sotto (scheda trade) cosa mostra l'esecuzione (setup, confluenze, errori) per includerlo nelle statistiche.</p>`;
    openModal();
  }

  function openTradeEditor(id) {
    const t = state.trades.find((x) => x.id === id);
    if (!t) return;
    document.getElementById('modal-title').textContent = `Annotazioni trade — ${t.symbol || ''} ${t.date || ''}`;
    document.getElementById('modal-body').innerHTML = `
      <label>Setup / tipo</label><input type="text" id="f-setup" value="${esc(t.setupType || '')}">
      <label style="margin-top:10px;">Confluenze (separate da virgola)</label><input type="text" id="f-confl" value="${esc((t.confluences || []).join(', '))}">
      <label style="margin-top:10px;">Errori (separati da virgola)</label><input type="text" id="f-mist" value="${esc((t.mistakes || []).join(', '))}">
      <label style="margin-top:10px;">Condizione di mercato</label><input type="text" id="f-market" value="${esc(t.marketCondition || '')}">
      <label style="margin-top:10px;">Stato mentale</label><input type="text" id="f-mental" value="${esc(t.mentalState || '')}">
      <label style="margin-top:10px;">Qualità esecuzione (1-5)</label><input type="number" id="f-exec" min="1" max="5" value="${t.executionQuality ?? ''}">
      <label style="margin-top:10px;">Link screenshot PRE-trade</label><input type="text" id="f-img-pre" value="${esc(t.imageUrlPre || '')}">
      <label style="margin-top:10px;">Link screenshot POST-trade</label><input type="text" id="f-img-post" value="${esc(t.imageUrlPost || '')}">
      <label style="margin-top:10px;">Note</label><textarea id="f-notes" rows="3">${esc(t.notes || '')}</textarea>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn" id="btn-cancel-edit">Annulla</button>
        <button class="btn btn-primary" id="btn-save-edit">Salva annotazioni</button>
      </div>
    `;
    document.getElementById('btn-cancel-edit').onclick = closeModal;
    document.getElementById('btn-save-edit').onclick = () => {
      const patch = {
        setupType: document.getElementById('f-setup').value.trim() || undefined,
        confluences: document.getElementById('f-confl').value.split(',').map((s) => s.trim()).filter(Boolean),
        mistakes: document.getElementById('f-mist').value.split(',').map((s) => s.trim()).filter(Boolean),
        marketCondition: document.getElementById('f-market').value.trim() || undefined,
        mentalState: document.getElementById('f-mental').value.trim() || undefined,
        executionQuality: P.toNumber(document.getElementById('f-exec').value),
        imageUrlPre: document.getElementById('f-img-pre').value.trim() || undefined,
        imageUrlPost: document.getElementById('f-img-post').value.trim() || undefined,
        notes: document.getElementById('f-notes').value.trim() || undefined
      };
      state.trades = DB.updateTrade(t.id, patch);
      closeModal();
      refreshAll();
      toast('Annotazioni salvate.');
    };
    openModal();
  }

  // ---------------------------------------------------------------- modal
  function openModal() { document.getElementById('modal-backdrop').classList.add('open'); }
  function closeModal() { document.getElementById('modal-backdrop').classList.remove('open'); }
  document.getElementById('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.getElementById('modal-close').addEventListener('click', closeModal);

  // ---------------------------------------------------------------- upload
  function initUpload() {
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files.length) handleFile(input.files[0]); input.value = ''; });

    document.getElementById('btn-download-template').addEventListener('click', downloadTemplate);
    document.getElementById('btn-export-json').addEventListener('click', () => {
      downloadTextFile('trading-journal-backup.json', DB.exportJson());
    });
    document.getElementById('btn-clear-data').addEventListener('click', () => {
      if (confirm('Eliminare TUTTI i trade salvati in questo browser? L\'azione non è reversibile.')) {
        DB.clearAll(); state.trades = []; refreshAll(); toast('Dati cancellati.');
      }
    });
    document.getElementById('btn-review-mapping').addEventListener('click', () => {
      if (state.pendingImport) openMappingModal();
    });
    document.getElementById('btn-import-gsheet').addEventListener('click', handleGoogleSheetImport);
    document.getElementById('gsheet-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleGoogleSheetImport();
    });
  }

  function googleSheetCsvUrl(rawUrl) {
    const url = rawUrl.trim();
    // Already-published sheet ("Pubblica sul web"): force the CSV variant.
    const pubMatch = /\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/.exec(url);
    if (pubMatch) return `https://docs.google.com/spreadsheets/d/e/${pubMatch[1]}/pub?output=csv`;
    // Regular share link: .../spreadsheets/d/<ID>/edit?gid=<GID>#gid=<GID>
    const idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
    if (!idMatch) return null;
    const gidMatch = /[#&?]gid=(\d+)/.exec(url);
    const gid = gidMatch ? gidMatch[1] : '0';
    return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
  }

  async function handleGoogleSheetImport() {
    const input = document.getElementById('gsheet-url');
    const raw = input.value.trim();
    if (!raw) { toast('Incolla prima il link del foglio Google.'); return; }
    const csvUrl = googleSheetCsvUrl(raw);
    if (!csvUrl) { toast('Link Google Sheets non riconosciuto: verifica di aver copiato l\'URL completo.'); return; }
    toast('Recupero il foglio da Google…');
    try {
      const res = await fetch(csvUrl, { credentials: 'omit' });
      const text = await res.text();
      if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) {
        toast('Google ha rifiutato la lettura: il foglio deve essere condiviso come "Chiunque abbia il link" (Visualizzatore), oppure pubblicato sul web.');
        return;
      }
      const { headers, rows } = P.parseDelimited(text);
      handleParsed(headers, rows);
    } catch (err) {
      toast('Impossibile raggiungere Google Sheets da qui (blocco di rete o CORS). Come alternativa: File → Scarica → CSV/Excel, poi carica il file qui sopra.');
    }
  }

  async function handleFile(file) {
    try {
      const { headers, rows } = await P.readFile(file);
      handleParsed(headers, rows);
    } catch (err) {
      toast(`Errore lettura file: ${err.message}`);
    }
  }

  function handleParsed(headers, rows) {
    if (!rows.length) { toast('Il file non contiene righe leggibili.'); return; }
    const sig = DB.headerSignature(headers);
    const savedMapping = DB.getMappingTemplate(sig);
    const mapping = savedMapping || P.guessMapping(headers);
    state.pendingImport = { headers, rows, mapping, sig };
    document.getElementById('btn-review-mapping').style.display = 'inline-flex';
    // Zero-click import: if the only required field (Data) was recognized
    // automatically, skip the confirmation dialog entirely and analyze
    // right away. The mapping modal only steps in when something essential
    // couldn't be guessed, or when reopened manually to fix a field.
    if (mapping.date) {
      runImport(mapping);
    } else {
      openMappingModal();
    }
  }

  function openMappingModal() {
    const { headers, mapping } = state.pendingImport;
    document.getElementById('modal-title').textContent = 'Associa le colonne del tuo file';
    const options = ['<option value="">— nessuna —</option>', ...headers.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`)].join('');
    document.getElementById('modal-body').innerHTML = `
      <p class="kpi-sub" style="margin-bottom:12px;">Indica quale colonna del tuo file corrisponde a ciascun campo. Solo "Data" è obbligatoria; gli altri campi arricchiscono l'analisi ma sono facoltativi.</p>
      <div id="mapping-rows">
        ${P.FIELD_DEFS.map((def) => `
          <div class="mapping-row">
            <span>${esc(def.label)}${def.required ? ' *' : ''}</span>
            <select data-field="${def.key}">${options}</select>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn" id="btn-cancel-import">Annulla</button>
        <button class="btn btn-primary" id="btn-confirm-import">Importa trade</button>
      </div>
    `;
    P.FIELD_DEFS.forEach((def) => {
      const sel = document.querySelector(`select[data-field="${def.key}"]`);
      if (sel && mapping[def.key]) sel.value = mapping[def.key];
    });
    document.getElementById('btn-cancel-import').onclick = () => { state.pendingImport = null; closeModal(); };
    document.getElementById('btn-confirm-import').onclick = () => {
      const mapping = {};
      document.querySelectorAll('#mapping-rows select[data-field]').forEach((sel) => {
        mapping[sel.dataset.field] = sel.value || null;
      });
      runImport(mapping, { closeAfter: true });
    };
    openModal();
  }

  function runImport(mapping, opts) {
    const pending = state.pendingImport;
    if (!pending) return;
    if (!mapping.date) { toast('Devi indicare almeno la colonna Data.'); if (!opts || !opts.closeAfter) openMappingModal(); return; }
    const normalized = P.normalizeRows(pending.rows, mapping);
    if (!normalized.length) {
      const sample = pending.rows.slice(0, 3).map((r) => r[mapping.date]).filter((v) => v !== '' && v !== undefined);
      const hint = sample.length ? ` Esempio di valore letto nella colonna Data: "${sample[0]}".` : ' La colonna Data risulta vuota nelle prime righe.';
      toast(`Nessuna riga valida trovata: il formato della data non è stato riconosciuto.${hint}`);
      return;
    }
    DB.saveMappingTemplate(pending.sig, mapping);
    state.trades = DB.addTrades(normalized);
    const latest = latestTradeDate(state.trades);
    if (latest) { const d = new Date(latest + 'T00:00:00'); state.calYear = d.getFullYear(); state.calMonth = d.getMonth(); }
    if (opts && opts.closeAfter) closeModal();
    refreshAll();
    const blank = normalized.every((t) => t.resultPercent === undefined && t.resultPips === undefined && !t.outcome);
    if (blank) {
      toast(`Importati ${normalized.length} trade, ma il risultato di ogni trade risulta vuoto: apri "Rivedi associazione colonne" e controlla il campo Esito/Risultato %.`);
    } else {
      toast(`Importati ${normalized.length} trade — analisi pronta.`);
    }
    switchTab('dashboard');
  }

  function downloadTemplate() {
    const headers = ['Data', 'Ora', 'Simbolo', 'Direzione', 'Esito', 'Risultato %', 'Pips', 'RR Pianificato', 'RR Realizzato', 'MAE %', 'MFE %', 'Sessione', 'Condizione di mercato', 'Stato mentale', 'Confluenze', 'Errori', 'Tipo setup', 'Qualità esecuzione', 'Note', 'Note post operazione', 'Link screenshot PRE-trade', 'Link screenshot POST-trade'];
    const example = ['06/08/2026', '18:00', 'XAUUSD', 'Long', 'Win', '3,7', '37', '3', '3.7', '-0,3', '4,0', 'Sera', 'Trend', 'Disciplinato', 'Order block, Liquidity sweep', '', 'Continuazione', '4', 'Ottima entrata dopo retest del livello', 'Gestione impeccabile, uscita a target pieno', 'https://...pre.png', 'https://...post.png'];
    const csv = `${headers.join(';')}\n${example.join(';')}\n`;
    downloadTextFile('template-trading-journal.csv', csv);
  }

  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------- misc
  function refreshAll() {
    const active = document.querySelector('.tab-panel.active');
    const tab = active ? active.dataset.tab : 'dashboard';
    switchTab(tab);
  }

  // -------------------------------------------------------------- PWA
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('btn-install').style.display = 'inline-flex';
  });
  document.getElementById('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('btn-install').style.display = 'none';
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    // A new service worker taking over mid-session means this page's own
    // code is already stale (the app is served network-first, but the
    // currently running tab was still loaded under the previous worker).
    // Reload once so the tab is never left running an outdated version.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }

  // ---------------------------------------------------------------- init
  window.TJSwitchTab = switchTab;
  initUpload();
  const lastTab = localStorage.getItem('tj_last_tab') || 'dashboard';
  switchTab(lastTab);
})();
