// functions/api/sheets.js
// Cloudflare Pages Function: proxy a Google Sheets API v4. La API key vive SOLO
// en variables de entorno del proyecto (Cloudflare dashboard, o .dev.vars en
// local), nunca llega al navegador.
//
// Variables de entorno requeridas:
//   SHEET_ID         -> el ID del Google Sheet (lo que va entre /d/ y /edit en la URL)
//   SHEETS_API_KEY   -> API key de Google Cloud con "Google Sheets API" habilitada
//
// La hoja debe ser de lectura pública ("Cualquiera con el enlace: Lector").

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

async function getRanges(sheetId, apiKey, ranges) {
  const params = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${params}&key=${apiKey}`;
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

// ---- construir top 10 de componentes por ETF desde la hoja "BD Tickers" ----
// Formato de la hoja: filas largas [ETF, Ticker, % Change, Peso], agrupadas
// por ETF pero no necesariamente ordenadas -- se ordena aquí por Peso desc.
function parseComponentes(rows) {
  if (!rows || !rows.length) return {};

  const headerIdx = rows.findIndex(row => row && row.some(c => String(c || '').trim() === 'ETF'));
  if (headerIdx === -1) return {};
  const header = rows[headerIdx];
  const col = {};
  header.forEach((cell, i) => {
    const t = String(cell || '').trim();
    if (t) col[t] = i;
  });

  const byEtf = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const etf = row && col['ETF'] != null ? (row[col['ETF']] || '').trim() : '';
    const ticker = row && col['Ticker'] != null ? (row[col['Ticker']] || '').trim() : '';
    const peso = row && col['Peso'] != null ? toNum(row[col['Peso']]) : null;
    if (!etf || !ticker || peso == null) continue;
    if (!byEtf[etf]) byEtf[etf] = [];
    byEtf[etf].push({
      ticker,
      peso,
      change: col['% Change'] != null ? toNum(row[col['% Change']]) : null
    });
  }
  for (const etf of Object.keys(byEtf)) {
    byEtf[etf] = byEtf[etf].sort((a, b) => b.peso - a.peso).slice(0, 10);
  }
  return byEtf;
}

function jsonResponse(obj, status, cacheControl) {
  const headers = { 'Content-Type': 'application/json' };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  return new Response(JSON.stringify(obj), { status, headers });
}

// Subir este número fuerza un cache miss inmediato en el próximo deploy (útil
// para invalidar una respuesta vieja sin esperar los 15 min de TTL, ej. justo
// después de corregir un error de fórmula en el Sheet).
const CACHE_VERSION = 4;

export async function onRequestGet(context) {
  // Cache en el borde de Cloudflare: sin importar cuántos miembros entren a la
  // vez, Google Sheets solo se consulta una vez cada 15 min en total (no una
  // vez por visita) -- esto es lo que evita repetir el problema de cuota que
  // tumbó el sitio en Netlify. Cache-Control de la respuesta define el TTL.
  // La clave es sintética (no la URL real) para poder invalidarla con CACHE_VERSION.
  const cache = caches.default;
  const cacheKey = new Request(`https://cache-key.internal/api-sheets-v${CACHE_VERSION}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    // Al cliente/CDN nunca se le manda Cache-Control público (ver más abajo por qué);
    // el hit de NUESTRO caché interno es lo único que decide si se sirve sin llamar
    // a Google Sheets, así que aquí solo reenviamos el cuerpo ya guardado.
    return new Response(cached.body, { status: cached.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  const SHEET_ID = context.env.SHEET_ID;
  const API_KEY = context.env.SHEETS_API_KEY;

  if (!SHEET_ID || !API_KEY) {
    return jsonResponse({ error: 'Falta SHEET_ID o SHEETS_API_KEY en variables de entorno.' }, 500);
  }
  try {
    const [rs, bd, dateRows, resumenRaw, componentesRaw] = await getRanges(SHEET_ID, API_KEY, [
      "'%RS'!A1:R260",   // ambos paneles
      "BD!1:60",         // cierres históricos para sparklines (filas completas: no depende
                         // de un límite de columna fijo, así crece solo al agregar ETFs)
      "'%RS'!D1:D6",     // fecha (celda exacta puede variar si se insertan filas arriba)
      "Resumen!A1:S150", // tabla resumen ordenable
      "'BD Tickers'!A:D" // componentes de cada ETF (top 10 por Peso en el mapa de burbujas);
                         // columnas completas porque aún se está llenando ETF por ETF
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
    const componentes = parseComponentes(componentesRaw);

    // Guardamos en nuestro caché interno CON Cache-Control público (la Cache API de
    // Workers exige eso para persistir la entrada), pero la respuesta que sale hacia
    // el cliente/CDN lleva no-store -- así Cloudflare nunca cachea por la URL real
    // (eso fue lo que dejaba la página pegada en datos viejos incluso subiendo
    // CACHE_VERSION: ese caché de borde no se invalida con nuestra clave sintética).
    const payload = { fecha, fuerzaRelativa, posicion, resumen, componentes };
    context.waitUntil(cache.put(cacheKey, jsonResponse(payload, 200, 'public, max-age=900')));
    return jsonResponse(payload, 200, 'no-store');
  } catch (err) {
    // Los errores (ej. cuota de Google agotada) no se cachean, para reintentar
    // en la próxima visita en vez de quedar pegado mostrando el error 15 min.
    return jsonResponse({ error: String(err.message || err) }, 502);
  }
}
