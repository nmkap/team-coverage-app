# Team Coverage App

A lightweight browser tool for booking field jobs against the right team. Select whether you need an **installer** or a **surveyor**, enter the customer's postcode, and the app geocodes that location, ranks your covering teams by estimated drive time, and plots them on an interactive map powered by Leaflet. Pick the top available team, tap through to **TeamUp** to confirm their availability, and book the job — all without leaving the browser.

## Tech stack

- HTML5 / CSS3 / Vanilla JavaScript (no framework, no build step)
- [Leaflet](https://leafletjs.com/) for interactive maps
- Hosted on **GitHub Pages** from the `main` branch root
- [postcodes.io](https://postcodes.io/) for postcode lookup (free, no key)
- [OSRM](https://project-osrm.org/) demo server for drive times and routes (free, no key, best-effort)
- CARTO dark basemap when a key is set in `js/config.js`, otherwise darkened OpenStreetMap tiles

## Project structure

| File | Purpose |
|---|---|
| `js/app.js` | UI flow: role picker, postcode input, list, selection |
| `js/postcode.js` | Postcode validation and lookup |
| `js/distance.js` | Drive times and routes. Swap the provider here without touching the UI. Falls back to estimates if the service is down. |
| `js/map.js` | Leaflet map, pins, route line, popup |
| `js/config.js` | Map key and service URLs |
| `data/teams.json` | Dummy team data |

## Run locally

The app uses ES modules, so open it through a local server rather than double-clicking `index.html`:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

## Docs

- [User flow diagram](docs/user-flow.mmd) — Mermaid source
- [FigJam user flow board](https://www.figma.com/board/kATGd4IjgdBoLFgsWFreCd/TeamCoverage)
