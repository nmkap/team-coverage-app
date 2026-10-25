/* Team Coverage App – settings you may need to change. */

export const CONFIG = {
  // Free CARTO basemap key (request one at https://carto.com/basemaps/).
  // Since Sept 2026 CARTO raster tiles need a key. Until you add one, the map
  // falls back to OpenStreetMap tiles darkened with a CSS filter.
  cartoKey: '',

  // Drive-time service. The OSRM demo server needs no key but is best-effort:
  // fine for the demo, swap for OpenRouteService (via a proxy) for daily use.
  osrmUrl: 'https://router.project-osrm.org',

  // Used only when the drive-time service can't be reached.
  fallback: { roadFactor: 1.3, avgMph: 38 },
};
