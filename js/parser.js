/* Trade Journal Analytics — parser.js
   Reads CSV/TSV/JSON/XLSX journal exports into raw {headers, rows}, offers
   fuzzy auto-mapping to the internal trade schema, and normalizes mapped
   rows into typed trade objects consumed by metrics.js / insights.js.
   Everything runs client-side; no file ever leaves the browser.
*/
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TJParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELD_DEFS = [
    { key: 'date', label: 'Data', required: true, synonyms: ['date', 'data', 'giorno', 'datetime', 'dataora'] },
    { key: 'time', label: 'Orario ingresso', synonyms: ['time', 'ora', 'orario', 'entrytime', 'oraingresso'] },
    { key: 'symbol', label: 'Simbolo', synonyms: ['symbol', 'simbolo', 'strumento', 'asset', 'pair', 'ticker', 'market'] },
    { key: 'direction', label: 'Direzione', synonyms: ['direction', 'direzione', 'side', 'tipo', 'longshort', 'buysell'] },
    { key: 'outcome', label: 'Esito', synonyms: ['outcome', 'esito', 'result', 'risultatotipo', 'winloss'] },
    { key: 'resultPercent', label: 'Risultato %', synonyms: ['resultpercent', 'risultato', 'pnl', 'pl', 'profit', 'percent', 'ritorno', 'performance', 'returnpercent'] },
    { key: 'resultPips', label: 'Risultato (pips)', synonyms: ['pips', 'pip', 'resultpips'] },
    { key: 'rrPlanned', label: 'R:R pianificato', synonyms: ['rr', 'riskreward', 'rrplanned', 'rrpianificato'] },
    { key: 'rrRealized', label: 'R:R realizzato', synonyms: ['rrrealized', 'rrrealizzato', 'rreffettivo'] },
    { key: 'maePercent', label: 'MAE %', synonyms: ['mae', 'maepercent', 'escursioneavversa', 'maxadverse'] },
    { key: 'maePips', label: 'MAE (pips)', synonyms: ['maepips'] },
    { key: 'mfePercent', label: 'MFE %', synonyms: ['mfe', 'mfepercent', 'escursionefavorevole', 'maxfavorable'] },
    { key: 'mfePips', label: 'MFE (pips)', synonyms: ['mfepips'] },
    { key: 'session', label: 'Sessione', synonyms: ['session', 'sessione', 'fasciaoraria'] },
    { key: 'marketCondition', label: 'Condizione di mercato', synonyms: ['marketcondition', 'condizionemercato', 'condizionidimercato', 'condizionedimercato', 'contesto'] },
    { key: 'mentalState', label: 'Stato mentale', synonyms: ['mentalstate', 'statomentale', 'emozione', 'psicologia', 'mood'] },
    { key: 'confluences', label: 'Confluenze', synonyms: ['confluences', 'confluenze', 'setup', 'conferme', 'confluence'] },
    { key: 'mistakes', label: 'Errori', synonyms: ['mistakes', 'errori', 'errore', 'mistake'] },
    { key: 'setupType', label: 'Tipo setup', synonyms: ['setuptype', 'tiposetup'] },
    { key: 'executionQuality', label: 'Qualità esecuzione (1-5)', synonyms: ['executionquality', 'qualitaesecuzione', 'votoesecuzione'] },
    { key: 'notes', label: 'Note', synonyms: ['notes', 'note', 'commento', 'commenti', 'comment'] },
    { key: 'imageUrl', label: 'Link immagine / screenshot', synonyms: ['image', 'immagine', 'screenshot', 'linkimmagine', 'chartlink', 'imageurl'] }
  ];

  function normalizeHeader(h) {
    return String(h || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function guessMapping(headers) {
    const normHeaders = headers.map(normalizeHeader);
    const mapping = {};
    const claimed = new Set();

    // Pass 1: exact normalized-header == synonym matches, claimed first-come.
    for (const def of FIELD_DEFS) {
      let bestIdx = -1;
      for (let i = 0; i < normHeaders.length; i++) {
        if (claimed.has(i)) continue;
        if (def.synonyms.includes(normHeaders[i])) { bestIdx = i; break; }
      }
      if (bestIdx >= 0) { mapping[def.key] = headers[bestIdx]; claimed.add(bestIdx); }
      else mapping[def.key] = null;
    }

    // Pass 2: fuzzy — only "header contains synonym" (never the reverse,
    // which produces false positives like "favorable".includes("ora")),
    // and only for synonyms long enough to be meaningful.
    for (const def of FIELD_DEFS) {
      if (mapping[def.key]) continue;
      let bestIdx = -1;
      for (let i = 0; i < normHeaders.length; i++) {
        if (claimed.has(i)) continue;
        if (def.synonyms.some((s) => s.length >= 4 && normHeaders[i].includes(s))) { bestIdx = i; break; }
      }
      if (bestIdx >= 0) { mapping[def.key] = headers[bestIdx]; claimed.add(bestIdx); }
    }
    return mapping;
  }

  // ---- Delimited text (CSV/TSV) parsing --------------------------------
  function detectDelimiter(sampleLine) {
    const counts = { ',': (sampleLine.match(/,/g) || []).length, ';': (sampleLine.match(/;/g) || []).length, '\t': (sampleLine.match(/\t/g) || []).length };
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
    if (!lines.length) return { headers: [], rows: [] };
    const delim = detectDelimiter(lines[0]);
    function parseLine(line) {
      const out = [];
      let cur = '', inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
          if (c === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
          } else cur += c;
        } else if (c === '"') {
          inQuotes = true;
        } else if (c === delim) {
          out.push(cur); cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    }
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map((line) => {
      const cells = parseLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ''; });
      return obj;
    });
    return { headers, rows };
  }

  // ---- JSON parsing -------------------------------------------------------
  function parseJson(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (Array.isArray(data.trades) ? data.trades : []);
    if (!arr.length) return { headers: [], rows: [] };
    const headerSet = new Set();
    arr.forEach((row) => Object.keys(row).forEach((k) => headerSet.add(k)));
    const headers = [...headerSet];
    const rows = arr.map((row) => {
      const obj = {};
      headers.forEach((h) => { obj[h] = row[h] !== undefined && row[h] !== null ? row[h] : ''; });
      return obj;
    });
    return { headers, rows };
  }

  // ---- XLSX parsing (requires global SheetJS `XLSX`) -----------------------
  function parseWorkbookArrayBuffer(buffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Libreria XLSX non caricata: impossibile leggere file Excel.');
    }
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!json.length) return { headers: [], rows: [] };
    const headers = Object.keys(json[0]);
    return { headers, rows: json };
  }

  function readFile(file) {
    const name = file.name.toLowerCase();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Impossibile leggere il file.'));
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        reader.onload = () => {
          try { resolve(parseWorkbookArrayBuffer(new Uint8Array(reader.result))); }
          catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => {
          try {
            const text = String(reader.result);
            if (name.endsWith('.json')) resolve(parseJson(text));
            else resolve(parseDelimited(text));
          } catch (e) { reject(e); }
        };
        reader.readAsText(file);
      }
    });
  }

  // ---- Normalization of a mapped raw row into a typed trade object --------
  function toNumber(v) {
    if (v === '' || v === null || v === undefined) return undefined;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/%/g, '').replace(/\s/g, '');
    if (s === '') return undefined;
    // handle Italian decimal comma only when no dot present
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  }

  function toDateIso(v) {
    if (!v) return undefined;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
    if (m) {
      // Italian convention: DD/MM/YYYY
      const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
      return `${m[3]}-${mo}-${d}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return undefined;
  }

  function toTime(v) {
    if (!v) return undefined;
    const s = String(v).trim();
    const m = /^(\d{1,2})[:.](\d{2})/.exec(s);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    return undefined;
  }

  function toDirection(v) {
    if (!v) return undefined;
    const s = String(v).toLowerCase();
    if (/(long|buy|acquist|compr)/.test(s)) return 'long';
    if (/(short|sell|vend)/.test(s)) return 'short';
    return undefined;
  }

  function toOutcome(v, resultPercent) {
    if (v) {
      const s = String(v).toLowerCase();
      if (/(win|vint|tp\b|target|profit)/.test(s)) return 'win';
      if (/(loss|pers|sl\b|stop)/.test(s)) return 'loss';
      if (/(be\b|breakeven|pareggio)/.test(s)) return 'be';
    }
    if (typeof resultPercent === 'number') {
      if (resultPercent > 0) return 'win';
      if (resultPercent < 0) return 'loss';
      return 'be';
    }
    return undefined;
  }

  function toList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
    return String(v).split(/[;,|\/]/).map((s) => s.trim()).filter(Boolean);
  }

  function normalizeRow(rawRow, mapping, idSeed) {
    function get(key) {
      const col = mapping[key];
      if (!col) return undefined;
      const v = rawRow[col];
      return v === '' ? undefined : v;
    }
    const resultPercent = toNumber(get('resultPercent'));
    const trade = {
      id: `t_${idSeed}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: toDateIso(get('date')),
      time: toTime(get('time')),
      symbol: get('symbol') ? String(get('symbol')).trim() : undefined,
      direction: toDirection(get('direction')),
      outcome: toOutcome(get('outcome'), resultPercent),
      resultPercent,
      resultPips: toNumber(get('resultPips')),
      rrPlanned: toNumber(get('rrPlanned')),
      rrRealized: toNumber(get('rrRealized')),
      maePercent: toNumber(get('maePercent')),
      maePips: toNumber(get('maePips')),
      mfePercent: toNumber(get('mfePercent')),
      mfePips: toNumber(get('mfePips')),
      session: get('session') ? String(get('session')).trim() : undefined,
      marketCondition: get('marketCondition') ? String(get('marketCondition')).trim() : undefined,
      mentalState: get('mentalState') ? String(get('mentalState')).trim() : undefined,
      confluences: toList(get('confluences')),
      mistakes: toList(get('mistakes')),
      setupType: get('setupType') ? String(get('setupType')).trim() : undefined,
      executionQuality: toNumber(get('executionQuality')),
      notes: get('notes') ? String(get('notes')).trim() : undefined,
      imageUrl: get('imageUrl') ? String(get('imageUrl')).trim() : undefined
    };
    return trade;
  }

  function normalizeRows(rows, mapping) {
    return rows
      .map((r, i) => normalizeRow(r, mapping, i))
      .filter((t) => t.date); // date is the only hard requirement
  }

  return { FIELD_DEFS, normalizeHeader, guessMapping, parseDelimited, parseJson, parseWorkbookArrayBuffer, readFile, normalizeRows, toNumber, toDateIso };
});
