import assert from 'node:assert/strict';

/** Select the requested display mode through the same single action as the user. */
export async function chooseDisplayCalendar(page, mode) {
  const control = page.locator('.calendar-mode-cycle');
  await control.waitFor();
  for (let step = 0; step < 3; step++) {
    const current = await control.getAttribute('data-calendar-mode');
    if (current === mode) return;
    await control.click();
    await page.waitForFunction(previous => document.querySelector('.calendar-mode-cycle')?.getAttribute('data-calendar-mode') !== previous, current);
  }
  assert.equal(await control.getAttribute('data-calendar-mode'), mode, 'Display calendar did not reach the requested mode');
}

/** Reproduce a session refresh returning the calendar that preceded a successful click. */
export async function verifyCalendarDuringSessionRefresh(page) {
  const control = page.locator('.calendar-mode-cycle');
  const initial = await control.getAttribute('data-calendar-mode');
  const sessionPath = '**/api/session';
  const captured = Promise.withResolvers(), release = Promise.withResolvers();
  const holdSession = async route => {
    let response;
    try {
      response = await route.fetch();
      captured.resolve((await response.json()).user?.calendarMode);
    } catch (error) {
      captured.reject(error);
      return route.abort();
    }
    await release.promise;
    await route.fulfill({response});
  };
  const isSave = response => new URL(response.url()).pathname === '/api/account/preferences' &&
    response.request().method() === 'PUT' && Boolean(response.request().postDataJSON()?.calendarMode);
  await page.route(sessionPath, holdSession, {times: 1});
  try {
    const refresh = page.waitForRequest(sessionPath);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refresh;
    assert.equal(await captured.promise, initial, 'The held server response should contain the previous calendar');
    const save = page.waitForResponse(isSave);
    await control.click();
    const response = await save;
    assert.equal(response.status(), 200);
    const chosen = response.request().postDataJSON().calendarMode;
    assert.notEqual(chosen, initial);
    const delivered = page.waitForResponse(sessionPath);
    release.resolve();
    await (await delivered).finished();
    await page.waitForLoadState('networkidle');
    assert.equal(await control.getAttribute('data-calendar-mode'), chosen, 'An older session response replaced the selected calendar');
    await page.reload();
    await page.waitForLoadState('networkidle');
    assert.equal(await control.getAttribute('data-calendar-mode'), chosen, 'Reload lost the saved calendar');
  } finally {
    release.resolve();
    await page.unroute(sessionPath, holdSession);
  }
}
