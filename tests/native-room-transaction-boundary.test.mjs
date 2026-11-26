import assert from 'node:assert/strict';
import test from 'node:test';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// Runtime instrumentation verifies dispatcher/cancellation semantics. This
// inventory prevents a new app transaction from accidentally skipping that
// context through a direct library extension or wildcard import.
test('every app-owned Room transaction uses the observable public transaction boundary',()=>{
 const root=fileURLToPath(new URL('../android/app/src/',import.meta.url)),files=[];
 function visit(path){for(const entry of readdirSync(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())visit(child);else if(entry.name.endsWith('.kt'))files.push(child);}}
 visit(root);const violations=[];
 for(const file of files){const source=readFileSync(file,'utf8'),name=relative(root,file).replaceAll('\\','/');
  if(name==='main/java/ru/genesis/calendar/data/GenesisRoomTransaction.kt')continue;
  if(/^\s*import\s+androidx\.room\.(?:withTransaction\b|RoomDatabaseKt\b|\*)/m.test(source)
   ||/\bandroidx\.room\.(?:withTransaction|RoomDatabaseKt)\b/.test(source)
   ||/\.assertNotSuspendingTransaction\s*\(/.test(source))violations.push(name);
 }
 assert.ok(files.length>100,'the actual native source inventory must be present');
 assert.deepEqual(violations,[],'raw/restricted Room transaction access bypasses the cross-dispatcher guard');
});
