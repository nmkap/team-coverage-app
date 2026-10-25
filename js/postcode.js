/* Postcode validation and lookup (postcodes.io, free, no key). */

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

export const isValidPostcode = (value) => POSTCODE_RE.test(value.trim());

/** "bs14dj" → "BS1 4DJ". Call only on valid input. */
export function normalisePostcode(value) {
  const [, outward, inward] = value.trim().toUpperCase().match(POSTCODE_RE);
  return `${outward} ${inward}`;
}

const cache = new Map();

/**
 * Look up a full UK postcode.
 * Resolves to { postcode, lat, lng, region, district } or null if it doesn't exist.
 * Rejects if the service can't be reached.
 */
export async function lookupPostcode(postcode) {
  if (cache.has(postcode)) return cache.get(postcode);

  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`postcodes.io responded ${res.status}`);

  const { result } = await res.json();
  const place = {
    postcode: result.postcode,
    lat: result.latitude,
    lng: result.longitude,
    region: result.region || result.country,
    // postcodes.io returns e.g. "Bristol, City of" – tidy to "Bristol"
    district: (result.admin_district || '').replace(/, City of$/, ''),
  };
  cache.set(postcode, place);
  return place;
}
