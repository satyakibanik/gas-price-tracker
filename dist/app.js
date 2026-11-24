import { stateNames } from './state-names.js';

const byId = id => document.getElementById(id);
const search = byId('search');
const results = byId('results');
const chart = byId('chart');
const tooltip = byId('price-tooltip');
const grades = [
  ['unleaded', '#1759bd'], ['midgrade', '#a44c11'],
  ['premium', '#7944b4'], ['diesel', '#087567'],
];
const money = value => '$' + (value / 1000).toFixed(3);
const label = grade => grade[0].toUpperCase() + grade.slice(1);
const day = date => Date.parse(date + 'T00:00:00Z') / 86400000;
const dateLabel = (date, full = false) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', ...(full && { year: 'numeric' }),
}).format(new Date(date * 86400000));
const tokens = input => input.toLowerCase().match(/[a-z0-9]+/g) ?? [];

function svg(tag, attrs = {}, content = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = content;
  return node;
}

let locations, history, selected;
let observations = [];

function draw() {
  tooltip.hidden = true;
  if (!observations.length) return;
  const width = chart.clientWidth;
  if (width < 100) return;
  const left = 48, right = width - 14, top = 15, bottom = 225;
  const values = observations.flatMap(([, prices]) => Object.values(prices));
  const min = Math.min(...values), max = Math.max(...values);
  const step = [100, 250, 500, 1000, 2000, 5000, 10000].find(size => (max - min) / size <= 6) ?? 20000;
  const low = Math.max(0, Math.floor((min - step / 3) / step) * step);
  const high = Math.ceil((max + step / 3) / step) * step;
  const first = day(observations[0][0]), last = day(observations.at(-1)[0]);
  const x = date => last === first ? (left + right) / 2 : left + (date - first) * (right - left) / (last - first);
  const y = price => bottom - (price - low) * (bottom - top) / (high - low);
  chart.setAttribute('viewBox', `0 0 ${width} 264`);
  chart.replaceChildren();
  const showTooltip = event => {
    if (!event.isPrimary) return;
    const bounds = chart.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    if (pointerX < left || pointerX > right || pointerY < top || pointerY > bottom) {
      tooltip.hidden = true;
      return;
    }
    const [date, prices] = observations.reduce((nearest, entry) =>
      Math.abs(x(day(entry[0])) - pointerX) < Math.abs(x(day(nearest[0])) - pointerX) ? entry : nearest);
    const heading = document.createElement('strong');
    heading.textContent = dateLabel(day(date), true);
    tooltip.replaceChildren(heading);
    for (const [type] of grades) {
      if (prices[type] === undefined) continue;
      const row = document.createElement('div');
      row.textContent = label(type) + ' ' + money(prices[type]);
      tooltip.append(row);
    }
    tooltip.hidden = false;
    tooltip.style.left = Math.max(0, Math.min(width - tooltip.offsetWidth, pointerX + 12)) + 'px';
    tooltip.style.top = Math.max(0, pointerY - tooltip.offsetHeight - 10) + 'px';
  };
  chart.onpointermove = showTooltip;
  chart.onpointerdown = event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    chart.setPointerCapture(event.pointerId);
    showTooltip(event);
  };
  chart.onpointerleave = event => {
    if (event.pointerType !== 'touch') tooltip.hidden = true;
  };
  chart.onpointercancel = () => { tooltip.hidden = true; };
  const details = observations.map(([date, prices]) =>
    dateLabel(day(date), true) + ', ' + grades.filter(([type]) => prices[type] !== undefined)
      .map(([type]) => label(type) + ' ' + money(prices[type])).join(', '));
  chart.setAttribute('aria-label', 'Recorded prices in US dollars per gallon. Latest observation: ' + details.at(-1));
  for (let tick = low; tick <= high; tick += step) {
    chart.append(svg('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), stroke: '#e1e8f0' }));
    chart.append(svg('text', { x: left - 8, y: y(tick) + 4, 'text-anchor': 'end', fill: 'currentColor' }, '$' + (tick / 1000).toFixed(2)));
  }
  const labels = Math.min(last - first + 1, width > 520 ? 5 : 3);
  for (let index = 0; index < labels; index++) {
    const date = first + (labels > 1 ? Math.round(index * (last - first) / (labels - 1)) : 0);
    const align = labels === 1 ? 'middle' : index === 0 ? 'start' : index === labels - 1 ? 'end' : 'middle';
    chart.append(svg('text', { x: x(date), y: 247, 'text-anchor': align, fill: 'currentColor' }, dateLabel(date)));
  }
  for (const [type, color] of grades) {
    let previous;
    for (const [date, prices] of observations) {
      if (prices[type] === undefined) { previous = undefined; continue; }
      const point = { day: day(date), price: prices[type] };
      if (previous && point.day === previous.day + 1) {
        chart.append(svg('line', { x1: x(previous.day), y1: y(previous.price), x2: x(point.day), y2: y(point.price), stroke: color, 'stroke-width': 2 }));
      }
      const dot = svg('circle', { cx: x(point.day), cy: y(point.price), r: 5, fill: color, stroke: 'white', 'stroke-width': 1.5 });
      chart.append(dot);
    previous = point;
    }
  }
}

function closeResults() {
  results.hidden = true;
  search.setAttribute('aria-expanded', 'false');
}

document.addEventListener('pointerdown', event => {
  if (!chart.contains(event.target)) tooltip.hidden = true;
});

function select(location) {
  selected = location;
  search.value = location.city;
  closeResults();
  observations = Object.entries(history[location.id] ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const latest = observations.at(-1);
  byId('location').textContent = location.city;
  byId('address').textContent = location.address;
  byId('count').textContent = latest ? `Latest · ${dateLabel(day(latest[0]), true)}` : '';
  byId('source').href = latest || location.publishedFuelPage ? location.url : location.clubUrl;
  byId('legend').replaceChildren();
  for (const [type, color] of grades) {
    if (latest?.[1][type] === undefined) continue;
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--color', color);
    swatch.setAttribute('aria-hidden', 'true');
    const price = document.createElement('strong');
    price.textContent = money(latest[1][type]);
    item.append(swatch, label(type), price);
    byId('legend').append(item);
  }
  chart.hidden = !latest;
  byId('empty').hidden = Boolean(latest);
  byId('panel').hidden = false;
  draw();
}

function showResults() {
  const terms = search.value === selected?.city ? [] : tokens(search.value);
  results.replaceChildren();
  for (const location of locations) {
    if (!terms.length && results.children.length === 15) break;
    const state = stateNames[location.city.split(', ').at(-1)] ?? '';
    const searchable = tokens(`Sams Sam's Club fuel center ${location.id} ${location.city} ${location.address} ${state}`);
    if (!terms.every(term => searchable.some(word => word.startsWith(term)))) continue;
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    link.href = './?' + new URLSearchParams({ club: location.id });
    const address = document.createElement('small');
    address.textContent = location.address === location.city ? '' : location.address;
    link.append(`${location.city} · #${location.id}`, address);
    listItem.append(link);
    results.append(listItem);
  }
  if (!results.children.length) {
    const message = document.createElement('li');
    message.className = 'no-match';
    message.setAttribute('role', 'status');
    message.textContent = 'No matching fuel centers.';
    results.append(message);
  }
  results.hidden = false;
  search.setAttribute('aria-expanded', 'true');
}

try {
  [locations, history] = await Promise.all(['locations.json', 'prices.json'].map(async path => {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(path);
    return response.json();
  }));
  search.disabled = false;
  search.addEventListener('focus', showResults);
  search.addEventListener('input', showResults);
  const lookup = search.parentElement;
  lookup.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !results.hidden) {
      event.preventDefault();
      search.focus();
      closeResults();
    }
    if (event.key === 'ArrowDown' && event.target === search) {
      event.preventDefault();
      showResults();
      results.querySelector('a')?.focus();
    }
    if (event.key === 'Enter' && event.target === search && !results.hidden) {
      results.querySelector('a')?.click();
    }
  });
  function dismissOutside(event) {
    if (!lookup.contains(event.target)) closeResults();
  }
  document.addEventListener('click', dismissOutside);
  document.addEventListener('focusin', dismissOutside);
  const requestedClub = new URLSearchParams(window.location.search).get('club');
  select(locations.find(location => location.id === requestedClub) ?? locations[0]);
  new ResizeObserver(draw).observe(chart.parentElement);
} catch (error) {
  byId('status').textContent = 'Fuel price data could not be loaded.';
  console.error(error);
}
