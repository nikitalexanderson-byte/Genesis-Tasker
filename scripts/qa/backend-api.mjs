import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupBackendRuntime } from './backend-cleanup.mjs';
import { backendPhpEnvironment, resolveBackendPhp } from './backend-php.mjs';
import { versionInfo } from './full-lib.mjs';
import { verifyTrialApi317 } from './trial-api317.mjs';
import { waitForQaBackend } from './backend-ready.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const php = await resolveBackendPhp(args.php);
const runId = args['run-id'] || `api-${new Date().toISOString().replaceAll(/[^0-9]/g, '').slice(0,14)}-${randomBytes(3).toString('hex')}`;
if (!/^[a-zA-Z0-9-]{6,80}$/.test(runId)) throw new Error('Invalid run ID');
const output = resolve(root, args.output || `output/qa/3.1.7-2026-11-03/backend/${runId}`);
if (existsSync(output)) throw new Error('Fresh output required');
mkdirSync(output, { recursive: true });
const runtime = join(output, 'runtime').replaceAll('\\', '/');
const rows = [];
const resultPath = join(output, 'api-results.json');
// Independent acceptance table: the user's 3.1.7 requirement raises Premium maps to 100.
// Historical expectations remain in docs/qa/full-2026-11-03.
const expected = {
  free: { projects:5, habits:5, maps:1, diary:100 },
  standart: { projects:20, habits:10, maps:5, diary:365 },
  premium: { projects:100, habits:20, maps:100, diary:1000 },
  business: { projects:100, habits:20, maps:100, diary:3000 },
  premium4life: { projects:100, habits:20, maps:100, diary:3000 },
};
const source = 'docs/qa/3.1.7-2026-11-03/requirements.md; docs/web-ui-lemon-test-2026-11-02.md; docs/release-3.1.5-acceptance.md; server/resources/feature-access-policy.json (cross-checked, not imported as oracle)';
const build = `${versionInfo(root).appVersion}-local`;
function record(tier, operation, expectedResult, actual, passed, details = {}) {
  const row = { id:`api.${tier}.${operation}`, feature: operation.split('.')[0], operation, platform:'php-http', build,
    tier, subscriptionState:details.state || (tier === 'free' ? 'free' : tier === 'premium4life' ? 'lifetime' : 'active'), role:'ordinary-user',
    expected:expectedResult, actual, status:passed?'PASS':'FAIL', level:'API/integration', source, runId, ...details };
  rows.push(row); writeFileSync(resultPath, JSON.stringify({ runId, results:rows }, null, 2));
  if (!passed) console.log(`FAIL ${row.id}: ${JSON.stringify(actual)}`);
  return passed;
}
async function command(file, cmdArgs, timeout=120000) {
  return await new Promise((done) => {
    const child = spawn(php, ['-d','disable_functions=curl_exec,mail',file,...cmdArgs], { cwd:root, windowsHide:true,
      env:{ ...process.env, ...backendPhpEnvironment(php) }, stdio:['ignore','pipe','pipe'] });
    let stdout='',stderr=''; child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
    const timer=setTimeout(()=>child.kill(),timeout);
    child.on('close',code=>{clearTimeout(timer);done({code,stdout,stderr});}); child.on('error',error=>{clearTimeout(timer);done({code:-1,stdout,stderr:error.message});});
  });
}
async function control(tier, action, extra={}) {
  const result=await command('scripts/qa/backend-control.php',[`--dir=${runtime}`,`--tier=${tier}`,`--action=${action}`,...Object.entries(extra).map(([key,value])=>`--${key}=${value}`)]);
  if(result.code!==0)throw new Error(`Synthetic control failed ${tier}/${action}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
const port = await new Promise((done) => { const server=createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>done(p));}); });
const origin=`http://127.0.0.1:${port}`;
const httpLog=[];
let server=null, serverClosed=null;
const sessions={};
async function request(tier,path,method='GET',payload,options={}) {
  const session=sessions[tier] || {};
  const headers={'Content-Type':'application/json',Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),...(session.csrf?{'X-CSRF-Token':session.csrf}:{})};
  if(options.csrf===false)delete headers['X-CSRF-Token'];
  const response=await fetch(origin+'/api/'+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  const cookie=response.headers.get('set-cookie'); if(cookie){session.cookie=cookie.split(';')[0];sessions[tier]=session;}
  const text=await response.text(); let data;try{data=JSON.parse(text);}catch{data={error:'NON_JSON'};}
  return {status:response.status,data};
}
async function login(tier){await request(tier,`qa/login?tier=${tier}`);const response=await request(tier,'session');sessions[tier].csrf=response.data.csrf;return response;}
const envelope=(id,revision=0)=>({schemaVersion:1,expectedRevision:revision,operationId:`op-${id}-${revision}`,iv:Buffer.alloc(12,7).toString('base64'),ciphertext:Buffer.from(`synthetic encrypted envelope ${id} ${revision}`).toString('base64')});
const diaryEnvelope=(id,revision=0)=>{const result=envelope(id,revision);delete result.operationId;return result;};
const workspace=(projects,habits,version)=>({expectedVersion:version,writerProtocol:9,minimumWriterProtocol:9,
  iv:Buffer.alloc(12,8).toString('base64'),ciphertext:Buffer.from(`synthetic encrypted workspace ${projects}:${habits}:${version}`).toString('base64'),
  quotaUsage:{'personal-projects':Array.from({length:projects},(_,i)=>`p-${i}`),habits:Array.from({length:habits},(_,i)=>`h-${i}`)}});
const codeOf=(r)=>({status:r.status,error:r.data.error ?? null});
const sharedMap=(id,revision=0)=>({schemaVersion:1,expectedRevision:revision,operationId:`operation-${id}-${revision}`,
  document:{schemaVersion:1,id,title:`Synthetic ${id}`,pinned:false,archived:false,nodes:[{id:'root',parentId:null,kind:'idea',text:'Synthetic root',note:''}],links:[]}});
try {
  const setup=await command('scripts/qa/backend-fixture.php',[`--dir=${runtime}`,`--origin=${origin}`,`--run-id=${runId}`]);
  if(setup.code!==0)throw new Error(`Fixture failed: ${setup.stderr}`);
  server=spawn(php,['-d','disable_functions=curl_exec,mail','-S',`127.0.0.1:${port}`,'scripts/qa/backend-router.php'],{cwd:root,windowsHide:true,
    env:{...process.env,GENESIS_FULL_QA:'isolated',GENESIS_FULL_QA_DIR:runtime,...backendPhpEnvironment(php)},stdio:['ignore','pipe','pipe']});
  let serverError=null;
  server.once('error',error=>{serverError=error;});
  serverClosed=new Promise(done=>server.once('close',done));
  server.stdout.on('data',c=>httpLog.push(String(c)));server.stderr.on('data',c=>httpLog.push(String(c)));
  if (serverError) throw serverError;
  await waitForQaBackend(server, origin, runId);
  const anonymous=await request('anonymous','workspace');record('guest','workspace.anonymous-reject',401,codeOf(anonymous),anonymous.status===401,{role:'guest',state:'anonymous'});
  await login('outsider');
  // A paid outsider tests authorization independently of the Free subscription gate.
  await control('outsider','subscription',{plan:'standart'});
  for(const [tier,limits] of Object.entries(expected).filter(([tier])=>!args.tiers||args.tiers.split(',').includes(tier))) {
    const session=await login(tier); const user=session.data.user;
    record(tier,'auth.session', {admin:false,plan:tier}, {status:session.status,admin:user?.isAdmin,plan:user?.subscriptionPlan},session.status===200 && user?.isAdmin===false && user?.subscriptionPlan===tier);
    const transferAllowed=user?.featureAccess?.allowedFeatures?.includes('data-export');
    record(tier,'data-transfer.effective-entitlement',tier!=='free',transferAllowed,transferAllowed===(tier!=='free'));
    const admin=await request(tier,'admin/stats');record(tier,'admin.denied',403,codeOf(admin),admin.status===403);
    const paidShared=['business','premium4life'].includes(tier);
    if(paidShared){
      const empty=await request(tier,'shared/spaces');
      const quota=empty.data.ownedProjectQuota;
      record(tier,'shared-projects.zero-space-owner-quota',{count:0,limit:100,remaining:100},{count:quota?.count,limit:quota?.limit,remaining:quota?.remaining},empty.status===200&&quota?.count===0&&quota.limit===100&&quota.remaining===100);
    }
    const shared=await request(tier,'shared/spaces','POST',{title:`Synthetic ${tier}`});
    record(tier,'shared-spaces.create',paidShared?'allow':'deny',codeOf(shared),shared.status===(paidShared?201:403));
    const assistant=await request(tier,'assistant/status');record(tier,'assistant.globally-disabled',403,codeOf(assistant),assistant.status===403);
    const physis=await request(tier,'physis/v1/access');record(tier,'physis.lifetime-gate',tier==='premium4life'?200:403,codeOf(physis),physis.status===(tier==='premium4life'?200:403));
    for(const [kind,allowed] of [['timeline',tier!=='free'],['spread',['premium','business','premium4life'].includes(tier)]]){
      const draw=await request(tier,'stoicheion/draws','POST',{kind,seed:20261103});record(tier,`oracle.${kind}-create`,allowed?200:403,codeOf(draw),draw.status===(allowed?200:403));
    }
    const catalog=await request(tier,'billing/catalog?client=web');
    const prices={'standart:1':33300,'standart:12':333000,'premium:1':55500,'premium:12':555000,'business:1':77700,'business:12':777000,'premium4life:0':1290000};
    for(const [offerId,amount] of Object.entries(prices)){
      const offer=catalog.data.offers?.find(item=>item.id===offerId);
      record(tier,`billing.catalog-${offerId.replace(':','-')}`,{amount,currency:'RUB',enabled:false},offer?{amount:offer.amountMinor,currency:offer.currency,enabled:offer.availableProviders.length>0}:null,
        catalog.status===200&&offer?.amountMinor===amount&&offer?.currency==='RUB'&&offer?.availableProviders.length===0,{source:'docs/web-advice-billing-2026-11-01.md; server/resources/billing-catalog.json',paymentPeriod:offerId.split(':')[1]});
    }
    const order=await request(tier,'billing/orders','POST',{offerId:'premium:1',provider:'yookassa',client:'web',idempotencyKey:`synthetic-order-${tier}`,expectedAmountMinor:55500,expectedCurrency:'RUB'});
    record(tier,'billing.unconfigured-checkout-denied',503,codeOf(order),order.status===503);
    const csrf=await request(tier,'mindmaps/csrf-probe','PUT',envelope('csrf'),{csrf:false});record(tier,'security.csrf-reject',403,codeOf(csrf),csrf.status===403);
    const originalPlan=user?.subscriptionPlan;
    await request(tier,'account/preferences','PUT',{subscriptionPlan:'premium4life',featureAccess:{effectivePlan:'business'}});
    const afterSpoof=await request(tier,'session');record(tier,'subscription.client-spoof-denied',originalPlan,afterSpoof.data.user?.subscriptionPlan,afterSpoof.data.user?.subscriptionPlan===originalPlan);

    let ownedProject = null;
    if(paidShared && shared.data.space?.id){
      const space=shared.data.space.id;
      const second=await request(tier,'shared/spaces','POST',{title:'Synthetic second owner space'});const otherSpace=second.data.space?.id;
      const initial=await request(tier,`shared/spaces/${space}/projects`);record(tier,'shared-projects.inbox-not-charged',1,initial.data.projects?.length,initial.data.projects?.length===1);
      await control(tier,'seed-shared-projects',{space,count:99});
      const last=await request(tier,`shared/spaces/${otherSpace}/projects`,'POST',{title:'Synthetic owner last slot'});
      ownedProject = { space:otherSpace, id:last.data.project?.id };
      record(tier,'shared-projects.owner-quota-limit',201,codeOf(last),last.status===201,{quota:100,scope:'owner-across-spaces'});
      const over=await request(tier,`shared/spaces/${space}/projects`,'POST',{title:'Synthetic rejected project'});
      record(tier,'shared-projects.owner-quota-overflow',403,codeOf(over),over.status===403,{quota:100,scope:'owner-across-spaces'});
      const spacesAtCap=await request(tier,'shared/spaces');
      const quota=spacesAtCap.data.ownedProjectQuota;
      record(tier,'shared-projects.owner-quota-metadata',{count:100,limit:100,remaining:0},quota,quota?.count===100&&quota.limit===100&&quota.remaining===0&&spacesAtCap.data.spaces.every(row=>row.projectQuota?.ownerId===quota.ownerId&&row.projectQuota.count===100));
      const blockedSpace=await request(tier,'shared/spaces','POST',{title:'Must be blocked by owner root pool'});
      record(tier,'shared-spaces.full-owner-pool-denied',403,codeOf(blockedSpace),blockedSpace.status===403&&blockedSpace.data.error==='SUBSCRIPTION_QUOTA_shared-projects');
      const child=await request(tier,`shared/spaces/${otherSpace}/projects`,'POST',{title:'Allowed nested project at owner cap',parentId:last.data.project?.id});
      record(tier,'shared-projects.subproject-at-cap',201,codeOf(child),child.status===201);
      const taskList=await request(tier,`shared/spaces/${otherSpace}/projects`,'POST',{title:'Synthetic list excluded from quota',kind:'task-list',parentId:last.data.project?.id});
      record(tier,'shared-projects.task-list-not-charged',201,codeOf(taskList),taskList.status===201);
      const outsider=await request('outsider',`shared/projects/${last.data.project?.id}`);record(tier,'shared-projects.foreign-access-denied',404,codeOf(outsider),outsider.status===404);
      const initialMaps=await request(tier,`shared/spaces/${space}/mindmaps`);record(tier,'shared-mindmaps.quota-zero',0,initialMaps.data.maps?.length,initialMaps.data.maps?.length===0);
      await control(tier,'seed-shared-mindmaps',{space,count:99});
      const lastMap=await request(tier,`shared/spaces/${otherSpace}/mindmaps/boundary`,'PUT',sharedMap('boundary'));
      record(tier,'shared-mindmaps.owner-quota-limit',200,codeOf(lastMap),lastMap.status===200,{quota:100,scope:'owner-across-spaces'});
      const overMap=await request(tier,`shared/spaces/${space}/mindmaps/overflow`,'PUT',sharedMap('overflow'));
      record(tier,'shared-mindmaps.owner-quota-overflow',403,codeOf(overMap),overMap.status===403,{quota:100,scope:'owner-across-spaces'});
      const editMap=await request(tier,`shared/spaces/${otherSpace}/mindmaps/boundary`,'PUT',sharedMap('boundary',1));record(tier,'shared-mindmaps.edit-at-cap',2,editMap.data.revision,editMap.status===200&&editMap.data.revision===2);
      const deleteMap=await request(tier,`shared/spaces/${otherSpace}/mindmaps/boundary`,'DELETE',{expectedRevision:2});record(tier,'shared-mindmaps.delete-release',200,codeOf(deleteMap),deleteMap.status===200);
      const reuseMap=await request(tier,`shared/spaces/${space}/mindmaps/replacement`,'PUT',sharedMap('replacement'));record(tier,'shared-mindmaps.reuse-released-quota',200,codeOf(reuseMap),reuseMap.status===200);
    }else{
      for(const path of ['shared/spaces/foreign/projects','shared/spaces/foreign/mindmaps','shared/messenger/conversations']){
        const denied=await request(tier,path,'POST',{});record(tier,`shared-route.${path.replaceAll('/','-')}-write-denied`,403,codeOf(denied),denied.status===403);
      }
    }

    let version=0;
    for(const [name,countProjects,countHabits] of [['zero',0,0],['below',limits.projects-1,limits.habits-1],['limit',limits.projects,limits.habits]]) {
      const response=await request(tier,'workspace','PUT',workspace(countProjects,countHabits,version));if(response.status===200)version=response.data.workspace.version;
      record(tier,`workspace.quota-${name}`,200,codeOf(response),response.status===200,{quota:{projects:limits.projects,habits:limits.habits}});
    }
    for(const resource of ['projects','habits']) {
      const response=await request(tier,'workspace','PUT',workspace(limits.projects+(resource==='projects'?1:0),limits.habits+(resource==='habits'?1:0),version));
      record(tier,`workspace.${resource}-overflow`,403,codeOf(response),response.status===403);
    }
    const saved=await request(tier,'workspace');record(tier,'workspace.denial-preserves-version',version,saved.data.workspace?.envelope?.version,saved.data.workspace?.envelope?.version===version);
    const stale=await request(tier,'workspace','PUT',workspace(1,1,version-1));record(tier,'workspace.stale-cas',409,codeOf(stale),stale.status===409);
    for(const [name,p,h] of [['release',limits.projects-1,limits.habits-1],['reuse',limits.projects,limits.habits]]){
      const response=await request(tier,'workspace','PUT',workspace(p,h,version));if(response.status===200)version=response.data.workspace.version;record(tier,`workspace.${name}-quota`,200,codeOf(response),response.status===200);
    }

    for(const [resource,limit,path,key,seed] of [['mindmaps',limits.maps,'mindmaps','maps','seed-mindmaps'],['diary',limits.diary,'diary','notes','seed-diary']]) {
      const fresh=await request(tier,path);record(tier,`${resource}.quota-zero`,0,fresh.data[key]?.length,fresh.data[key]?.length===0,{quota:limit});
      await control(tier,seed,{count:limit-1});const below=await request(tier,path);record(tier,`${resource}.quota-below`,limit-1,below.data[key]?.length,below.data[key]?.length===limit-1,{quota:limit});
      const body=resource==='mindmaps'?envelope(`${tier}-boundary`):diaryEnvelope(`${tier}-boundary`);
      const boundary=await request(tier,`${path}/boundary`,'PUT',body);record(tier,`${resource}.quota-limit`,200,codeOf(boundary),boundary.status===200,{quota:limit});
      const retry=await request(tier,`${path}/boundary`,'PUT',body);record(tier,`${resource}.retry-idempotent`,1,retry.data.revision,retry.status===200&&retry.data.revision===1);
      const overflow=await request(tier,`${path}/overflow`,'PUT',resource==='mindmaps'?envelope(`${tier}-overflow`):diaryEnvelope(`${tier}-overflow`));record(tier,`${resource}.quota-overflow`,403,codeOf(overflow),overflow.status===403);
      const after=await request(tier,path);record(tier,`${resource}.denial-preserves-count`,limit,after.data[key]?.length,after.data[key]?.length===limit);
      const edited=await request(tier,`${path}/boundary`,'PUT',resource==='mindmaps'?envelope(`${tier}-edit`,1):diaryEnvelope(`${tier}-edit`,1));record(tier,`${resource}.edit-at-cap`,2,edited.data.revision,edited.status===200&&edited.data.revision===2);
      const foreign=await request('outsider',resource==='mindmaps'?`${path}/boundary/history`:path);record(tier,`${resource}.foreign-read-denied`,0,foreign.data[resource==='mindmaps'?'versions':'notes']?.length,foreign.data[resource==='mindmaps'?'versions':'notes']?.length===0);
      const foreignWrite=await request('outsider',`${path}/boundary`,'PUT',resource==='mindmaps'?envelope('foreign',2):diaryEnvelope('foreign',2));record(tier,`${resource}.foreign-write-denied`,409,codeOf(foreignWrite),foreignWrite.status===409);
      const deleted=await request(tier,`${path}/boundary`,'DELETE',{expectedRevision:2});record(tier,`${resource}.delete-release`,200,codeOf(deleted),deleted.status===200);
      const reused=await request(tier,`${path}/replacement`,'PUT',resource==='mindmaps'?envelope('replacement'):diaryEnvelope('replacement'));record(tier,`${resource}.reuse-released-quota`,200,codeOf(reused),reused.status===200);
      const resurrect=await request(tier,`${path}/boundary`,'PUT',body);record(tier,`${resource}.deleted-no-resurrection`,409,codeOf(resurrect),resurrect.status===409);
    }

    // Two independent PHP writers contend for the final map slot, using actual SQLite transactions.
    await request(tier,'mindmaps/replacement','DELETE',{expectedRevision:1});
    const race=await Promise.all(['race-a','race-b'].map(id=>control(tier,'save-mindmap',{id})));
    const raceStatuses=race.map(r=>r.status).sort();record(tier,'mindmaps.concurrent-last-slot',[200,403],raceStatuses,JSON.stringify(raceStatuses)==='[200,403]',{level:'integration/two-process'});
    const mapBefore=await request(tier,'mindmaps');let digest=createHash('sha256').update(JSON.stringify(mapBefore.data.maps)).digest('hex');
    if(tier!=='free'){
      await control(tier,'subscription',{plan:tier==='premium4life'?'free':tier,state:'expired'});
      const expired=await request(tier,'session');record(tier,'subscription.stale-session-rechecks-expiry','free',expired.data.user?.featureAccess?.effectivePlan,expired.data.user?.featureAccess?.effectivePlan==='free',{state:'expired-or-revoked'});
      const preserved=await request(tier,'mindmaps');const currentDigest=createHash('sha256').update(JSON.stringify(preserved.data.maps)).digest('hex');record(tier,'subscription.maps-preserved',digest,currentDigest,currentDigest===digest,{state:'expired-or-revoked'});
      const blocked=await request(tier,'mindmaps/after-expiry','PUT',envelope('after-expiry'));record(tier,'subscription.no-growth-after-expiry',403,codeOf(blocked),blocked.status===403,{state:'expired-or-revoked'});
      const existing=preserved.data.maps?.[0];
      if(existing){
        const edit=await request(tier,`mindmaps/${existing.id}`,'PUT',envelope(`expiry-edit-${existing.id}`,existing.revision));
        record(tier,'subscription.existing-map-edit-after-expiry',existing.revision+1,edit.data.revision,edit.status===200&&edit.data.revision===existing.revision+1,{state:'expired-or-revoked'});
        const updated=await request(tier,'mindmaps');digest=createHash('sha256').update(JSON.stringify(updated.data.maps)).digest('hex');
      }
      const diaryPreserved=await request(tier,'diary');record(tier,'subscription.diary-preserved',limits.diary,diaryPreserved.data.notes?.length,diaryPreserved.data.notes?.length===limits.diary,{state:'expired-or-revoked'});
      const diaryEdit=await request(tier,'diary/replacement','PUT',diaryEnvelope('expiry-edit',1));record(tier,'subscription.existing-diary-edit-after-expiry',2,diaryEdit.data.revision,diaryEdit.status===200&&diaryEdit.data.revision===2,{state:'expired-or-revoked'});
      const workspaceEdit=await request(tier,'workspace','PUT',workspace(limits.projects,limits.habits,version));record(tier,'subscription.existing-workspace-edit-after-expiry',version+1,workspaceEdit.data.workspace?.version,workspaceEdit.status===200&&workspaceEdit.data.workspace?.version===version+1,{state:'expired-or-revoked'});
      if(ownedProject){
        const read=await request(tier,`shared/projects/${ownedProject.id}`);record(tier,'subscription.shared-read-after-expiry',200,codeOf(read),read.status===200,{state:'expired-or-revoked'});
        const exported=await request(tier,`shared/spaces/${ownedProject.space}/data-export`,'POST',{scope:'tree',projectId:ownedProject.id});
        record(tier,'subscription.shared-export-after-expiry',403,codeOf(exported),exported.status===403&&exported.data.error==='FEATURE_SUBSCRIPTION_REQUIRED'&&exported.data.feature==='data-export'&&!('content' in exported.data),{state:'expired-or-revoked'});
        const csv=await request(tier,`shared/spaces/${ownedProject.space}/data-export`,'POST',{scope:'tree',projectId:ownedProject.id,format:'csv'});
        record(tier,'subscription.shared-csv-export-after-expiry',403,codeOf(csv),csv.status===403&&csv.data.error==='FEATURE_SUBSCRIPTION_REQUIRED'&&csv.data.feature==='data-export'&&!('content' in csv.data),{state:'expired-or-revoked'});
        const exportCsrf=await request(tier,`shared/spaces/${ownedProject.space}/data-export`,'POST',{scope:'tree',projectId:ownedProject.id},{csrf:false});
        record(tier,'subscription.export-csrf-required',403,codeOf(exportCsrf),exportCsrf.status===403,{state:'expired-or-revoked'});
        const foreignExport=await request('outsider',`shared/spaces/${ownedProject.space}/data-export`,'POST',{scope:'tree',projectId:ownedProject.id});
        record(tier,'subscription.foreign-export-denied',404,codeOf(foreignExport),foreignExport.status===404,{state:'expired-or-revoked'});
        const newProject=await request(tier,`shared/spaces/${ownedProject.space}/projects`,'POST',{title:'Must remain restricted after expiry'});
        record(tier,'subscription.new-shared-project-still-denied',403,codeOf(newProject),newProject.status===403,{state:'expired-or-revoked'});
      }
      await control(tier,'subscription',{plan:tier});const renewed=await request(tier,'session');record(tier,'subscription.restore-session-rights',tier,renewed.data.user?.subscriptionPlan,renewed.data.user?.subscriptionPlan===tier,{state:'restored-fixture'});
    }
    await login(tier);const reopened=await request(tier,'mindmaps');record(tier,'persistence.new-session',digest,createHash('sha256').update(JSON.stringify(reopened.data.maps)).digest('hex'),createHash('sha256').update(JSON.stringify(reopened.data.maps)).digest('hex')===digest);
    console.log(`COMPLETE ${tier}: HTTP lifecycle finished`);
  }
  await verifyTrialApi317({request,login,control,record,envelope});
} catch(error) {
  record('environment','runner.completed','completed',String(error.message),false);process.exitCode=1;
} finally {
  if(server){server.kill();await serverClosed;}
  writeFileSync(join(output,'http-server.log'),httpLog.join('').replace(/(GENESISSESSID=)[^\s;]+/g,'$1[REDACTED]'));
  let cleanup = { status:'NOT_RUN', reason:'Explicit --keep-runtime requested' };
  if (!args['keep-runtime']) {
    try { cleanup = existsSync(runtime) ? cleanupBackendRuntime(runtime, output) : {status:'PASS',reason:'No runtime created'}; }
    catch(error) { cleanup = {status:'FAIL',error:error.message};record('environment','cleanup.owned-runtime','removed',error.message,false); }
  }
  const summary=Object.fromEntries(['PASS','FAIL'].map(status=>[status,rows.filter(row=>row.status===status).length]));
  const blocked=['Google OAuth and real Calendar/Tasks sync','Google Play licensed test purchase','Lemon Squeezy sandbox checkout/webhook','YooKassa sandbox charge/refund','Real push and email delivery'].map(item=>({operation:item,status:'BLOCKED',reason:'This isolated run does not load provider credentials and disables external delivery. Existing provider configuration elsewhere is not assessed; injected contract tests are separate evidence.'}));
  writeFileSync(resultPath,JSON.stringify({runId,summary,cleanup,isolation:{database:runtime+'/genesis.sqlite',ordinaryUsers:true,externalDelivery:'curl_exec/mail disabled',productionTouched:false},results:rows,external:blocked},null,2));
  console.log(JSON.stringify({runId,summary,resultPath}));process.exitCode=summary.FAIL?1:0;
}
