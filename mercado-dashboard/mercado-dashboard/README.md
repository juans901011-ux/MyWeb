# Dashboard de Mercado — "Descripción diaria del mercado"

Replica el dashboard del Excel (Fuerza Relativa + Posición en el mercado) en una web,
leyendo los datos en vivo desde Google Sheets vía la API v4. La API key queda oculta
detrás de una Netlify Function (nunca llega al navegador).

## Estructura
```
mercado-dashboard/
├── index.html                  Frontend (tablas, heatmap, sparklines SVG)
├── netlify/functions/sheets.js Proxy a Google Sheets API (lee %RS y BD)
├── netlify.toml
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
3. Copia `.env.example` a `.env` y completa `SHEET_ID` y `SHEETS_API_KEY`.
   - `SHEET_ID` es lo que va entre `/d/` y `/edit` en la URL del Sheet.
4. Corre local con Netlify CLI:
   ```bash
   npm i -g netlify-cli      # si no lo tienes
   netlify dev               # sirve el sitio + la función en /.netlify/functions/sheets
   ```
   El frontend detecta la función automáticamente y reemplaza la muestra por datos reales.

## Paso 3 — Desplegar
```bash
netlify deploy --prod
```
Carga `SHEET_ID` y `SHEETS_API_KEY` en **Site settings → Environment variables** de Netlify.

## Notas
- Si los nombres de las pestañas no son exactamente `%RS` y `BD`, ajústalos en `netlify/functions/sheets.js`.
- El color de las celdas (heatmap) y los sparklines se generan en el cliente; no se usa Chart.js.
- Cache de 5 min en la función para no golpear la API en cada visita.
