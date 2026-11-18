// Playwright CLI --filename function; only task-owned loopback contexts.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const checks=[],check=(name,passed)=>{checks.push({name,passed});if(!passed)throw new Error(name);};
  const context=await page.context().browser().newContext(),url=page.url();
  try {
    const old=await context.newPage();await old.goto(url);await old.waitForFunction(()=>globalThis.genesisTransportFixture?.state().ready);
    await old.evaluate(()=>globalThis.genesisTransportFixture.resetProfile());
    const missing=await old.evaluate(()=>globalThis.genesisTransportFixture.workerProbe());
    check('migration refuses a page without a controlling security worker',missing.error==='E2EE_SERVICE_WORKER_REQUIRED');
    await old.evaluate(()=>globalThis.genesisTransportFixture.registerWorker());
    check('real service worker acknowledges the required transport protocol',(await old.evaluate(()=>globalThis.genesisTransportFixture.workerProbe())).ok===true);
    const control=await context.newPage();await control.goto(url);await control.waitForFunction(()=>globalThis.genesisTransportFixture?.state().ready);
    const owner='worker-owner-'+Date.now(),id='slow-'+Date.now();
    await old.evaluate(id=>globalThis.genesisTransportFixture.oldSlow(id),id);
    await control.waitForFunction(async id=>(await globalThis.genesisTransportFixture.slowStatus()).active.includes(id),id);
    await control.evaluate(owner=>{globalThis.workerFreeze=globalThis.genesisTransportFixture.workerFreeze(owner);},owner);
    await control.waitForFunction(async()=>{const state=await navigator.locks.query();return state.pending.some(lock=>lock.name.endsWith(':unbound')&&lock.mode==='exclusive');});
    check('worker holds an old unidentified response under the shared global permit',(await control.evaluate(()=>navigator.locks.query())).held.some(lock=>lock.name.endsWith(':unbound')&&lock.mode==='shared'));
    check('migration cannot snapshot ahead of the final old network bytes',await control.evaluate(owner=>globalThis.genesisTransportFixture.marker(owner),owner)===null);
    await control.evaluate(id=>globalThis.genesisTransportFixture.releaseSlow(id).then(()=>true),id);
    const oldReply=await old.evaluate(id=>globalThis.genesisTransportFixture.wait(id),id);
    check('old response arrives complete before the snapshot',oldReply.status===200&&oldReply.payload.synthetic===true);
    const token=await control.evaluate(()=>globalThis.workerFreeze);check('worker barrier permits migration after old IO completes',typeof token==='string');
    const before=await control.evaluate(()=>globalThis.genesisTransportFixture.counters());
    const denied=await old.evaluate(()=>globalThis.genesisTransportFixture.oldRequest('/advice/saved'));
    const after=await control.evaluate(()=>globalThis.genesisTransportFixture.counters());
    check('old unbound private request creates zero server requests after the marker',denied.status===409&&denied.payload.error==='E2EE_UPGRADE_REQUIRED'&&after.count===before.count);
    const privatePatch=await old.evaluate(()=>globalThis.genesisTransportFixture.oldRequest('/account/preferences',{method:'PUT',body:'{"uiLayout":{"synthetic":true}}'}));
    check('old private preference patch never reaches the backend',privatePatch.status===409&&(await control.evaluate(()=>globalThis.genesisTransportFixture.counters())).preferenceCount===before.preferenceCount);
    const technical=await old.evaluate(()=>globalThis.genesisTransportFixture.oldRequest('/account/preferences',{method:'PUT',body:'{"language":"en"}'}));
    check('technical preference patch remains compatible',technical.status===200);
    const session=await old.evaluate(()=>globalThis.genesisTransportFixture.oldRequest('/session'));
    const status=await old.evaluate(()=>globalThis.genesisTransportFixture.oldRequest('/e2ee/v1/status'));
    check('identity and signed discovery stay outside private interception',session.status===200&&status.status===200&&status.payload.cryptoProtocol===1);
    const productOwner=await old.evaluate(()=>globalThis.genesisTransportFixture.productSession());
    const normal=await old.evaluate(()=>globalThis.genesisTransportFixture.productRequest());
    check('an identified unrelated legacy account can still use the real API',typeof productOwner==='string'&&normal.ok===true);
    await control.evaluate(owner=>globalThis.genesisTransportFixture.workerFreeze(owner),productOwner);
    const identifiedBefore=await control.evaluate(()=>globalThis.genesisTransportFixture.count());
    const identified=await old.evaluate(owner=>globalThis.genesisTransportFixture.oldRequest('/advice/saved',{headers:{'X-Genesis-Account-Id':owner}}),productOwner);
    check('worker independently fences an identified request bypassing the page API',identified.payload.error==='E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN'&&await control.evaluate(()=>globalThis.genesisTransportFixture.count())===identifiedBefore);
    const corrupt=owner+'-corrupt';await control.evaluate(owner=>globalThis.genesisTransportFixture.corruptMarker(owner),corrupt);
    const broken=await old.evaluate(owner=>globalThis.genesisTransportFixture.oldRequest('/advice/saved',{headers:{'X-Genesis-Account-Id':owner}}),corrupt);
    check('worker reports marker corruption without plaintext fallback',broken.status===409&&broken.payload.error==='E2EE_CORRUPT_LOCAL_FENCE');
    return{status:'PASS',synthetic:true,checks};
  } finally { await context.close(); }
}
