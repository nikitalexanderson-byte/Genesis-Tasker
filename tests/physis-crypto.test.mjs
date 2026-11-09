import assert from 'node:assert/strict';
import test from 'node:test';
import { physisModules, settingsRecord, clone } from './physis-test-loader.mjs';

const owner = 'a3c19e26-eef9-4e51-a1cd-04bfe46d2e0a';
const password = 'private training password 2026';

test('a new browser restores the same encrypted record using password or independent recovery code', async () => {
  const first = physisModules().crypto;
  const created = await first.createPhysisVault(owner, password);
  const record = settingsRecord();
  const envelope = await first.sealPhysis(created.key, owner, record.id, 1, record);
  assert.equal(Buffer.from(created.vault.password.ciphertext, 'base64').length, 48);
  assert.equal(Buffer.from(created.vault.recovery.ciphertext, 'base64').length, 48);
  const fresh = physisModules().crypto;
  for (const [method, secret] of [['password', password], ['recovery', created.recovery]]) {
    const restored = await fresh.unlockPhysisVault(owner, clone(created.vault), secret, method);
    assert.deepEqual(clone(await fresh.openPhysis(restored, owner, record.id, 1, clone(envelope))), record);
  }
  await assert.rejects(fresh.unlockPhysisVault(owner, created.vault, 'a completely wrong password', 'password'), /разблокировать/);
  await assert.rejects(fresh.unlockPhysisVault('other-owner', created.vault, password, 'password'), /разблокировать/);
  await assert.rejects(fresh.unlockPhysisVault(owner, created.vault, 'PHY1-' + 'A'.repeat(43), 'recovery'), /разблокировать/);
});

test('authenticated encryption rejects owner/id/version substitution, modified nonce and altered ciphertext', async () => {
  const c = physisModules().crypto;
  const { key } = await c.createPhysisVault(owner, password);
  const record = settingsRecord(); const envelope = await c.sealPhysis(key, owner, record.id, 1, record);
  for (const args of [
    [key, 'other-owner', record.id, 1, envelope], [key, owner, 'other-record', 1, envelope],
    [key, owner, record.id, 2, envelope], [key, owner, record.id, 1, { ...envelope, schemaVersion: 2 }],
    [key, owner, record.id, 1, { ...envelope, keyVersion: 2 }],
  ]) await assert.rejects(c.openPhysis(...args));
  for (const field of ['iv', 'ciphertext']) {
    const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] ^= 1;
    await assert.rejects(c.openPhysis(key, owner, record.id, 1, { ...envelope, [field]: bytes.toString('base64') }));
  }
  const raw = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  await assert.rejects(c.openPhysis(raw, owner, record.id, 1, envelope));
  assert.deepEqual(clone(await c.openPhysis(key, owner, record.id, 1, envelope)), record);
});

test('each encryption gets a new nonce; changing password preserves record key and recovery', async () => {
  const c = physisModules().crypto; const created = await c.createPhysisVault(owner, password);
  const record = settingsRecord();
  const envelopes = await Promise.all(Array.from({ length: 25 }, () => c.sealPhysis(created.key, owner, record.id, 1, record)));
  assert.equal(new Set(envelopes.map(e => e.iv)).size, envelopes.length);
  assert.equal(new Set(envelopes.map(e => e.ciphertext)).size, envelopes.length);
  const next = await c.changePhysisPassword(owner, created.vault, created.key, 'new independent vault password');
  assert.deepEqual(clone(next.recovery), clone(created.vault.recovery));
  assert.notEqual(next.password.salt, created.vault.password.salt);
  await assert.rejects(c.unlockPhysisVault(owner, next, password, 'password'));
  for (const [secret, method] of [['new independent vault password', 'password'], [created.recovery, 'recovery']]) {
    const key = await c.unlockPhysisVault(owner, next, secret, method);
    assert.deepEqual(clone(await c.openPhysis(key, owner, record.id, 1, envelopes[0])), record);
  }
});

test('plaintext byte limit includes UTF-8 expansion and the GCM tag matches the server bound', async () => {
  const c = physisModules().crypto; const { key } = await c.createPhysisVault(owner, password);
  const fits = 'x'.repeat(c.MAX_PHYSIS_PLAINTEXT_BYTES - 2); // JSON string quotes
  const envelope = await c.sealPhysis(key, owner, 'size-check', 1, fits);
  assert.equal(Buffer.from(envelope.ciphertext, 'base64').length, 256 * 1024);
  await assert.rejects(c.sealPhysis(key, owner, 'size-check', 1, fits + 'x'), /слишком велика/);
  await assert.rejects(c.sealPhysis(key, owner, 'size-check', 1, 'я'.repeat(140000)), /слишком велика/);
});
