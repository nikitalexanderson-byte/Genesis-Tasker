import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cloudSyncClient} from './helpers/cloud-sync-client.mjs';
import copy from '../app/billing-safety-copy.json' with {type:'json'};

test('unresolved payment prevents self/admin deletion with localized recovery guidance and keeps device data',async()=>{
  for(const [language,text]of Object.entries(copy)){
    const tab=await cloudSyncClient({language});
    tab.storage.setItem('deletion-protected-draft','synthetic private draft');
    tab.respond(async()=>Response.json({error:'BILLING_SETTLEMENT_REQUIRED'},{status:409}));
    for(const action of [()=>tab.client.deleteGenesisAccount(tab.userId),()=>tab.client.deleteAdminUser('synthetic-target',false)]){
      await assert.rejects(action,error=>error instanceof Error&&error.payload?.error==='BILLING_SETTLEMENT_REQUIRED'&&error.message===text.accountDeletionBlocked&&!error.message.includes('BILLING_'),language);
      assert.equal(tab.storage.getItem('deletion-protected-draft'),'synthetic private draft',language);
      assert.ok(tab.storage.getItem(`genesis-workspace-device-key-v2:${tab.userId}`),language);
    }
    await assert.rejects(()=>tab.client.createBillingOrder('premium:1','yookassa','synthetic-key-1234',40000,'RUB'),error=>error.message===text.settlementRequired,language);
    assert.equal(tab.requests.length,3,language);
    assert.deepEqual(tab.requests.slice(0,2).map(request=>request.init.method),['DELETE','DELETE']);
  }
});
