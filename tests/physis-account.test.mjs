import test from 'node:test';
import assert from 'node:assert/strict';
import { physisModules, settingsRecord, clone, deferred } from './physis-test-loader.mjs';

async function access(owner = 'owner-a', key) {
  key ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const aad = scope => new TextEncoder().encode(`genesis-mindmap-v1:${owner}:${scope}`);
  return {
    key,
    async seal(value, scope) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(scope) }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(bytes).toString('base64') };
    },
    async open(envelope, scope) {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64'), additionalData: aad(scope) }, key, Buffer.from(envelope.ciphertext, 'base64'));
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}
function transport(state = { vault: null, revision: 0 }, records = []) {
  const writes = [];
  return { writes, state: () => clone(state), async request(path, init) {
    if (!init) return path === '/vault' ? clone(state) : { records, hasMore: false, snapshot: 0 };
    const body = JSON.parse(init.body); writes.push({ path, body });
    if (body.expectedRevision !== state.revision) throw { status: 409 };
    state = { vault: body.vault, revision: state.revision + 1 }; return { revision: state.revision };
  } };
}

test('one site account opens a new Physis vault across browsers without a password', async () => {
  const first = physisModules(), a = await access(), t = transport();
  const initial = await first.account().openPhysisAccount('owner-a', a, t.request, () => {});
  assert.equal(initial.state.vault.version, 2); assert.equal(t.writes.length, 1);
  assert.equal(Buffer.from(initial.state.vault.account.ciphertext, 'base64').length, 62);
  const record = settingsRecord();
  const sealed = await first.crypto.sealPhysis(initial.key, 'owner-a', record.id, 1, record);
  const next = physisModules();
  const reopened = await next.account().openPhysisAccount('owner-a', await access('owner-a', a.key), t.request, () => {});
  assert.deepEqual(clone(await next.crypto.openPhysis(reopened.key, 'owner-a', record.id, 1, sealed)), record);
  assert.equal(t.writes.length, 1);
  await assert.rejects(next.crypto.openAccountPhysisVault(await access('owner-b', a.key), reopened.state.vault));
  await assert.rejects(next.crypto.openAccountPhysisVault(await access(), reopened.state.vault));
  await assert.rejects(next.crypto.openAccountPhysisVault(a, { ...reopened.state.vault, keyVersion: 2 }));
});

test('populated legacy data is preserved and migrated once using its original key', async () => {
  const m = physisModules(), a = await access();
  const old = await m.crypto.createPhysisVault('owner-a', 'old vault password');
  const t = transport({ vault: old.vault, revision: 1 }, [{ deletedAt: null }]);
  const gate = await m.account().openPhysisAccount('owner-a', a, t.request, () => {});
  assert.equal(gate.key, null); assert.equal(t.writes.length, 0);
  await assert.rejects(m.account().openPhysisAccount('owner-a', a, t.request, () => {}, { secret: 'wrong', method: 'password' }));
  assert.equal(t.writes.length, 0);
  const record = settingsRecord(), envelope = await m.crypto.sealPhysis(old.key, 'owner-a', record.id, 1, record);
  const migrated = await m.account().openPhysisAccount('owner-a', a, t.request, () => {}, { secret: old.recovery, method: 'recovery' });
  assert.equal(t.writes[0].path, '/vault'); assert.equal(migrated.state.vault.keyVersion, 1);
  const reopened = await m.account().openPhysisAccount('owner-a', a, t.request, () => {});
  assert.deepEqual(clone(await m.crypto.openPhysis(reopened.key, 'owner-a', record.id, 1, envelope)), record);
  assert.equal(t.writes.length, 1);
});

test('empty legacy vault moves to the account without asking for its old password', async () => {
  const m = physisModules(), old = await m.crypto.createPhysisVault('owner-a', 'old empty vault password');
  const t = transport({ vault: old.vault, revision: 1 });
  const next = await m.account().openPhysisAccount('owner-a', await access(), t.request, () => {});
  assert.equal(next.state.vault.version, 2); assert.equal(next.state.vault.keyVersion, 2);
  assert.equal(t.writes[0].path, '/rotate'); assert.deepEqual(t.writes[0].body.records, []);
  assert.equal(t.writes[0].body.expectedCursor, 0);
});

test('concurrent first opens use the winning committed account key', async () => {
  const m = physisModules(), a = await access(), t = transport();
  const [one, two] = await Promise.all([1, 2].map(() => m.account().openPhysisAccount('owner-a', a, t.request, () => {})));
  assert.equal(t.state().revision, 1);
  const sealed = await m.crypto.sealPhysis(one.key, 'owner-a', 'record', 1, { value: 42 });
  assert.equal((await m.crypto.openPhysis(two.key, 'owner-a', 'record', 1, sealed)).value, 42);
});

test('logout during account wrapping cannot save or expose a stale key', async () => {
  const m = physisModules(), a = await access(), t = transport(), wait = deferred(); let active = true;
  const pending = m.account().openPhysisAccount('owner-a', { ...a, seal: async (...args) => { await wait.promise; return a.seal(...args); } }, t.request,
    () => { if (!active) throw new Error('session ended'); });
  await new Promise(resolve => setImmediate(resolve)); active = false; wait.resolve();
  await assert.rejects(pending, /session ended/); assert.equal(t.writes.length, 0);
});

test('an unknown committed result is recovered on retry without replacing the key', async () => {
  const m = physisModules(), a = await access(), t = transport(); let fail = true;
  const request = async (...args) => { const result = await t.request(...args); if (args[1] && fail) { fail = false; throw new Error('network lost'); } return result; };
  await assert.rejects(m.account().openPhysisAccount('owner-a', a, request, () => {}), /network lost/);
  const committed = t.state();
  const reopened = await m.account().openPhysisAccount('owner-a', a, request, () => {});
  assert.deepEqual(clone(reopened.state), committed); assert.equal(t.writes.length, 1);
});
