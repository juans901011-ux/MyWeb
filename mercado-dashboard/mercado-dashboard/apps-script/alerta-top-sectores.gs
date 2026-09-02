/**
 * Alerta diaria por correo: Top 10 ETFs por variación del Día (de mayor a menor).
 * Se pega en el editor de Apps Script del propio Google Sheet (Extensiones > Apps Script) —
 * corre sobre los mismos datos de la pestaña "Resumen" que usa el dashboard, sin backend
 * ni credenciales adicionales.
 *
 * Instalación (una sola vez):
 *   1. Abre el Sheet -> Extensiones -> Apps Script.
 *   2. Pega este archivo completo (reemplaza el contenido de Code.gs, o créalo aparte).
 *   3. Ajusta EMAIL_TO abajo si hace falta.
 *   4. Fija la zona horaria del proyecto en America/New_York:
 *      icono de engranaje "Project Settings" (barra izquierda) -> Time zone,
 *      o activa "Show appsscript.json" ahí mismo y pon "timeZone": "America/New_York".
 *   5. En el desplegable de funciones (arriba) elige "instalarTrigger" y dale a Ejecutar.
 *      La primera vez pedirá autorizar acceso a Gmail y al Sheet -> Revisar permisos ->
 *      elige tu cuenta -> Avanzado -> Ir a [nombre del proyecto] (no seguro) -> Permitir.
 *      Esto es normal: es tu propio script, no de un tercero.
 *   6. Listo. Se enviará solo, de lunes a viernes ~9:45-10:00am hora de Nueva York
 *      (Apps Script no garantiza el minuto exacto, solo una ventana aproximada de
 *      hasta 15 min). Sábado y domingo no hay envío (mercado cerrado, sin datos nuevos).
 *
 * Para probarlo ya, sin esperar al día siguiente: elige "enviarAlertaTopSectores"
 * en el desplegable de funciones y dale a Ejecutar.
 */

const EMAIL_TO = 'juans901011@gmail.com';
const SHEET_ID = '11gXWPBsWHIVnYa3vl_UHwEIcprH9WCcTbAVuN5V_G6E';
const HOJA = 'Resumen';
const TOP_N = 10;

// Convierte a número, aceptando dos formas que Apps Script puede devolver para
// la MISMA celda según cómo esté formateada en el Sheet:
//  - texto mostrado, ej. "100%" o "1,17%" (columna de texto)
//  - número crudo, ej. 1 o 0.0117 (columna numérica con formato de %) -- este es
//    el caso real en este Sheet: getValues() da el valor sin formatear, no el
//    texto que se ve en pantalla, así que hay que escalarlo x100 nosotros mismos.
function toNum_(s) {
  if (s === null || s === undefined || s === '') return null;
  if (typeof s === 'number') return s * 100;
  const n = parseFloat(String(s).replace('%', '').replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

// Normaliza encabezados quitando acentos y mayúsculas: evita que un copy/paste
// cambie la codificación Unicode de una tilde (ej. "Día") y rompa la comparación
// exacta de strings sin que se note.
function normKey_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase();
}

// Ubica el encabezado por contenido ("Ticker"), no por fila fija: si el Sheet
// crece (nuevos ETFs) e inserta filas arriba, esto sigue funcionando igual
// (mismo enfoque que netlify/functions/sheets.js).
function leerResumen_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(HOJA);
  if (!sheet) throw new Error('No existe la hoja "' + HOJA + '"');
  const values = sheet.getDataRange().getValues();

  const headerIdx = values.findIndex(row => row.some(c => normKey_(c) === 'ticker'));
  if (headerIdx === -1) throw new Error('No se encontró el encabezado "Ticker" en la hoja ' + HOJA);
  const header = values[headerIdx];
  const col = {};
  header.forEach((cell, i) => {
    const t = normKey_(cell);
    if (t) col[t] = i;
  });

  const rows = [];
  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i];
    const ticker = col['ticker'] != null ? String(row[col['ticker']]).trim() : '';
    if (!ticker) continue;
    rows.push({
      ticker,
      nombre: col['nombre'] != null ? String(row[col['nombre']]).trim() : '',
      rs: col['rs_sts%'] != null ? toNum_(row[col['rs_sts%']]) : null,
      dia: col['dia'] != null ? toNum_(row[col['dia']]) : null
    });
  }
  return rows;
}

function topSectores_() {
  const rows = leerResumen_();
  return rows
    .filter(r => r.dia != null)
    .sort((a, b) => b.dia - a.dia)
    .slice(0, TOP_N);
}

function construirHtml_(top) {
  const fecha = Utilities.formatDate(new Date(), 'America/New_York', "EEEE d 'de' MMMM, yyyy");
  const filas = top.map((r, i) => `
    <tr>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center">${i + 1}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;font-weight:bold">${r.ticker}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;color:#c0561f">${r.nombre}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;background:#d5f5e3">${r.rs}%</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;background:${r.dia >= 0 ? '#d5f5e3' : '#fadbd8'}">${r.dia > 0 ? '+' : ''}${r.dia.toFixed(2)}%</td>
    </tr>`).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px">
      <h2 style="background:#16285f;color:#fff;padding:8px 12px;margin:0">Top ${top.length} sectores fuertes — ${fecha}</h2>
      <p style="color:#555;font-size:12px;margin:6px 0">Ordenados por variación del día (de mayor a menor).</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead>
          <tr style="background:#e9ecef">
            <th style="padding:4px 8px;border:1px solid #ddd">#</th>
            <th style="padding:4px 8px;border:1px solid #ddd">Ticker</th>
            <th style="padding:4px 8px;border:1px solid #ddd">Nombre</th>
            <th style="padding:4px 8px;border:1px solid #ddd">RS_STS%</th>
            <th style="padding:4px 8px;border:1px solid #ddd">Día</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function enviarAlertaTopSectores() {
  const top = topSectores_();
  if (!top.length) {
    MailApp.sendEmail(EMAIL_TO,
      'Top sectores — sin datos disponibles',
      'Hoy no se pudo leer la variación del día para ningún sector/ETF (revisa si el Sheet tiene errores de fórmula).');
    return;
  }
  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: 'Top ' + top.length + ' sectores fuertes — ' + Utilities.formatDate(new Date(), 'America/New_York', 'dd/MM/yyyy'),
    htmlBody: construirHtml_(top)
  });
}

// Ejecutar UNA vez manualmente para instalar los disparadores (lunes a viernes).
// Si se corre de nuevo (ej. para cambiar la hora), borra los triggers anteriores primero.
function instalarTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarAlertaTopSectores')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Un trigger por día hábil: onWeekDay() no admite un rango lunes-viernes en una
  // sola llamada, así que se crean 5 triggers idénticos salvo el día.
  const diasHabiles = [
    ScriptApp.WeekDay.MONDAY,
    ScriptApp.WeekDay.TUESDAY,
    ScriptApp.WeekDay.WEDNESDAY,
    ScriptApp.WeekDay.THURSDAY,
    ScriptApp.WeekDay.FRIDAY
  ];
  diasHabiles.forEach(dia => {
    ScriptApp.newTrigger('enviarAlertaTopSectores')
      .timeBased()
      .onWeekDay(dia)
      .atHour(9)
      .nearMinute(45)
      .create();
  });
}
