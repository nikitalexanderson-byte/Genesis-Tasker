import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysisAccessCheck } from '../app/physis/access-check.ts';

function fixture(request) {
  const states = [], timers = new Map(); let next = 0;
  const check = createPhysisAccessCheck('owner-a', request, status => states.push(status), {
    schedule(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    cancel(id) { timers.delete(id); },
  });
  return { ...check, states, timers };
}
const allowed = { available: true, ownerId: 'owner-a' };
const unavailable = { status: 403, payload: { error: 'PHYSIS_UNAVAILABLE' } };

test('default timers retain the browser global receiver while retrying and stopping', async () => {
  const originalSchedule = globalThis.setTimeout, originalCancel = globalThis.clearTimeout;
  let scheduled = 0, cancelled = 0;
  globalThis.setTimeout = function () { assert.equal(this, globalThis); return ++scheduled; };
  globalThis.clearTimeout = function () { assert.equal(this, globalThis); cancelled++; };
  try {
    const check = createPhysisAccessCheck('owner-a', async () => { throw new Error('offline'); }, () => {});
    await check.refresh(); await check.refresh(); check.stop();
    assert.equal(scheduled, 2); assert.equal(cancelled, 2);
  } finally { globalThis.setTimeout = originalSchedule; globalThis.clearTimeout = originalCancel; }
});

test('an initial connection failure retries and makes the eligible menu available', async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new TypeError('Failed to fetch'); return allowed; });
  await f.refresh(); assert.deepEqual(f.states, ['error']);
  assert.equal([...f.timers.values()][0].ms, 1000);
  fail = false; await f.refresh();
  assert.deepEqual(f.states, ['error', 'ready']); assert.equal(f.timers.size, 0); f.stop();
});

test('denied sessions never create a separate sign-in flow', async () => {
  for (const error of [unavailable, { status: 401 }, { status: 403, payload: { reauthRequired: 'true' } }]) {
    const f = fixture(async () => { throw error; }); await f.refresh();
    assert.deepEqual(f.states, ['unavailable']); assert.equal(f.timers.size, 0); f.stop();
  }
  const f = fixture(async () => { throw { status: 403, payload: { reauthRequired: true } }; });
  await f.refresh(); assert.deepEqual(f.states, ['unavailable']); f.stop();
});

test('another owner or a false availability never opens a vault', async () => {
  for (const response of [{ ...allowed, ownerId: 'owner-b' }, { ...allowed, available: false }]) {
    const f = fixture(async () => response); await f.refresh(); assert.deepEqual(f.states, ['unavailable']); f.stop();
  }
});

test('focus and reconnect checks do not overlap or revive a signed-out owner', async () => {
  let complete, requests = 0, signal;
  const f = fixture(async current => { requests++; signal = current; return new Promise(resolve => { complete = resolve; }); });
  const initial = f.refresh(); await f.refresh(); await f.refresh(); assert.equal(requests, 1);
  f.stop(); assert.equal(signal.aborted, true); complete(allowed); await initial;
  assert.deepEqual(f.states, []); await f.refresh(); assert.equal(requests, 1);
});

test('a transient check failure preserves an open unsaved vault, but explicit denial revokes it', async () => {
  let response = allowed, error;
  const f = fixture(async () => { if (error) throw error; return response; });
  await f.refresh(); error = new TypeError('offline'); await f.refresh();
  assert.deepEqual(f.states, ['ready']); assert.equal(f.timers.size, 1);
  error = unavailable; await f.refresh();
  assert.deepEqual(f.states, ['ready', 'unavailable']); assert.equal(f.timers.size, 0); f.stop();
});

test('retries back off and are removed when the owner changes', async () => {
  const f = fixture(async () => { throw new Error('timeout'); });
  for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await f.refresh(); assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, expected);
  }
  f.stop(); assert.equal(f.timers.size, 0);
});

test('returning to the page can recover a previously denied or legacy session', async () => {
  let error = { status: 403, payload: { reauthRequired: true } };
  const f = fixture(async () => { if (error) throw error; return allowed; });
  await f.refresh(); error = null; await f.refresh();
  assert.deepEqual(f.states, ['unavailable', 'ready']); f.stop();
});
