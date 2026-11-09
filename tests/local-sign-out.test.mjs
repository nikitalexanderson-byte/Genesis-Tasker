import assert from "node:assert/strict";
import test from "node:test";
import { acceptAuthenticatedLogin, clearPrivateDeviceStorage, hasLocalSignOut, markLocalSignOut, prepareLocalSignIn } from "../app/local-sign-out.ts";

function storage() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test("logout clears keys, personal/team drafts and analytics receipts across accounts while preserving theme/assets", () => {
  const device = storage();
  for (const key of ["genesis-calendar-v1", "genesis-last-user-v2", "genesis-calendar-v2:a", "genesis-calendar-v2:b",
    "genesis-workspace-device-key-v2:a", "genesis-workspace-sync-state-v1:a", "genesis-workspace-device-id-v1:a",
    "genesis-pending-mutations-v2:a", "genesis-pending-mutations-v2-deleted:a", "genesis-shared-offline-v1:a", "genesis-shared-offline-v1:a:read-epoch",
    "genesis-moon-reminders-v1:a", "genesis-habit-notifications-delivered-v1", "genesis-stoicheion-draws-v2:a",
    "genesis-shared-place-v1:a", "genesis-affairs-area-v1:a", "genesis-hidden-invitations:a",
    "genesis-comment-notices:a", "genesis-project-import:a:copy", "genesis-solar-place-v1",
    "genesis.shared-views.draft.a", "genesis.shared-views.draft.b", "genesis.shared-views.draft.a.request",
    "genesis.shared-bulk.a.request", "genesis.shared-bulk.b.operation"]) device.setItem(key, "synthetic-private");
  device.setItem("theme", "standart-dark");
  device.setItem("asset-precache", "public");
  acceptAuthenticatedLogin(device, "server-login-a");
  markLocalSignOut(device);
  clearPrivateDeviceStorage(device);
  assert.equal(device.length, 3);
  assert.equal(device.getItem("theme"), "standart-dark");
  assert.equal(device.getItem("asset-precache"), "public");
  assert.equal(hasLocalSignOut(device), true);
  assert.equal(acceptAuthenticatedLogin(device, "server-login-a"), false);
  assert.equal(acceptAuthenticatedLogin(device, ""), false);
  assert.equal(acceptAuthenticatedLogin(device, "fresh-server-login-b"), true);
  assert.equal(hasLocalSignOut(device), false);
});

test("offline logout with an unknown cookie refuses restoration until explicit login learns the previous session", () => {
  const device = storage();
  markLocalSignOut(device);
  assert.equal(acceptAuthenticatedLogin(device, "previous-unobserved-login"), false);
  prepareLocalSignIn(device, "previous-unobserved-login");
  assert.equal(acceptAuthenticatedLogin(device, "previous-unobserved-login"), false);
  assert.equal(acceptAuthenticatedLogin(device, "verified-new-login"), true);
  device.setItem("genesis-local-sign-out-v1", "malformed");
  assert.equal(acceptAuthenticatedLogin(device, "verified-new-login"), false);
});
