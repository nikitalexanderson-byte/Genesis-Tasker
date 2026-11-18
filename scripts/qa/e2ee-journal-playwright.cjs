// Actual two-tab Storage/WebCrypto/Web Locks; only the loopback synthetic API.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async page=>{
 const checks=[];const check=(name,passed)=>{checks.push({name,passed});if(!passed)throw new Error(name);};
 const second=await page.context().newPage();await second.goto(page.url());
 const poll=async(kind,writes)=>page.evaluate(async({kind,writes})=>{
  const until=Date.now()+10000;while(Date.now()<until){const state=await globalThis.genesisTransportFixture.editorControl('state',kind);
   if(state.writes>=writes&&state.waiting.includes(kind))return;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error('Synthetic held writes not reached');
 },{kind,writes});
 try{for(const kind of ['aurora','restoration']){
  await page.evaluate(()=>globalThis.genesisTransportFixture.resetProfile());
  const owner=await page.evaluate(kind=>globalThis.genesisTransportFixture.initEditor(kind),kind);
  check(kind+': both tabs bind the same verified owner',owner===await second.evaluate(kind=>globalThis.genesisTransportFixture.initEditor(kind),kind));
  const before=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('state',kind),kind);
  await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('hold',kind),kind);
  await page.evaluate(kind=>globalThis.genesisTransportFixture.startEditor(kind,'left-retained'),kind);await poll(kind,before.writes+1);
  const original=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorSources(kind).filter(([key])=>key.endsWith(':pending')),kind);
  await second.evaluate(kind=>globalThis.genesisTransportFixture.startEditor(kind,'right-retained'),kind);await poll(kind,before.writes+2);
  const staged=await page.evaluate(kind=>globalThis.genesisTransportFixture.editorSources(kind).filter(([key])=>key.endsWith(':pending')),kind);
  check(kind+': separate immutable writers coexist before acknowledgment',staged.length>=2&&new Set(staged.map(([key])=>key.split(':writer:')[1]?.split(':')[0])).size===2);
  check(kind+': second tab cannot overwrite the first request bytes',original.every(([key,raw])=>staged.some(([other,value])=>key===other&&raw===value)));
  check(kind+': private markers are absent from stored journals',!JSON.stringify(staged).includes('left-retained')&&!JSON.stringify(staged).includes('right-retained'));
  await page.evaluate(kind=>globalThis.genesisTransportFixture.editorControl('release',kind),kind);
  check(kind+': both exact writes finish',(await page.evaluate(kind=>globalThis.genesisTransportFixture.waitEditor(kind),kind)).ok&&(await second.evaluate(kind=>globalThis.genesisTransportFixture.waitEditor(kind),kind)).ok);
  const document=await page.evaluate(kind=>globalThis.genesisTransportFixture.loadEditor(kind),kind);
  check(kind+': cold read retains both deletion markers',document.removed.length===2&&document.removed.some(row=>row.id.endsWith('left-retained'))&&document.removed.some(row=>row.id.endsWith('right-retained')));
  check(kind+': every accepted journal is acknowledged exactly',!(await page.evaluate(kind=>globalThis.genesisTransportFixture.editorSources(kind),kind)).some(([key])=>key.endsWith(':pending')));
 }}finally{await second.close();}
 return{status:'PASS',synthetic:true,checks};
}
