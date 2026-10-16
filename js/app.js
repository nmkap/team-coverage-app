/* Team Coverage App – app.js (placeholder) */

const searchBtn = document.getElementById('search-btn');
const postcodeInput = document.getElementById('postcode');
const postcodeError = document.getElementById('postcode-error');
const resultsSection = document.getElementById('results');
const teamList = document.getElementById('team-list');

// Basic UK postcode regex
const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

searchBtn.addEventListener('click', () => {
  const postcode = postcodeInput.value.trim();

  if (!POSTCODE_RE.test(postcode)) {
    postcodeError.textContent = 'Please enter a valid UK postcode.';
    postcodeError.hidden = false;
    return;
  }

  postcodeError.hidden = true;
  // TODO: geocode postcode → lat/lng, rank teams by drive time, render list + map
  resultsSection.hidden = false;
  teamList.innerHTML = '<p style="padding:1rem">Search coming soon…</p>';
});
