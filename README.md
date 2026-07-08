# SKIWEATHER – Snow Forecast Map

A Vercel-ready snowsports weather forecasting app.

## Features

- Interactive map forecast picker
- Header search for places, towns, mountains and general locations
- Remembers the last forecast location and opens there on reload
- Esri World Topographic Map with hillshade overlay
- OpenStreetMap street basemap
- Basemap selection through the Leaflet control in the top-right of the map
- Ski resort marker layer with clickable mountain icons
- Resort icons are hidden/limited at low zoom levels to avoid map clutter
- Forecast model selector:
  - Open-Meteo Best Match
  - ECMWF IFS
  - DWD ICON Seamless
- Premium view enabled by default
- Free/Premium test toggle
- 16-day premium forecast view
- Archive view for recent past conditions
- Combined or split charts
- Estimated snowfall in cm using a temperature/snowline-based snow-to-liquid ratio
- Wind and Cloud Base are unticked by default
- Chart layer selections are remembered in browser localStorage
- Black chart hover tooltip with white text
- Chart tooltip excludes the `0°C: 0` line
- Saved spots and localStorage demo accounts

## Ski resort marker data

The app includes a seeded ski-resort marker dataset in `src/ski-resorts.js`.

The source page requested by the project lists 6,109 ski resorts worldwide, but the public page text available to this build does not expose latitude/longitude coordinates for all entries. The map therefore uses a practical seeded marker layer that can be expanded with more coordinates over time.

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

## Notes

- This is a frontend demo. Accounts and saved spots are stored in browser `localStorage` only.
- Forecast data comes from Open-Meteo APIs.
- Place search uses public OpenStreetMap/Nominatim search.
- Snowline is approximated from `freezing_level_height` where available, otherwise from 2 m temperature plus a standard lapse-rate calculation.
- Snowfall is an estimate of settled snow depth. It converts liquid precipitation into approximate cm using temperature, snowline and a snow-to-liquid ratio. It is not observed snow depth.
