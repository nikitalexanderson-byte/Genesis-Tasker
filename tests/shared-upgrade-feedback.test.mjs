import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudSyncClient } from './helpers/cloud-sync-client.mjs';

const denied = () => Response.json({ error:'FEATURE_SUBSCRIPTION_REQUIRED', feature:'shared-projects' }, {status:403});
async function fixture(options = {}) {
  const tab = await cloudSyncClient(options), upgrades = [];
  tab.window.addEventListener('genesis:upgrade-request', event => upgrades.push(event.detail));
  return {...tab, upgrades};
}

test('background notification context denial stays an API error without opening an upgrade comparison', async () => {
  const tab = await fixture();
  tab.respond(denied);
  await assert.rejects(tab.client.updateSharedNotificationDeviceContext('Europe/Moscow'), error => error.status === 403);
  assert.equal(tab.requests[0].init.method, 'PUT');
  assert.equal(tab.requests[0].url, 'http://127.0.0.1:4193/api/shared/notification-context');
  assert.equal(tab.upgrades.length, 0);
});

test('background task-read acknowledgement cannot sell a plan when an existing task is opened', async () => {
  const tab = await fixture();
  tab.respond(denied);
  await assert.rejects(tab.client.readSharedTaskUpdates('kept-project', 'kept-task', []), error => error.status === 403);
  assert.equal(tab.upgrades.length, 0);
});

test('a rejected shared read preserves its error without an unsolicited upgrade event', async () => {
  const tab = await fixture();
  tab.respond(denied);
  await assert.rejects(tab.client.loadSharedOverview(), error => error.status === 403 && error.payload.feature === 'shared-projects');
  assert.equal(tab.upgrades.length, 0);
});

test('automatic presence denial cannot interrupt viewing the existing participant list', async () => {
  const tab = await fixture({withPrivateMessages:true});
  tab.respond(denied);
  await assert.rejects(tab.privateMessages.spaceParticipants('kept-space',true,undefined,'tab-id'), error => error.status === 403);
  assert.equal(tab.requests[0].init.method, 'POST');
  assert.equal(tab.upgrades.length, 0);
  tab.respond(() => Response.json({members:[{userId:'member-id',displayName:'Existing member'}]}));
  const result = await tab.privateMessages.spaceParticipants('kept-space');
  assert.equal(tab.requests[1].init.method, undefined);
  assert.equal(result.members[0].displayName, 'Existing member');
});

test('automatic workspace layout persistence reports denial without opening a plan comparison', async () => {
  const tab = await fixture();
  tab.respond(denied);
  await assert.rejects(tab.client.saveSharedUiState('kept-space',['kept-project']), error => error.status === 403);
  assert.equal(tab.requests[0].init.method, 'PATCH');
  assert.equal(tab.upgrades.length, 0);
});

test('an explicit paid create action still reports the server denial and requests a comparison', async () => {
  const tab = await fixture();
  tab.respond(denied);
  await assert.rejects(tab.client.createSharedSpace('Explicit user action'), error => error.status === 403);
  assert.equal(tab.upgrades.length, 1);
  assert.equal(tab.upgrades[0].feature, 'shared-projects');
});

test('downgraded sessions keep shared reads while explicit file export is paid in 3.1.7', async () => {
  const tab = await fixture({withMindmaps:true, withDataExchange:true});
  tab.featureAccess.rememberFeatureAccess(tab.userId, {schemaVersion:1,enforcementEnabled:true,effectivePlan:'free',validUntil:null,
    lifetimePremium:false,allowedFeatures:[],freeFeatures:[]});
  tab.respond((url, init) => {
    assert.equal(init.credentials, 'include');
    if (url.endsWith('/shared/spaces')) return Response.json({spaces:[{id:'kept-space',title:'Existing workspace'}]});
    if (url.endsWith('/shared/overview')) return Response.json({overview:{projects:1,tasks:1,openTasks:1}});
    assert.equal(url, 'http://127.0.0.1:4193/api/shared/spaces/kept-space/data-export');
    assert.equal(init.method, 'POST');
    return Response.json({content:'Existing shared task',format:'json',projectCount:1,taskCount:1,notices:[]});
  });
  assert.equal((await tab.client.listSharedSpaces())[0].title, 'Existing workspace');
  assert.equal((await tab.client.loadSharedOverview()).tasks, 1);
  await assert.rejects(tab.dataExchange.exportData('kept-space',{scope:'space',projectId:'kept-project',format:'json'}),
    {code:'FEATURE_SUBSCRIPTION_REQUIRED',feature:'data-export'});
  assert.equal(tab.requests.length, 2,'Free file export must not reach the transport');
  assert.equal(tab.upgrades.length, 1);
  assert.equal(tab.upgrades[0].feature,'data-export');
});
