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
