/** Keep the web favicon and sidebar mark in the selected palette without changing app icons. */
export function installWebBrandIcon(appBase: string) {
  const root = document.documentElement;
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const palettes = new Set(['green', 'blue', 'burgundy', 'violet']);
  const update = () => {
    const palette = palettes.has(root.dataset.genesisPalette ?? '') ? root.dataset.genesisPalette : 'green';
    const mode = root.dataset.genesisTheme?.endsWith('-dark') ? 'dark' : 'light';
    const url = `${appBase}/icons/jade-facets-${palette}-${mode}.svg`;
    root.style.setProperty('--genesis-web-brand-icon', `url("${url}")`);
    if (favicon && favicon.getAttribute('href') !== url) favicon.setAttribute('href', url);
  };
  update();
  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-genesis-theme', 'data-genesis-palette'] });
}
