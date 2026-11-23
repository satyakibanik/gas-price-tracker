import { paintLegend, priceColor, priceLabel, priceScale } from './price-scale.js';

const api = 'https://api.openrouteservice.org';
const routeCorridorMiles = 10;
const form = document.getElementById('trip-form');
const status = document.getElementById('trip-status');
const comparison = document.getElementById('trip-comparison');
const mapContainer = document.getElementById('trip-map');
const routeKey = document.getElementById('trip-map-key');
const submit = form.querySelector('[type="submit"]');
const legInputs = document.getElementById('trip-legs');
const addLeg = document.getElementById('add-leg');
const legColors = ['#265e9b', '#9a3b8b', '#a45416', '#216d61', '#593bb1'];

function updateLegInputs() {
  const legs = [...legInputs.children];
  legs.forEach((leg, index) => {
    leg.querySelector('legend').textContent = `Leg ${index + 1}`;
    const remove = leg.querySelector('.remove-leg');
    remove.hidden = legs.length === 1;
    remove.setAttribute('aria-label', `Remove leg ${index + 1}`);
  });
  addLeg.disabled = legs.length >= legColors.length;
}

addLeg.addEventListener('click', () => {
  if (legInputs.children.length >= legColors.length) return;
  const previous = legInputs.lastElementChild;
  const next = previous.cloneNode(true);
  next.querySelector('[name="start"]').value = previous.querySelector('[name="destination"]').value;
  next.querySelector('[name="destination"]').value = '';
  legInputs.append(next);
  updateLegInputs();
  next.querySelector('[name="destination"]').focus();
});

legInputs.addEventListener('click', event => {
  const remove = event.target.closest('.remove-leg');
  if (!remove || legInputs.children.length === 1) return;
  remove.closest('fieldset').remove();
  updateLegInputs();
  addLeg.focus();
});
const keyInput = document.getElementById('trip-key');
let tripMap;
window.addEventListener('pagehide', () => { keyInput.value = ''; });

async function readJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (response.status === 401 || response.status === 403) throw new Error('Openrouteservice rejected the API key.');
  if (response.status === 429) throw new Error('Openrouteservice’s request limit was reached. Try again later.');
  if (!response.ok) throw new Error('A trip data request failed. Check the locations and try again.');
  return response.json();
}

async function geocode(query, key) {
  const params = new URLSearchParams({ text: query, size: '1', 'boundary.country': 'US,PR' });
  const data = await readJson(api + '/geocode/search?' + params, { headers: { Authorization: key } });
  const place = data.features[0];
  if (!place) throw new Error('No match for ' + query + '. Try a full street address.');
  return { coordinates: place.geometry.coordinates, label: place.properties.label };
}

async function directions(coordinates, key) {
  const data = await readJson(api + '/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  });
  const route = data.features[0];
  if (!route) throw new Error('No driving route was found.');
  return { route, ...route.properties.summary };
}

// Project each station onto the route and scale progress to the reported road distance.
function routePosition(club, coordinates, routeDistance) {
  const longitudeScale = Math.cos(club.latitude * Math.PI / 180);
  let minimum = Infinity;
  let distance = 0;
  let progress = 0;
  for (let index = 1; index < coordinates.length; index++) {
    const [left, right] = [coordinates[index - 1], coordinates[index]];
    const x = (left[0] - club.longitude) * longitudeScale;
    const y = left[1] - club.latitude;
    const dx = (right[0] - left[0]) * longitudeScale;
    const dy = right[1] - left[1];
    const length = dx * dx + dy * dy;
    const portion = length ? Math.max(0, Math.min(1, -(x * dx + y * dy) / length)) : 0;
    const offset = Math.hypot(x + portion * dx, y + portion * dy);
    const segment = Math.sqrt(length);
    if (offset < minimum) {
      minimum = offset;
      progress = distance + portion * segment;
    }
    distance += segment;
  }
  return {
    proximity: minimum * 111195,
    fromStart: distance ? progress / distance * routeDistance : 0,
  };
}

const copyStops = document.getElementById('copy-stops');
const copyStatus = document.getElementById('copy-status');
const copyFallback = document.getElementById('copy-fallback');
let stopList = '';

function stopLines(stations) {
  return [...stations].sort((a, b) => a.fromStart - b.fromStart).map(({ club, price, fromStart }) => {
    const fuel = price ? `Unleaded ${priceLabel(price.value)}/gal` : 'Unleaded price unavailable';
    return `${(fromStart / 1609.344).toFixed(1)} mi — Sam’s Club #${club.id} — ${club.address} — ${fuel}`;
  });
}

function prepareStopList(legs) {
  if (!legs.some(leg => leg.stations.length)) return;
  const groups = legs.flatMap(leg => [
    '',
    `Leg ${leg.number} · ${leg.start.label} → ${leg.destination.label}`,
    ...(leg.stations.length ? stopLines(leg.stations) : ['No mapped fuel stops.']),
  ]);
  stopList = ['Sam’s Club fuel stops', 'Estimated route miles from each leg’s start, excluding station detours.', ...groups].join('\n');
  copyStops.hidden = false;
}

copyStops.addEventListener('click', async () => {
  copyStatus.hidden = false;
  try {
    await navigator.clipboard.writeText(stopList);
    copyFallback.hidden = true;
    copyStatus.textContent = 'Fuel stops copied.';
  } catch {
    copyFallback.value = stopList;
    copyFallback.hidden = false;
    copyFallback.select();
    copyStatus.textContent = 'Select and copy the fuel stop list below.';
  }
});

function unleadedPrice(records) {
  const date = Object.keys(records ?? {}).sort().reverse().find(day => Number.isFinite(records[day].unleaded));
  return date ? { date, value: records[date].unleaded } : null;
}

function addSummary(container, title, route, detail) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const metrics = document.createElement('p');
  metrics.textContent = `${(route.distance / 1609.344).toFixed(1)} mi · ${Math.round(route.duration / 60)} min`;
  section.append(heading, metrics);
  for (const line of detail) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    section.append(paragraph);
  }
  container.append(section);
  return section;
}

function drawRoutes(legs) {
  if (!window.L || !legs.length) return;
  mapContainer.hidden = false;
  routeKey.hidden = false;
  routeKey.textContent = 'Route colors match the leg cards. Dashed lines show routes via recommended stops. Use the map layer control to isolate a leg.';
  tripMap?.remove();
  tripMap = L.map(mapContainer);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 19,
  }).addTo(tripMap);
  const routes = L.featureGroup().addTo(tripMap);
  const layers = {};
  const byClub = new Map();
  for (const leg of legs) {
    const layer = L.featureGroup().addTo(routes);
    const color = legColors[leg.number - 1];
    L.geoJSON(leg.direct.route, { style: { color, weight: 5 } }).addTo(layer);
    if (leg.stop) L.geoJSON(leg.stop.route, { style: { color, weight: 8, dashArray: '5 10', opacity: .65 } }).addTo(layer);
    const label = document.createElement('span');
    label.className = 'leg-layer-name';
    const swatch = document.createElement('span');
    swatch.className = 'leg-layer-swatch';
    swatch.style.backgroundColor = color;
    swatch.setAttribute('aria-hidden', 'true');
    label.append(swatch, `Leg ${leg.number} · ${leg.start.label} → ${leg.destination.label}`);
    // Leaflet takes markup for this label. Serialize text nodes to keep addresses escaped.
    layers[label.outerHTML] = layer;
    for (const station of leg.stations) {
      if (!byClub.has(station.club.id)) byClub.set(station.club.id, { ...station, legs: [] });
      byClub.get(station.club.id).legs.push({ number: leg.number, recommended: leg.stop?.club.id === station.club.id });
    }
  }
  if (legs.length > 1) L.control.layers({}, layers, { collapsed: false }).addTo(tripMap);
  const stations = [...byClub.values()];

  const prices = stations.flatMap(station => station.price ? [station.price.value] : []);
  const scale = priceScale(prices, Infinity);
  const legend = L.control({ position: 'bottomleft' });
  const legendContent = L.DomUtil.create('div', 'price-legend');
  paintLegend(legendContent, 'Unleaded', scale, prices.length < stations.length);
  legend.onAdd = () => legendContent;
  L.DomEvent.disableClickPropagation(legendContent);
  legend.addTo(tripMap);

  tripMap.fitBounds(routes.getBounds(), { padding: [24, 24], maxZoom: 14 });
  for (const { club, price, legs: stationLegs } of stations) {
    const recommended = stationLegs.some(leg => leg.recommended);
    const popup = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = (recommended ? 'Recommended stop · ' : '') + 'Sam’s Club #' + club.id;
    const address = document.createElement('div');
    address.textContent = club.address;
    const detail = document.createElement('div');
    detail.textContent = price ? `Unleaded ${priceLabel(price.value)}/gal · ${price.date}` : 'No recorded unleaded price';
    const link = document.createElement('a');
    link.href = './?' + new URLSearchParams({ club: club.id });
    link.textContent = 'View price history';
    const membership = document.createElement('div');
    membership.textContent = stationLegs.map(leg => `Leg ${leg.number}${leg.recommended ? ' (recommended)' : ''}`).join(' · ');
    popup.append(title, address, detail, membership, link);

    const size = recommended ? 19 : 13;
    const icon = L.divIcon({
      className: 'fuel-price-pin trip-station' + (recommended ? ' trip-stop' : ''),
      iconSize: [size, size],
    });
    const marker = L.marker([club.latitude, club.longitude], {
      title: club.address,
      icon,
      zIndexOffset: recommended ? 500 : 0,
    }).bindPopup(popup).addTo(routes);
    const element = marker.getElement();
    element.style.backgroundColor = priceColor(scale, price?.value);
    element.setAttribute('aria-label', title.textContent + ', ' + club.address);
  }
  if (stations.length) tripMap.fitBounds(routes.getBounds(), { padding: [24, 24], maxZoom: 14 });
}

async function planLeg(number, start, destination, clubs, history, key, maximumSeconds) {
  const direct = await directions([start.coordinates, destination.coordinates], key);
  const stations = clubs.map(club => ({
    club,
    ...routePosition(club, direct.route.geometry.coordinates, direct.distance),
    price: unleadedPrice(history[club.id]),
  })).filter(station => station.proximity <= routeCorridorMiles * 1609.344)
    .sort((a, b) => a.proximity - b.proximity);
  const candidates = stations.slice(0, 6);
  const stops = [];
  let checked = 0;
  for (const [index, { club, price }] of candidates.entries()) {
    status.textContent = `Leg ${number}: checking fuel stop ${index + 1} of ${candidates.length}…`;
    try {
      const stop = await directions([start.coordinates, [club.longitude, club.latitude], destination.coordinates], key);
      checked++;
      const extraSeconds = Math.max(0, stop.duration - direct.duration);
      if (extraSeconds <= maximumSeconds) stops.push({ ...stop, club, extraSeconds, price });
    } catch (error) {
      console.warn('Could not check a fuel detour.', error.message);
    }
  }
  stops.sort((a, b) => (a.price?.value ?? Infinity) - (b.price?.value ?? Infinity) || a.extraSeconds - b.extraSeconds);
  const stop = stops[0];
  const scope = `${stations.length} fuel centers within ${routeCorridorMiles} miles of the route.`;
  const result = stop ? '' : checked ? 'No checked stop fit the detour limit. ' :
    candidates.length ? 'No detours could be checked. ' : '';
  return { number, start, destination, direct, stations, stop,
    message: `${result}${scope} Compared ${checked} of ${candidates.length} nearby stops.` };
}

function renderLeg(leg) {
  const card = document.createElement('article');
  card.className = 'trip-leg-result';
  card.style.setProperty('--leg-color', legColors[leg.number - 1]);
  const title = document.createElement('h2');
  title.textContent = `Leg ${leg.number} · ${leg.start.label} → ${leg.destination.label}`;
  const summaries = document.createElement('div');
  summaries.className = 'trip-comparison';
  addSummary(summaries, 'Direct route', leg.direct, []);
  if (leg.stop) {
    const { stop } = leg;
    const deltaMiles = (stop.distance - leg.direct.distance) / 1609.344;
    const amount = stop.price ? `Unleaded ${priceLabel(stop.price.value)}/gal · ${stop.price.date}` : 'No recorded unleaded price';
    const summary = addSummary(summaries, 'Via Sam’s Club', stop, [
      stop.club.address,
      `${Math.round(stop.extraSeconds / 60)} min extra · ${deltaMiles.toFixed(1)} mi vs. direct`,
      amount,
    ]);
    const link = document.createElement('a');
    link.href = './?' + new URLSearchParams({ club: stop.club.id });
    link.textContent = 'View price history';
    summary.append(link);
  }
  const note = document.createElement('p');
  note.textContent = leg.message;
  const list = document.createElement('details');
  const label = document.createElement('summary');
  label.textContent = `Fuel stations (${leg.stations.length})`;
  const rows = document.createElement('ol');
  for (const text of stopLines(leg.stations)) {
    const row = document.createElement('li');
    row.textContent = text;
    rows.append(row);
  }
  list.append(label, rows);
  card.append(title, summaries, note);
  if (leg.stations.length) card.append(list);
  comparison.append(card);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(form);
  const key = keyInput.value.trim();
  keyInput.value = '';
  const maximumSeconds = Number(values.get('detour')) * 60;
  const inputs = values.getAll('start').map((start, index) => [start.trim(), values.getAll('destination')[index].trim()]);
  submit.disabled = true;
  addLeg.disabled = true;
  for (const fieldset of legInputs.children) fieldset.disabled = true;
  comparison.hidden = true;
  comparison.replaceChildren();
  mapContainer.hidden = true;
  routeKey.hidden = true;
  copyStops.hidden = true;
  copyStatus.hidden = true;
  copyFallback.hidden = true;
  stopList = '';
  status.textContent = 'Finding driving routes…';
  try {
    const [directory, history] = await Promise.all([
      readJson('locations.json'), readJson('prices.json', { cache: 'no-cache' }),
    ]);
    const clubs = directory.filter(club => club.publishedFuelPage &&
      Number.isFinite(club.latitude) && Number.isFinite(club.longitude));
    const places = new Map();
    function resolve(query) {
      if (!places.has(query)) places.set(query, geocode(query, key));
      return places.get(query);
    }
    const legs = [];
    const errors = [];
    for (const [index, [from, to]] of inputs.entries()) {
      const number = index + 1;
      status.textContent = `Finding the driving route for leg ${number}…`;
      try {
        const [start, destination] = await Promise.all([resolve(from), resolve(to)]);
        const leg = await planLeg(number, start, destination, clubs, history, key, maximumSeconds);
        legs.push(leg);
        renderLeg(leg);
      } catch (error) {
        errors.push(`Leg ${number}: ${error.message}`);
      }
    }
    comparison.hidden = !legs.length;
    prepareStopList(legs);
    drawRoutes(legs);
    const summary = inputs.length === 1 && legs.length ? legs[0].message :
      `Compared ${legs.length} of ${inputs.length} legs.`;
    status.textContent = [summary, ...errors, 'Drive times exclude traffic and fueling.'].join(' ');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
    for (const fieldset of legInputs.children) fieldset.disabled = false;
    updateLegInputs();
  }
});
