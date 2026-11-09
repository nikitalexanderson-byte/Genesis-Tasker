import assert from "node:assert/strict";
import test from "node:test";
import { importWithRecovery } from "../app/module-recovery.ts";

test("a transient module fetch retries once and preserves the resolved module", async () => {
  let calls = 0;
  const loadedModule = { default: () => null };
  const result = await importWithRecovery(async () => {
    if (++calls === 1) throw new TypeError("Failed to fetch dynamically imported module: /assets/old.js");
    return loadedModule;
  }, async () => {});
  assert.equal(result, loadedModule);
  assert.equal(calls, 2);
});

test("permanent failure stops after two attempts without reloading or clearing pending work", async () => {
  let calls = 0;
  await assert.rejects(importWithRecovery(async () => {
    calls++;
    throw new TypeError("Importing a module script failed.");
  }, async () => {}), /module script failed/);
  assert.equal(calls, 2);
});

test("an application exception is not retried as a network failure", async () => {
  const error = new Error("Invalid task state");
  let calls = 0;
  await assert.rejects(importWithRecovery(async () => {
    calls++;
    throw error;
  }, async () => { throw new Error("Unexpected retry"); }), value => value === error);
  assert.equal(calls, 1);
});
