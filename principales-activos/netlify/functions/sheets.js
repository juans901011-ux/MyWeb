// netlify/functions/sheets.js
// Proxy a Google Sheets API v4 para el Sheet "Seguimiento 2026" (pestaña Dashboard).
// La API key vive SOLO aquí (variable de entorno), nunca llega al navegador.
//
// Variables de entorno requeridas (Netlify > Site settings > Environment, o .env con netlify dev):
//   SHEET_ID         -> ID del Sheet "Seguimiento 2026" (lo que va entre /d/ y /edit en la URL)
//   SHEETS_API_KEY   -> API key de Google Cloud con "Google Sheets API" habilitada
//
// La hoja debe ser de lectura pública ("Cualquiera con el enlace: Lector").

const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.SHEETS_API_KEY;

const toNum = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

async function getRanges(ranges) {
  const params = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${params}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.valueRanges.map(v => v.values || []);
}

const PRINCIPALES_TICKERS = {
  activos: ['SPY', 'DIA', 'QQQ', 'IWM', 'GLD', 'TLT', 'UUP', 'GBTC', 'USO'],
  sectores: ['XLE', 'XLV', 'XLRE', 'XLF', 'XLP', 'XLI', 'XLU', 'XLB', 'XLC', 'XLY', 'XLK']
};

// Encuentra "as of" + día de semana escaneando las primeras filas por contenido
// (patrón fecha DD/MM/AAAA y nombre de día), en vez de una celda fija.
function extraerFecha(sheet) {
  const dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  let fechaTxt = '', diaTxt = '';
  for (let i = 0; i < Math.min(6, sheet.length); i++) {
    for (const cell of (sheet[i] || [])) {
      const t = String(cell || '').trim();
      if (!fechaTxt && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) fechaTxt = t;
      if (!diaTxt && dias.includes(t.toLowerCase())) diaTxt = t;
    }
  }
  return diaTxt && fechaTxt ? `${diaTxt}, ${fechaTxt}` : fechaTxt;
}

// Ubica el encabezado por contenido ("Ticker"), no por fila fija: si el Sheet
// inserta filas arriba, esto sigue funcionando igual.
function parsePrincipales(sheet) {
  if (!sheet || !sheet.length) return [];

  const headerIdx = sheet.findIndex(row => row && row.some(c => String(c || '').trim() === 'Ticker'));
  if (headerIdx === -1) return [];
  const header = sheet[headerIdx];
  const col = {};
  header.forEach((cell, i) => {
    const t = String(cell || '').trim();
    if (t) col[t] = i;
  });

  // Un mismo ticker (ej. GLD) puede repetirse más abajo en otro bloque del Sheet
  // ("Otros Instrumentos Financieros"); nos quedamos con la primera aparición.
  const byTicker = {};
  for (let i = headerIdx + 1; i < sheet.length; i++) {
    const row = sheet[i];
    const ticker = row && col['Ticker'] != null ? (row[col['Ticker']] || '').trim() : '';
    if (!ticker || byTicker[ticker]) continue;
    byTicker[ticker] = {
      ticker,
      nombre: (col['Nombre'] != null ? row[col['Nombre']] : '') || '',
      high52: col['High 52'] != null ? toNum(row[col['High 52']]) : null,
      ytd: col['YTD'] != null ? toNum(row[col['YTD']]) : null,
      mes: col['Mes'] != null ? toNum(row[col['Mes']]) : null,
      semana: col['Semana'] != null ? toNum(row[col['Semana']]) : null,
      dia: col['Día'] != null ? toNum(row[col['Día']]) : null
    };
  }

  const result = [];
  for (const [grupo, tickers] of Object.entries(PRINCIPALES_TICKERS)) {
    tickers.forEach(t => { if (byTicker[t]) result.push({ grupo, ...byTicker[t] }); });
  }
  return result;
}

exports.handler = async () => {
  if (!SHEET_ID || !API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta SHEET_ID o SHEETS_API_KEY en variables de entorno.' }) };
  }
  try {
    const [dash] = await getRanges(["Dashboard!A1:L50"]);
    const principales = parsePrincipales(dash);
    const fecha = extraerFecha(dash);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({ fecha, principales })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
