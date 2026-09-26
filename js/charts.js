/* Trade Journal Analytics — charts.js
   Thin Chart.js rendering layer. Keeps one Chart instance per canvas id
   and destroys/recreates on refresh so re-rendering after a new upload
   never leaks canvases.
*/
(function (root) {
  'use strict';
  const registry = new Map();

  // Data labels are opt-in per chart (registered globally, off by default)
  // so the equity curve — one point per trade, far too dense to label —
  // stays readable while bar/doughnut charts show their values directly
  // on the chart itself instead of only on hover.
  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    Chart.defaults.set('plugins.datalabels', { display: false });
  }

  const PALETTE = {
    green: '#22c55e', red: '#ef4444', amber: '#f59e0b', blue: '#3b82f6',
    purple: '#a78bfa', grid: 'rgba(255,255,255,0.06)', text: '#8b93a7', label: '#e7eaf0'
  };
  const LABEL_FONT = { weight: '700', size: 11 };

  const commonScales = {
    x: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.text, font: { size: 11 } } },
    y: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.text, font: { size: 11 } } }
  };

  function render(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    if (registry.has(canvasId)) registry.get(canvasId).destroy();
    const chart = new Chart(el.getContext('2d'), config);
    registry.set(canvasId, chart);
    return chart;
  }

  function equityCurve(canvasId, points) {
    const labels = points.map((p, i) => p.date ? `${p.date}${p.time ? ' ' + p.time : ''}` : `#${i + 1}`);
    const data = points.map((p) => p.cum);
    return render(canvasId, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data, borderColor: PALETTE.blue, backgroundColor: 'rgba(59,130,246,0.12)',
          fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)}%` } } },
        scales: {
          x: { ...commonScales.x, ticks: { ...commonScales.x.ticks, maxTicksLimit: 8 } },
          y: { ...commonScales.y, ticks: { ...commonScales.y.ticks, callback: (v) => `${v}%` } }
        }
      }
    });
  }

  function weekdayBar(canvasId, rows) {
    return render(canvasId, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{
          data: rows.map((r) => r.winRate),
          backgroundColor: rows.map((r) => (r.winRate >= 50 ? PALETTE.green : PALETTE.red)),
          borderRadius: 6, maxBarThickness: 34
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `Win rate ${ctx.parsed.y.toFixed(0)}% (${rows[ctx.dataIndex].n} trade)` } },
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            anchor: 'end', align: 'top', color: PALETTE.label, font: LABEL_FONT,
            formatter: (v) => `${v.toFixed(0)}%`
          }
        },
        scales: { x: commonScales.x, y: { ...commonScales.y, max: 100, ticks: { ...commonScales.y.ticks, callback: (v) => `${v}%` } } }
      }
    });
  }

  function hourBar(canvasId, rows) {
    return render(canvasId, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{
          data: rows.map((r) => r.winRate),
          backgroundColor: rows.map((r) => (r.winRate >= 50 ? PALETTE.green : PALETTE.red)),
          borderRadius: 6, maxBarThickness: 28
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `Win rate ${ctx.parsed.y.toFixed(0)}% (${rows[ctx.dataIndex].n} trade)` } },
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            anchor: 'end', align: 'top', color: PALETTE.label, font: LABEL_FONT,
            formatter: (v) => `${v.toFixed(0)}%`
          }
        },
        scales: { x: commonScales.x, y: { ...commonScales.y, max: 100, ticks: { ...commonScales.y.ticks, callback: (v) => `${v}%` } } }
      }
    });
  }

  function winLossDonut(canvasId, kpisObj) {
    return render(canvasId, {
      type: 'doughnut',
      data: {
        labels: ['Vincenti', 'Perdenti', 'Breakeven'],
        datasets: [{
          data: [kpisObj.wins, kpisObj.losses, kpisObj.breakevens],
          backgroundColor: [PALETTE.green, PALETTE.red, PALETTE.amber],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { color: PALETTE.text, boxWidth: 10, font: { size: 11 } } },
          datalabels: {
            display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 0,
            color: '#0a0e14', font: { weight: '800', size: 12 },
            formatter: (v) => v
          }
        }
      }
    });
  }

  function directionBar(canvasId, rows) {
    const labels = rows.map((r) => (r.key === 'long' ? 'Long' : 'Short'));
    return render(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Win rate %', data: rows.map((r) => r.winRate), backgroundColor: PALETTE.blue, borderRadius: 6, maxBarThickness: 40 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true, anchor: 'end', align: 'end', color: PALETTE.label, font: LABEL_FONT,
            formatter: (v) => `${v.toFixed(0)}%`
          }
        },
        scales: { x: { ...commonScales.x, max: 100 }, y: commonScales.y }
      }
    });
  }

  function confluenceBar(canvasId, rows) {
    const sorted = [...rows].sort((a, b) => b.winRate - a.winRate);
    return render(canvasId, {
      type: 'bar',
      data: {
        labels: sorted.map((r) => r.tag),
        datasets: [{
          data: sorted.map((r) => r.winRate),
          backgroundColor: sorted.map((r) => (r.winRate >= 60 ? PALETTE.green : r.winRate <= 40 ? PALETTE.red : PALETTE.amber)),
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `Win rate ${ctx.parsed.x.toFixed(0)}% (${sorted[ctx.dataIndex].n} trade)` } },
          datalabels: {
            display: true, anchor: 'end', align: 'end', color: PALETTE.label, font: LABEL_FONT,
            formatter: (v) => `${v.toFixed(0)}%`
          }
        },
        scales: { x: { ...commonScales.x, max: 100 }, y: commonScales.y }
      }
    });
  }

  function monthlyComparison(canvasId, rows) {
    // rows: [{label, pnl, winRate}]
    return render(canvasId, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            type: 'bar', label: 'P&L %', data: rows.map((r) => r.pnl), yAxisID: 'y',
            backgroundColor: rows.map((r) => (r.pnl >= 0 ? PALETTE.green : PALETTE.red)), borderRadius: 6, order: 2,
            datalabels: { display: true, anchor: 'end', align: (ctx) => (ctx.dataset.data[ctx.dataIndex] >= 0 ? 'top' : 'bottom'), color: PALETTE.label, font: LABEL_FONT, formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }
          },
          {
            type: 'line', label: 'Win rate %', data: rows.map((r) => r.winRate), yAxisID: 'y1',
            borderColor: PALETTE.purple, backgroundColor: PALETTE.purple, tension: 0.3, pointRadius: 3, order: 1,
            datalabels: { display: true, align: 'bottom', color: PALETTE.purple, font: LABEL_FONT, formatter: (v) => `${v.toFixed(0)}%` }
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: PALETTE.text, boxWidth: 10, font: { size: 11 } } } },
        scales: {
          x: commonScales.x,
          y: { ...commonScales.y, position: 'left', ticks: { ...commonScales.y.ticks, callback: (v) => `${v}%` } },
          y1: { position: 'right', grid: { display: false }, ticks: { color: PALETTE.text, callback: (v) => `${v}%` }, min: 0, max: 100 }
        }
      }
    });
  }

  function maeMfeBar(canvasId, avgMAE, avgMFE) {
    return render(canvasId, {
      type: 'bar',
      data: {
        labels: ['MAE medio', 'MFE medio'],
        datasets: [{ data: [avgMAE ?? 0, avgMFE ?? 0], backgroundColor: [PALETTE.red, PALETTE.green], borderRadius: 8, maxBarThickness: 60 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)}%` } },
          datalabels: { display: true, anchor: 'end', align: (ctx) => (ctx.dataset.data[ctx.dataIndex] >= 0 ? 'top' : 'bottom'), color: PALETTE.label, font: LABEL_FONT, formatter: (v) => `${v.toFixed(2)}%` }
        },
        scales: { x: commonScales.x, y: { ...commonScales.y, ticks: { ...commonScales.y.ticks, callback: (v) => `${v}%` } } }
      }
    });
  }

  root.TJCharts = { render, equityCurve, weekdayBar, hourBar, winLossDonut, directionBar, confluenceBar, monthlyComparison, maeMfeBar };
})(typeof window !== 'undefined' ? window : this);
