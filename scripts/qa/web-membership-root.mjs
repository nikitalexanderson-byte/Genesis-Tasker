import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {hash} from './full-lib.mjs';

// Checks the actual compiled root, rather than mounting a review component in
// a replacement test root. The legacy fixture deliberately has no unlocked
// private authority: the requested review must mount and fail closed.
export async function runMembershipRoot({baseURL,output,bundleDirectory}){
 const report={status:'RUNNING',scope:'Actual compiled-root review registration and fail-closed UI only',checks:[],mutations:[],pageErrors:[],sourceSha256:hash(readFileSync(fileURLToPath(import.meta.url))),limitations:['No private account is unlocked and no approval is simulated','Not the populated owner-review/apply lifecycle']};
 const save=()=>writeFileSync(path.join(output,'membership-root-results.json'),JSON.stringify(report,null,2)+'\n');
 const copy=JSON.parse(readFileSync(new URL('../../contracts/e2ee/membership-review-copy-v2.json',import.meta.url))).en;
 const assets=path.join(bundleDirectory,'assets'),matches=readdirSync(assets).filter(name=>name.endsWith('.js')&&readFileSync(path.join(assets,name),'utf8').includes('E2EE_MEMBERSHIP_UI_BUSY'));
 assert.equal(matches.length,1,'One actual membership UI channel module is required');report.artifact=matches[0];report.artifactSha256=hash(readFileSync(path.join(assets,matches[0])));
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844}});
  await context.route('**/*',route=>{const url=route.request().url();return url.startsWith(baseURL+'/')||url.startsWith('data:')||url.startsWith('blob:')?route.continue():route.abort('blockedbyclient');});
  const login=await context.request.get('/api/qa/login?tier=business');assert.equal(login.status(),200);
  const session=await(await context.request.get('/api/session')).json();assert.equal(typeof session.user?.uid,'string');
  const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(/^\/api\/e2ee\/v1\/(bootstrap|command|challenge)$/.test(url.pathname))report.mutations.push({path:url.pathname,method:request.method()});});
  await page.goto('/#today');await page.locator('.today-tasks-panel').waitFor();await page.waitForLoadState('networkidle');
  const channelURL=await page.evaluate(artifact=>performance.getEntriesByType('resource').map(row=>row.name).find(name=>new URL(name).pathname.endsWith('/'+artifact))??('/assets/'+artifact),matches[0]);
  const entries=await page.evaluate(async({channelURL,ownerId})=>{
   const observed=window.__genesisQaMembershipRoot={mounted:false,outcome:'pending'};
   const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&(node.matches('.private-membership-dialog')||node.querySelector('.private-membership-dialog')))observed.mounted=true;});observer.observe(document.body,{childList:true,subtree:true});
   const exports=await import(channelURL);
   const waits=Object.values(exports).filter(value=>typeof value==='function'&&String(value).includes('E2EE_MEMBERSHIP_UI_BUSY')&&String(value).includes('new Promise'));
   if(waits.length===1)void waits[0](ownerId,'en','qa-root-registration-only').then(()=>{observed.outcome='resolved';},error=>{observed.outcome=/^E2EE_[A-Z_]+$/.test(error.message)?error.message:'other refusal';});
   return waits.length;
  },{channelURL,ownerId:session.user.uid});
  assert.equal(entries,1,'Use the real shared-editor review request channel');
  // The legacy identity is not an unlocked private account. The real root
  // mounts its review, then the foreground guard closes it with a refusal;
  // waiting for a persistent dialog here would incorrectly require bypassing
  // that guard just to test registration.
  try{await page.waitForFunction(()=>window.__genesisQaMembershipRoot?.mounted,null,{timeout:6000});}catch(error){report.rootObservation=await page.evaluate(()=>({observed:window.__genesisQaMembershipRoot,uiModules:performance.getEntriesByType('resource').filter(row=>row.name.includes('/assets/private-security-ui-')).map(row=>({path:new URL(row.name).pathname,queryKeys:[...new URL(row.name).searchParams.keys()]}))}));throw error;}
  report.checks.push({name:'ordinary compiled root instantiates the real requested membership review',status:'PASS'});
  await page.waitForFunction(error=>window.__genesisQaMembershipRoot.outcome==='E2EE_ACCOUNT_CHANGED'||document.querySelector('.private-membership-dialog [role=alert]')?.textContent===error,copy.error,{timeout:6000});
  const dialog=page.locator('.private-membership-dialog');
  if(await dialog.isVisible()){
   assert.equal(await dialog.getByRole('button',{name:copy.apply,exact:true}).count(),0);
   try{await dialog.getByRole('button',{name:copy.keep,exact:true}).click({timeout:2000});}catch(error){if(await dialog.isVisible())throw error;}
  }
  await dialog.waitFor({state:'hidden'});report.rootObservation=await page.evaluate(()=>window.__genesisQaMembershipRoot);
  assert.notEqual(report.rootObservation.outcome,'resolved');
  assert.deepEqual(report.mutations,[]);assert.deepEqual(report.pageErrors,[]);
  report.checks.push({name:'actual foreground guard refuses the legacy identity and submits no authority command',status:'PASS'});
  await page.screenshot({path:path.join(output,'membership-root-locked-refusal.png'),animations:'disabled'});
  await context.close();report.status='PASS';save();console.log('PASS compiled membership root 2/2');
  return{status:'PASS',report:path.join(output,'membership-root-results.json'),sha256:hash(readFileSync(path.join(output,'membership-root-results.json')))};
 }catch(error){report.status='FAIL';report.error=error.message;save();throw error;}
 finally{await browser.close();}
}
