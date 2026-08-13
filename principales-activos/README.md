# Principales Activos — Club de Inversionistas

Tabla de los activos macro principales (SPY, DIA, QQQ, IWM, GLD, TLT, UUP, GBTC, USO)
y los 11 sectores del S&P 500 (XLE, XLV, XLRE, XLF, XLP, XLI, XLU, XLB, XLC, XLY, XLK),
leyendo en vivo desde la pestaña **Dashboard** del Google Sheet **"Seguimiento 2026"**
vía la API v4. La API key queda oculta detrás de una Netlify Function (nunca llega
al navegador).

Este proyecto se separó de `mercado-dashboard` (que sigue con sus propias pestañas
de Fuerza Relativa / Resumen / Mapa RS × Día) para trabajarse de forma independiente.

## Estructura
```
principales-activos/
├── index.html                  Frontend (una sola tabla, sin pestañas)
├── netlify/functions/sheets.js Proxy a Google Sheets API (lee la pestaña Dashboard)
├── netlify.toml
├── .env.example
└── README.md
```

## Fuente de datos (en el Sheet "Seguimiento 2026")
Pestaña **Dashboard**, columnas: Ticker, Nombre, High 52, YTD, Mes, Semana, Día.
Se omiten las columnas "2023" y "Enero" del Sheet porque tienen errores de fórmula
(`#REF!` / `#N/A`) en el origen.

Los tickers a mostrar están fijos en `PRINCIPALES_TICKERS` dentro de
`netlify/functions/sheets.js` (dos grupos: activos y sectores). Si cambian los
tickers de interés, se edita esa lista.

## Correr local
```bash
npm i -g netlify-cli      # si no lo tienes
netlify dev               # sirve el sitio + la función en /.netlify/functions/sheets
```
Copia `.env.example` a `.env` y completa `SHEET_ID` (el de "Seguimiento 2026") y
`SHEETS_API_KEY` antes de correr `netlify dev`.

## Desplegar
```bash
netlify deploy --prod
```
Carga `SHEET_ID` y `SHEETS_API_KEY` en **Site settings → Environment variables** de Netlify.

## Notas
- Cache de 15 min en la función, misma cadencia que `mercado-dashboard`.
- El color de las celdas se genera en el cliente, relativo al máximo de cada columna
  (igual que el formato condicional por columna de Excel); no se usa Chart.js.
