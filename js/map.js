/* Leaflet map: tiles, team pins, customer pin, route and popup. */
import { CONFIG } from './config.js';

const UK_BOUNDS = [[49.9, -6.6], [58.7, 1.9]];
const ACCENT = '#F4B445';

export const initials = (name) => name.split(' ').map((p) => p[0]).join('');

export function createMap(el, { onPinClick }) {
  const map = L.map(el, { zoomControl: false }).fitBounds(UK_BOUNDS);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  addTiles(map);

  const teamLayer = L.layerGroup().addTo(map);
  const resultLayer = L.layerGroup().addTo(map);
  const pins = new Map();

  const pinIcon = (member, state = '') =>
    L.divIcon({
      className: '',
      html: `<div class="pin ${state}">${initials(member.name)}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

  return {
    invalidate: () => map.invalidateSize(),

    showMembers(members) {
      teamLayer.clearLayers();
      pins.clear();
      members.forEach((m) => {
        const marker = L.marker([m.baseLat, m.baseLng], { icon: pinIcon(m), title: m.name, keyboard: true })
          .on('click', () => onPinClick(m.id))
          .addTo(teamLayer);
        pins.set(m.id, { marker, member: m });
      });
    },

    reset() {
      resultLayer.clearLayers();
      pins.forEach(({ marker, member }) => marker.setIcon(pinIcon(member)));
      map.flyToBounds(UK_BOUNDS, { duration: 0.8 });
    },

    /** Highlight one member, draw the journey, open the popup on the customer. */
    showResult({ customer, member, path, popupHtml, animate }) {
      pins.forEach(({ marker, member: m }) => {
        marker.setIcon(pinIcon(m, m.id === member.id ? 'on' : 'dim'));
        marker.setZIndexOffset(m.id === member.id ? 1000 : 0);
      });

      resultLayer.clearLayers();
      const straight = !path;
      const line = path || [[member.baseLat, member.baseLng], [customer.lat, customer.lng]];
      L.polyline(line, { color: ACCENT, weight: 10, opacity: 0.18, interactive: false }).addTo(resultLayer);
      L.polyline(line, {
        color: ACCENT,
        weight: 3,
        lineCap: 'round',
        dashArray: straight ? '2 9' : null,
        className: 'route',
        interactive: false,
      }).addTo(resultLayer);

      const home = L.marker([customer.lat, customer.lng], {
        icon: L.divIcon({ className: '', html: '<div class="home"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 2000,
        title: 'Customer',
      }).addTo(resultLayer);
      home.bindPopup(popupHtml, { autoPan: false, closeButton: false, offset: [0, -6] });

      map.once('moveend', () => home.openPopup());
      map.flyToBounds(L.latLngBounds(line), {
        paddingTopLeft: [80, 180],
        paddingBottomRight: [80, 60],
        maxZoom: 11,
        duration: animate ? 1.4 : 0.8,
      });
    },

    /** Swap a straight placeholder line for the real road route once it arrives. */
    replaceRoute(path) {
      resultLayer.eachLayer((layer) => {
        if (layer instanceof L.Polyline) {
          layer.setLatLngs(path);
          layer.setStyle({ dashArray: null });
        }
      });
    },
  };
}

/* CARTO dark tiles when a key is set; otherwise darkened OpenStreetMap tiles. */
function addTiles(map) {
  const osm = () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'tiles-darkened',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Routing <a href="https://project-osrm.org/">OSRM</a>',
    });

  if (!CONFIG.cartoKey) {
    osm().addTo(map);
    return;
  }

  const carto = L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CONFIG.cartoKey}`, {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · Routing <a href="https://project-osrm.org/">OSRM</a>',
  }).addTo(map);

  // If the key is wrong or CARTO is down, fall back rather than show a blank map.
  let errors = 0;
  carto.on('tileerror', () => {
    if (++errors === 6) {
      console.warn('CARTO tiles failing, switching to OpenStreetMap.');
      map.removeLayer(carto);
      osm().addTo(map);
    }
  });
}
