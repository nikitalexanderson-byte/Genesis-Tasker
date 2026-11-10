import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { verifySharedRetention } from './web-shared-retention.mjs';
import { verifyRelease317 } from './web-317.mjs';
import { verifyCalendarVisual317 } from './web-calendar-visual317.mjs';
import { verifySharedInbox } from './web-shared-inbox.mjs';
import { sanitizeTraceFile } from './trace-sanitize.mjs';
import { verifyTrialWeb317 } from './web-trials317.mjs';
import { runHeaderStartup } from './web-header-startup.mjs';
import { chooseDisplayCalendar } from './display-calendar-control.mjs';

const baseURL = process.env.GENESIS_QA_WEB_ORIGIN ?? 'http://127.0.0.1:4380';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error('Only isolated loopback web origin is allowed');
const phase = process.env.GENESIS_QA_PHASE ?? 'baseline';
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('Invalid QA phase');
const output = process.env.GENESIS_QA_WEB_OUTPUT ?? `output/playwright/full-qa/web-${phase}`;
mkdirSync(output, { recursive: true });
const tiers = process.env.GENESIS_QA_TIERS?.split(',') ?? ['free', 'standart', 'premium', 'business', 'premium4life'];
assert(tiers.every(tier => ['free', 'standart', 'premium', 'business', 'premium4life'].includes(tier)));
const results = [];
const browser = await chromium.launch({ headless: true });
const browserIdentity = { name: 'Chromium', version: browser.version(), driver: 'playwright', driverVersion: createRequire(import.meta.url)('playwright/package.json').version };
const stamp = Date.now().toString(36);

async function newContext(tier) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  await context.route(/https?:\/\//, route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await context.addInitScript((origin) => {
    if (location.origin === origin) localStorage.setItem('genesis-language-v1', 'ru');
  }, new URL(baseURL).origin);
  const login = await context.request.get(`/api/qa/login?tier=${tier}`);
  assert(login.ok() && (await login.json()).synthetic, 'Login must be a synthetic local fixture');
  return context;
}

try {
  for (const tier of tiers) {
    const context = await newContext(tier);
    await context.tracing.start({ screenshots: false, snapshots: true, sources: true });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [], apiFailures = [];
    let taskTitle = `QA ${tier} ${stamp} 📅 задача`;
    let savedMapUrl = '';
    const projectTitle = `QA ${tier} ${stamp} проект`, habitTitle = `QA ${tier} ${stamp} привычка`, noteTitle = `QA ${tier} ${stamp} заметка`, mapTitle = `QA ${tier} ${stamp} карта`;
    const savedWorkspace = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace' && response.request().method() === 'PUT' && response.status() === 200);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(baseURL + '/api/') && response.status() >= 400) apiFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    const save = () => writeFileSync(`${output}/results.json`, JSON.stringify({ schemaVersion: 1, platform: 'web', phase, browser: browserIdentity, results }, null, 2));
    const snapshot = async id => {
      await page.screenshot({ path: `${output}/${tier}-${id}.png`, fullPage: true, animations: 'disabled' });
      writeFileSync(`${output}/${tier}-${id}.txt`, await page.locator('body').ariaSnapshot());
    };
    const check = async (id, operation) => {
      const started = performance.now();
      try { await operation(); results.push({ id: `web.${tier}.${id}`, planId: tier, platformId: 'web', status: 'PASS', durationMs: Math.round(performance.now() - started), evidence: [`${output}/${tier}-${id}.png`] }); }
      catch (error) {
        await snapshot(id + '-failure').catch(() => {});
        results.push({ id: `web.${tier}.${id}`, planId: tier, platformId: 'web', status: 'FAIL', error: error.message, durationMs: Math.round(performance.now() - started), evidence: [`${output}/${tier}-${id}-failure.png`, `${output}/${tier}-${id}-failure.txt`] });
        // Preserve the failure, then dismiss transient modal state for independent checks.
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      save(); console.log(`${results.at(-1).status} ${tier} ${id}`);
      if (results.at(-1).error) console.error(results.at(-1).error);
    };
    try {
      await check('session', async () => {
        const session = await (await context.request.get('/api/session')).json();
        assert.equal(session.user.isAdmin, false);
        assert.equal(session.user.subscriptionPlan, tier);
        assert.equal(session.user.featureAccess.enforcementEnabled, true);
        assert(session.user.email.endsWith('@example.invalid'));
        await page.goto('/#habits');
        await page.getByRole('button', { name: 'Новая привычка', exact: true }).waitFor();
        await snapshot('session');
      });
      await check('stale-shared-preference', async () => {
        // Legacy enabled preference remains after downgrade. Merely opening a personal screen must not sell a plan.
        await page.waitForLoadState('networkidle');
        assert.equal(await page.getByRole('dialog', { name: /Больше возможностей GENESIS/ }).count(), 0, 'Background shared polling opened an unsolicited upgrade dialog');
        assert.equal(apiFailures.filter(item => item.path.startsWith('/api/shared/')).length, 0, 'Inaccessible shared APIs must not be polled');
        await snapshot('stale-shared-preference');
      });
      if (tier === 'business') await verifyCalendarVisual317({context,page,tier,output,check,snapshot});
      const upgrade = page.getByRole('dialog', { name: /Больше возможностей GENESIS/ });
      if (await upgrade.count()) await upgrade.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await check('task-create', async () => {
        await page.getByRole('button', { name: 'Сегодня', exact: true }).first().click();
        await page.getByRole('button', { name: 'Создать задачу', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Создать · Личное дело', exact: true });
        assert(await dialog.getByRole('button', { name: 'Добавить задачу', exact: true }).isDisabled());
        await dialog.getByRole('textbox', { name: 'Новая задача', exact: true }).fill('   ');
        assert(await dialog.getByRole('button', { name: 'Добавить задачу', exact: true }).isDisabled(), 'Whitespace-only tasks must not be accepted');
        await dialog.getByRole('textbox', { name: 'Новая задача', exact: true }).fill(taskTitle);
        await dialog.getByRole('button', { name: 'Добавить задачу', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).waitFor();
        await snapshot('task-create');
      });
      await check('task-local-reload', async () => {
        // The documented no-Google-connection mode stores personal tasks only on this device.
        await page.reload();
        await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).count(), 1);
        await snapshot('task-local-reload');
      });
      await check('task-complete', async () => {
        await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).click();
        await page.getByRole('button', { name: `Вернуть задачу «${taskTitle}»`, exact: true }).waitFor();
        await page.reload();
        await page.getByRole('button', { name: `Вернуть задачу «${taskTitle}»`, exact: true }).waitFor();
        await snapshot('task-complete');
      });
      await check('task-uncomplete', async () => {
        await page.getByRole('button', { name: `Вернуть задачу «${taskTitle}»`, exact: true }).click();
        await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).waitFor();
        await snapshot('task-uncomplete');
      });
      await check('task-local-editor-explanation', async () => {
        await page.getByRole('button', { name: `Редактировать задачу «${taskTitle}»`, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Задача и её контекст', exact: true });
        await dialog.waitFor();
        assert(!/Изменения синхронизируются с Google Calendar/.test(await dialog.innerText()), 'Disconnected local task incorrectly promises Google Calendar sync');
        await snapshot('task-local-editor-explanation');
      });
      await check('task-edit', async () => {
        const dialog = page.getByRole('dialog', { name: 'Задача и её контекст', exact: true });
        const changed = taskTitle + ' — изменено';
        await dialog.getByRole('textbox', { name: 'Название', exact: true }).fill(changed);
        await dialog.getByRole('button', { name: /^Сохранить(?: задачу)?$/ }).click();
        taskTitle = changed;
        await page.reload();
        await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).waitFor();
        await snapshot('task-edit');
      });
      await check('project-create', async () => {
        await page.getByRole('button', { name: 'Дела', exact: true }).first().click();
        await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Новый проект', exact: true });
        await dialog.getByRole('textbox', { name: 'Новый проект или подпроект', exact: true }).fill(projectTitle);
        await dialog.getByRole('textbox', { name: 'Описание проекта', exact: true }).fill('Синтетическое QA: кириллица, emoji 🌱, новая строка\nи повторное открытие.');
        await Promise.all([savedWorkspace(), dialog.getByRole('button', { name: /^(Сохранить|Создать проект)$/ }).click()]);
        await dialog.waitFor({ state: 'hidden' });
        await snapshot('project-create');
      });
      await check('project-second-client', async () => {
        const second = await newContext(tier);
        try {
          const otherPage = await second.newPage();
          await otherPage.goto('/#projects');
          await otherPage.getByText(projectTitle, { exact: true }).first().waitFor();
          assert.equal(await otherPage.getByText(taskTitle, { exact: true }).count(), 0, 'Local-only personal tasks must not leak into a fresh device');
          await otherPage.screenshot({ path: `${output}/${tier}-project-second-client.png`, fullPage: true });
        } finally { await second.close(); }
      });
      await check('habit-create', async () => {
        await page.getByRole('button', { name: 'Привычки', exact: true }).first().click();
        await page.getByRole('button', { name: 'Новая привычка', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Новая привычка', exact: true });
        await dialog.getByRole('textbox', { name: 'Название', exact: true }).fill(habitTitle);
        await Promise.all([savedWorkspace(), dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()]);
        await dialog.waitFor({ state: 'hidden' });
        await snapshot('habit-create');
      });
      await check('habit-complete', async () => {
        await Promise.all([savedWorkspace(), page.getByRole('button', { name: `Отметить «${habitTitle}»`, exact: true }).click()]);
        await page.getByRole('button', { name: `Снять отметку «${habitTitle}»`, exact: true }).waitFor();
        await snapshot('habit-complete');
      });
      await check('habit-second-client', async () => {
        const second = await newContext(tier);
        try {
          const other = await second.newPage(); await other.goto('/#habits');
          await other.getByRole('button', { name: `Снять отметку «${habitTitle}»`, exact: true }).waitFor();
          await other.screenshot({ path: `${output}/${tier}-habit-second-client.png`, fullPage: true });
        } finally { await second.close(); }
      });
      await check('habit-uncomplete', async () => {
        await Promise.all([savedWorkspace(), page.getByRole('button', { name: `Снять отметку «${habitTitle}»`, exact: true }).click()]);
        await page.getByRole('button', { name: `Отметить «${habitTitle}»`, exact: true }).waitFor();
        await snapshot('habit-uncomplete');
      });
      await check('habit-timer-access', async () => {
        await page.locator('[data-habit-reminder]').filter({ hasText: habitTitle }).getByRole('button', { name: 'Таймер', exact: true }).click();
        const timer = page.getByRole('region', { name: 'Таймер', exact: true });
        if (tier === 'free') {
          assert(await timer.getByRole('button', { name: 'Начать', exact: true }).isDisabled());
          await timer.getByRole('button', { name: 'Подключить больше функций', exact: true }).click();
          await page.getByRole('dialog', { name: /Больше возможностей GENESIS/ }).waitFor();
          await snapshot('habit-timer-access');
          await page.getByRole('dialog', { name: /Больше возможностей GENESIS/ }).getByRole('button', { name: 'Закрыть', exact: true }).click();
        } else {
          await timer.getByRole('button', { name: 'Начать', exact: true }).click();
          await timer.getByRole('button', { name: 'Пауза', exact: true }).click();
          await timer.getByRole('button', { name: 'Продолжить', exact: true }).waitFor();
          assert.equal(await page.getByRole('dialog', { name: /Больше возможностей GENESIS/ }).count(), 0);
          await snapshot('habit-timer-access');
        }
      });
      await check('diary-create', async () => {
        await page.reload();
        await page.getByRole('button', { name: 'Дела', exact: true }).first().click();
        await page.getByRole('button', { name: 'Дневник', exact: true }).click();
        await page.getByRole('button', { name: 'Новая заметка', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Новая заметка', exact: true });
        await dialog.getByRole('textbox', { name: 'Заголовок', exact: true }).fill(noteTitle);
        await dialog.getByRole('textbox', { name: 'Запись', exact: true }).fill('Только синтетические данные 🌱\nТело заметки после перезапуска и синхронизации.');
        await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: `Открыть заметку: ${noteTitle}`, exact: true }).waitFor();
        await snapshot('diary-create');
      });
      await check('diary-second-client', async () => {
        const second = await newContext(tier);
        try {
          const other = await second.newPage(); await other.goto('/?diary=1#projects');
          await other.getByRole('button', { name: `Открыть заметку: ${noteTitle}`, exact: true }).waitFor();
          assert((await other.locator('.diary-page').innerText()).includes('Тело заметки после перезапуска'));
          await other.screenshot({ path: `${output}/${tier}-diary-second-client.png`, fullPage: true });
        } finally { await second.close(); }
      });
      await check('diary-edit-search-pin', async () => {
        await page.getByRole('button', { name: `Открыть заметку: ${noteTitle}`, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Редактировать заметку', exact: true });
        await dialog.getByRole('textbox', { name: 'Запись', exact: true }).fill('Обновлённая заметка: ёж, Greek Ω, emoji 🌱.');
        await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
        const note = page.locator('.diary-note').filter({ hasText: noteTitle });
        await note.getByRole('button', { name: 'Закрепить', exact: true }).click();
        await note.getByRole('button', { name: 'Открепить', exact: true }).waitFor();
        await page.getByRole('searchbox', { name: 'Поиск в дневнике', exact: true }).fill('Ω');
        await note.waitFor();
        await snapshot('diary-edit-search-pin');
        await page.getByRole('searchbox', { name: 'Поиск в дневнике', exact: true }).fill('');
      });
      await check('diary-archive-restore', async () => {
        const note = page.locator('.diary-note').filter({ hasText: noteTitle });
        await note.getByRole('button', { name: 'В архив', exact: true }).click(); await note.waitFor({ state: 'hidden' });
        await page.getByLabel('Ещё', { exact: true }).click();
        await page.getByRole('button', { name: 'Архив', exact: true }).click();
        await note.getByRole('button', { name: 'Вернуть в дневник', exact: true }).click();
        await page.locator('.diary-heading .diary-back').click();
        await note.waitFor(); await snapshot('diary-archive-restore');
      });
      await check('mindmap-create', async () => {
        await page.getByRole('button', { name: 'К личным делам', exact: true }).click();
        await page.getByRole('button', { name: 'Майндмепы', exact: true }).click();
        await page.getByRole('button', { name: 'Создать карту', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Новая карта', exact: true });
        await dialog.getByRole('textbox', { name: 'Название карты', exact: true }).fill(mapTitle);
        await dialog.getByRole('button', { name: 'Создать карту', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({ state: 'attached' });
        savedMapUrl = page.url();
        await snapshot('mindmap-create');
      });
      await check('mindmap-edit-second-client', async () => {
        await page.getByRole('button', { name: 'Настройка карты', exact: true }).click();
        await page.getByRole('textbox', { name: 'Описание', exact: true }).fill('Карта синтетического теста — сохранённое описание 🌱.');
        await page.getByRole('textbox', { name: 'Название карты', exact: true }).click();
        await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({ state: 'attached' });
        const second = await newContext(tier);
        try {
          const other = await second.newPage(); await other.goto(page.url());
          await other.getByText('Карта синтетического теста — сохранённое описание 🌱.', { exact: true }).waitFor();
          await other.screenshot({ path: `${output}/${tier}-mindmap-edit-second-client.png`, fullPage: true });
        } finally { await second.close(); }
        await snapshot('mindmap-edit-second-client');
        const settings = page.getByRole('dialog', { name: 'Настройка карты', exact: true });
        await settings.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await settings.waitFor({ state: 'hidden' });
      });
      await check('today-editor-independent-map-history', async () => {
        await page.getByRole('button', { name: 'Сегодня', exact: true }).first().click();
        await page.waitForLoadState('networkidle');
        const baseline = await page.evaluate(() => history.length);
        for (let cycle = 0; cycle < 2; cycle++) {
          await page.getByRole('button', { name: `Редактировать задачу «${taskTitle}»`, exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Задача и её контекст', exact: true });
          await dialog.waitFor();
          await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
          const navigation = await page.evaluate(() => ({length:history.length,mapTask:history.state?.genesisMindmapTaskPanel??false}));
          assert.equal(navigation.mapTask, false, 'Today editor adopted a hidden map navigation entry');
          assert.equal(navigation.length, baseline, 'Today editor added a hidden map navigation entry');
          await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
          await dialog.waitFor({state:'hidden'});
        }
        await snapshot('today-editor-independent-map-history');
      });
      await check('task-offline-edit', async () => {
        await page.getByRole('button', { name: 'Сегодня', exact: true }).first().click();
        await page.getByRole('button', { name: `Редактировать задачу «${taskTitle}»`, exact: true }).waitFor();
        await context.setOffline(true);
        try {
          await page.getByRole('button', { name: `Редактировать задачу «${taskTitle}»`, exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Задача и её контекст', exact: true });
          const offlineTitle = taskTitle + ' офлайн';
          await dialog.getByRole('textbox', { name: 'Название', exact: true }).fill(offlineTitle);
          await dialog.getByRole('button', { name: /^Сохранить(?: задачу)?$/ }).click();
          taskTitle = offlineTitle;
          await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).waitFor();
          await snapshot('task-offline-edit');
        } finally { await context.setOffline(false); }
        // Confirm that Chromium's emulated connection is usable before navigation.
        // A failed probe fails this scenario; no operation or reload is retried.
        const online = await page.evaluate(async () => {
          const response = await fetch('/api/health', {cache:'no-store', signal:AbortSignal.timeout(5000)});
          return {online:navigator.onLine,status:response.status};
        });
        assert.equal(online.online, true); assert.equal(online.status, 200);
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: `Завершить задачу «${taskTitle}»`, exact: true }).waitFor();
      });
      await check('task-delete-reload', async () => {
        await page.getByRole('button', { name: `Редактировать задачу «${taskTitle}»`, exact: true }).click();
        await page.getByRole('dialog', { name: 'Задача и её контекст', exact: true }).getByRole('button', { name: 'Удалить', exact: true }).click();
        // A non-recurring local task is removed immediately; only series show a scope dialog.
        await page.getByRole('dialog', { name: 'Задача и её контекст', exact: true }).waitFor({ state: 'hidden' });
        await page.reload(); await page.getByRole('button', { name: 'Создать задачу', exact: true }).first().waitFor();
        assert.equal(await page.getByText(taskTitle, { exact: true }).count(), 0);
        await snapshot('task-delete-reload');
      });
      await check('today-date-independent', async () => {
        await chooseDisplayCalendar(page, 'profane');
        await page.getByRole('button', { name: 'Сегодня', exact: true }).first().click();
        const actualDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
        assert.equal(await page.locator('.hero-day-title-translation').innerText(), actualDate);
        await page.getByRole('button', { name: 'Календарь', exact: true }).first().click();
        await page.getByRole('button', { name: 'Следующий календарный месяц', exact: true }).click();
        await page.getByRole('region', { name: /^Григорианский календарь:/ }).getByRole('button').first().click();
        const details = page.getByRole('dialog');
        await details.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await details.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Сегодня', exact: true }).first().click();
        assert.equal(await page.locator('.hero-day-title-translation').innerText(), actualDate, 'Today followed the selected calendar date');
        await snapshot('today-date-independent');
      });
      await check('oracle-three-card-access', async () => {
        await page.getByRole('button', { name: 'Оракул', exact: true }).first().click();
        const begin = page.getByTestId('stoicheion-timeline-past');
        await begin.waitFor();
        if (tier === 'free') {
          assert(await begin.isDisabled());
          await page.getByText('Прорицание по трём картам доступно в Standard и выше.', { exact: true }).waitFor();
        } else {
          await begin.click();
          const draw = page.getByRole('dialog', { name: 'Откройте три времени движением', exact: true });
          await draw.waitFor();
          await snapshot('oracle-three-card-access');
          await draw.getByRole('button', { name: 'Отменить выбор', exact: true }).click();
          await draw.waitFor({ state: 'hidden' });
        }
        await snapshot('oracle-three-card-access');
      });
      await check('oracle-daily-draw-persistence', async () => {
        await page.getByRole('button', { name: 'Начать выбор случайной буквы дня движением', exact: true }).click();
        const field = page.getByRole('button', { name: 'Собирать случайность движением мыши, пальца или клавишами со стрелками', exact: true });
        await field.waitFor();
        // Entropy input itself can take over 20s on a loaded QA host. Keep the
        // save assertion, and settle the input before recovery even on failure.
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/stoicheion/draws' && response.request().method() === 'POST' && response.status() === 200, { timeout: 60_000 });
        const completed = await Promise.allSettled([saved, (async () => {
          for (let i = 0; i < 100 && await field.isVisible(); i++) await field.press(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][i % 4]);
        })()]);
        for (const result of completed) if (result.status === 'rejected') throw result.reason;
        const card = page.locator('.stoicheion-revealed-card');
        await card.waitFor();
        const label = await card.getAttribute('aria-label');
        assert(label && label.includes('Открыть полное описание'));
        const second = await newContext(tier);
        try {
          const other = await second.newPage(); await other.goto('/#stoicheion');
          await other.locator('.stoicheion-revealed-card').waitFor();
          assert.equal(await other.locator('.stoicheion-revealed-card').getAttribute('aria-label'), label);
          await other.screenshot({ path: `${output}/${tier}-oracle-daily-second-client.png`, fullPage: true });
        } finally { await second.close(); }
        await snapshot('oracle-daily-draw-persistence');
      });
      for (const mode of ['profane', 'sacred', 'lunar']) {
        await check(`calendar-${mode}`, async () => {
          await page.getByRole('button', { name: 'Календарь', exact: true }).first().click();
          await chooseDisplayCalendar(page, mode);
          assert.equal(await page.locator('.calendar-mode-cycle').getAttribute('data-calendar-mode'), mode);
          const month = page.getByRole('tabpanel', { name: 'Месяц', exact: true });
          await month.waitFor();
          assert((await month.getByRole('button').count()) > 20, 'The selected calendar has no selectable days');
          await page.getByRole('tab', { name: 'Круг года', exact: true }).click();
          await page.getByRole('tabpanel', { name: 'Круг года', exact: true }).waitFor();
          assert((await page.locator('.year-month').count()) >= 12);
          await snapshot(`calendar-${mode}`);
          await page.getByRole('tab', { name: 'Месяц', exact: true }).click();
          await month.waitFor();
        });
      }
      await check('physis-access', async () => {
        const physis = page.getByRole('button', { name: 'Фюзис', exact: true }).first();
        if (tier !== 'premium4life') {
          assert.equal(await physis.count(), 0, 'An ineligible plan exposes the Physis navigation');
        } else {
          await physis.click();
          await page.getByRole('heading', { name: 'Фюзис', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Пустое занятие', exact: true }).click();
          const journal = page.getByRole('region', { name: 'Журнал тренировки', exact: true });
          const note = `QA ${stamp} сохранённая тренировка 🌱`;
          await journal.getByRole('textbox', { name: 'Заметка о тренировке', exact: true }).fill(note);
          await journal.getByRole('button', { name: 'Сохранить и закрыть', exact: true }).click();
          const second = await newContext(tier);
          try {
            const other = await second.newPage(); await other.goto('/#physis');
            await other.getByRole('button', { name: 'Продолжить тренировку', exact: true }).click();
            assert.equal(await other.getByRole('textbox', { name: 'Заметка о тренировке', exact: true }).inputValue(), note);
            await other.screenshot({ path: `${output}/${tier}-physis-second-client.png`, fullPage: true });
          } finally { await second.close(); }
        }
        await snapshot('physis-access');
      });
      for (const width of [360, 390, 768, 1440]) {
        for (const scheme of ['light', 'dark']) {
          await check(`responsive-${width}-${scheme}`, async () => {
            await page.setViewportSize({ width, height: 1000 });
            const desired = scheme === 'dark' ? 'standart-dark' : 'standart';
            if (await page.locator('html').getAttribute('data-genesis-theme') !== desired) {
              await page.getByRole('button', { name: scheme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему', exact: true }).click();
            }
            assert.equal(await page.locator('html').getAttribute('data-genesis-theme'), desired);
            for (const [screen, label] of [['today', 'Сегодня'], ['habits', 'Привычки']]) {
              await page.locator('.app-sidebar nav, .mobile-nav').getByRole('button', { name: label, exact: true }).first().click();
              await page.getByRole('button', { name: screen === 'today' ? 'Создать задачу' : 'Новая привычка', exact: true }).first().waitFor();
              const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
              assert(bounds.scroll <= bounds.width + 1, `${screen} overflows: ${JSON.stringify(bounds)}`);
              await page.screenshot({ path: `${output}/${tier}-responsive-${width}-${scheme}-${screen}.png`, fullPage: true, animations: 'disabled' });
            }
            assert(savedMapUrl, 'The saved map prerequisite is missing');
            await page.goto(savedMapUrl);
            await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({ state: 'attached' });
            assert.equal(await page.locator('html').getAttribute('data-genesis-theme'), desired);
            const mapBounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
            assert(mapBounds.scroll <= mapBounds.width + 1, `Mindmap page overflows: ${JSON.stringify(mapBounds)}`);
            await page.screenshot({ path: `${output}/${tier}-responsive-${width}-${scheme}-mindmap.png`, fullPage: true, animations: 'disabled' });
            await snapshot(`responsive-${width}-${scheme}`);
          });
        }
      }
      await verifyRelease317({context,page,tier,output,check,snapshot});
      if (['business', 'premium4life'].includes(tier)) {
        await check('shared-inbox-coverage', async () => {
          const firstResult = results.length;
          const fixture = await verifySharedInbox({ context, page, tier, output,
            runtime: process.env.GENESIS_QA_BACKEND_RUNTIME, php: process.env.GENESIS_QA_PHP,
            check: async (id, operation) => {
              await check(id, async () => { await operation(); await snapshot(id); });
              assert.equal(results.at(-1).status, 'PASS', 'Dependent inbox fixture stopped after '+id+'; original failure is preserved');
            } });
          writeFileSync(`${output}/${tier}-shared-inbox-fixture.json`, JSON.stringify(fixture, null, 2));
          assert(!results.slice(firstResult).some(result => result.status !== 'PASS'), 'Shared inbox checks failed; see individual cases');
          await snapshot('shared-inbox-coverage');
        });
        await check('shared-existing-after-downgrade', async () => verifySharedRetention({ context, page, tier, output, baseURL }));
      }
      await check('no-uncaught-errors', async () => {
        assert.deepEqual(errors, [], 'Unhandled browser exceptions');
        await snapshot('no-uncaught-errors');
      });
    } finally {
      const traceDirectory = mkdtempSync(path.join(tmpdir(), 'genesis-qa-trace-'));
      const rawTrace = path.join(traceDirectory, 'raw.zip');
      try {
        writeFileSync(`${output}/${tier}-diagnostics.json`, JSON.stringify({ errors, apiFailures }, null, 2));
        await context.tracing.stop({ path: rawTrace });
        const sanitization = sanitizeTraceFile(rawTrace, `${output}/${tier}-trace.sanitized.zip`);
        writeFileSync(`${output}/${tier}-trace-sanitization.json`, JSON.stringify(sanitization, null, 2));
      } catch (error) {
        // Collection failures remain FAIL, but must not prevent independent plans from being tested.
        const failure = { id: `web.${tier}.trace-collection`, planId: tier, platformId: 'web', status: 'FAIL', error: error.message, evidence: [`${output}/${tier}-trace-collection-error.json`] };
        writeFileSync(`${output}/${tier}-trace-collection-error.json`, JSON.stringify(failure, null, 2));
        results.push(failure);save();console.error(`FAIL ${tier} trace-collection: ${error.message}`);
      } finally {
        // Raw credentials never enter the report/upload tree, even on sanitizer failure.
        try { rmSync(rawTrace, { force: true }); rmdirSync(traceDirectory); }
        finally { await context.close(); }
      }
    }
  }
  results.push(...await verifyTrialWeb317({browser,baseURL,output}));
  const header=await runHeaderStartup({browser,baseURL,output:path.join(output,'header-startup')});
  results.push(...header.cases);
  writeFileSync(`${output}/results.json`,JSON.stringify({schemaVersion:1,platform:'web',phase,browser:browserIdentity,results},null,2));
} finally { await browser.close(); }
process.exitCode = results.some(result => result.status !== 'PASS') ? 1 : 0;
