/* Trade Journal Analytics — metrics.js
   Pure calculation functions over an array of normalized trade objects.
   Trade shape (all fields optional except date):
   {
     id, date:'YYYY-MM-DD', time:'HH:MM', symbol, direction:'long'|'short',
     outcome:'win'|'loss'|'be', resultPercent:Number, resultPips:Number,
     rrPlanned:Number, rrRealized:Number,
     maePercent:Number, maePips:Number, mfePercent:Number, mfePips:Number,
     session, marketCondition, mentalState,
     confluences:[String], mistakes:[String], setupType,
     notes:String, imageUrl:String, executionQuality:Number(1-5)
   }
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TJMetrics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEKDAYS_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const WEEKDAYS_SHORT_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  function num(v, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
  }

  function sortByDateTime(trades) {
    return [...trades].sort((a, b) => {
      const ka = `${a.date || ''}T${a.time || '00:00'}`;
      const kb = `${b.date || ''}T${b.time || '00:00'}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  function pnlOf(t) {
    // Prefer percent result; fall back to pips converted 1:1 for ranking only.
    if (typeof t.resultPercent === 'number' && Number.isFinite(t.resultPercent)) return t.resultPercent;
    if (typeof t.resultPips === 'number' && Number.isFinite(t.resultPips)) return t.resultPips;
    return 0;
  }

  function isWin(t) {
    if (t.outcome) return t.outcome === 'win';
    return pnlOf(t) > 0;
  }
  function isLoss(t) {
    if (t.outcome) return t.outcome === 'loss';
    return pnlOf(t) < 0;
  }
  function isBE(t) {
    if (t.outcome) return t.outcome === 'be';
    return pnlOf(t) === 0;
  }

  function weekdayOf(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    return d.getDay(); // 0=Sunday
  }

  function hourOf(timeStr) {
    if (!timeStr) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(timeStr.trim());
    if (!m) return null;
    return Math.min(23, parseInt(m[1], 10));
  }

  // ---- Equity curve -------------------------------------------------
  function equityCurve(trades) {
    const sorted = sortByDateTime(trades);
    let cum = 0;
    const points = [];
    for (const t of sorted) {
      cum += pnlOf(t);
      points.push({ date: t.date, time: t.time, cum, trade: t });
    }
    return points;
  }

  function maxDrawdown(points) {
    let peak = -Infinity, maxDD = 0;
    for (const p of points) {
      peak = Math.max(peak, p.cum);
      maxDD = Math.min(maxDD, p.cum - peak);
    }
    return maxDD; // negative number (percent points)
  }

  function streaks(trades) {
    const sorted = sortByDateTime(trades);
    let curWin = 0, curLoss = 0, bestWin = 0, worstLoss = 0;
    for (const t of sorted) {
      if (isWin(t)) { curWin++; curLoss = 0; bestWin = Math.max(bestWin, curWin); }
      else if (isLoss(t)) { curLoss++; curWin = 0; worstLoss = Math.max(worstLoss, curLoss); }
      else { curWin = 0; curLoss = 0; }
    }
    return { bestWinStreak: bestWin, worstLossStreak: worstLoss };
  }

  function stddev(arr) {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
    return Math.sqrt(variance);
  }

  // ---- Core KPIs ------------------------------------------------------
  function kpis(trades) {
    const n = trades.length;
    const wins = trades.filter(isWin);
    const losses = trades.filter(isLoss);
    const bes = trades.filter(isBE);
    const winRate = n ? (wins.length / n) * 100 : 0;
    const totalPnL = trades.reduce((a, t) => a + pnlOf(t), 0);
    const avgWin = wins.length ? wins.reduce((a, t) => a + pnlOf(t), 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, t) => a + pnlOf(t), 0) / losses.length : 0;
    const grossWin = wins.reduce((a, t) => a + Math.max(pnlOf(t), 0), 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + Math.min(pnlOf(t), 0), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const expectancy = n ? totalPnL / n : 0;
    const rrValues = trades.map((t) => num(t.rrRealized, num(t.rrPlanned, NaN))).filter(Number.isFinite);
    const avgRR = rrValues.length ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : null;
    const rrStdDev = rrValues.length > 1 ? stddev(rrValues) : null;
    const pnlReturns = trades.map(pnlOf);
    const sharpeLike = pnlReturns.length > 1 && stddev(pnlReturns) > 0
      ? (pnlReturns.reduce((a, b) => a + b, 0) / pnlReturns.length) / stddev(pnlReturns)
      : null;
    const maeVals = trades.map((t) => num(t.maePercent, num(t.maePips, NaN))).filter(Number.isFinite);
    const mfeVals = trades.map((t) => num(t.mfePercent, num(t.mfePips, NaN))).filter(Number.isFinite);
    const avgMAE = maeVals.length ? maeVals.reduce((a, b) => a + b, 0) / maeVals.length : null;
    const avgMFE = mfeVals.length ? mfeVals.reduce((a, b) => a + b, 0) / mfeVals.length : null;
    const pointsCurve = equityCurve(trades);
    const dd = pointsCurve.length ? maxDrawdown(pointsCurve) : 0;
    const st = streaks(trades);
    const totalPips = trades.reduce((a, t) => a + num(t.resultPips, 0), 0);

    return {
      totalTrades: n,
      wins: wins.length,
      losses: losses.length,
      breakevens: bes.length,
      winRate,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      avgRR,
      rrStdDev,
      sharpeLike,
      avgMAE,
      avgMFE,
      maxDrawdown: dd,
      bestWinStreak: st.bestWinStreak,
      worstLossStreak: st.worstLossStreak,
      totalPips
    };
  }

  // ---- Breakdown helpers ----------------------------------------------
  function groupStats(trades, keyFn) {
    const map = new Map();
    for (const t of trades) {
      const key = keyFn(t);
      if (key === null || key === undefined || key === '') continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    const out = [];
    for (const [key, list] of map.entries()) {
      const wins = list.filter(isWin).length;
      const losses = list.filter(isLoss).length;
      const pnl = list.reduce((a, t) => a + pnlOf(t), 0);
      out.push({
        key,
        n: list.length,
        wins,
        losses,
        winRate: (wins / list.length) * 100,
        pnl,
        avgPnL: pnl / list.length
      });
    }
    return out;
  }

  function byWeekday(trades) {
    const rows = groupStats(trades, (t) => {
      const wd = weekdayOf(t.date);
      return wd === null ? null : wd;
    });
    // fill all 7 days, ordered Mon..Sun for display (trading calendars usually start Monday)
    const order = [1, 2, 3, 4, 5, 6, 0];
    return order.map((wd) => {
      const found = rows.find((r) => r.key === wd);
      return found
        ? { ...found, label: WEEKDAYS_SHORT_IT[wd], labelFull: WEEKDAYS_IT[wd] }
        : { key: wd, n: 0, wins: 0, losses: 0, winRate: 0, pnl: 0, avgPnL: 0, label: WEEKDAYS_SHORT_IT[wd], labelFull: WEEKDAYS_IT[wd] };
    });
  }

  function byHour(trades) {
    const rows = groupStats(trades, (t) => hourOf(t.time));
    rows.sort((a, b) => a.key - b.key);
    return rows.map((r) => ({ ...r, label: `${String(r.key).padStart(2, '0')}:00` }));
  }

  function byDirection(trades) {
    return groupStats(trades, (t) => (t.direction ? String(t.direction).toLowerCase() : null));
  }

  function bySymbol(trades) {
    return groupStats(trades, (t) => t.symbol || null).sort((a, b) => b.n - a.n);
  }

  function byMarketCondition(trades) {
    return groupStats(trades, (t) => t.marketCondition || null).sort((a, b) => b.pnl - a.pnl);
  }

  function byMentalState(trades) {
    return groupStats(trades, (t) => t.mentalState || null).sort((a, b) => b.winRate - a.winRate);
  }

  function bySession(trades) {
    return groupStats(trades, (t) => t.session || null);
  }

  // Tag lists (confluences / mistakes) need explosion before grouping
  function explodeTagStats(trades, field) {
    const map = new Map();
    for (const t of trades) {
      const tags = Array.isArray(t[field]) ? t[field] : (t[field] ? [t[field]] : []);
      for (const raw of tags) {
        const tag = String(raw).trim();
        if (!tag) continue;
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag).push(t);
      }
    }
    const out = [];
    for (const [tag, list] of map.entries()) {
      const wins = list.filter(isWin).length;
      const losses = list.filter(isLoss).length;
      const pnl = list.reduce((a, t) => a + pnlOf(t), 0);
      out.push({ tag, n: list.length, wins, losses, winRate: (wins / list.length) * 100, pnl, avgPnL: pnl / list.length });
    }
    return out;
  }

  function confluenceStats(trades) {
    const all = explodeTagStats(trades, 'confluences').sort((a, b) => b.winRate - a.winRate);
    const MIN_N = 2;
    const strong = all.filter((c) => c.n >= MIN_N && c.winRate >= 65).slice(0, 5);
    const dangerous = all.filter((c) => c.n >= MIN_N && c.winRate <= 40).sort((a, b) => a.winRate - b.winRate).slice(0, 5);
    return { all, strong, dangerous };
  }

  function mistakeStats(trades) {
    return explodeTagStats(trades, 'mistakes').sort((a, b) => b.n - a.n);
  }

  // ---- Post-loss performance -------------------------------------------
  function postLossPerformance(trades) {
    const sorted = sortByDateTime(trades);
    const after = [];
    for (let i = 1; i < sorted.length; i++) {
      if (isLoss(sorted[i - 1])) after.push(sorted[i]);
    }
    const baseline = kpis(sorted);
    const postLoss = kpis(after);
    return {
      n: after.length,
      winRateAfterLoss: postLoss.winRate,
      avgPnLAfterLoss: after.length ? after.reduce((a, t) => a + pnlOf(t), 0) / after.length : 0,
      baselineWinRate: baseline.winRate,
      delta: postLoss.winRate - baseline.winRate
    };
  }

  // ---- Trades-per-day quality degradation -------------------------------
  function performanceByDailyTradeCount(trades) {
    const byDate = new Map();
    for (const t of sortByDateTime(trades)) {
      if (!t.date) continue;
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push(t);
    }
    const buckets = new Map(); // ordinal position within day -> outcomes
    for (const list of byDate.values()) {
      list.forEach((t, idx) => {
        const pos = idx + 1;
        if (!buckets.has(pos)) buckets.set(pos, []);
        buckets.get(pos).push(t);
      });
    }
    const out = [];
    for (const [pos, list] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const wins = list.filter(isWin).length;
      out.push({ tradeNumberInDay: pos, n: list.length, winRate: (wins / list.length) * 100 });
    }
    const avgTradesPerDay = byDate.size ? trades.length / byDate.size : 0;
    return { byOrdinal: out, avgTradesPerDay, activeDays: byDate.size };
  }

  // ---- Pips management --------------------------------------------------
  function pipsStats(trades) {
    const withPips = trades.filter((t) => Number.isFinite(num(t.resultPips, NaN)));
    const wins = withPips.filter(isWin);
    const losses = withPips.filter(isLoss);
    const totalPips = withPips.reduce((a, t) => a + num(t.resultPips, 0), 0);
    const avgPipsWin = wins.length ? wins.reduce((a, t) => a + num(t.resultPips, 0), 0) / wins.length : 0;
    const avgPipsLoss = losses.length ? losses.reduce((a, t) => a + num(t.resultPips, 0), 0) / losses.length : 0;
    const bySymbolPips = groupStats(withPips, (t) => t.symbol || null).map((r) => {
      const list = withPips.filter((t) => (t.symbol || null) === r.key);
      const pips = list.reduce((a, t) => a + num(t.resultPips, 0), 0);
      return { symbol: r.key, n: r.n, totalPips: pips, avgPips: pips / r.n };
    });
    return { n: withPips.length, totalPips, avgPipsWin, avgPipsLoss, bySymbolPips };
  }

  // ---- MAE / MFE efficiency ----------------------------------------------
  function maeMfeEfficiency(trades) {
    const rows = trades.filter((t) => Number.isFinite(num(t.mfePercent, num(t.mfePips, NaN))));
    if (!rows.length) return null;
    const captured = rows.map((t) => {
      const mfe = num(t.mfePercent, num(t.mfePips, 0));
      const result = pnlOf(t);
      if (mfe <= 0) return null;
      return Math.max(0, Math.min(1, result / mfe));
    }).filter((v) => v !== null);
    const avgCaptureRatio = captured.length ? (captured.reduce((a, b) => a + b, 0) / captured.length) * 100 : null;
    return { n: rows.length, avgCaptureRatio };
  }

  // ---- Calendar aggregation (matches "Calendario delle performance") -----
  function calendarMonth(trades, year, month /* 0-indexed */) {
    const byDate = new Map();
    for (const t of trades) {
      if (!t.date) continue;
      const d = new Date(t.date + 'T00:00:00');
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push(t);
    }
    const days = [];
    for (const [date, list] of byDate.entries()) {
      const pnl = list.reduce((a, t) => a + pnlOf(t), 0);
      days.push({ date, trades: list, pnl });
    }
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    const monthTotal = days.reduce((a, d) => a + d.pnl, 0);
    return { days, monthTotal };
  }

  function bestWorstDays(trades, topN) {
    const byDate = new Map();
    for (const t of trades) {
      if (!t.date) continue;
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push(t);
    }
    const rows = [...byDate.entries()].map(([date, list]) => ({
      date,
      n: list.length,
      pnl: list.reduce((a, t) => a + pnlOf(t), 0),
      winRate: (list.filter(isWin).length / list.length) * 100
    }));
    const best = [...rows].sort((a, b) => b.pnl - a.pnl).slice(0, topN || 5);
    const worst = [...rows].sort((a, b) => a.pnl - b.pnl).slice(0, topN || 5);
    return { best, worst };
  }

  // ---- Simple notes keyword pattern reading -----------------------------
  const STOPWORDS = new Set([
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
    'e', 'ed', 'o', 'ma', 'che', 'non', 'si', 'mi', 'ti', 'ci', 'vi', 'ho', 'hai', 'ha', 'abbiamo', 'avete', 'hanno',
    'sono', 'sei', 'è', 'siamo', 'siete', 'del', 'della', 'dei', 'delle', 'al', 'allo', 'alla', 'ai', 'agli', 'alle',
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
    'trade', 'trades'
  ]);

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-zàèéìòù0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  }

  function journalPatternReading(trades, topN) {
    const winFreq = new Map();
    const lossFreq = new Map();
    let winWordTotal = 0, lossWordTotal = 0;
    for (const t of trades) {
      if (!t.notes) continue;
      const words = tokenize(t.notes);
      const target = isLoss(t) ? lossFreq : (isWin(t) ? winFreq : null);
      if (!target) continue;
      for (const w of words) {
        target.set(w, (target.get(w) || 0) + 1);
        if (target === winFreq) winWordTotal++; else lossWordTotal++;
      }
    }
    function topDistinct(target, other, otherTotal, selfTotal) {
      const rows = [];
      for (const [word, count] of target.entries()) {
        const selfRate = selfTotal ? count / selfTotal : 0;
        const otherRate = otherTotal ? (other.get(word) || 0) / otherTotal : 0;
        rows.push({ word, count, lift: selfRate - otherRate });
      }
      return rows.filter((r) => r.count >= 2).sort((a, b) => b.lift - a.lift).slice(0, topN || 5);
    }
    return {
      wordsInLosses: topDistinct(lossFreq, winFreq, winWordTotal, lossWordTotal),
      wordsInWins: topDistinct(winFreq, lossFreq, lossWordTotal, winWordTotal)
    };
  }

  return {
    WEEKDAYS_IT, WEEKDAYS_SHORT_IT,
    sortByDateTime, pnlOf, isWin, isLoss, isBE, weekdayOf, hourOf,
    equityCurve, maxDrawdown, streaks,
    kpis,
    byWeekday, byHour, byDirection, bySymbol, byMarketCondition, byMentalState, bySession,
    confluenceStats, mistakeStats,
    postLossPerformance, performanceByDailyTradeCount,
    pipsStats, maeMfeEfficiency,
    calendarMonth, bestWorstDays,
    journalPatternReading
  };
});
