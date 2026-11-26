import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage} from './helpers/cloud-sync-client.mjs';
const {EncryptedPendingJournal}=calendarModule('app/encrypted-pending-journal.ts');
const key='genesis-aurora-workspace-v1:synthetic:pending';

test('independent writers never overwrite another pending head or immutable earlier request',()=>{
 const storage=new MemoryStorage(),a=new EncryptedPendingJournal(key),b=new EncryptedPendingJournal(key);
 const first=a.stage(storage,'encrypted-first'),other=b.stage(storage,'encrypted-other'),second=a.stage(storage,'encrypted-second');
 assert.equal(storage.getItem(first.head.key),'encrypted-first');assert.equal(storage.length,3);
 const heads=a.read(storage);assert.equal(heads.length,2);assert.deepEqual(new Set(heads.map(row=>row.head.raw)),new Set(['encrypted-second','encrypted-other']));
 a.acknowledge(storage,second);assert.equal(storage.length,1);assert.equal(storage.getItem(other.head.key),'encrypted-other');
});
test('an exact late receipt cannot delete a newer writer snapshot, changed bytes or a legacy-tab copy',()=>{
 const storage=new MemoryStorage(),journal=new EncryptedPendingJournal(key),first=journal.stage(storage,'first'),second=journal.stage(storage,'second');
 storage.setItem(key,'legacy-tab-copy');storage.setItem(first.head.key,'changed-first');journal.acknowledge(storage,first);
 assert.equal(storage.length,3);assert.equal(storage.getItem(second.head.key),'second');
 journal.acknowledge(storage,second);assert.equal(storage.getItem(first.head.key),'changed-first');assert.equal(storage.getItem(key),'legacy-tab-copy');
});
test('old single-slot work remains a separate branch until its own exact accepted receipt',()=>{
 const storage=new MemoryStorage();storage.setItem(key,'old-retained-copy');
 const journal=new EncryptedPendingJournal(key),branch=journal.read(storage)[0];journal.stage(storage,'new-writer-copy');
 assert.equal(storage.getItem(key),'old-retained-copy');journal.acknowledge(storage,branch);assert.equal(storage.length,1);
});
test('full journals fail before changing any stored source instead of dropping oldest copies',()=>{
 const storage=new MemoryStorage(),journal=new EncryptedPendingJournal(key),writer=crypto.randomUUID();
 for(let n=1;n<=1024;n++)storage.setItem(`${key}:writer:${writer}:${n}:pending`,'ciphertext-'+n);
 const before=[...storage.data];assert.equal(journal.read(storage)[0].entries.length,1024);
 assert.throws(()=>journal.stage(storage,'too-many'),/E2EE_JOURNAL_LIMIT/);assert.deepEqual([...storage.data],before);
});
test('malformed writer identities and unsupported sequences block inspection without cleanup',()=>{
 for(const suffix of ['other:1:pending',`${crypto.randomUUID()}:01:pending`,`${crypto.randomUUID()}:9007199254740992:pending`]){
  const storage=new MemoryStorage();storage.setItem(`${key}:writer:${suffix}`,'retained');const journal=new EncryptedPendingJournal(key);
  assert.throws(()=>journal.read(storage),/E2EE_INVALID_JOURNAL_ENTRY/);assert.equal(storage.length,1);
 }
});
