// Follows the system light/dark preference. Bootstrap switches colour modes through the
// data-bs-theme attribute; loaded as a blocking script in <head> so the first paint is right.
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  document.documentElement.dataset.bsTheme = darkQuery.matches ? 'dark' : 'light';
};
applyTheme();
darkQuery.addEventListener('change', applyTheme);
