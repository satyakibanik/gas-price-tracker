import { stateNames } from './state-names.js';

import { paintLegend, priceColor, priceScale } from './price-scale.js';
import { createStationTable } from './station-table.js?v=shared-filters';

function showPopupPrices(container, history, today) {
  const latest = Object.keys(history ?? {}).sort().at(-1);
  if (!latest) {
    container.textContent = 'No recorded fuel prices.';
    return;
  }
  const date = history[today] ? today : latest;
  const heading = document.createElement('strong');
  heading.textContent = date === today ? 'Today’s prices' : `Latest recorded prices (${date})`;
  const list = document.createElement('ul');
  const prices = history[date];
  for (const grade of ['unleaded', 'premium', 'diesel', 'midgrade']) {
    const price = prices[grade];
    if (!Number.isFinite(price)) continue;
    const row = document.createElement('li');
    row.textContent = `${grade[0].toUpperCase() + grade.slice(1)} · $${(price / 1000).toFixed(3)}/gal`;
    list.append(row);
  }
  container.replaceChildren(heading, list);
}

async function showFuelCenters() {
  const status = document.getElementById('map-status');
  const container = document.getElementById('fuel-map');
  try {
    if (!window.L) throw new Error('Map library unavailable');
    const response = await fetch('locations.json');
    if (!response.ok) throw new Error('Location directory unavailable');
    const locations = await response.json();
    const fuelCenters = locations.filter(club => club.publishedFuelPage);
    const mapped = fuelCenters.filter(club =>
      Number.isFinite(club.latitude) && Number.isFinite(club.longitude));
    if (!mapped.length) throw new Error('No fuel center coordinates available');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(new Date());
    const history = fetch('prices.json', { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('Price history unavailable');
      return response.json();
    }).catch(() => null);
    const records = await history;

    container.hidden = false;
    const map = L.map(container, { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map);

    const filters = document.getElementById('map-filters');
    const gradeInput = document.getElementById('map-grade');
    const hasMidgrade = Object.values(records ?? {}).some(clubHistory =>
      Object.values(clubHistory).some(prices => Number.isFinite(prices.midgrade)));
    if (hasMidgrade) gradeInput.add(new Option('Midgrade', 'midgrade'));
    const maximumInput = document.getElementById('map-max');
    const todayInput = document.getElementById('map-today');
    const stateInputs = document.getElementById('map-states');
    const stateOf = club => club.city.split(', ').at(-1);
    const nameOf = state => stateNames[state] ?? state;
    const renderStationTable = createStationTable(locations, today, hasMidgrade, renderFilters);
    const statesByName = [...new Set(mapped.map(stateOf))]
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'en'));
    for (const state of statesByName) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = state;
      label.append(input, nameOf(state));
      stateInputs.append(label);
    }

    const legend = L.control({ position: 'bottomleft' });
    const legendContent = L.DomUtil.create('div', 'price-legend');
    legend.onAdd = () => legendContent;
    L.DomEvent.disableClickPropagation(legendContent);
    legend.addTo(map);
    const pins = [];
    map.fitBounds(mapped.map(club => [club.latitude, club.longitude]), { padding: [28, 28], maxZoom: 13 });
    for (const club of mapped) {
      const coordinates = [club.latitude, club.longitude];
      const popup = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = `Sam’s Club #${club.id}`;
      const address = document.createElement('div');
      address.textContent = club.address;
      const source = document.createElement('a');
      source.href = club.url;
      source.textContent = 'Official fuel center';
      const prices = document.createElement('div');
      prices.className = 'map-popup-prices';
      const tracker = document.createElement('a');
      tracker.href = './?' + new URLSearchParams({ club: club.id });
      tracker.textContent = 'View price history';
      tracker.className = 'map-popup-tracker';
      popup.append(heading, address, prices, tracker, source);
      const clubHistory = records?.[club.id] ?? {};
      const icon = L.divIcon({ className: 'fuel-price-pin', iconSize: [13, 13] });
      const marker = L.marker(coordinates, { title: club.address, icon }).bindPopup(popup);
      pins.push({ club, clubHistory, marker });
      if (records) showPopupPrices(prices, records[club.id], today);
      else prices.textContent = 'Fuel prices could not load.';
    }
    const stateDropdown = stateInputs.closest('details');
    document.addEventListener('click', event => {
      if (!stateDropdown.contains(event.target)) stateDropdown.open = false;
    });
    stateDropdown.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      stateDropdown.open = false;
      stateDropdown.querySelector('summary').focus();
    });

    function renderFilters() {
      const grade = gradeInput.value;
      const maximum = maximumInput.value === '' ? Infinity : Math.round(Number(maximumInput.value) * 1000);
      const states = new Set(Array.from(stateInputs.querySelectorAll(':checked'), input => input.value));
      document.getElementById('map-state-summary').textContent = states.size
        ? `States and territories (${states.size})` : 'States and territories';
      const candidates = [];
      for (const pin of pins) {
        const { club, clubHistory } = pin;
        const date = todayInput.checked ? today : Object.keys(clubHistory).sort().reverse()
          .find(day => Number.isFinite(clubHistory[day][grade]));
        const price = clubHistory[date]?.[grade];
        const hasPrice = Number.isFinite(price);
        if ((states.size && !states.has(stateOf(club))) ||
            ((todayInput.checked || maximum !== Infinity) && (!hasPrice || price > maximum))) {
          continue;
        }
        candidates.push({ pin, price, date: hasPrice ? date : undefined });
      }
      const visible = renderStationTable(candidates, grade, todayInput.checked);
      const visiblePins = new Set(visible.map(({ pin }) => pin));
      for (const pin of pins) {
        if (!visiblePins.has(pin)) pin.marker.remove();
      }
      const scale = priceScale(visible.map(item => item.price).filter(Number.isFinite), maximum);
      for (const { pin, price } of visible) {
        const element = pin.marker.addTo(map).getElement();
        element.style.backgroundColor = priceColor(scale, price);
        element.setAttribute('aria-label', pin.club.address);
      }
      paintLegend(legendContent, gradeInput.selectedOptions[0].textContent, scale, visible.some(item => !Number.isFinite(item.price)));
      if (visible.length) {
        status.textContent = `${visible.length} of ${fuelCenters.length} fuel centers on the map`;
      } else if (!records) {
        status.textContent = 'Price data could not load. Clear the price filters or try again.';
      } else if (todayInput.checked && !pins.some(pin => Number.isFinite(pin.clubHistory[today]?.[grade]))) {
        status.textContent = `No ${grade} prices recorded for ${today} (Eastern time) in this data.`;
      } else {
        status.textContent = 'No fuel centers match the selected filters.';
      }
    }
    filters.addEventListener('input', renderFilters);
    filters.addEventListener('reset', () => requestAnimationFrame(renderFilters));
    filters.addEventListener('submit', event => event.preventDefault());
    renderFilters();
  } catch (error) {
    container.hidden = true;
    status.textContent = 'The fuel center map could not load.';
    console.error(error);
  }
}

showFuelCenters();
