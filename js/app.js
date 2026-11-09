/* Team Coverage App – UI flow: pick role → enter postcode → nearest team highlighted. */
import { isValidPostcode, normalisePostcode, lookupPostcode } from './postcode.js';
import { getDriveTimes, getRoute, formatDuration, haversineMiles } from './distance.js';
import { createMap, initials } from './map.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ui = {
  landing: $('#landing'),
  landingCount: $('#landing-count'),
  restart: $('#restart'),
  input: $('#postcode'),
  field: $('#postcode-field'),
  hint: $('#postcode-hint'),
  list: $('#team-list'),
  listTitle: $('#list-title'),
  listSort: $('#list-sort'),
  mapEmpty: $('#map-empty'),
  footnote: $('#footnote'),
};

const state = {
  team: [],
  role: null,
  customer: null, // { postcode, lat, lng, region, district }
  ranked: null,   // members sorted by drive time, each with { miles, mins }
  estimated: false,
  activeId: null,
  searchId: 0,    // guards against out-of-order responses
};
const routeCache = new Map();    // "memberId|postcode" → road path
const routeRequests = new Map(); // same key → in-flight request, so a route is only fetched once

/** Fetch (once) and cache the road route for a member → customer journey. */
function fetchRoute(member, customer) {
  const key = `${member.id}|${customer.postcode}`;
  if (routeCache.has(key)) return Promise.resolve(routeCache.get(key));
  if (!routeRequests.has(key)) {
    const req = getRoute({ lat: member.baseLat, lng: member.baseLng }, customer).then((path) => {
      routeRequests.delete(key);
      if (path) routeCache.set(key, path);
      return path;
    });
    routeRequests.set(key, req);
  }
  return routeRequests.get(key);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const map = createMap($('#map'), { onPinClick: (id) => state.ranked && select(id, true) });

init();

async function init() {
  try {
    const res = await fetch('data/teams.json');
    state.team = await res.json();
  } catch (err) {
    ui.landingCount.textContent = "Couldn't load team data. Open the app through a web server, not as a file.";
    console.error(err);
    return;
  }
  renderStats();
  map.showPreview(state.team);
  bindEvents();
}

/* ---------- Landing stats ---------- */
function renderStats() {
  const surveyors = state.team.filter((m) => m.role !== 'installer').length;
  const installers = state.team.filter((m) => m.role !== 'surveyor').length;
  ui.landingCount.innerHTML = `
    <span class="stat" data-role="surveyor"><b data-to="${surveyors}">0</b> surveyors</span>
    <span class="sep" aria-hidden="true"></span>
    <span class="stat" data-role="installer"><b data-to="${installers}">0</b> installers</span>
    <span class="sep" aria-hidden="true"></span>
    <span class="live">UK-wide coverage</span>`;
  countUp(ui.landingCount.querySelectorAll('b[data-to]'));
}

/** Numbers tick from 0 to their value over 900ms (ease-out cubic); jump straight there with reduced motion. */
function countUp(els, duration = 900) {
  const targets = [...els].map((el) => Number(el.dataset.to));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((el, i) => { el.textContent = targets[i]; });
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - t) ** 3;
    els.forEach((el, i) => { el.textContent = Math.round(targets[i] * eased); });
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function bindEvents() {
  let revealTimer;
  document.querySelectorAll('.role-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.classList.add('picked');
      map.hidePreview();
      setRole(btn.dataset.role);
      revealTimer = setTimeout(() => {
        ui.landing.classList.add('is-gone');
        document.body.classList.add('ready');
        ui.landing.setAttribute('aria-hidden', 'true');
        revealTimer = setTimeout(() => {
          if (state.customer) map.invalidate(); else map.refitAfterReveal();
          ui.input.focus();
        }, 900);
      }, 180);
    }),
  );

  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));

  let timer;
  ui.restart.addEventListener('click', () => {
    clearTimeout(timer);
    clearTimeout(revealTimer);
    document.querySelectorAll('.role-btn').forEach((b) => b.classList.remove('picked'));
    ui.landing.classList.remove('is-gone');
    ui.landing.removeAttribute('aria-hidden');
    document.body.classList.remove('ready');
    ui.input.value = '';
    ui.field.classList.remove('valid');
    setHint('');
    state.role = null; // before clearResult, which re-applies any role still set
    clearResult();
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    ui.list.innerHTML = '';
    map.showLanding(state.team);
    document.querySelector('.role-btn').focus();
  });

  ui.input.addEventListener('input', () => {
    clearTimeout(timer);
    const value = ui.input.value.trim();
    ui.field.classList.remove('valid');
    if (!value) { setHint(''); clearResult(); return; }
    if (!isValidPostcode(value)) {
      setHint(value.replace(/\s/g, '').length >= 6 ? "That doesn't look like a full UK postcode yet." : '');
      return;
    }
    setHint('');
    timer = setTimeout(() => search(normalisePostcode(value)), 200);
  });
}

/* ---------- Role ---------- */
const membersForRole = () => state.team.filter((m) => m.role === state.role || m.role === 'both');

function setRole(role) {
  state.role = role;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)));
  ui.listTitle.textContent = role === 'surveyor' ? 'Surveyors' : 'Installers';
  map.showMembers(membersForRole());
  if (state.customer) {
    rank();
  } else {
    renderList();
    map.reset();
  }
}

/* ---------- Search ---------- */
async function search(postcode) {
  const id = ++state.searchId;
  setLoading(true);
  let place;
  try {
    place = await lookupPostcode(postcode);
  } catch {
    if (id !== state.searchId) return;
    setLoading(false);
    setHint("Couldn't reach the postcode service. Check your connection and try again.", true);
    return;
  }
  if (id !== state.searchId) return;
  if (!place) {
    setLoading(false);
    setHint(`We couldn't find ${postcode}. Check it and try again.`, true);
    return;
  }
  ui.input.value = place.postcode;
  state.customer = place;

  // Start moving straight away towards the nearest member as the crow flies (usually the real
  // nearest too), and fetch that road route while drive times load.
  const guess = nearestByAir(place);
  if (guess) {
    map.focus(place, guess);
    fetchRoute(guess, place);
  }
  await rank(id, true);
}

async function rank(id = ++state.searchId, fromSearch = false) {
  setLoading(true);
  const members = membersForRole();
  const { estimated, results } = await getDriveTimes(state.customer, members);
  if (id !== state.searchId) return;
  setLoading(false);
  ui.field.classList.add('valid');

  state.estimated = estimated;
  state.ranked = members
    .filter((m) => results.has(m.id))
    .map((m) => ({ ...m, ...results.get(m.id) }))
    .sort((a, b) => a.mins - b.mins);
  ui.footnote.textContent = estimated
    ? 'Live drive times are unavailable, so these are estimates.'
    : 'Drive times are without traffic. Allow extra at busy times.';
  ui.mapEmpty.hidden = true;

  if (!state.ranked.length) {
    setHint('No one in this role can reach that postcode by road.', true);
    return;
  }
  // After a new search, give the road route a moment so the line lands once instead of swapping mid-flight.
  if (fromSearch) {
    await Promise.race([fetchRoute(state.ranked[0], state.customer), wait(600)]);
    if (id !== state.searchId) return;
  }
  select(state.ranked[0].id, false);
}

function nearestByAir(place) {
  let best = null;
  let bestMiles = Infinity;
  membersForRole().forEach((m) => {
    const miles = haversineMiles(place, { lat: m.baseLat, lng: m.baseLng });
    if (miles < bestMiles) { best = m; bestMiles = miles; }
  });
  return best;
}

/* ---------- Selection ---------- */
function select(id, fromUser) {
  state.activeId = id;
  const member = state.ranked.find((m) => m.id === id);
  if (!member) return;
  renderList();
  const row = ui.list.querySelector(`[data-id="${id}"]`);
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const { customer } = state;
  const key = `${id}|${customer.postcode}`;
  map.showResult({
    customer,
    member,
    path: routeCache.get(key) || null,
    popupHtml: popupHtml(customer, member),
    animate: !fromUser,
  });

  if (!routeCache.has(key)) {
    fetchRoute(member, customer).then((path) => {
      if (path && state.activeId === id && state.customer === customer) map.replaceRoute(path);
    });
  }
}

function popupHtml(customer, member) {
  const nearest = member.id === state.ranked[0].id;
  return `
    <div class="pop">
      <div class="pop-region">${esc(customer.region)}</div>
      <div class="pop-area">${esc(customer.district)} · ${esc(customer.postcode.split(' ')[0])}</div>
      <div class="pop-who">
        <span class="avatar">${esc(initials(member.name))}</span>
        <div><b>${esc(member.name)}</b><span>${distanceText(member)}${nearest ? ' · nearest' : ''}</span></div>
      </div>
    </div>`;
}

const distanceText = (m) => `${m.miles} mi · ${state.estimated ? '~' : ''}${formatDuration(m.mins)}`;

/* ---------- List ---------- */
function renderList() {
  const ranked = !!state.ranked;
  const data = state.ranked || [...membersForRole()].sort((a, b) => a.name.localeCompare(b.name));
  ui.listSort.textContent = ranked ? 'Nearest first' : 'A–Z';
  ui.list.classList.toggle('ranked', ranked);

  ui.list.innerHTML = data
    .map((m, i) => {
      const active = m.id === state.activeId;
      return `
      <li>
        <button class="member${active ? ' is-active' : ''}" data-id="${esc(m.id)}" ${ranked ? '' : 'disabled'} aria-current="${active}">
          <span class="avatar">${esc(initials(m.name))}</span>
          <span class="member-text">
            <span class="name">${esc(m.name)}</span>
            <span class="meta">${esc(m.town)} · ${esc(m.basePostcode)}${m.role === 'both' ? ' <span class="tag">Both roles</span>' : ''}${ranked && i === 0 ? ' <span class="badge">Nearest</span>' : ''}</span>
          </span>
          <span class="dist">${ranked ? `${m.miles} mi<small>${state.estimated ? '~' : ''}${formatDuration(m.mins)}</small>` : ''}</span>
        </button>
      </li>`;
    })
    .join('');

  ui.list.querySelectorAll('.member').forEach((btn) => btn.addEventListener('click', () => select(btn.dataset.id, true)));
}

/* ---------- Helpers ---------- */
function clearResult() {
  state.searchId++;
  state.customer = null;
  state.ranked = null;
  state.activeId = null;
  setLoading(false);
  ui.mapEmpty.hidden = false;
  ui.footnote.textContent = '';
  if (state.role) setRole(state.role);
}

function setHint(text, isError = false) {
  ui.hint.textContent = text;
  ui.hint.classList.toggle('err', isError && !!text);
}

function setLoading(on) {
  ui.field.classList.toggle('loading', on);
}
