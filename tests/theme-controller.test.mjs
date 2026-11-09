import test from "node:test";
import assert from "node:assert/strict";
import {
  GENESIS_THEME,
  GENESIS_THEME_LABEL,
  ThemeConflictError,
  createGenesisThemeController,
  normalizeGenesisTheme,
  withExperimentalTheme,
  withThemeColorMode,
} from "../app/theme-controller.ts";

test("switching the visual family preserves color mode, and switching color preserves family", () => {
  assert.equal(withExperimentalTheme(GENESIS_THEME.STANDART_DARK, true), GENESIS_THEME.EXPERIMENTAL_DARK);
  assert.equal(withExperimentalTheme(GENESIS_THEME.EXPERIMENTAL_DARK, false), GENESIS_THEME.STANDART_DARK);
  assert.equal(withExperimentalTheme(GENESIS_THEME.STANDART, true), GENESIS_THEME.EXPERIMENTAL);
  assert.equal(withExperimentalTheme(GENESIS_THEME.EXPERIMENTAL, false), GENESIS_THEME.STANDART);
  assert.equal(withThemeColorMode(GENESIS_THEME.EXPERIMENTAL_DARK, false), GENESIS_THEME.EXPERIMENTAL);
  assert.equal(withThemeColorMode(GENESIS_THEME.EXPERIMENTAL, true), GENESIS_THEME.EXPERIMENTAL_DARK);
  assert.equal(withThemeColorMode(GENESIS_THEME.STANDART_DARK, false), GENESIS_THEME.STANDART);
  assert.equal(withThemeColorMode(GENESIS_THEME.STANDART, true), GENESIS_THEME.STANDART_DARK);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (condition()) return;
    await tick();
  }
  throw new Error("Theme controller test timed out");
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};
const root = () => {
  const attributes = {};
  return { attributes, setAttribute(name, value) { attributes[name] = value; } };
};
const memoryAdapter = (initial = {}) => {
  const records = new Map(Object.entries(initial));
  const writes = [];
  return {
    records,
    writes,
    async read({ accountId }) {
      return records.get(accountId) ?? { theme: null, revision: 0 };
    },
    async write({ accountId, theme, expectedRevision }) {
      writes.push({ accountId, theme, expectedRevision });
      const previous = records.get(accountId) ?? { theme: null, revision: 0 };
      if (previous.revision !== expectedRevision) throw new ThemeConflictError();
      const next = { theme, revision: previous.revision + 1 };
      records.set(accountId, next);
      return next;
    },
  };
};

test("theme names are exact and unknown values fall back to Standart", () => {
  assert.equal(GENESIS_THEME_LABEL.standart, "Standart");
  assert.equal(GENESIS_THEME_LABEL.experimental, "Experimental");
  for (const value of [null, undefined, "standard", "dark", 42]) {
    assert.equal(normalizeGenesisTheme(value), GENESIS_THEME.STANDART);
  }
});

test("unset account stays Standart without a migration write", async () => {
  const pageRoot = root();
  const adapter = memoryAdapter();
  const controller = createGenesisThemeController({ root: pageRoot, adapter });
  await controller.bindAccount("account-a");
  assert.equal(pageRoot.attributes["data-genesis-theme"], "standart");
  assert.equal(adapter.writes.length, 0);
});

test("fast on/off is serialized and latest intent wins", async () => {
  const gate = deferred();
  const adapter = memoryAdapter();
  const originalWrite = adapter.write.bind(adapter);
  const calls = [];
  let writeNumber = 0;
  adapter.write = async (input) => {
    calls.push(input.theme);
    if (writeNumber++ === 0) await gate.promise;
    return originalWrite(input);
  };
  const controller = createGenesisThemeController({ root: root(), adapter });
  await controller.bindAccount("account-a");
  controller.setTheme("experimental");
  controller.setTheme("standart");
  gate.resolve();
  await waitFor(() => !controller.getState().pending);
  assert.deepEqual(calls, ["experimental", "standart"]);
  assert.equal(adapter.records.get("account-a").theme, "standart");
});

test("save errors keep the selected theme locally and can be retried", async () => {
  const failing = memoryAdapter();
  const recoveredWrite = failing.write.bind(failing);
  failing.write = async () => { throw new Error("offline"); };
  const first = createGenesisThemeController({ root: root(), adapter: failing });
  await first.bindAccount("account-a");
  first.setTheme("experimental");
  await waitFor(() => !first.getState().pending);
  assert.equal(first.getState().theme, "experimental");
  assert.equal(first.getState().savedTheme, "standart");
  assert.equal(first.getState().error, "save-failed");
  failing.write = recoveredWrite;
  first.retry();
  await waitFor(() => !first.getState().pending && first.getState().savedTheme === "experimental");
  assert.equal(failing.records.get("account-a").theme, "experimental");
});

test("revision conflicts refresh server state and retry the latest intent", async () => {
  const conflicting = memoryAdapter();
  const second = createGenesisThemeController({ root: root(), adapter: conflicting });
  await second.bindAccount("account-a");
  conflicting.records.set("account-a", { theme: "standart", revision: 3 });
  second.setTheme("experimental");
  await waitFor(() => !second.getState().pending);
  assert.equal(second.getState().error, null);
  assert.equal(second.getState().theme, "experimental");
  assert.equal(conflicting.records.get("account-a").theme, "experimental");
  assert.equal(conflicting.records.get("account-a").revision, 4);
});

test("logout, account switches and the kill switch always paint Standart safely", async () => {
  const adapter = memoryAdapter({ a: { theme: "experimental", revision: 2 } });
  const pageRoot = root();
  const controller = createGenesisThemeController({ root: pageRoot, adapter });
  await controller.bindAccount("a");
  assert.equal(pageRoot.attributes["data-genesis-theme"], "experimental");
  await controller.bindAccount("b");
  assert.equal(pageRoot.attributes["data-genesis-theme"], "standart");
  await controller.bindAccount("a");
  controller.setAvailable(false);
  assert.equal(pageRoot.attributes["data-genesis-theme"], "standart");
  assert.equal(adapter.writes.length, 0);
  await controller.bindAccount(null);
  assert.equal(pageRoot.attributes["data-genesis-theme"], "standart");
});

test("all 72 theme/calendar/time combinations preserve non-theme preferences", async () => {
  const calendarModes = ["sacred", "lunar", "profane"];
  const timeFormats = ["24h", "12h"];
  let checked = 0;
  for (const displayCalendar of calendarModes) {
    for (const taskCalendar of calendarModes) {
      for (const timeFormat of timeFormats) {
        for (const theme of ["standart", "standart-dark", "experimental", "experimental-dark"]) {
          const preferences = { displayCalendar, taskCalendar, timeFormat };
          const before = structuredClone(preferences);
          const adapter = memoryAdapter();
          const controller = createGenesisThemeController({ root: root(), adapter });
          await controller.bindAccount(`matrix-${checked}`);
          if (theme !== "standart") {
            controller.setTheme(theme);
            await waitFor(() => !controller.getState().pending);
          }
          assert.deepEqual(preferences, before);
          assert.ok(adapter.writes.every((write) => Object.keys(write).sort().join(",") === "accountId,expectedRevision,theme"));
          controller.destroy();
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 72);
});
