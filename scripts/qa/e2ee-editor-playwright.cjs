// Executed by Playwright CLI; actual repository/WebCrypto/Web Locks/IndexedDB,
// loopback-only synthetic API. This is not a product activation or UI audit.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const checks=[];
  const check=(name,passed)=>{checks.push({name,passed});if(!passed)throw new Error(name);};
  await page.waitForFunction(()=>globalThis.genesisTransportFixture?.state().ready);
  const second=await page.context().newPage();await second.goto(page.url());
  await second.waitForFunction(()=>globalThis.genesisTransportFixture?.state().ready);
  try {
    for(const kind of ['mindmaps','shared','aurora','restoration']){
      await page.evaluate(()=>globalThis.genesisTransportFixture.resetProfile());
      const owner=await page.evaluate(kind=>globalThis.genesisTransportFixture.initEditor(kind),kind);
      await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('hold',kind),kind);
      await page.evaluate(kind=>globalThis.genesisTransportFixture.startEditor(kind),kind);
      await page.evaluate(async kind=>{
        const until=Date.now()+10000;
        while(Date.now()<until){if((await globalThis.genesisTransportFixture.editorControl('state',kind)).waiting.includes(kind))return;await new Promise(resolve=>setTimeout(resolve,20));}
        throw new Error(kind+': synthetic server did not receive the pending write');
      },kind);
      const staged=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorSources(kind),kind);
      check(kind+': ciphertext journal exists before server acknowledgment',staged.some(([key])=>key.includes(':draft:')||key.endsWith(':pending')));
      check(kind+': private draft text is absent from local bytes',!JSON.stringify(staged).includes('Synthetic private browser map'));
      await second.evaluate(owner=>{globalThis.editorMigration=globalThis.genesisTransportFixture.freeze(owner);},owner);
      await second.evaluate(async owner=>{
        const until=Date.now()+10000;
        while(Date.now()<until){if((await navigator.locks.query()).pending.some(lock=>lock.name.endsWith(':'+owner)&&lock.mode==='exclusive'))return;await new Promise(resolve=>setTimeout(resolve,20));}
        throw new Error('owner migration did not queue');
      },owner);
      check(kind+': cross-tab migration waits for the entire response',await second.evaluate(owner=>globalThis.genesisTransportFixture.marker(owner),owner)===null);
      await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('release',kind),kind);
      check(kind+': borrowed HTTP completes ahead of the waiting migration',(await page.evaluate(kind=>globalThis.genesisTransportFixture.waitEditor(kind),kind)).ok);
      await second.evaluate(()=>globalThis.editorMigration);
      const finished=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorSources(kind),kind);
      check(kind+': acknowledgment cleanup precedes marker commit',!finished.some(([key])=>key.includes(':draft:')||key.includes(':request:')||key.endsWith(':pending')));
      const before=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('state',kind),kind);
      await page.evaluate(kind=>globalThis.genesisTransportFixture.startEditor(kind),kind);
      const denied=await page.evaluate(kind=>globalThis.genesisTransportFixture.waitEditor(kind),kind);
      const after=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('state',kind),kind);
      check(kind+': denied next save creates zero server writes',denied.error==='E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN'&&after.writes===before.writes);
      check(kind+': denied save leaves all prior source bytes unchanged',JSON.stringify(finished)===JSON.stringify(await page.evaluate(kind=>globalThis.genesisTransportFixture.editorSources(kind),kind)));
    }
  } finally {await second.close();}
  return{status:'PASS',synthetic:true,checks};
}
