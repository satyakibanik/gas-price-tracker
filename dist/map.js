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
  for (const [grade, price] of Object.entries(history[date])) {
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

    container.hidden = false;
    const map = L.map(container, { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map);

    const markers = [];
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
      const marker = L.marker(coordinates, { alt: club.address, title: club.address });
      marker.bindPopup(popup).addTo(map);
      marker.on('popupopen', async event => {
        prices.textContent = 'Loading fuel prices…';
        const records = await history;
        if (records) showPopupPrices(prices, records[club.id], today);
        else prices.textContent = 'Fuel prices could not load.';
        event.popup.update();
      });
      markers.push(coordinates);
    }
    map.fitBounds(markers, { padding: [28, 28], maxZoom: 13 });
    status.textContent = `${mapped.length} of ${fuelCenters.length} fuel centers on the map`;
  } catch (error) {
    container.hidden = true;
    status.textContent = 'The fuel center map could not load.';
    console.error(error);
  }
}

showFuelCenters();
