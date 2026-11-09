import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from './browser.mjs';

// Reuse the actual edited occurrence, including its ordinary local task store.
const state = JSON.parse(readFileSync('output/recurring-state.json', 'utf8'));
state.origins = state.origins.map(origin => ({ ...origin, origin: origin.origin.replace(':4319', ':4323') }));
const { mapUrl } = JSON.parse(readFileSync('output/mindmaps-recurring-result.json', 'utf8'));
if (!mapUrl.startsWith('http://127.0.0.1:4319/')) throw new Error('Only the isolated loopback fixture is allowed.');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
mkdirSync('output/playwright/mindmaps/compiled', { recursive: true });
try {
  for (const [theme, width] of [['standart', 390], ['standart-dark', 1440]]) {
    const context = await browser.newContext({ storageState: state, viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(mapUrl.replace(':4319', ':4323'));
    await page.getByRole('button', { name: 'Структура', exact: true }).click();
    const row = page.locator('.mindmap-row').filter({ hasText: 'Перенесён только один день' });
    await row.click();
    assert.ok((await row.innerText()).includes('2026-10-20 — 2026-10-22'));
    await page.evaluate(async selectedTheme => {
      document.documentElement.dataset.genesisTheme = selectedTheme;
      await document.fonts.ready;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `output/playwright/mindmaps/compiled/structure-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
    if (width === 1440) {
      await page.goto('http://127.0.0.1:4323/#projects');
      await page.getByRole('button', { name: 'Майндмепы', exact: true }).waitFor();
      await page.evaluate(selectedTheme => { document.documentElement.dataset.genesisTheme = selectedTheme; }, theme);
      await page.locator('.project-toolbar').screenshot({ path: 'output/playwright/mindmaps/compiled/entry-and-search.png', animations: 'disabled' });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS compiled screenshots: actual recurring task range, light 390 / dark 1440, no page overflow or errors');
} finally { await browser.close(); }
