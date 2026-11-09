import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { LOCAL_SIGN_OUT_KEY } from "../app/local-sign-out.ts";
import { cloudSyncClient as createClient, deferred } from "./helpers/cloud-sync-client.mjs";

async function cloudSyncClient(options) {
  const fixture=await createClient(options);
  fixture.featureAccess.rememberFeatureAccess(fixture.userId,{schemaVersion:1,enforcementEnabled:true,effectivePlan:'business',
    lifetimePremium:true,validUntil:null,allowedFeatures:['data-export'],freeFeatures:[]});
  return fixture;
}

const selection = () => ({ scope: "space", projectId: "export-project", format: "csv", from: "2026-02-28", to: "2026-03-02",
  undated: false, archived: false, calendarMode: "moon", calendarContext: { version: 2, timeZone: "Europe/Moscow", gregorianYearStart: "march" },
  titles: { title: "Название", storyPoints: "Story points", estimateHours: "Часы" } });
const result = { content: "Title\nSynthetic task\n", format: "csv", taskCount: 1, projectCount: 1, notices: [] };

test('Free and expired file import/export reject before transport; paid access permits both',async()=>{
  const tab=await cloudSyncClient({withDataExchange:true});let writes=0;
  tab.respond(()=>{writes++;return Response.json(result);});
  const access={schemaVersion:1,enforcementEnabled:true,effectivePlan:'business',lifetimePremium:true,validUntil:null,allowedFeatures:['data-export'],freeFeatures:[]};
  for(const denied of [undefined,{...access,effectivePlan:'free',lifetimePremium:false},
    {...access,lifetimePremium:false,validUntil:'2020-01-01T00:00:00Z',freeFeatures:['data-export']}]) {
    tab.featureAccess.rememberFeatureAccess(tab.userId,denied);
    for(const request of [()=>tab.dataExchange.exportData('space',selection()),()=>tab.dataExchange.previewData({spaceId:'space'}),()=>tab.dataExchange.applyData({spaceId:'space'})])
      await assert.rejects(request(),{code:'FEATURE_SUBSCRIPTION_REQUIRED',feature:'data-export'});
    assert.doesNotThrow(()=>tab.dataExchange.downloadData('secret','data.json'),'Denied local download stops before touching DOM or Blob URLs');
    assert.equal(writes,0);
  }
  for(const plan of ['standart','premium','business','premium4life']) {
    tab.featureAccess.rememberFeatureAccess(tab.userId,{...access,effectivePlan:plan});
    await tab.dataExchange.exportData('space',selection());await tab.dataExchange.previewData({spaceId:'space'});await tab.dataExchange.applyData({spaceId:'space'});
  }
  assert.equal(writes,12);
});

test('space directory preserves separate account and destination-owner quota even without owned spaces',async()=>{
  const tab=await cloudSyncClient({withDataExchange:true});
  const own={ownerId:tab.userId,count:0,limit:100,remaining:100},inviter={ownerId:'inviter',count:100,limit:100,remaining:0};
  tab.respond(()=>Response.json({ownedProjectQuota:own,spaces:[{id:'invited',role:'member',projectQuota:inviter}]}));
  const directory=await tab.client.loadSharedSpaceDirectory();
  assert.deepEqual(JSON.parse(JSON.stringify(directory.ownedProjectQuota)),own);
  assert.deepEqual(JSON.parse(JSON.stringify(directory.spaces[0].projectQuota)),inviter);
  assert.equal((await tab.client.listSharedSpaces())[0].projectQuota.ownerId,'inviter');
});

test("CSV custom mapping preserves independent positions for duplicate and empty headings", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), exchange = fixture.dataExchange;
  const headers = exchange.dataCsvHeaders('\uFEFFtitle,Effort,Effort,,   ,GENESIS CSV v1,Effort\r\nTask,2,3,a,b,,4', ',');
  const choices = exchange.dataCsvCustomColumnChoices(headers);
  assert.deepEqual(JSON.parse(JSON.stringify(choices)), [
    { column: 0, title: 'title' }, { column: 1, title: 'Effort' }, { column: 2, title: 'Effort' },
    { column: 3, title: '4' }, { column: 4, title: '5' }, { column: 6, title: 'Effort' },
  ]);
  const selected = { 1: 'number', 2: 'text', 3: 'checkbox', 6: 'number' };
  const customColumns = choices.filter(({ column }) => selected[column]).map(row => ({ ...row, type: selected[row.column] }));
  fixture.respond(() => Response.json({ canApply: true }));
  await exchange.previewData({ format: 'csv', content: 'title,Effort,Effort,,   ,GENESIS CSV v1,Effort\nTask,2,3,true,b,,4',
    spaceId: 'mapping-space', parse: { customColumns } });
  assert.deepEqual(JSON.parse(fixture.requests[0].init.body).parse.customColumns, [
    { column: 1, title: 'Effort', type: 'number' }, { column: 2, title: 'Effort', type: 'text' },
    { column: 3, title: '4', type: 'checkbox' }, { column: 6, title: 'Effort', type: 'number' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(exchange.dataCsvCustomColumnChoices([]))), []);
});

test("a cancelled export aborts the active session request and can retry the same selection", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true });
  const entered = deferred(), response = deferred(), controller = new AbortController(), options = selection();
  fixture.respond((_url, init) => {
    init.signal.addEventListener("abort", () => response.reject(init.signal.reason), { once: true });
    entered.resolve();
    return response.promise;
  });
  const pending = fixture.dataExchange.exportData("export-space", options, controller.signal);
  await entered.promise;
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(fixture.requests[0].init.signal.aborted, true);
  fixture.respond(() => Response.json(result));
  const exported = await fixture.dataExchange.exportData("export-space", options, new AbortController().signal);
  assert.equal(exported.content, result.content);
  assert.equal(exported.taskCount, 1);
  assert.equal(fixture.requests.length, 2);
  for (const request of fixture.requests) {
    assert.equal(request.url, "http://127.0.0.1:4193/api/shared/spaces/export-space/data-export");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.credentials, "include");
    assert.deepEqual(JSON.parse(request.init.body), options);
  }
});

test("an already cancelled export preserves the caller cancellation reason", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), controller = new AbortController();
  const reason = new DOMException("Synthetic export cancellation", "AbortError");
  controller.abort(reason);
  fixture.respond((_url, init) => {
    assert.equal(init.signal.aborted, true);
    throw init.signal.reason;
  });
  await assert.rejects(fixture.dataExchange.exportData("export-space", selection(), controller.signal), error => error === reason);
});

test("an export permission denial remains an access error rather than a cancellation", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), controller = new AbortController();
  fixture.respond(() => Response.json({ error: "SHARED_PROJECT_FORBIDDEN" }, { status: 403 }));
  await assert.rejects(fixture.dataExchange.exportData("export-space", selection(), controller.signal), error =>
    error.status === 403 && error.payload.error === "SHARED_PROJECT_FORBIDDEN");
  assert.equal(controller.signal.aborted, false);
});

test("a late export response cannot escape account-generation cancellation after sign-out", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), entered = deferred(), response = deferred();
  // Deliberately ignore abort at the transport boundary to exercise the session generation guard.
  fixture.respond(() => { entered.resolve(); return response.promise; });
  const pending = fixture.dataExchange.exportData("export-space", selection(), new AbortController().signal);
  await entered.promise;
  fixture.window.dispatchEvent(Object.assign(new Event("storage"), { key: LOCAL_SIGN_OUT_KEY, newValue: "synthetic-sign-out" }));
  response.resolve(Response.json(result));
  await assert.rejects(pending, error => error.status === 401 && error.message === "AUTH_REQUIRED");
  assert.equal(fixture.requests[0].init.signal.aborted, true);
});

test("export cancellation still aborts while a large response body is being read", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), bodyEntered = deferred(), controller = new AbortController();
  let writer;
  fixture.respond((_url, init) => {
    const body = new ReadableStream({ start(stream) { writer = stream; } });
    init.signal.addEventListener("abort", () => writer.error(init.signal.reason), { once: true });
    const response = new Response(body, { headers: { "Content-Type": "application/json" } });
    const json = response.json.bind(response);
    response.json = () => { bodyEntered.resolve(); return json(); };
    return response;
  });
  const pending = fixture.dataExchange.exportData("export-space", selection(), controller.signal);
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  await bodyEntered.promise;
  controller.abort();
  await setImmediate();
  const aborted = fixture.requests[0].init.signal.aborted;
  if (!aborted) { writer.enqueue(new TextEncoder().encode(JSON.stringify(result))); writer.close(); }
  const settled = await outcome;
  assert.equal(aborted, true, "caller cancellation must remain connected after headers");
  assert.equal(settled.error?.name, "AbortError");
});

test("account sign-out aborts an export body that has already started loading", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), bodyEntered = deferred();
  fixture.respond((_url, init) => {
    let writer;
    const response = new Response(new ReadableStream({ start(stream) { writer = stream; } }));
    init.signal.addEventListener("abort", () => writer.error(init.signal.reason), { once: true });
    const json = response.json.bind(response);
    response.json = () => { bodyEntered.resolve(); return json(); };
    return response;
  });
  const outcome = fixture.dataExchange.exportData("export-space", selection()).then(value => ({ value }), error => ({ error }));
  await bodyEntered.promise;
  fixture.window.dispatchEvent(Object.assign(new Event("storage"), { key: LOCAL_SIGN_OUT_KEY, newValue: "synthetic-sign-out" }));
  const settled = await outcome;
  assert.equal(fixture.requests[0].init.signal.aborted, true);
  assert.equal(settled.value, undefined);
  assert.equal(settled.error?.name, "AbortError");
});

test("the existing request timeout remains active until the export body finishes", async () => {
  const alarms = [], timers = {
    setTimeout(run, milliseconds) { const alarm = { run, milliseconds, cleared: false }; alarms.push(alarm); return alarm; },
    clearTimeout(alarm) { alarm.cleared = true; },
  };
  const fixture = await cloudSyncClient({ withDataExchange: true, timers }), bodyEntered = deferred();
  fixture.respond((_url, init) => {
    let writer;
    const response = new Response(new ReadableStream({ start(stream) { writer = stream; } }));
    init.signal.addEventListener("abort", () => writer.error(init.signal.reason), { once: true });
    const json = response.json.bind(response);
    response.json = () => { bodyEntered.resolve(); return json(); };
    return response;
  });
  const outcome = fixture.dataExchange.exportData("export-space", selection()).then(value => ({ value }), error => ({ error }));
  await bodyEntered.promise;
  const alarm = alarms.find(value => value.milliseconds === 20_000);
  assert.ok(alarm);
  assert.equal(alarm.cleared, false);
  alarm.run();
  const settled = await outcome;
  assert.ok(settled.error instanceof fixture.client.GenesisNetworkTimeoutError);
  assert.equal(fixture.requests[0].init.signal.aborted, true);
  assert.equal(alarm.cleared, true);
});

test("invalid export JSON still rejects and completed requests detach their cancellation listener", async () => {
  const fixture = await cloudSyncClient({ withDataExchange: true }), invalid = new AbortController(), valid = new AbortController();
  fixture.respond(() => new Response("{incomplete", { status: 200 }));
  await assert.rejects(fixture.dataExchange.exportData("export-space", selection(), invalid.signal), /временно недоступен/);
  invalid.abort();
  assert.equal(fixture.requests[0].init.signal.aborted, false);
  fixture.respond(() => Response.json(result));
  const exported = await fixture.dataExchange.exportData("export-space", selection(), valid.signal);
  valid.abort();
  assert.equal(exported.content, result.content);
  assert.equal(fixture.requests[1].init.signal.aborted, false);
});
