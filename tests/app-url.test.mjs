import assert from "node:assert/strict";
import test from "node:test";

import { cleanGenesisAppUrl } from "../app/app-url.ts";
import { normalizeSharedPlace, sharedPlaceFromUrl, sharedPlaceUrl, recordSharedPlace, initialSharedPlace, savedSharedPlace, saveAffairsArea, storedAffairsArea } from "../app/shared-navigation.ts";

test("Google task links retain the workspace, project and task after URL cleanup", () => {
  const place = { spaceId: "workspace-1", projectId: "project-1", taskId: "task-1", view: "board" };
  const url = sharedPlaceUrl(new URL("https://genesiscalendar.com/?qa=old#calendar"), place);
  assert.deepEqual(sharedPlaceFromUrl(new URL(cleanGenesisAppUrl(url), url.origin)), place);
  assert.deepEqual(normalizeSharedPlace({ spaceId: "../private", projectId: "valid", taskId: "task" }), { spaceId: "", projectId: "", taskId: "", view: null });
  assert.equal(sharedPlaceFromUrl(new URL("https://genesiscalendar.com/?affairs=personal#projects")), null);
});

test("shared navigation restores links, browser history and separate users' last workplaces", () => {
  const previous = { window: globalThis.window, localStorage: globalThis.localStorage };
  const data = new Map(); const entries = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const browser = { localStorage: storage, location: { href: "https://genesiscalendar.com/#projects" }, history: { state: null,
    pushState(state, unused, url) { this.state = state; entries.push(url); browser.location.href = new URL(url, browser.location.href).href; },
    replaceState(state, unused, url) { this.state = state; browser.location.href = new URL(url, browser.location.href).href; } } };
  globalThis.window = browser; globalThis.localStorage = storage;
  try {
    const first = { spaceId: "space-1", projectId: "project-1", taskId: "", view: "list" };
    const second = { ...first, taskId: "task-2", view: "board" };
    saveAffairsArea("user-a", "shared"); recordSharedPlace("user-a", first, true); recordSharedPlace("user-a", second);
    recordSharedPlace("user-a", second);
    assert.equal(entries.length, 1, "a repeated render must not add a duplicate history entry");
    assert.deepEqual(initialSharedPlace("user-a"), second, "a task deep link must survive reload");
    browser.location.href = "https://genesiscalendar.com/#calendar";
    assert.deepEqual(initialSharedPlace("user-a"), second, "leaving Affairs must retain the last workplace");
    assert.equal(storedAffairsArea("user-a"), "shared");
    assert.equal(storedAffairsArea("user-b"), "personal");
    assert.deepEqual(savedSharedPlace("user-b"), { spaceId: "", projectId: "", taskId: "", view: null });
    data.set("genesis-shared-place-v1:user-b", "invalid-json");
    assert.equal(savedSharedPlace("user-b").spaceId, "");
    data.set("genesis-local-sign-out-v1", "{}");
    recordSharedPlace("user-a", first);
    saveAffairsArea("user-a", "personal");
    assert.equal(entries.length, 1, "a stale tab must not write history after logout");
    assert.equal(storedAffairsArea("user-a"), "shared", "a stale effect must not rewrite account preferences");
  } finally {
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.localStorage;
  }
});

test("comment destinations retain the exact discussion across reload and clear it on exit", () => {
  const place = { spaceId: "space-1", projectId: "project-1", taskId: "task-1", view: null, taskAction: "comments", commentId: "comment-2" };
  const url = sharedPlaceUrl(new URL("https://genesiscalendar.com/#today"), place);
  assert.deepEqual(sharedPlaceFromUrl(url), place);
  const next = sharedPlaceUrl(url, { ...place, taskId: "", taskAction: undefined, commentId: undefined });
  assert.equal(next.searchParams.has("comment"), false);
  assert.equal(next.searchParams.has("taskAction"), false);
  assert.equal(normalizeSharedPlace({ ...place, commentId: "../invalid" }).commentId, undefined);
  assert.equal(normalizeSharedPlace({ ...place, taskId: "" }).commentId, undefined);
});

test("removes the transient QA marker from every GENESIS section link", () => {
  const sections = [
    "today",
    "all-tasks",
    "projects",
    "habits",
    "calendar",
    "year",
    "stoicheion",
    "theokyklos",
    "admin",
  ];
  for (const section of sections) {
    assert.equal(
      cleanGenesisAppUrl(`https://genesiscalendar.ru/?qa=6b0d2bb#${section}`),
      `/#${section}`,
    );
  }
});

test("keeps supported query parameters while removing QA", () => {
  assert.equal(
    cleanGenesisAppUrl("https://genesiscalendar.ru/?lang=en&qa=temporary#calendar"),
    "/?lang=en#calendar",
  );
  assert.equal(
    cleanGenesisAppUrl("/?auth_error=access_denied#today"),
    "/?auth_error=access_denied#today",
  );
});

test("leaves already clean links unchanged", () => {
  assert.equal(cleanGenesisAppUrl("https://genesiscalendar.ru/#projects"), "/#projects");
});
