# Dashboard de Mercado — "Descripción diaria del mercado"

Replica el dashboard del Excel (Fuerza Relativa + Posición en el mercado) en una web,
leyendo los datos en vivo desde Google Sheets vía la API v4. La API key queda oculta
detrás de una Cloudflare Pages Function (nunca llega al navegador).

Desplegado en: **https://mercado-dashboard-club.pages.dev**

## Estructura
```
mercado-dashboard/
├── index.html               Frontend (tablas, heatmap, sparklines SVG)
├── functions/api/sheets.js  Proxy a Google Sheets API (lee %RS, BD y Resumen)
├── apps-script/             Alerta diaria por correo (vive en el Sheet, aparte de este sitio)
├── .env.example
└── README.md
```

## Fuente de datos (en tu Sheet)
- Hoja **%RS**: paneles ya calculados.
  - Fuerza Relativa → col **D** (ticker), **E** (descripción), **J** (RS_STS%). Filas vacías = separador de grupo.
  - Posición → col **L** (ticker), **N** (RS%), **P** (1W pps), **R** (1M pps).
  - Fecha → **D2**.
- Hoja **BD**: cierres históricos → se toman los últimos 26 por ticker para el sparkline.

## Paso 1 — Probar el aspecto (sin backend)
Abre `index.html` con Live Server en VS Code. Carga con **datos de muestra** para que
confirmes que se ve como el Excel.

## Paso 2 — Conectar Google Sheets en vivo
1. **Comparte el Sheet** como "Cualquiera con el enlace: Lector".
2. En Google Cloud Console: crea/usa un proyecto → habilita **Google Sheets API** →
   crea una **API key** (restríngela a la Sheets API; opcional restringir por referente HTTP).
3. Copia `.env.example` a `.dev.vars` y completa `SHEET_ID` y `SHEETS_API_KEY`
   (`.dev.vars` es el equivalente de `.env` que usa Wrangler en local).
   - `SHEET_ID` es lo que va entre `/d/` y `/edit` en la URL del Sheet.
4. Corre local con Wrangler (CLI de Cloudflare):
   ```bash
   npx wrangler pages dev . --port 8788   # sirve el sitio + la función en /api/sheets
   ```
   El frontend detecta la función automáticamente y reemplaza la muestra por datos reales.

## Paso 3 — Desplegar
```bash
npx wrangler login                                     # una sola vez
npx wrangler pages project create mercado-dashboard-club
npx wrangler pages secret put SHEET_ID --project-name=mercado-dashboard-club
npx wrangler pages secret put SHEETS_API_KEY --project-name=mercado-dashboard-club
npx wrangler pages deploy . --project-name=mercado-dashboard-club --branch=main
```
Para desplegar de nuevo tras un cambio, basta con el último comando (`wrangler pages deploy ...`).

## Alerta diaria por correo (Top sectores)
`apps-script/alerta-top-sectores.gs` es un Google Apps Script independiente (no corre en
este sitio) que envía un correo diario ~10:00am hora de Nueva York con el Top 10 de ETFs con
RS_STS% > 90%, ordenados por variación del Día. Se pega directo en el editor de Apps Script
del propio Google Sheet — instrucciones de instalación en los comentarios del archivo.

## Notas
- Si los nombres de las pestañas no son exactamente `%RS` y `BD`, ajústalos en `functions/api/sheets.js`.
- El color de las celdas (heatmap) y los sparklines se generan en el cliente; no se usa Chart.js.
- Cache de 15 min en la función (misma cadencia con la que actualiza Google Finance) para no golpear la API en cada visita.
- Migrado de Netlify a Cloudflare Pages (agosto 2026) porque la cuenta de Netlify se quedó
  sin minutos/tokens de build. La función y el frontend son funcionalmente idénticos; solo
  cambió el formato del backend (Netlify Functions → Cloudflare Pages Functions) y la ruta
  del endpoint (`/.netlify/functions/sheets` → `/api/sheets`).
