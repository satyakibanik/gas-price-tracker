import { stateNames } from './state-names.js';

const gradeName = grade => grade[0].toUpperCase() + grade.slice(1);
const zipOf = club => club.address.match(/\b(\d{5})(?:-\d{4})?$/)?.[1];
const dollars = price => '$' + (price / 1000).toFixed(3);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function distanceMiles(origin, club) {
  const radians = Math.PI / 180;
  const latitude = (club.latitude - origin.latitude) * radians;
  const longitude = (club.longitude - origin.longitude) * radians;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(origin.latitude * radians) *
    Math.cos(club.latitude * radians) * Math.sin(longitude / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function createStationTable(directory, today, hasMidgrade, refreshFilters) {
  const grades = ['unleaded', 'premium', 'diesel'];
  if (hasMidgrade) grades.push('midgrade');
  const section = document.querySelector('.station-list');
  const table = section.querySelector('table');
  const search = document.getElementById('station-search');
  const count = document.getElementById('station-count');
  const nearbyMessage = document.getElementById('nearby-message');
  const clearLocation = document.getElementById('nearby-clear');
  let rows = [];
  let origin;
  let locationRequest = 0;
  let sort = 'location';
  let direction = 1;

  const columns = [
    { key: 'location', label: 'Location' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP code' },
    { key: 'distance', label: 'Distance (mi)', limit: 1 },
    { key: 'price', label: 'Selected price / gal', limit: 1000 },
    ...grades.map(key => ({ key, label: gradeName(key), limit: 1000 })),
    { key: 'date', label: 'Price date' },
  ];
  const headers = table.tHead.insertRow();
  const filters = table.tHead.insertRow();
  for (const column of columns) {
    const header = document.createElement('th');
    header.scope = 'col';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = column.label;
    button.addEventListener('click', () => {
      direction = sort === column.key ? -direction : 1;
      sort = column.key;
      render();
    });
    header.append(button);
    headers.append(header);
    const input = document.createElement('input');
    input.type = column.limit ? 'number' : 'search';
    input.placeholder = column.limit ? 'Max' : 'Filter';
    if (column.limit) {
      input.min = '0';
      input.step = column.limit === 1000 ? '0.001' : 'any';
    }
    input.setAttribute('form', 'map-filters');
    input.addEventListener('input', refreshFilters);
    filters.insertCell().append(input);
    Object.assign(column, { header, button, input });
  }

  function render() {
    const terms = search.value.trim().toLowerCase().split(/\s+/);
    const activeFilters = columns.filter(({ input }) => input.value.trim());
    const matches = rows.filter(row => {
      const haystack = [row.location, row.state, row.stateCode, row.zip, row.club.id]
        .join(' ').toLowerCase();
      return terms.every(term => haystack.includes(term)) && activeFilters.every(({ key, input, limit }) => {
        const value = row[key];
        if (limit) {
          const maximum = Number(input.value);
          return Number.isFinite(value) && (limit === 1000 ? value <= Math.round(maximum * limit) : value <= maximum);
        }
        const searchable = key === 'state' ? row.state + ' ' + row.stateCode : value ?? '';
        return searchable.toLowerCase().includes(input.value.trim().toLowerCase());
      });
    });
    matches.sort((a, b) => {
      if (a[sort] == null) return b[sort] == null ? 0 : 1;
      if (b[sort] == null) return -1;
      const comparison = typeof a[sort] === 'number' ? a[sort] - b[sort] : collator.compare(a[sort], b[sort]);
      return direction * comparison;
    });
    for (const column of columns) {
      column.input.setAttribute('aria-label', column.limit ? `Maximum ${column.label.toLowerCase()}` : `Filter by ${column.label.toLowerCase()}`);
      if (column.key === sort) {
        column.header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
      } else {
        column.header.removeAttribute('aria-sort');
      }
    }
    count.textContent = matches.length ? `${matches.length} of ${rows.length} stations · Prices per gallon`
      : 'No stations match the selected filters.';
    const body = document.createDocumentFragment();
    for (const row of matches) {
      const tr = document.createElement('tr');
      for (const { key, limit } of columns) {
        const cell = tr.insertCell();
        const value = row[key];
        if (key === 'location') {
          const link = document.createElement('a');
          link.href = './?' + new URLSearchParams({ club: row.club.id });
          link.textContent = value;
          cell.append(link);
          if (origin) {
            const directions = document.createElement('a');
            directions.className = 'station-directions';
            directions.href = 'https://www.google.com/maps/dir/?' + new URLSearchParams({
              api: '1', destination: `${row.club.latitude},${row.club.longitude}`,
            });
            directions.textContent = 'Directions';
            directions.setAttribute('aria-label', `Directions to ${value}`);
            cell.append(directions);
          }
        } else {
          cell.textContent = value == null ? '—' : limit === 1000 ? dollars(value)
            : key === 'distance' ? value.toFixed(1) : value;
        }
        if (row.gradeDates[key]) cell.title = `Recorded ${row.gradeDates[key]} (Eastern time)`;
      }
      body.append(tr);
    }
    table.tBodies[0].replaceChildren(body);
    return matches.map(row => row.station);
  }

  function setOrigin(coordinates, message) {
    origin = coordinates;
    sort = origin ? 'distance' : 'location';
    direction = 1;
    nearbyMessage.textContent = message;
    clearLocation.hidden = !origin;
    refreshFilters();
  }

  document.getElementById('nearby-form').addEventListener('submit', event => {
    event.preventDefault();
    locationRequest++;
    const zip = document.getElementById('nearby-zip').value.trim();
    const match = directory.find(club => zipOf(club) === zip &&
      Number.isFinite(club.latitude) && Number.isFinite(club.longitude));
    if (match) {
      setOrigin(match, `Straight-line distances from a Sam’s Club location in ZIP ${zip}.`);
    } else {
      setOrigin(undefined, `ZIP ${zip} has no location in the club directory. Try a nearby club’s ZIP or use your location.`);
    }
  });
  document.getElementById('nearby-location').addEventListener('click', () => {
    if (!navigator.geolocation) {
      nearbyMessage.textContent = 'Device location is unavailable. Enter a ZIP code.';
      return;
    }
    const request = ++locationRequest;
    nearbyMessage.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (request === locationRequest) setOrigin(coords, 'Straight-line distances from your device location.');
    }, () => {
      if (request === locationRequest) nearbyMessage.textContent = 'Could not get your location. Enter a ZIP code.';
    }, { timeout: 10000 });
  });
  clearLocation.addEventListener('click', () => {
    locationRequest++;
    document.getElementById('nearby-zip').value = '';
    setOrigin(undefined, '');
  });

  section.hidden = false;
  return (candidates, grade, todayOnly) => {
    const priceColumn = columns.find(({ key }) => key === 'price');
    priceColumn.label = `${gradeName(grade)} price / gal`;
    priceColumn.button.textContent = priceColumn.label;
    rows = candidates.map(station => {
      const { pin: { club, clubHistory }, price, date } = station;
      const stateCode = club.city.split(', ').at(-1);
      const row = {
        station, club, location: club.address, stateCode, state: stateNames[stateCode] ?? stateCode,
        zip: zipOf(club), price, date, distance: origin ? distanceMiles(origin, club) : undefined,
        gradeDates: {},
      };
      const days = todayOnly ? [today] : Object.keys(clubHistory).sort().reverse();
      for (const key of grades) {
        const day = days.find(day => Number.isFinite(clubHistory[day]?.[key]));
        row[key] = clubHistory[day]?.[key];
        row.gradeDates[key] = day;
      }
      return row;
    });
    return render();
  };
}
