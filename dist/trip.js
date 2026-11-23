const api = 'https://api.openrouteservice.org';
const form = document.getElementById('trip-form');
const status = document.getElementById('trip-status');
const comparison = document.getElementById('trip-comparison');
const mapContainer = document.getElementById('trip-map');
const submit = form.querySelector('button');
let tripMap;

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

// Approximate distance to the route is used only to shortlist stops.
// The routing service determines the actual detour by road.
function distanceToRoute(club, coordinates) {
  const longitudeScale = Math.cos(club.latitude * Math.PI / 180);
  let minimum = Infinity;
  for (let index = 1; index < coordinates.length; index++) {
    const [left, right] = [coordinates[index - 1], coordinates[index]];
    const x = (left[0] - club.longitude) * longitudeScale;
    const y = left[1] - club.latitude;
    const dx = (right[0] - left[0]) * longitudeScale;
    const dy = right[1] - left[1];
    const length = dx * dx + dy * dy;
    const portion = length ? Math.max(0, Math.min(1, -(x * dx + y * dy) / length)) : 0;
    minimum = Math.min(minimum, Math.hypot(x + portion * dx, y + portion * dy));
  }
  return minimum * 111195;
}

function unleadedPrice(records) {
  const date = Object.keys(records ?? {}).sort().reverse().find(day => Number.isFinite(records[day].unleaded));
  return date ? { date, value: records[date].unleaded } : null;
}

function addSummary(title, route, detail) {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const metrics = document.createElement('p');
  metrics.textContent = `${(route.distance / 1609.344).toFixed(1)} mi · ${Math.round(route.duration / 60)} min`;
  section.append(heading, metrics);
  for (const line of detail) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    section.append(paragraph);
  }
  comparison.append(section);
  return section;
}

function drawRoutes(direct, stop) {
  if (!window.L) return;
  mapContainer.hidden = false;
  tripMap?.remove();
  tripMap = L.map(mapContainer);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 19,
  }).addTo(tripMap);
  const routes = L.featureGroup().addTo(tripMap);
  if (stop) L.geoJSON(stop.route, { style: { color: '#187b50', weight: 7 } }).addTo(routes);
  L.geoJSON(direct.route, { style: { color: '#265e9b', weight: 4, dashArray: stop ? '7 7' : null } }).addTo(routes);
  if (stop) {
    const label = document.createElement('span');
    label.textContent = stop.club.address;
    L.marker([stop.club.latitude, stop.club.longitude]).bindPopup(label).addTo(routes);
  }
  tripMap.fitBounds(routes.getBounds(), { padding: [24, 24], maxZoom: 14 });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(form);
  const key = document.getElementById('trip-key').value.trim();
  const maximumSeconds = Number(values.get('detour')) * 60;
  submit.disabled = true;
  comparison.hidden = true;
  mapContainer.hidden = true;
  status.textContent = 'Finding the direct driving route…';
  try {
    const [start, destination, clubs, history] = await Promise.all([
      geocode(values.get('start').trim(), key), geocode(values.get('destination').trim(), key),
      readJson('locations.json'), readJson('prices.json', { cache: 'no-cache' }),
    ]);
    const direct = await directions([start.coordinates, destination.coordinates], key);
    comparison.replaceChildren();
    addSummary('Direct route', direct, [start.label + ' → ' + destination.label]);
    comparison.hidden = false;
    drawRoutes(direct);
    const candidates = clubs.filter(club => club.publishedFuelPage &&
      Number.isFinite(club.latitude) && Number.isFinite(club.longitude))
      .map(club => ({ club, proximity: distanceToRoute(club, direct.route.geometry.coordinates) }))
      .sort((a, b) => a.proximity - b.proximity).slice(0, 6);
    const stops = [];
    let failed = 0;
    for (const [index, { club }] of candidates.entries()) {
      status.textContent = `Checking fuel stop ${index + 1} of ${candidates.length}…`;
      try {
        const stop = await directions([start.coordinates, [club.longitude, club.latitude], destination.coordinates], key);
        const extraSeconds = Math.max(0, stop.duration - direct.duration);
        if (extraSeconds <= maximumSeconds) stops.push({ ...stop, club, extraSeconds, price: unleadedPrice(history[club.id]) });
      } catch (error) {
        failed++;
      }
    }
    stops.sort((a, b) => (a.price?.value ?? Infinity) - (b.price?.value ?? Infinity) ||
      a.extraSeconds - b.extraSeconds);
    const stop = stops[0];
    const checked = candidates.length - failed;
    const context = `Compared ${checked} of ${candidates.length} nearby stops. Drive times exclude traffic and fueling.`;
    if (!stop) {
      status.textContent = checked ? `No checked stop fit the detour limit. ${context}` :
        'No detours could be checked. Try again later.';
      return;
    }
    const deltaMiles = (stop.distance - direct.distance) / 1609.344;
    const amount = stop.price ? `Unleaded $${(stop.price.value / 1000).toFixed(3)}/gal · ${stop.price.date}` :
      'No recorded unleaded price';
    const summary = addSummary('Via Sam’s Club', stop, [
      stop.club.address,
      `${Math.round(stop.extraSeconds / 60)} min extra · ${deltaMiles.toFixed(1)} mi vs. direct`,
      amount,
    ]);
    const priceHistory = document.createElement('a');
    priceHistory.href = './?' + new URLSearchParams({ club: stop.club.id });
    priceHistory.textContent = 'View price history';
    summary.append(priceHistory);
    status.textContent = (stop.price ? 'Lowest recorded unleaded price among eligible stops. ' : 'Shortest eligible detour. ') + context;
    drawRoutes(direct, stop);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
