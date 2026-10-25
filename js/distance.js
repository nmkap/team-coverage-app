/*
 * Drive times between the customer and team members.
 *
 * The rest of the app only calls getDriveTimes() and getRoute(), so the
 * provider can be swapped (e.g. OpenRouteService behind a proxy) without
 * touching the UI.
 */
import { CONFIG } from './config.js';

const METRES_PER_MILE = 1609.344;

/**
 * @param {{lat:number,lng:number}} origin  customer location
 * @param {Array<{id:string,baseLat:number,baseLng:number}>} members
 * @returns {Promise<{estimated:boolean, results:Map<string,{miles:number, mins:number}>}>}
 */
export async function getDriveTimes(origin, members) {
  try {
    return { estimated: false, results: await osrmTable(origin, members) };
  } catch (err) {
    console.warn('Drive-time service unavailable, using estimates.', err);
    return { estimated: true, results: estimate(origin, members) };
  }
}

/**
 * Road geometry for one journey, as [[lat,lng], ...].
 * Resolves to null if unavailable (caller draws a straight line instead).
 */
export async function getRoute(from, to) {
  try {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const res = await fetch(`${CONFIG.osrmUrl}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, {
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    if (data.code !== 'Ok') return null;
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch {
    return null;
  }
}

/* ---------- OSRM table: one request, customer → every member ---------- */
async function osrmTable(origin, members) {
  // OSRM wants longitude,latitude. Index 0 is the customer.
  const points = [origin, ...members.map((m) => ({ lat: m.baseLat, lng: m.baseLng }))]
    .map((p) => `${p.lng},${p.lat}`)
    .join(';');
  const url = `${CONFIG.osrmUrl}/table/v1/driving/${points}?sources=0&annotations=duration,distance`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM: ${data.code}`);

  const [durations] = data.durations; // seconds
  const [distances] = data.distances; // metres
  const results = new Map();
  members.forEach((m, i) => {
    const secs = durations[i + 1];
    const metres = distances[i + 1];
    if (secs == null || metres == null) return; // unreachable by road (e.g. islands)
    results.set(m.id, {
      miles: Math.round(metres / METRES_PER_MILE),
      mins: Math.round(secs / 60),
    });
  });
  if (!results.size) throw new Error('OSRM returned no routes');
  return results;
}

/* ---------- Fallback: straight line × road factor ---------- */
function estimate(origin, members) {
  const { roadFactor, avgMph } = CONFIG.fallback;
  const results = new Map();
  members.forEach((m) => {
    const road = haversineMiles(origin, { lat: m.baseLat, lng: m.baseLng }) * roadFactor;
    results.set(m.id, {
      miles: Math.round(road),
      mins: Math.max(5, Math.round(((road / avgMph) * 60) / 5) * 5),
    });
  });
  return results;
}

export function haversineMiles(a, b) {
  const R = 3958.8;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "1 h 39 min" / "56 min" */
export function formatDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
