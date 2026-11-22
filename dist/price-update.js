async function showPriceUpdate() {
  try {
    const response = await fetch('price-update.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const { updatedAt } = await response.json();
    const date = new Date(updatedAt);
    if (!Number.isFinite(date.getTime())) return;
    const formatted = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium', timeStyle: 'long', timeZone: 'America/New_York',
    }).format(date);
    const time = document.createElement('time');
    time.dateTime = updatedAt;
    time.textContent = formatted;
    document.getElementById('price-update').replaceChildren('Prices last updated ', time);
  } catch (error) {
    console.error(error);
  }
}

showPriceUpdate();
