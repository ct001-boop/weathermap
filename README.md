# SKIWEATHER – Snow Forecast Map

A Vercel-ready snowsports weather forecasting app.

## Features

- Interactive map forecast picker
- Esri World Topographic Map with hillshade overlay
- OpenStreetMap street basemap
- Optional Google Terrain basemap using the official Google Maps JavaScript API
- Forecast model selector:
  - Open-Meteo Best Match
  - ECMWF IFS
  - DWD ICON Seamless
- Premium view enabled by default
- Free/Premium test toggle
- 16-day premium forecast view
- Archive view for recent past conditions
- Combined or split charts
- Wind and Cloud Base are unticked by default
- Black chart hover tooltip with white text
- Chart tooltip excludes the `0°C: 0` line
- Saved spots and localStorage demo accounts

## Deploy to Vercel

1. Upload this folder to a GitHub repository.
2. Go to Vercel.
3. Add New Project.
4. Import the GitHub repository.
5. Vercel should detect Vite automatically.
6. Build command: `npm run build`
7. Output directory: `dist`
8. Deploy.

## Local preview

```bash
npm install
npm run dev
```

Then open the local URL shown in the terminal.

## Google Terrain setup

Google Terrain requires a Google Maps JavaScript API key.

For a quick demo:

1. Open the app.
2. Select `Google Terrain` from the Basemap dropdown.
3. Paste your Google Maps JavaScript API key into the Map panel.
4. Click `Save Google key`.

For production, restrict the key in Google Cloud Console to your Vercel domain and localhost for testing.

## Notes

- This is a frontend demo. Accounts and saved spots are stored in browser `localStorage` only.
- Forecast data comes from Open-Meteo APIs.
- Snowline is approximated from `freezing_level_height` where available, otherwise from 2 m temperature plus a standard lapse-rate calculation.
