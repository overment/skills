// Set the saved theme before the first paint, so the page does not flash in the other theme.
// map.js reads and writes the same settings.
try {
  const { theme } = JSON.parse(localStorage.getItem('unknown-unknowns-map:settings') || '{}');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {}
