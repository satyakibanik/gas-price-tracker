const priceColors = ['#187b50', '#73a62e', '#d29a12', '#d06621', '#ad3042'];
const missingPriceColor = '#64748b';
export const priceLabel = price => '$' + (price / 1000).toFixed(3);

export function priceScale(prices, maximum) {
  if (!prices.length) return [];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  if (low === high) return [[Infinity, priceColors[0], priceLabel(low)]];
  const step = Math.ceil((high - low + 1) / priceColors.length);
  return priceColors.flatMap((color, index) => {
    const start = low + step * index;
    const end = Math.min(high, start + step - 1, maximum);
    if (start > end) return [];
    return [[end, color, start === end ? priceLabel(start) : `${priceLabel(start)}–${priceLabel(end)}`]];
  });
}

export function paintLegend(container, grade, scale, missing) {
  const title = document.createElement('strong');
  title.textContent = grade + ' price / gal';
  const list = document.createElement('ul');
  const entries = missing ? [...scale, [null, missingPriceColor, 'No recorded price']] : scale;
  for (const [, color, label] of entries) {
    const row = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.style.backgroundColor = color;
    row.append(swatch, label);
    list.append(row);
  }
  container.replaceChildren(title, list);
  container.hidden = !entries.length;
}

export function priceColor(scale, price) {
  return scale.find(([limit]) => price <= limit)?.[1] ?? missingPriceColor;
}
