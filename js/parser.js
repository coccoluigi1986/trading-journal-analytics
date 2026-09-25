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
    { key: 'symbol', label: 'Simbolo', synonyms: ['symbol', 'simbolo', 'strumento', 'asset', 'pair', 'ticker', 'market', 'coppia', 'cross', 'coppiacross'] },
    { key: 'direction', label: 'Direzione', synonyms: ['direction', 'direzione', 'side', 'tipo', 'longshort', 'buysell'] },
    { key: 'outcome', label: 'Esito', synonyms: ['outcome', 'esito', 'result', 'risultato', 'risultatotipo', 'winloss'] },
    { key: 'resultPercent', label: 'Risultato %', synonyms: ['resultpercent', 'pnl', 'pl', 'profit', 'percent', 'ritorno', 'performance', 'returnpercent'] },
    { key: 'resultPips', label: 'Risultato (pips)', synonyms: ['pips', 'pip', 'resultpips'], excludeIfContains: ['tp', 'stop'] },
    { key: 'rrPlanned', label: 'R:R pianificato', synonyms: ['rr', 'riskreward', 'rrplanned', 'rrpianificato'] },
    { key: 'rrRealized', label: 'R:R realizzato', synonyms: ['rrrealized', 'rrrealizzato', 'rreffettivo', 'rrfinale'] },
    { key: 'maePercent', label: 'MAE %', synonyms: ['mae', 'maepercent', 'escursioneavversa', 'maxadverse'] },
    { key: 'maePips', label: 'MAE (pips)', synonyms: ['maepips'] },
    { key: 'mfePercent', label: 'MFE %', synonyms: ['mfe', 'mfepercent', 'escursionefavorevole', 'maxfavorable'] },
    { key: 'mfePips', label: 'MFE (pips)', synonyms: ['mfepips'] },
    { key: 'session', label: 'Sessione', synonyms: ['session', 'sessione', 'fasciaoraria'] },
    { key: 'marketCondition', label: 'Condizione di mercato', synonyms: ['marketcondition', 'condizionemercato', 'condizionidimercato', 'condizionedimercato', 'contesto'] },
    { key: 'mentalState', label: 'Stato mentale', synonyms: ['mentalstate', 'statomentale', 'emozione', 'psicologia', 'mood'] },
    { key: 'confluences', label: 'Confluenze / Pro', synonyms: ['confluences', 'confluenze', 'setup', 'conferme', 'confluence', 'pro'] },
    { key: 'mistakes', label: 'Errori / Contro', synonyms: ['mistakes', 'errori', 'errore', 'mistake', 'contro'] },
    { key: 'setupType', label: 'Tipo setup', synonyms: ['setuptype', 'tiposetup'] },
    { key: 'executionQuality', label: 'Qualità esecuzione (1-5)', synonyms: ['executionquality', 'qualitaesecuzione', 'votoesecuzione'] },
    { key: 'notes', label: 'Note', synonyms: ['notes', 'note', 'commento', 'commenti', 'comment'] },
    { key: 'notesPost', label: 'Note post operazione', synonyms: ['notespost', 'notepostoperazione', 'notapostoperazione', 'postoperazione'] },
    { key: 'imageUrlPre', label: 'Link screenshot PRE-trade', synonyms: ['screenpre', 'imagepre', 'screenshotpre', 'linkscreenpre'] },
    { key: 'imageUrlPost', label: 'Link screenshot POST-trade', synonyms: ['screenpost', 'imagepost', 'screenshotpost', 'linkscreenpost'] },
    { key: 'imageUrl', label: 'Link immagine / screenshot', synonyms: ['image', 'immagine', 'screenshot', 'linkimmagine', 'chartlink', 'imageurl'] }
  ];

  function normalizeHeader(h) {
    return String(h || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // Headers like "Risultato" and "Risultato %" normalize to the identical
  // string once punctuation is stripped, so a plain synonym match can't
  // tell them apart. A literal '%' in the raw header is a strong, cheap
  // signal that the column holds the numeric percent result rather than
  // a categorical outcome label (win/loss/TP/SL) — resolve those columns
  // first, before the generic synonym passes even run.
  const RESULT_PERCENT_ROOTS = ['risultato', 'result', 'pnl', 'profit', 'ritorno', 'performance', 'guadagno', 'perdita'];

  function guessMapping(headers) {
    const normHeaders = headers.map(normalizeHeader);
    const mapping = {};
    const claimed = new Set();

    // Pass 0: percent-sign disambiguation for resultPercent.
    for (let i = 0; i < headers.length; i++) {
      if (/%/.test(headers[i]) && RESULT_PERCENT_ROOTS.some((r) => normHeaders[i].includes(r))) {
        mapping.resultPercent = headers[i];
        claimed.add(i);
        break;
      }
    }

    // Pass 1: exact normalized-header == synonym matches, claimed first-come.
    for (const def of FIELD_DEFS) {
      if (mapping[def.key]) continue;
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
        if (def.excludeIfContains && def.excludeIfContains.some((x) => normHeaders[i].includes(x))) continue;
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
  const ALL_SYNONYMS = new Set(FIELD_DEFS.flatMap((d) => d.synonyms));

  // Picks the row most likely to be the real header row, scanning the first
  // few rows instead of blindly trusting row 1 — many trading journals have
  // a title/logo row (or a blank spacer) above the actual table header.
  function bestHeaderRowIndex(aoa) {
    let bestIdx = 0, bestScore = -1;
    const scanLimit = Math.min(aoa.length, 10);
    for (let i = 0; i < scanLimit; i++) {
      const row = aoa[i] || [];
      const nonEmpty = row.filter((c) => String(c || '').trim() !== '').length;
      if (nonEmpty < 2) continue;
      const score = row.filter((c) => ALL_SYNONYMS.has(normalizeHeader(c))).length;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestScore > 0 ? bestIdx : 0;
  }

  function parseWorkbookArrayBuffer(buffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Libreria XLSX non caricata: impossibile leggere file Excel.');
    }
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // Two parallel reads of the same sheet, merged cell-by-cell:
    // - raw:true (+ cellDates) gives real JS Date objects for date cells,
    //   which our date parser handles directly and unambiguously.
    // - raw:false gives each OTHER cell's DISPLAYED text (e.g. "3,7%")
    //   instead of Excel's underlying stored value (a percent-formatted
    //   cell is stored internally as a fraction like 0.037, which would
    //   otherwise silently shrink every result by 100x).
    // Relying on only one of the two breaks the other case, so both are
    // read and the best representation is picked per cell.
    const aoaRaw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    const aoaFmt = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    if (!aoaFmt.length) return { headers: [], rows: [] };
    const aoa = aoaFmt.map((fmtRow, r) => fmtRow.map((fmtCell, c) => {
      const rawCell = (aoaRaw[r] || [])[c];
      return rawCell instanceof Date ? rawCell : fmtCell;
    }));
    const headerIdx = bestHeaderRowIndex(aoa);
    const headers = aoa[headerIdx].map((h) => String(h || '').trim());
    const rows = aoa.slice(headerIdx + 1)
      .filter((r) => r.some((c) => String(c || '').trim() !== ''))
      .map((r) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined && r[i] !== null ? r[i] : ''; });
        return obj;
      });
    return { headers, rows };
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
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma !== -1 && lastDot !== -1) {
      // Both separators present: whichever comes LAST is the decimal
      // point, the other is a thousands grouping (e.g. "1.234,56" or
      // "1,234.56" both mean one thousand two hundred thirty-four point
      // five six — treating the dot as always-decimal broke on the
      // former, silently turning "10.370" into 10.37 instead of 10370).
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma !== -1) {
      s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  }

  function toDateIso(v) {
    if (!v) return undefined;
    if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) return undefined;
      return v.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // DD/MM/YYYY (Italian convention) — any trailing text (e.g. a time
    // stamp like "06/08/2026 00:00:00") is ignored, not required to match.
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/.exec(s);
    if (m) {
      const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
      return `${m[3]}-${mo}-${d}`;
    }
    // 2-digit year variant: DD/MM/YY
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/.exec(s);
    if (m) {
      const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
      const yy = parseInt(m[3], 10);
      const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
      return `${yyyy}-${mo}-${d}`;
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
    const noteParts = [];
    if (get('notes')) noteParts.push(String(get('notes')).trim());
    if (get('notesPost')) noteParts.push(`Post: ${String(get('notesPost')).trim()}`);
    const imageUrlPre = get('imageUrlPre') ? String(get('imageUrlPre')).trim() : undefined;
    const imageUrlPost = get('imageUrlPost') ? String(get('imageUrlPost')).trim() : undefined;
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
      notes: noteParts.length ? noteParts.join(' — ') : undefined,
      imageUrlPre,
      imageUrlPost,
      imageUrl: get('imageUrl') ? String(get('imageUrl')).trim() : (imageUrlPost || imageUrlPre)
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
