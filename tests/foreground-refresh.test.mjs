import assert from "node:assert/strict";
import test from "node:test";
import { foregroundRefresh } from "../app/foreground-refresh.ts";
import { deferred } from "./helpers/cloud-sync-client.mjs";

function fixture(operation) {
  const timers = new Map(); let next = 0, available = true;
  const results = [];
  const loop = foregroundRefresh(operation, { available: () => available,
    success: () => results.push("ok"), failure: error => results.push(error.message),
    schedule(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    cancel(id) { timers.delete(id); } });
  return { loop, timers, results, available(value) { available = value; } };
}

test("slow reads never overlap and stopping aborts the active request", async () => {
  const pending = deferred(); let requests = 0, signal;
  const f = fixture(async value => { requests++; signal = value; await pending.promise; });
  const first = f.loop.trigger();
  await Promise.all([f.loop.trigger(), f.loop.trigger(), f.loop.trigger()]);
  assert.equal(requests, 1); assert.equal(f.timers.size, 0);
  f.loop.stop(); assert.equal(signal.aborted, true);
  pending.resolve(); await first;
  assert.deepEqual(f.results, []); assert.equal(f.timers.size, 0);
});

test("failed refreshes back off and a successful retry clears failure", async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error("timeout"); });
  for (const delay of [10000, 20000, 30000, 30000]) {
    await f.loop.trigger(); assert.equal([...f.timers.values()][0].ms, delay);
  }
  fail = false; await f.loop.trigger();
  assert.equal(f.results.at(-1), "ok");
  assert.equal([...f.timers.values()][0].ms, 5000);
  f.loop.stop(); assert.equal(f.timers.size, 0);
});

test("background and offline windows do not issue a request", async () => {
  let requests = 0;
  const f = fixture(async () => { requests++; }); f.available(false);
  await f.loop.trigger(); assert.equal(requests, 0);
  f.available(true); await f.loop.trigger(); assert.equal(requests, 1);
  f.loop.stop(); await f.loop.trigger(); assert.equal(requests, 1);
});
