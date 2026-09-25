/* Trade Journal Analytics — db.js
   Local-only persistence (localStorage). Nothing here ever talks to a
   server: all trade data stays in the browser of the person using it.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TJDB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY_TRADES = 'tj_trades_v1';
  const KEY_MAPPINGS = 'tj_mapping_templates_v1';
  const KEY_SETTINGS = 'tj_settings_v1';

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function getAllTrades() {
    return safeParse(localStorage.getItem(KEY_TRADES), []);
  }

  function saveTrades(trades) {
    localStorage.setItem(KEY_TRADES, JSON.stringify(trades));
  }

  function addTrades(newTrades) {
    const existing = getAllTrades();
    const byKey = new Map(existing.map((t) => [dedupeKey(t), t]));
    for (const t of newTrades) byKey.set(dedupeKey(t), t);
    const merged = [...byKey.values()];
    saveTrades(merged);
    return merged;
  }

  function dedupeKey(t) {
    // Same date+time+symbol+direction+result is treated as the same trade
    // on re-import, so re-uploading a journal doesn't duplicate rows.
    return [t.date, t.time || '', t.symbol || '', t.direction || '', t.resultPercent ?? '', t.resultPips ?? ''].join('|');
  }

  function updateTrade(id, patch) {
    const trades = getAllTrades();
    const idx = trades.findIndex((t) => t.id === id);
    if (idx === -1) return trades;
    trades[idx] = { ...trades[idx], ...patch };
    saveTrades(trades);
    return trades;
  }

  function deleteTrade(id) {
    const trades = getAllTrades().filter((t) => t.id !== id);
    saveTrades(trades);
    return trades;
  }

  function clearAll() {
    localStorage.removeItem(KEY_TRADES);
  }

  function exportJson() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), trades: getAllTrades() }, null, 2);
  }

  function headerSignature(headers) {
    return headers.map((h) => String(h).toLowerCase().trim()).sort().join('|');
  }

  function getMappingTemplate(sig) {
    const all = safeParse(localStorage.getItem(KEY_MAPPINGS), {});
    return all[sig] || null;
  }

  function saveMappingTemplate(sig, mapping) {
    const all = safeParse(localStorage.getItem(KEY_MAPPINGS), {});
    all[sig] = mapping;
    localStorage.setItem(KEY_MAPPINGS, JSON.stringify(all));
  }

  function getSettings() {
    return safeParse(localStorage.getItem(KEY_SETTINGS), { weekendVisible: false });
  }

  function saveSettings(settings) {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
  }

  return {
    getAllTrades, saveTrades, addTrades, updateTrade, deleteTrade, clearAll, exportJson,
    headerSignature, getMappingTemplate, saveMappingTemplate,
    getSettings, saveSettings
  };
});
