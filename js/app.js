/* Team Coverage App – UI flow: pick role → enter postcode → nearest team highlighted. */
import { isValidPostcode, normalisePostcode, lookupPostcode } from './postcode.js';
import { getDriveTimes, getRoute, formatDuration } from './distance.js';
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
const routeCache = new Map();

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
  const count = (r) => state.team.filter((m) => m.role === r || m.role === 'both').length;
  ui.landingCount.innerHTML = `<span><b>${count('surveyor')}</b> surveyors</span><span><b>${count('installer')}</b> installers</span><span>UK-wide coverage</span>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('.role-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      btn.classList.add('picked');
      setRole(btn.dataset.role);
      setTimeout(() => {
        ui.landing.classList.add('is-gone');
        document.body.classList.add('ready');
        ui.landing.setAttribute('aria-hidden', 'true');
        setTimeout(() => { map.invalidate(); ui.input.focus(); }, 900);
      }, 180);
    }),
  );

  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));

  ui.restart.addEventListener('click', () => {
    document.querySelectorAll('.role-btn').forEach((b) => b.classList.remove('picked'));
    ui.landing.classList.remove('is-gone');
    ui.landing.removeAttribute('aria-hidden');
    document.body.classList.remove('ready');
    ui.input.value = '';
    setHint('');
    clearResult();
    document.querySelector('.role-btn').focus();
  });

  let timer;
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
    timer = setTimeout(() => search(normalisePostcode(value)), 350);
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
  await rank(id);
}

async function rank(id = ++state.searchId) {
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
  select(state.ranked[0].id, false);
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
    getRoute({ lat: member.baseLat, lng: member.baseLng }, customer).then((path) => {
      if (!path) return;
      routeCache.set(key, path);
      if (state.activeId === id && state.customer === customer) map.replaceRoute(path);
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
