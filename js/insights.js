/* Trade Journal Analytics — insights.js
   Rule-based, deterministic insight/recommendation engine built purely on
   top of TJMetrics output. No AI/LLM call — everything here is computed
   from the numbers in the uploaded journal.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./metrics.js'));
  } else {
    root.TJInsights = factory(root.TJMetrics);
  }
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const MIN_N_HOUR = 3;
  const MIN_N_TAG = 2;
  const MIN_N_DAY = 3;

  function pct(n) { return `${n.toFixed(1)}%`; }
  function signed(n, suffix) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}${suffix || '%'}`; }

  function buildRecommendations(trades) {
    const cards = [];
    const k = M.kpis(trades);
    const hours = M.byHour(trades).filter((h) => h.n >= MIN_N_HOUR);
    const weekdays = M.byWeekday(trades).filter((d) => d.n >= MIN_N_DAY);
    const dailyCount = M.performanceByDailyTradeCount(trades);
    const confl = M.confluenceStats(trades);
    const postLoss = M.postLossPerformance(trades);
    const marketCond = M.byMarketCondition(trades).filter((c) => c.n >= MIN_N_TAG);
    const mentalStates = M.byMentalState(trades).filter((c) => c.n >= MIN_N_TAG);

    // 1) Worst trading hour window
    if (hours.length) {
      const worst = [...hours].sort((a, b) => a.winRate - b.winRate)[0];
      if (worst.winRate <= 45) {
        cards.push({
          title: `Evita di operare nella fascia ${worst.label}`,
          description: `Le loss si concentrano attorno a questo orario: win rate ${pct(worst.winRate)} su ${worst.n} trade.`,
          action: `Non aprire nuovi trade nella fascia ${worst.label}-${String((worst.key + 1) % 24).padStart(2, '0')}:00.`,
          check: `Verifica sui prossimi ${Math.max(20, worst.n * 3)} trade che nessuno sia aperto in quella fascia.`,
          metricLabel: 'Fascia oraria peggiore',
          metricValue: `${worst.label} · ${pct(worst.winRate)}`,
          priority: worst.winRate <= 30 ? 'alta' : 'media'
        });
      }
    }

    // 2) R:R dispersion / Sharpe-like consistency
    if (k.rrStdDev !== null && k.avgRR !== null && k.avgRR !== 0) {
      const cv = Math.abs(k.rrStdDev / k.avgRR);
      if (cv > 0.8) {
        cards.push({
          title: 'Standardizza i target su livelli fissi',
          description: `Il rapporto rischio/rendimento varia molto da trade a trade (media ${k.avgRR.toFixed(2)}R, deviazione ${k.rrStdDev.toFixed(2)}R): questo abbassa la coerenza dei risultati.`,
          action: 'Definisci a priori il livello di take profit (es. prima liquidità scoperta) e non modificarlo a trade aperto.',
          check: 'Dopo 20 trade, verifica se la deviazione standard del R:R si riduce.',
          metricLabel: 'Indice di consistenza (Sharpe-like)',
          metricValue: k.sharpeLike !== null ? k.sharpeLike.toFixed(2) : 'n/d',
          priority: 'media'
        });
      }
    }

    // 3) Trades per day quality degradation
    if (dailyCount.byOrdinal.length >= 3) {
      const early = dailyCount.byOrdinal.filter((o) => o.tradeNumberInDay <= 2 && o.n >= MIN_N_TAG);
      const late = dailyCount.byOrdinal.filter((o) => o.tradeNumberInDay >= 4 && o.n >= MIN_N_TAG);
      if (early.length && late.length) {
        const earlyWR = early.reduce((a, o) => a + o.winRate * o.n, 0) / early.reduce((a, o) => a + o.n, 0);
        const lateWR = late.reduce((a, o) => a + o.winRate * o.n, 0) / late.reduce((a, o) => a + o.n, 0);
        if (earlyWR - lateWR > 15) {
          cards.push({
            title: 'Limita a tre i trade giornalieri massimi',
            description: `Nelle giornate con quattro o più trade la qualità decisionale peggiora: win rate ${pct(lateWR)} contro ${pct(earlyWR)} nei primi due trade del giorno.`,
            action: 'Dopo il terzo trade della giornata, chiudi il terminale indipendentemente dal risultato e riprendi il giorno successivo.',
            check: 'Monitora per due settimane che nessuna giornata superi tre trade aperti.',
            metricLabel: 'Trade al giorno (media)',
            metricValue: dailyCount.avgTradesPerDay.toFixed(1),
            priority: 'alta'
          });
        }
      }
    }

    // 4) Dangerous confluences
    if (confl.dangerous.length) {
      const worst = confl.dangerous[0];
      cards.push({
        title: `Evita di operare con la confluenza "${worst.tag}"`,
        description: `Su ${worst.n} trade con questa confluenza il win rate è ${pct(worst.winRate)}, ben sotto la tua media.`,
        action: `Se noti "${worst.tag}" come confluenza, tratta il setup come contro-confluenza e aspetta ulteriore conferma prima di entrare.`,
        check: `Sui prossimi trade con questa condizione, verifica che nessuno sia una loss diretta.`,
        metricLabel: 'Confluenza pericolosa',
        metricValue: `${worst.tag} · ${pct(worst.winRate)}`,
        priority: 'alta'
      });
    }

    // 5) Post-loss performance drop
    if (postLoss.n >= MIN_N_TAG && postLoss.delta < -10) {
      cards.push({
        title: 'Fai una pausa dopo una perdita',
        description: `Dopo una loss il tuo win rate scende a ${pct(postLoss.winRateAfterLoss)}, contro una media generale del ${pct(postLoss.baselineWinRate)} — probabile revenge trading.`,
        action: 'Dopo ogni stop loss, imposta un timer di almeno 15-20 minuti prima di poter aprire un nuovo trade.',
        check: 'Controlla sui prossimi 10 stop loss quanto tempo intercorre prima del trade successivo.',
        metricLabel: 'Win rate post-loss',
        metricValue: pct(postLoss.winRateAfterLoss),
        priority: postLoss.delta < -20 ? 'alta' : 'media'
      });
    }

    // 6) Market condition underperformance (e.g. news)
    if (marketCond.length) {
      const worstCond = [...marketCond].sort((a, b) => a.winRate - b.winRate)[0];
      if (worstCond.winRate <= 40) {
        cards.push({
          title: `Gestisci con più cautela le condizioni "${worstCond.key}"`,
          description: `In queste condizioni di mercato il win rate è ${pct(worstCond.winRate)} su ${worstCond.n} trade, il tuo punto più debole.`,
          action: `Se annoti "${worstCond.key}" come condizione, attendi una conferma aggiuntiva (retest o chiusura candela) prima di entrare.`,
          check: `Sui prossimi trade in questa condizione, verifica che nessuno sia aperto senza conferma extra.`,
          metricLabel: 'Condizione di mercato peggiore',
          metricValue: `${worstCond.key} · ${pct(worstCond.winRate)}`,
          priority: 'media'
        });
      }
    }

    // 7) Mental state correlation
    if (mentalStates.length) {
      const worstState = [...mentalStates].sort((a, b) => a.winRate - b.winRate)[0];
      if (worstState.winRate <= 40) {
        cards.push({
          title: `Non operare quando ti senti "${worstState.key}"`,
          description: `I trade annotati con questo stato mentale hanno un win rate del ${pct(worstState.winRate)} su ${worstState.n} trade.`,
          action: `Se prima di entrare riconosci questo stato, chiudi il terminale ed esci dal grafico per almeno 30 minuti.`,
          check: 'Traccia per due settimane quante volte riconosci lo stato prima di operare, invece che dopo.',
          metricLabel: 'Stato mentale più rischioso',
          metricValue: `${worstState.key} · ${pct(worstState.winRate)}`,
          priority: 'alta'
        });
      }
    }

    return cards.sort((a, b) => {
      const order = { alta: 0, media: 1, bassa: 2 };
      return order[a.priority] - order[b.priority];
    });
  }

  function buildProsCons(trades) {
    const k = M.kpis(trades);
    const hours = M.byHour(trades).filter((h) => h.n >= MIN_N_HOUR);
    const weekdays = M.byWeekday(trades).filter((d) => d.n >= MIN_N_DAY);
    const dirs = M.byDirection(trades).filter((d) => d.n >= MIN_N_TAG);
    const confl = M.confluenceStats(trades);
    const symbols = M.bySymbol(trades).filter((s) => s.n >= MIN_N_TAG);

    const pros = [];
    const cons = [];

    if (k.profitFactor >= 1.5) pros.push(`Profit factor solido: ${k.profitFactor.toFixed(2)} — le vincite pesano più delle perdite.`);
    else if (k.profitFactor > 0 && k.profitFactor < 1) cons.push(`Profit factor sotto 1 (${k.profitFactor.toFixed(2)}): le perdite superano le vincite in valore.`);

    if (k.winRate >= 55) pros.push(`Win rate elevato: ${pct(k.winRate)} su ${k.totalTrades} trade.`);
    else if (k.winRate <= 40) cons.push(`Win rate basso: ${pct(k.winRate)} su ${k.totalTrades} trade.`);

    if (k.avgRR !== null && k.avgRR >= 2) pros.push(`Ottimo R:R medio realizzato: ${k.avgRR.toFixed(2)}R.`);
    if (k.avgRR !== null && k.avgRR < 1 && k.avgRR >= 0) cons.push(`R:R medio realizzato basso: ${k.avgRR.toFixed(2)}R, sotto la soglia di sostenibilità con questo win rate.`);

    if (weekdays.length) {
      const best = [...weekdays].sort((a, b) => b.winRate - a.winRate)[0];
      const worst = [...weekdays].sort((a, b) => a.winRate - b.winRate)[0];
      if (best.winRate >= 60) pros.push(`Giorno migliore: ${best.labelFull} (${pct(best.winRate)} win rate, ${signed(best.pnl)}).`);
      if (worst.winRate <= 40) cons.push(`Giorno peggiore: ${worst.labelFull} (${pct(worst.winRate)} win rate, ${signed(worst.pnl)}).`);
    }

    if (hours.length) {
      const best = [...hours].sort((a, b) => b.winRate - a.winRate)[0];
      pros.push(`Fascia oraria migliore: ${best.label} (${pct(best.winRate)} win rate).`);
    }

    if (dirs.length === 2) {
      const [d1, d2] = dirs;
      const better = d1.winRate >= d2.winRate ? d1 : d2;
      const worse = better === d1 ? d2 : d1;
      if (Math.abs(better.winRate - worse.winRate) >= 15) {
        pros.push(`Performi meglio ${better.key === 'long' ? 'in acquisto (long)' : 'in vendita (short)'}: ${pct(better.winRate)} vs ${pct(worse.winRate)}.`);
        cons.push(`Direzione più debole: ${worse.key === 'long' ? 'long' : 'short'} (${pct(worse.winRate)} win rate).`);
      }
    }

    if (symbols.length) {
      const best = [...symbols].sort((a, b) => b.avgPnL - a.avgPnL)[0];
      const worst = [...symbols].sort((a, b) => a.avgPnL - b.avgPnL)[0];
      if (best.avgPnL > 0) pros.push(`Strumento più redditizio: ${best.key} (${signed(best.avgPnL)} medio a trade).`);
      if (worst.avgPnL < 0 && worst.key !== best.key) cons.push(`Strumento più problematico: ${worst.key} (${signed(worst.avgPnL)} medio a trade).`);
    }

    if (confl.strong.length) pros.push(`Confluenza più forte: "${confl.strong[0].tag}" (${pct(confl.strong[0].winRate)} win rate su ${confl.strong[0].n} trade).`);
    if (confl.dangerous.length) cons.push(`Confluenza più pericolosa: "${confl.dangerous[0].tag}" (${pct(confl.dangerous[0].winRate)} win rate su ${confl.dangerous[0].n} trade).`);

    if (k.maxDrawdown <= -10) cons.push(`Drawdown massimo importante: ${k.maxDrawdown.toFixed(2)}% dal picco dell'equity.`);
    if (k.bestWinStreak >= 4) pros.push(`Serie positiva più lunga: ${k.bestWinStreak} vincite consecutive.`);
    if (k.worstLossStreak >= 4) cons.push(`Serie negativa più lunga: ${k.worstLossStreak} perdite consecutive.`);

    return { pros, cons };
  }

  function watchlist(trades) {
    const k = M.kpis(trades);
    const items = [];
    if (k.sharpeLike !== null && k.sharpeLike > 0 && k.sharpeLike < 1) {
      items.push(`Sharpe ratio appena sotto la soglia buona (${k.sharpeLike.toFixed(2)}): la dispersione dei risultati tra trade merita attenzione.`);
    }
    const marketCond = M.byMarketCondition(trades).filter((c) => c.n >= MIN_N_TAG && c.n < MIN_N_TAG * 2);
    if (marketCond.length) items.push(`Condizioni di mercato con pochi dati (${marketCond.map((c) => c.key).join(', ')}): raccogli più trade prima di trarre conclusioni.`);
    const confl = M.confluenceStats(trades);
    const borderline = confl.all.filter((c) => c.n >= MIN_N_TAG && c.winRate > 40 && c.winRate < 55);
    if (borderline.length) items.push(`Confluenze border-line da monitorare: ${borderline.map((c) => `"${c.tag}" (${pct(c.winRate)})`).join(', ')}.`);
    const dailyCount = M.performanceByDailyTradeCount(trades);
    if (dailyCount.avgTradesPerDay >= 3) items.push(`Media di ${dailyCount.avgTradesPerDay.toFixed(1)} trade al giorno: livello a cui la qualità decisionale può iniziare a calare.`);
    return items;
  }

  function generalInterpretation(trades) {
    const k = M.kpis(trades);
    if (!k.totalTrades) return 'Carica un file journal per generare l\'interpretazione generale delle tue performance.';
    const parts = [];
    parts.push(`Su ${k.totalTrades} trade analizzati hai un win rate del ${pct(k.winRate)} con un profit factor di ${Number.isFinite(k.profitFactor) ? k.profitFactor.toFixed(2) : '∞'} e un'aspettativa media di ${signed(k.expectancy)} per trade.`);
    if (k.avgRR !== null) parts.push(`Il rapporto rischio/rendimento medio realizzato è ${k.avgRR.toFixed(2)}R.`);
    const recs = buildRecommendations(trades);
    const alta = recs.filter((r) => r.priority === 'alta');
    if (alta.length) {
      parts.push(`Le aree più critiche da correggere ora sono: ${alta.map((r) => r.title.toLowerCase()).join('; ')}.`);
    } else {
      parts.push('Non emergono criticità gravi dai dati raccolti finora: continua a monitorare la coerenza del processo.');
    }
    const pc = buildProsCons(trades);
    if (pc.pros.length) parts.push(`Il punto di forza principale: ${pc.pros[0].toLowerCase()}`);
    return parts.join(' ');
  }

  return { buildRecommendations, buildProsCons, watchlist, generalInterpretation };
});
