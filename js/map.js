/* Leaflet map: tiles, team pins, customer pin, route and popup. */
import { CONFIG } from './config.js';

const UK_BOUNDS = [[49.9, -6.6], [58.7, 1.9]];
const ACCENT = '#F4B445';

export const initials = (name) => name.split(' ').map((p) => p[0]).join('');

/* Framing: keep the UK clear of the landing text or the floating panel. */
const isDesktop = () => matchMedia('(min-width: 761px)').matches;
const landingView = () =>
  isDesktop()
    ? { paddingTopLeft: [Math.round(innerWidth * 0.48), 40], paddingBottomRight: [40, 40] }
    : { padding: [20, 20] };
const appView = () =>
  isDesktop()
    ? { paddingTopLeft: [420, 40], paddingBottomRight: [40, 40] }
    : { padding: [20, 20] };
const routeView = () =>
  isDesktop()
    ? { paddingTopLeft: [380 + 80, 170], paddingBottomRight: [80, 60] }
    : { paddingTopLeft: [80, 180], paddingBottomRight: [80, 60] };

export function createMap(el, { onPinClick }) {
  const map = L.map(el, { zoomControl: false }).fitBounds(UK_BOUNDS, landingView());
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  addTiles(map);

  const teamLayer = L.layerGroup().addTo(map);
  const resultLayer = L.layerGroup().addTo(map);
  const previewLayer = L.layerGroup().addTo(map);
  const pins = new Map();
  let landingUp = true;

  // Result framing state: the customer pin is reused between the early fly-in and the final result
  let home = null;
  let focusedOn = null; // postcode the map is already flying towards
  let resultToken = 0;  // ignores stale moveend callbacks
  let moving = false;
  map.on('movestart', () => { moving = true; }).on('moveend', () => { moving = false; });

  const clearResultLayer = () => {
    resultLayer.clearLayers();
    home = null;
    focusedOn = null;
    resultToken++;
  };

  const placeHome = (customer) => {
    if (home?.postcode === customer.postcode) return home;
    if (home) resultLayer.removeLayer(home);
    home = L.marker([customer.lat, customer.lng], {
      icon: L.divIcon({ className: '', html: '<div class="home"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 2000,
      title: 'Customer',
    }).addTo(resultLayer);
    home.postcode = customer.postcode;
    return home;
  };

  /** True if the bounds already sit inside the result framing at roughly the right zoom. */
  const fitsView = (bounds) => {
    const { paddingTopLeft: tl, paddingBottomRight: br } = routeView();
    const size = map.getSize();
    const inner = L.latLngBounds(
      map.containerPointToLatLng([tl[0] - 60, tl[1] - 60]),
      map.containerPointToLatLng([size.x - br[0] + 40, size.y - br[1] + 40]),
    );
    const targetZoom = Math.min(11, map.getBoundsZoom(bounds, false, L.point(tl).add(br)));
    return inner.contains(bounds) && targetZoom - map.getZoom() < 0.75;
  };

  const showPreview = (team) => {
    previewLayer.clearLayers();
    team.forEach((m) =>
      L.marker([m.baseLat, m.baseLng], {
        icon: L.divIcon({ className: '', html: '<div class="dot"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }),
        interactive: false,
        keyboard: false,
      }).addTo(previewLayer),
    );
  };

  // Re-fit only if the size differs from the last landing framing, so this can't interrupt
  // the fly back from showLanding. (Leaflet's own window-resize handler may already have run.)
  let framedSize = map.getSize();
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      map.invalidateSize({ pan: false });
      if (landingUp && !framedSize.equals(map.getSize())) {
        framedSize = map.getSize();
        map.fitBounds(UK_BOUNDS, { ...landingView(), animate: false });
      }
    }, 120);
  }).observe(el);

  const pinIcon = (member, state = '') =>
    L.divIcon({
      className: '',
      html: `<div class="pin ${state}">${initials(member.name)}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

  return {
    invalidate: () => map.invalidateSize(),

    showPreview,

    hidePreview() {
      landingUp = false;
      previewLayer.clearLayers();
    },

    /** Back to the landing: no pins or route, preview dots restored, UK right of the text. */
    showLanding(team) {
      landingUp = true;
      teamLayer.clearLayers();
      pins.clear();
      clearResultLayer();
      showPreview(team);
      map.invalidateSize({ pan: false });
      framedSize = map.getSize();
      map.flyToBounds(UK_BOUNDS, { ...landingView(), duration: 0.9 });
    },

    /** On mobile the map shrinks during the reveal, so the UK has to be re-framed afterwards. */
    refitAfterReveal() {
      map.invalidateSize({ pan: false });
      if (!isDesktop()) map.flyToBounds(UK_BOUNDS, { ...appView(), duration: 0.5 });
    },

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
      clearResultLayer();
      pins.forEach(({ marker, member }) => marker.setIcon(pinIcon(member)));
      map.flyToBounds(UK_BOUNDS, { ...appView(), duration: 0.8 });
    },

    /**
     * Start flying towards the customer and a best-guess nearest member as soon as the postcode
     * resolves, so the map is already moving while drive times load.
     */
    focus(customer, member) {
      resultLayer.eachLayer((layer) => layer instanceof L.Polyline && resultLayer.removeLayer(layer));
      placeHome(customer).closePopup();
      focusedOn = customer.postcode;
      resultToken++;
      map.flyToBounds(L.latLngBounds([[member.baseLat, member.baseLng], [customer.lat, customer.lng]]), {
        ...routeView(),
        maxZoom: 11,
        duration: 1.4,
      });
    },

    /** Highlight one member, draw the journey, open the popup on the customer. */
    showResult({ customer, member, path, popupHtml, animate }) {
      pins.forEach(({ marker, member: m }) => {
        marker.setIcon(pinIcon(m, m.id === member.id ? 'on' : 'dim'));
        marker.setZIndexOffset(m.id === member.id ? 1000 : 0);
      });

      resultLayer.eachLayer((layer) => layer instanceof L.Polyline && resultLayer.removeLayer(layer));
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

      const pin = placeHome(customer);
      pin.unbindPopup().bindPopup(popupHtml, { autoPan: false, closeButton: false, offset: [0, -6] });

      const bounds = L.latLngBounds(line);
      const token = ++resultToken;
      const flyTo = (duration) => {
        map.once('moveend', () => token === resultToken && pin.openPopup());
        map.flyToBounds(bounds, { ...routeView(), maxZoom: 11, duration });
      };

      // Already flying here from focus(): let that flight finish, then only nudge if needed.
      if (animate && focusedOn === customer.postcode) {
        focusedOn = null;
        const settle = () => {
          if (token !== resultToken) return;
          if (fitsView(bounds)) pin.openPopup();
          else flyTo(0.6);
        };
        if (moving) map.once('moveend', settle);
        else settle();
        return;
      }
      focusedOn = null;
      flyTo(animate ? 1.4 : 0.8);
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
      updateWhenZooming: false, // load tiles once a flight lands, not at every intermediate zoom
      keepBuffer: 4,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Routing <a href="https://project-osrm.org/">OSRM</a>',
    });

  if (!CONFIG.cartoKey) {
    osm().addTo(map);
    return;
  }

  const carto = L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CONFIG.cartoKey}`, {
    subdomains: 'abcd',
    maxZoom: 19,
    updateWhenZooming: false,
    keepBuffer: 4,
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
