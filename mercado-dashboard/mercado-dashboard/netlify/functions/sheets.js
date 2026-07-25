// netlify/functions/sheets.js
// Proxy a Google Sheets API v4. La API key vive SOLO aquí (variable de entorno),
// nunca llega al navegador.
//
// Variables de entorno requeridas (Netlify > Site settings > Environment, o .env con netlify dev):
//   SHEET_ID         -> el ID del Google Sheet (lo que va entre /d/ y /edit en la URL)
//   SHEETS_API_KEY   -> API key de Google Cloud con "Google Sheets API" habilitada
//
// La hoja debe ser de lectura pública ("Cualquiera con el enlace: Lector").

const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.SHEETS_API_KEY;

// ---- helpers de parseo ----
const toNum = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};
const ppsToNum = (s) => {
  if (s == null) return 0;
  const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
};

async function getRanges(ranges) {
  const params = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${params}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.valueRanges.map(v => v.values || []);
}

// ---- construir series de sparkline desde la hoja BD ----
function buildSparklines(bd, lastN = 26) {
  if (!bd.length) return {};

  // La fila de encabezados (tickers, ej. SPY, XLK, ...) no siempre está en la
  // primera fila del rango: filas en blanco insertadas arriba (p.ej. al agregar
  // ETFs nuevos) la corren hacia abajo. La ubicamos por contenido, no por índice fijo.
  const headerIdx = bd.findIndex(row =>
    row && row.filter(c => /^[A-Z]{1,6}$/.test(String(c || '').trim())).length >= 2
  );
  if (headerIdx === -1) return {};
  const header = bd[headerIdx];          // [fecha, SPY, '', XLK, '', SMH, ...]
  const tickerCol = {};                 // ticker -> columna del Close (col del ticker + 1)
  header.forEach((cell, c) => {
    const t = String(cell || '').trim();
    if (t && !/^\d/.test(t)) tickerCol[t] = c + 1;
  });

  const series = {};
  for (const [ticker, col] of Object.entries(tickerCol)) series[ticker] = [];

  // filas de datos: la primera celda es un número de fila (1..52), empiezan tras el encabezado
  for (let i = headerIdx + 1; i < bd.length; i++) {
    const row = bd[i];
    if (!row || !/^\d+$/.test(String(row[0] || '').trim())) continue;
    for (const [ticker, col] of Object.entries(tickerCol)) {
      const v = toNum(row[col]);
      if (v != null) series[ticker].push(v);
    }
  }
  // recortar a los últimos N
  for (const t of Object.keys(series)) series[t] = series[t].slice(-lastN);
  return series;
}

// ---- construir filas de la pestaña Resumen ----
function parseResumen(sheet) {
  if (!sheet || !sheet.length) return [];

  // Encabezado ubicado por contenido ("Ticker"), no por fila fija, por la misma
  // razón que arriba: insertar filas se corre la posición.
  const headerIdx = sheet.findIndex(row => row && row.some(c => String(c || '').trim() === 'Ticker'));
  if (headerIdx === -1) return [];
  const header = sheet[headerIdx];
  const col = {};
  header.forEach((cell, i) => {
    const t = String(cell || '').trim();
    if (t) col[t] = i;
  });

  const numCols = { rs: 'RS_STS%', fromOpen: 'From Open', dia: 'Día', semana: 'Semana', mes: 'Mes', ytd: 'YTD', yoy: 'YoY', w52h: '52W High' };

  const rows = [];
  for (let i = headerIdx + 1; i < sheet.length; i++) {
    const row = sheet[i];
    const ticker = row && col['Ticker'] != null ? (row[col['Ticker']] || '').trim() : '';
    if (!ticker) continue;
    const item = { ticker, nombre: (col['Nombre'] != null ? row[col['Nombre']] : '') || '' };
    for (const [key, label] of Object.entries(numCols)) {
      item[key] = col[label] != null ? toNum(row[col[label]]) : null;
    }
    rows.push(item);
  }
  return rows;
}

exports.handler = async () => {
  if (!SHEET_ID || !API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta SHEET_ID o SHEETS_API_KEY en variables de entorno.' }) };
  }
  try {
    const [rs, bd, dateRows, resumenRaw] = await getRanges([
      "'%RS'!A1:R260",   // ambos paneles
      "BD!A1:DZ60",      // cierres históricos para sparklines
      "'%RS'!D1:D6",     // fecha (celda exacta puede variar si se insertan filas arriba)
      "Resumen!A1:S150"  // tabla resumen ordenable
    ]);

    // La celda de fecha se identifica por contener un año (4 dígitos), no por
    // una fila fija, ya que insertar filas arriba (p.ej. al agregar ETFs) la corre.
    const fecha = (dateRows || [])
      .map(r => (r && r[0]) || '')
      .find(v => /\d{4}/.test(v)) || '';
    const spark = buildSparklines(bd);

    // ---- Panel izquierdo: Fuerza Relativa (cols D=3, E=4, J=9) ----
    const fuerzaRelativa = [];
    let prevEmpty = false;
    for (const row of rs) {
      const ticker = (row[3] || '').trim();
      const desc = (row[4] || '').trim();
      const rsVal = toNum(row[9]);
      if (!ticker) { prevEmpty = true; continue; }      // fila separadora
      if (ticker === 'SPY') { prevEmpty = false; continue; } // benchmark, no se lista
      if (rsVal == null) continue;
      fuerzaRelativa.push({
        ticker, desc, rs: rsVal,
        serie: spark[ticker] || [],
        sep: prevEmpty && fuerzaRelativa.length > 0  // marca inicio de nuevo grupo
      });
      prevEmpty = false;
    }

    // ---- Panel derecho: Posición (cols L=11, N=13, P=15, R=17) ----
    const posicion = [];
    for (const row of rs) {
      const ticker = (row[11] || '').trim();
      const rsVal = toNum(row[13]);
      if (!ticker || rsVal == null) continue;
      posicion.push({
        ticker, rs: rsVal,
        w1: ppsToNum(row[15]),
        m1: ppsToNum(row[17])
      });
    }

    const resumen = parseResumen(resumenRaw);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ fecha, fuerzaRelativa, posicion, resumen })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
