import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {personalLegacyTransportProtected} from '../app/e2ee/legacy-transport.ts';
import {resolveBackendPhp,backendPhpEnvironment} from '../scripts/qa/backend-php.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/legacy-transport-v1.json',import.meta.url),'utf8'));
test('private legacy reads, mutations and unknown preferences have the same personal boundary',()=>{
  for(const row of fixture.cases)assert.equal(personalLegacyTransportProtected(row.method,row.path,row.body),row.protected,`${row.method} ${row.path}`);
  assert.throws(()=>personalLegacyTransportProtected('PUT','account/preferences',[]),/E2EE_INVALID_TRANSPORT_POLICY/);
});

test('the deployed PHP resource is an exact copy of the cross-platform contract',()=>{
  assert.deepEqual(readFileSync(new URL('../contracts/e2ee/legacy-transport-v1.json',import.meta.url)),
    readFileSync(new URL('../server/resources/e2ee-legacy-transport-v1.json',import.meta.url)));
});

// deploy.yml sends server/ without repository-root contracts. Exercise the real
// loader in that layout; missing policy must never become an unprotected fallback.
test('the PHP loader runs with only the deployed server package',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'genesis-e2ee-transport-'));
  if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith('genesis-e2ee-transport-'))throw new Error('Unsafe fixture cleanup path');
  try{
    // Mirror src/ -> ../resources/ while keeping unrelated app/config files absent.
    cpSync(new URL('../server/src/e2ee-legacy-transport.php',import.meta.url),join(directory,'src','policy.php'),{recursive:true});
    cpSync(new URL('../server/resources/e2ee-legacy-transport-v1.json',import.meta.url),join(directory,'resources','e2ee-legacy-transport-v1.json'),{recursive:true});
    const php=await resolveBackendPhp();
    const result=spawnSync(php,['-r',"require $argv[1];if(!genesisE2eePersonalTransportProtected('GET','billing/modeling/results/id'))exit(2);",join(directory,'src','policy.php')],{encoding:'utf8',env:{...process.env,...backendPhpEnvironment(php)}});
    assert.equal(result.status,0,result.error?.message??result.stderr);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
