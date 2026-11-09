import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const tier = process.argv[2] ?? 'free';
const route = process.argv[3] ?? '#today';
const baseURL = 'http://127.0.0.1:4380';
const output = 'output/playwright/full-qa/explore';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await context.route(/https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
await context.addInitScript(() => localStorage.setItem('genesis-language-v1', 'ru'));
try {
  const login = await context.request.get(`/api/qa/login?tier=${tier}`);
  if (!login.ok() || !(await login.json()).synthetic) throw new Error('Synthetic login failed');
  const page = await context.newPage();
  page.on('pageerror', error => console.log('PAGEERROR', error.message));
  await page.goto(`/${route}`);
  await page.locator('.genesis-app').waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: 'Сегодня', exact: true }).first().waitFor();
  if (route === '#habits') await page.getByRole('button', { name: /Создать привычку|Новая привычка|Добавить привычку/ }).first().waitFor();
  for (const action of process.argv.slice(4)) await page.getByRole('button', { name: action, exact: true }).first().click();
  await page.waitForLoadState('networkidle');
  const snapshot = await page.locator('body').ariaSnapshot();
  const suffix = process.argv[4] ? '-action' : '';
  writeFileSync(`${output}/${tier}-${route.slice(1)}${suffix}.txt`, snapshot);
  await page.screenshot({ path: `${output}/${tier}-${route.slice(1)}${suffix}.png`, fullPage: true });
  console.log(snapshot);
} finally { await browser.close(); }
