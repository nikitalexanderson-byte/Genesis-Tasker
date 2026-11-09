import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { physisModules, settingsRecord, deferred, clone } from './physis-test-loader.mjs';
import { createPhysisSubmission } from '../app/physis/submission.ts';
import { preparePhysisImport, resumePhysisImport, previewPhysisImport } from '../app/physis/exchange-domain.ts';
import { addExercise, startSession, STARTER_EXERCISES, TrainingCreationDrafts } from '../app/physis/training-domain.ts';
import { newPhysisRecord } from '../app/physis/types.ts';

const owner = 'a3c19e26-eef9-4e51-a1cd-04bfe46d2e0a';
const key = () => webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const conflict = () => Object.assign(new Error('PHYSIS_CONFLICT'), { status: 409 });

/** A small protocol peer models committed receipts and a second device. Crypto, queues,
 * validation and snapshots are the production implementations, not test copies. */
function peer() {
  const rows = new Map(), receipts = new Map(), writes = [];
  let cursor = 0, revision = 1;
  const api = {
    rows, writes, dropResponse: false, truncateResponse: false, beforeRead: null,
    async seed(record, crypto, keyValue, version = 1) {
      rows.set(record.id, { id: record.id, revision: 1, sequence: ++cursor, updatedAt: record.updatedAt, deletedAt: null,
        envelope: await crypto.sealPhysis(keyValue, owner, record.id, version, record) });
    },
    async transport(path, init) {
      if (path.startsWith('/records?')) {
        const query = new URL('https://localhost.invalid' + path).searchParams;
        const after = Number(query.get('page') ?? 0), limit = Number(query.get('limit') ?? 100);
        const found = [...rows.values()].filter(row => row.sequence > after).sort((a, b) => a.sequence - b.sequence);
        const page = found.slice(0, limit), hasMore = found.length > limit;
        const snapshot = clone({ records: page, cursor: hasMore ? page.at(-1).sequence : cursor, snapshot: cursor, minCursor: 0, hasMore });
        if (api.beforeRead) await api.beforeRead();
        return snapshot;
      }
      const text = init.body; const body = JSON.parse(text); writes.push({ path, text, body });
      if (receipts.has(body.requestId)) {
        const known = receipts.get(body.requestId); assert.equal(text, known.text, 'retry changed encrypted payload');
        return clone(known.result);
      }
      let result;
      if (path === '/records') {
        for (const change of body.changes) {
          const row = rows.get(change.id);
          if (change.expectedRevision !== (row?.revision ?? 0) || row?.deletedAt || change.operation === 'create' && row) throw conflict();
        }
        const changed = body.changes.map(change => ({ id: change.id, revision: change.expectedRevision + 1, sequence: ++cursor,
          updatedAt: '2026-10-24T13:00:00Z', deletedAt: change.operation === 'delete' ? '2026-10-24T13:00:00Z' : null,
          envelope: change.envelope ?? null }));
        for (const row of changed) rows.set(row.id, row);
        result = { records: changed.map(row => { const metadata = { ...row }; delete metadata.envelope; return metadata; }), cursor };
      } else if (path === '/rotate') {
        if (body.expectedCursor !== cursor || body.expectedRevision !== revision) throw conflict();
        assert.equal(body.records.length, [...rows.values()].filter(row => !row.deletedAt).length);
        for (const record of body.records) {
          const old = rows.get(record.id); assert.equal(record.expectedRevision, old.revision);
          rows.set(record.id, { ...old, revision: old.revision + 1, sequence: ++cursor, envelope: record.envelope });
        }
        result = { revision: ++revision, cursor: ++cursor, keyVersion: body.vault.keyVersion };
      } else throw new Error('Unexpected route ' + path);
      receipts.set(body.requestId, { text, result: clone(result) });
      if (api.dropResponse) { api.dropResponse = false; throw new TypeError('Network lost after server commit'); }
      if (api.truncateResponse) { api.truncateResponse = false; return { ...result, records: [] }; }
      return clone(result);
    },
  };
  return api;
}

function storeFixture(modules, peerValue, dataKey, check = () => {}, version = 1) {
  return new (modules.store().PhysisMemoryStore)(owner, dataKey, version, peerValue.transport.bind(peerValue), check);
}

test('lost response retries the same idempotency key/ciphertext and a new browser restores the committed batch', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key();
  const store = storeFixture(modules, server, dataKey); await store.reload();
  const records = [settingsRecord(), settingsRecord()]; records[0].data.foodRules = ['private Physis note'];
  server.dropResponse = true;
  await assert.rejects(store.getSnapshot().saveMany(records));
  assert.equal(store.getSnapshot().status, 'offline'); assert.equal(store.hasPending, true);
  assert.equal(server.rows.size, 2); assert.equal(store.getSnapshot().records.length, 2);
  assert.equal(server.writes[0].text.includes('private Physis note'), false);
  await store.flush();
  assert.equal(server.writes[1].text, server.writes[0].text); assert.equal(store.hasPending, false);
  assert.equal(store.getSnapshot().status, 'saved'); assert.equal(server.rows.size, 2);
  const newBrowser = storeFixture(physisModules(), server, dataKey); await newBrowser.reload();
  assert.deepEqual(clone(newBrowser.getSnapshot().records), records);
});

test('repeated form submit keeps one stable draft ID after the server commits but the response is lost', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key();
  const store = storeFixture(modules, server, dataKey), draft = settingsRecord();
  server.dropResponse = true;
  await assert.rejects(store.getSnapshot().save(draft));
  const edited = { ...draft, data: { ...draft.data, restSeconds: 120 } };
  await store.getSnapshot().save(edited);
  assert.equal(server.rows.size, 1);
  assert.equal(server.writes[0].text, server.writes[1].text, 'original uncertain mutation is retried identically');
  assert.deepEqual(server.writes.map(write => write.body.changes[0].operation), ['create', 'create', 'update']);
  assert.equal(store.getSnapshot().records[0].id, draft.id);
  const reloaded = storeFixture(physisModules(), server, dataKey); await reloaded.reload();
  assert.equal(reloaded.getSnapshot().records.length, 1); assert.equal(reloaded.getSnapshot().records[0].data.restSeconds, 120);
});

test('copy/import submissions retain generated IDs until acknowledgement and allow a new intentional copy afterwards', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key();
  const store = storeFixture(modules, server, dataKey), submit = createPhysisSubmission();
  let preparations = 0;
  const prepare = () => { preparations++; return [settingsRecord(), settingsRecord()]; };
  server.dropResponse = true;
  await assert.rejects(submit('copy-day', prepare, store.getSnapshot()));
  await submit('copy-day', prepare, store.getSnapshot());
  assert.equal(preparations, 1); assert.equal(server.rows.size, 2);
  assert.equal(server.writes[0].text, server.writes[1].text);
  await submit('copy-day', prepare, store.getSnapshot());
  assert.equal(preparations, 2); assert.equal(server.rows.size, 4);
});

test('background acknowledgement followed by editing a copied record is preserved when the old intent is retried', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key();
  const store = storeFixture(modules, server, dataKey), submit = createPhysisSubmission();
  const original = settingsRecord();
  let preparations = 0;
  const prepare = () => { preparations++; return [original]; };
  server.dropResponse = true;
  await assert.rejects(submit('copy', prepare, store.getSnapshot()));
  await store.flush();
  await store.getSnapshot().save({ ...original, data: { ...original.data, restSeconds: 240 } });
  const writes = server.writes.length;
  await submit('copy', prepare, store.getSnapshot());
  assert.equal(preparations, 1); assert.equal(server.writes.length, writes);
  assert.equal(store.getSnapshot().records[0].data.restSeconds, 240);
  const reopened = storeFixture(physisModules(), server, dataKey); await reopened.reload();
  assert.equal(reopened.getSnapshot().records[0].data.restSeconds, 240);
});

test('retained copy, training and import intents preserve newer edits through offline retry and reconnect', async t => {
  for (const helper of ['copy', 'training', 'import']) for (const state of ['saved', 'offline']) {
    await t.test(`${helper}: later edit is ${state}`, async () => {
      const modules = physisModules(), server = peer(), dataKey = await key();
      let offline = false;
      const transport = (path, init) => {
        if (offline && init?.method === 'POST') throw new TypeError('Synthetic disconnected network');
        return server.transport(path, init);
      };
      const store = new (modules.store().PhysisMemoryStore)(owner, dataKey, 1, transport, () => {});
      const original = newPhysisRecord('session', startSession('2026-10-24', 'Europe/Moscow'));
      const copy = createPhysisSubmission(), training = new TrainingCreationDrafts(), plan = preparePhysisImport([original]);
      const retry = () => helper === 'copy' ? copy('copy', () => [original], store.getSnapshot())
        : helper === 'training' ? training.save('session', () => original, store.getSnapshot())
        : resumePhysisImport(plan, store.getSnapshot());
      server.dropResponse = true;
      await assert.rejects(retry());
      await store.flush();
      const current = store.getSnapshot().records[0];
      const edited = { ...current, data: { ...current.data, notes: 'Newer user correction after background acknowledgement' } };
      offline = state === 'offline';
      if (offline) {
        await assert.rejects(store.getSnapshot().save(edited));
        assert.equal(store.getSnapshot().status, 'offline');
        await assert.rejects(retry());
        assert.equal(store.getSnapshot().records[0].data.notes, edited.data.notes, 'retry reverted the optimistic edit');
        offline = false; await store.flush();
      } else {
        await store.getSnapshot().save(edited);
        const writes = server.writes.length;
        await retry();
        assert.equal(server.writes.length, writes, 'acknowledged intent must not replay stale payload');
      }
      assert.equal(server.rows.size, 1);
      const reopened = storeFixture(physisModules(), server, dataKey); await reopened.reload();
      assert.equal(reopened.getSnapshot().records[0].data.notes, edited.data.notes, 'reconnect persisted the frozen draft over the edit');
    });
  }
});

test('large valid workout imports adapt batches to the real encrypted 2 MiB request limit', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key();
  const store = storeFixture(modules, server, dataKey);
  const source = Array.from({ length: 20 }, () => {
    const session = startSession('2026-10-24', 'Europe/Moscow');
    session.exercises = Array.from({ length: 6 }, () => ({ ...addExercise(STARTER_EXERCISES[0]), notes: 'x'.repeat(18000) }));
    session.plannedSetCount = 6;
    return newPhysisRecord('session', session);
  });
  assert.equal(previewPhysisImport(source, []).records.length, 20);
  assert.ok(Buffer.byteLength(JSON.stringify(source)) > 2 * 1024 * 1024);
  assert.ok(source.every(record => Buffer.byteLength(JSON.stringify(record)) < 256 * 1024 - 16));
  const plan = preparePhysisImport(source), progress = [];
  await resumePhysisImport(plan, store.getSnapshot(), confirmed => progress.push(confirmed));
  assert.equal(plan.confirmed, 20); assert.equal(server.rows.size, 20);
  assert.ok(server.writes.length > 1);
  assert.ok(server.writes.every(write => write.body.changes.length <= 20 && Buffer.byteLength(write.text) <= 2 * 1024 * 1024));
  assert.equal(progress.at(-1), 20);
  const reopened = storeFixture(physisModules(), server, dataKey); await reopened.reload();
  assert.equal(reopened.getSnapshot().records.length, 20);
  assert.equal(reopened.getSnapshot().records[0].data.exercises[0].notes.length, 18000);
});

test('encryption failure in the second record never retains or sends a partial batch', async () => {
  let encryptions = 0;
  const cryptoOverride = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID: webcrypto.randomUUID.bind(webcrypto),
    subtle: new Proxy(webcrypto.subtle, { get(target, name) {
      if (name === 'encrypt') return (...args) => ++encryptions === 2 ? Promise.reject(new Error('Synthetic crypto interruption')) : target.encrypt(...args);
      return typeof target[name] === 'function' ? target[name].bind(target) : target[name];
    } }),
  };
  const modules = physisModules(cryptoOverride), server = peer(), store = storeFixture(modules, server, await key());
  const records = [settingsRecord(), settingsRecord()];
  await assert.rejects(store.getSnapshot().saveMany(records));
  assert.equal(server.writes.length, 0); assert.equal(store.hasPending, true);
  await store.flush();
  assert.equal(server.writes[0].body.changes.length, 2); assert.equal(server.rows.size, 2);
  assert.equal(store.getSnapshot().records.length, 2); assert.equal(store.hasPending, false);
});

test('two queued edits use the acknowledged revision; delete remains a tombstone after reload', async () => {
  const modules = physisModules(), server = peer(), store = storeFixture(modules, server, await key());
  const record = settingsRecord(), edited = clone(record); edited.data.restSeconds = 120;
  const first = store.getSnapshot().save(record); const second = store.getSnapshot().save(edited);
  await Promise.all([first, second]);
  assert.deepEqual(server.writes.map(write => write.body.changes[0].expectedRevision), [0, 1]);
  assert.equal(server.rows.get(record.id).revision, 2);
  await store.getSnapshot().remove(record.id); await store.reload();
  assert.equal(store.getSnapshot().records.length, 0); assert.equal(server.rows.get(record.id).envelope, null);
  await assert.rejects(store.getSnapshot().save(record));
  assert.equal(store.getSnapshot().status, 'conflict'); assert.equal(server.rows.get(record.id).revision, 3);
});

test('a stale reload cannot overwrite an edit that completed while the read was in flight', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key(); const record = settingsRecord();
  await server.seed(record, modules.crypto, dataKey);
  const store = storeFixture(modules, server, dataKey); await store.reload();
  const reading = deferred(), resume = deferred(); server.beforeRead = () => { reading.resolve(); return resume.promise; };
  const reload = store.reload(); await reading.promise;
  const updated = clone(record); updated.data.restSeconds = 240;
  await store.getSnapshot().save(updated); assert.equal(store.hasPending, false);
  resume.resolve(); await assert.rejects(reload, /изменились во время/);
  assert.equal(store.getSnapshot().records[0].data.restSeconds, 240);
  server.beforeRead = null; await store.reload();
  assert.equal(store.getSnapshot().records[0].data.restSeconds, 240);
});

test('second-device conflict preserves the local draft and requires explicit discard before full reload', async () => {
  const modules = physisModules(), server = peer(), dataKey = await key(), record = settingsRecord();
  await server.seed(record, modules.crypto, dataKey);
  const first = storeFixture(modules, server, dataKey), other = storeFixture(modules, server, dataKey);
  await Promise.all([first.reload(), other.reload()]);
  const remote = clone(record); remote.data.restSeconds = 300; await other.getSnapshot().save(remote);
  const local = clone(record); local.data.restSeconds = 30;
  await assert.rejects(first.getSnapshot().save(local));
  assert.equal(first.getSnapshot().status, 'conflict'); assert.equal(first.getSnapshot().records[0].data.restSeconds, 30);
  const count = server.writes.length; await assert.rejects(first.flush()); assert.equal(server.writes.length, count);
  await assert.rejects(first.exportWire());
  await first.discardAndReload();
  assert.equal(first.getSnapshot().records[0].data.restSeconds, 300); assert.equal(first.hasPending, false);
});

test('record and total request size are rejected before optimistic state or queue changes', async () => {
  const modules = physisModules(), server = peer(), store = storeFixture(modules, server, await key());
  const tooLarge = settingsRecord(); tooLarge.data.foodRules = Array.from({ length: 3000 }, () => 'x'.repeat(100));
  await assert.rejects(store.getSnapshot().save(tooLarge), /слишком велика/);
  const batch = Array.from({ length: 8 }, () => { const record = settingsRecord(); record.data.foodRules = Array.from({ length: 2200 }, () => 'x'.repeat(100)); return record; });
  await assert.rejects(store.getSnapshot().saveMany(batch), /слишком велик/);
  assert.equal(store.hasPending, false); assert.equal(store.getSnapshot().records.length, 0); assert.equal(server.writes.length, 0);
});

test('incomplete acknowledgement does not drop the queue; identical retry recovers the complete commit', async () => {
  const modules = physisModules(), server = peer(), store = storeFixture(modules, server, await key());
  server.truncateResponse = true;
  await assert.rejects(store.getSnapshot().saveMany([settingsRecord(), settingsRecord()]));
  assert.equal(store.hasPending, true); assert.equal(server.rows.size, 2);
  await store.flush(); assert.equal(store.hasPending, false);
  assert.equal(server.writes[0].text, server.writes[1].text);
});

test('logout while a response is in flight clears plaintext and cannot publish delayed private data', async () => {
  const modules = physisModules(), dataKey = await key(), started = deferred(), finish = deferred();
  const server = peer();
  const transport = async (path, init) => { const result = await server.transport(path, init); started.resolve(); await finish.promise; return result; };
  const store = new (modules.store().PhysisMemoryStore)(owner, dataKey, 1, transport, () => {});
  const saving = store.getSnapshot().save(settingsRecord()); await started.promise;
  store.destroy(); finish.resolve(); await assert.rejects(saving, /PHYSIS_LOCKED/);
  assert.equal(store.getSnapshot().records.length, 0); assert.equal(store.hasPending, false);
  await assert.rejects(store.reload(), /PHYSIS_LOCKED/);
});

test('pagination snapshot change rejects a mixed read instead of replacing a confirmed collection', async () => {
  const modules = physisModules(), dataKey = await key(); const record = settingsRecord();
  const wire = { id: record.id, revision: 1, sequence: 1, updatedAt: record.updatedAt, deletedAt: null,
    envelope: await modules.crypto.sealPhysis(dataKey, owner, record.id, 1, record) };
  let count = 0;
  const transport = async () => ++count === 1
    ? { records: [wire], cursor: 1, snapshot: 2, minCursor: 0, hasMore: true }
    : { records: [], cursor: 3, snapshot: 3, minCursor: 0, hasMore: false };
  const store = new (modules.store().PhysisMemoryStore)(owner, dataKey, 1, transport, () => {});
  await assert.rejects(store.reload(), /PHYSIS_RESYNC_REQUIRED/);
  assert.equal(store.getSnapshot().records.length, 0);
});

test('rotation over 100 records retries exact payload after an unknown commit and blocks old-key writes', async () => {
  const modules = physisModules(), server = peer(), oldKey = await key(), newKey = await key();
  for (let i = 0; i < 101; i++) await server.seed(settingsRecord(), modules.crypto, oldKey);
  const store = storeFixture(modules, server, oldKey); await store.reload();
  const vault = { keyVersion: 2 }; server.dropResponse = true;
  await assert.rejects(store.rotate(newKey, vault, 1), /Network/);
  assert.equal(store.rotationPending, true); assert.equal(server.writes[0].body.records.length, 101);
  await assert.rejects(store.getSnapshot().save(settingsRecord()), /смены ключа/);
  await assert.rejects(store.discardAndReload(), /смены ключа/);
  await assert.rejects(store.rotate(await key(), vault, 1), /предыдущую попытку/);
  const result = await store.rotate(newKey, vault, 1);
  assert.equal(result.keyVersion, 2); assert.equal(store.rotationPending, false);
  assert.equal(server.writes[1].text, server.writes[0].text);
  await assert.rejects(store.getSnapshot().save(settingsRecord()), /смены ключа/);
  const restored = storeFixture(physisModules(), server, newKey, () => {}, 2); await restored.reload();
  assert.equal(restored.getSnapshot().records.length, 101);
  const attempts = server.writes.length; assert.deepEqual(await store.rotate(newKey, vault, 1), result);
  assert.equal(server.writes.length, attempts);
});

test('encrypted export refuses new-key ciphertext from another device instead of bundling it with an obsolete vault', async () => {
  const modules = physisModules(), server = peer(), oldKey = await key(), newKey = await key(), record = settingsRecord();
  await server.seed(record, modules.crypto, oldKey);
  const oldDevice = storeFixture(modules, server, oldKey), newDevice = storeFixture(modules, server, oldKey);
  await Promise.all([oldDevice.reload(), newDevice.reload()]);
  await newDevice.rotate(newKey, { keyVersion: 2 }, 1);
  await assert.rejects(oldDevice.exportWire(), /PHYSIS_INVALID_ENVELOPE/);
  assert.equal(oldDevice.getSnapshot().records.length, 1);
});


test('monthly plan chunks retain uncertain IDs after the second response is lost and preserve acknowledged edits', async () => {
  const modules=physisModules(), server=peer(), dataKey=await key();
  let failSecond=true;
  const transport=(path,init)=>{
    if(path==='/records' && server.writes.length===1 && failSecond){server.dropResponse=true;failSecond=false;}
    return server.transport(path,init);
  };
  const store=new (modules.store().PhysisMemoryStore)(owner,dataKey,1,transport,()=>{});
  const submit=createPhysisSubmission();let preparations=0;
  const records=Array.from({length:205},()=>settingsRecord());
  const prepare=()=>{preparations++;return records;};
  await assert.rejects(submit('month',prepare,store.getSnapshot()));
  assert.equal(server.rows.size,200);
  await store.flush();
  await store.getSnapshot().save({...records[0],data:{...records[0].data,restSeconds:333}});
  await submit('month',prepare,store.getSnapshot());
  assert.equal(preparations,1);assert.equal(server.rows.size,205);
  assert.equal(store.getSnapshot().records.find(r=>r.id===records[0].id).data.restSeconds,333);
  assert.ok(server.writes.every(w=>w.body.changes.length<=100));
  assert.equal(server.writes.filter(w=>w.body.changes.some(c=>c.id===records[0].id)).length,2,'first chunk is not replayed after later edits');
  const reopened=storeFixture(physisModules(),server,dataKey);await reopened.reload();
  assert.equal(reopened.getSnapshot().records.length,205);
});
