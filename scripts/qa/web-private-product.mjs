// Mounted product migration against the real loopback PHP/SQLite API.
// Only identity/provider delivery is supplied by the isolated QA fixture.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {openBackup} from '../../app/backup-format.ts';

const baseURL=process.env.GENESIS_QA_WEB_ORIGIN;
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''));
const output=process.env.GENESIS_QA_WEB_OUTPUT;
assert(output);mkdirSync(output,{recursive:true});
const migration=JSON.parse(readFileSync('contracts/e2ee/migration-copy-v1.json','utf8')).ru;
const vault=JSON.parse(readFileSync('contracts/e2ee/vault-copy-v1.json','utf8')).ru;
const report={synthetic:true,scope:'mounted web product + real PHP/SQLite',status:'RUNNING',checks:[],apiErrors:[],pageErrors:[],caughtCodes:[],caughtFrames:[],storageFailures:[],migrationRefusals:[],migrationErrorFrames:[],networkFailures:[],networkRetries:[],historyGuards:[],rateLimits:[],rateRetries:[],custodyFrames:[],custodyPredicates:[],transferredScopes:[]};
report.keyBundleRefusals=[];
const browser=await chromium.launch({headless:true});report.browser=browser.version();
let page,secret,kit,backupKey;
const diagnostics=process.env.GENESIS_QA_FOLLOWUP_SCOPE==='diagnostics';
const profileOnly=process.env.GENESIS_QA_FOLLOWUP_SCOPE==='profile';
const sharedJourney=['shared','shared-locales','content'].includes(process.env.GENESIS_QA_FOLLOWUP_SCOPE);
const sharedFilesJourney=process.env.GENESIS_QA_FOLLOWUP_SCOPE==='content';
const localeJourney=['locales','shared-locales'].includes(process.env.GENESIS_QA_FOLLOWUP_SCOPE);
const backupJourney=['backup','content'].includes(process.env.GENESIS_QA_FOLLOWUP_SCOPE);
const sharedCopy=JSON.parse(readFileSync('contracts/e2ee/shared-security-copy-v1.json','utf8')).ru;
const sharedMigration=JSON.parse(readFileSync('contracts/e2ee/shared-migration-copy-v1.json','utf8')).ru;
const canary='PRIVATE-PRODUCT-'+crypto.randomUUID();
const cacheCanary='PRIVATE-CACHE-'+crypto.randomUUID();
let sharedFixture;
const redactPrivateText=value=>[secret,backupKey].filter(Boolean).reduce((text,key)=>text.replaceAll(key,'[redacted synthetic secret]'),String(value));
const save=()=>writeFileSync(`${output}/private-product-results.json`,JSON.stringify(report,null,2)+'\n');
const check=async(name,operation)=>{
 try{await operation();report.checks.push({name,status:'PASS'});console.log('PASS private-product '+name);save();}
 catch(error){report.checks.push({name,status:'FAIL',error:redactPrivateText(error.message)});throw error;}
};
const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow',acceptDownloads:true});
await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
await context.addInitScript(()=>{
 const original=IDBDatabase.prototype.transaction;
 IDBDatabase.prototype.transaction=function(...args){
  const transaction=original.apply(this,args);
  for(const event of ['error','abort'])transaction.addEventListener(event,value=>{
   const name=value.target?.error?.name??transaction.error?.name??null;
   console.info('GENESIS_QA_IDB_FAILURE '+JSON.stringify({event,stores:Array.from(transaction.objectStoreNames),mode:transaction.mode,error:typeof name==='string'&&/^[A-Za-z]+Error$/.test(name)?name:null}));
  });
  return transaction;
 };
});
const login=async target=>{const response=await target.request.get('/api/qa/login?tier=business');assert(response.ok()&&(await response.json()).synthetic);};
const downloadBytes=async download=>{const stream=await download.createReadStream();assert(stream);const parts=[];for await(const chunk of stream)parts.push(chunk);return Buffer.concat(parts);};
const recoveryInput=async(dialog,wrong=false)=>{
 await dialog.locator('input[type=file]').setInputFiles({name:'synthetic-recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(kit))});
 await dialog.locator('input[type=password]').fill(wrong?'A'.repeat(43):secret);
};
const continueMigration=async(dialog,button,label)=>{
 for(let attempt=0;attempt<3;attempt++){
  const failures=report.networkFailures.length;await recoveryInput(dialog);
  await dialog.getByRole('button',{name:button,exact:true}).click();
  const outcome=await Promise.race([dialog.waitFor({state:'hidden',timeout:1200000}).then(()=>'active'),dialog.getByRole('alert').waitFor({timeout:1200000}).then(()=>'refused')]);
  if(outcome==='active')return outcome;
  await page.waitForTimeout(100);const failure=report.networkFailures.at(-1),refusal=report.migrationRefusals.at(-1);
  if(attempt===2||report.networkFailures.length===failures||!failure||refusal&&refusal!=='NON_TECHNICAL_ERROR'
    ||!['net::ERR_NETWORK_CHANGED','net::ERR_INTERNET_DISCONNECTED','net::ERR_CONNECTION_RESET','net::ERR_CONNECTION_CLOSED','net::ERR_CONNECTION_REFUSED','net::ERR_FAILED'].includes(failure.code))return outcome;
  report.networkRetries.push({label,attempt:attempt+1,code:failure.code,policy:'Explicit retry through the existing form with the same saved recovery kit; no scope, journal or request reset'});save();
  await page.waitForTimeout(1000);
  button=await dialog.getByRole('button',{name:migration.resume,exact:true}).count()?migration.resume:migration.begin;
 }
 throw new Error('Migration network retry budget exhausted');
};
const withRateRetry=async(label,operation)=>{
 for(let attempt=0;attempt<4;attempt++){
  const previous=report.rateLimits.length;
  try{return await operation();}catch(error){
   await page.waitForTimeout(100);
   const limited=report.rateLimits.at(-1);if(report.rateLimits.length===previous||!limited||attempt===3)throw error;
   const until=limited.observedAt+limited.retryAfterSeconds*1000+1000;
   report.rateRetries.push({label,attempt:attempt+1,until,policy:'Actual Retry-After boundary; no rate table reset or larger budget'});save();
   console.log('WAIT private-product rate boundary '+label+' '+Math.max(0,until-Date.now())+'ms');
   while(Date.now()<until){assert(!page.isClosed());await page.waitForTimeout(Math.min(5000,until-Date.now()));}
  }
 }
};
try{
 await login(context);page=await context.newPage();page.setDefaultTimeout(20000);
 const debug=await context.newCDPSession(page);await debug.send('Debugger.enable');
 if(process.env.GENESIS_QA_DIAGNOSTIC_BUNDLE){
  // A false conditional logpoint observes only public refusal codes without
  // pausing the event loop inside live IndexedDB transactions.
  const assets=path.join(process.env.GENESIS_QA_DIAGNOSTIC_BUNDLE,'assets');
  const pattern=/\b(?:let|const|var)\s+([\w$]+)=([\w$]+)=>\{(?:let|const|var)\s+([\w$]+)=\2 instanceof Error\?\2.message:(?:``|"");return \3===`E2EE_REAUTH_REQUIRED`/;
  const candidates=readdirSync(assets).filter(name=>/^private-security-ui-[\w-]+\.js$/.test(name)).map(file=>{const source=readFileSync(path.join(assets,file),'utf8');return{file,source,found:pattern.exec(source)};}).filter(row=>row.found);
  assert(candidates.length>0,'Compiled diagnostic refusal mapper');
  // Immutable bundles retain older chunks for offline clients. Register inert
  // logpoints on each matching URL; only an actually loaded chunk can emit.
  for(const {file,source,found} of candidates){
   const at=source.indexOf('return '+found[3]+'===`E2EE_REAUTH_REQUIRED`',found.index);
   const before=source.slice(0,at),lineNumber=before.split('\n').length-1,columnNumber=at-before.lastIndexOf('\n')-1;
   const condition=`(()=>{const qaFailure=${found[2]},message=qaFailure instanceof Error?qaFailure.message:'',technical=/^E2EE_[A-Z_]+$/.test(message);console.info('GENESIS_QA_MIGRATION_REFUSAL '+(technical?message:'NON_TECHNICAL_ERROR'));if(message==='E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED'||!technical){const frames=(typeof qaFailure?.stack==='string'?qaFailure.stack:'').split(String.fromCharCode(10)).slice(1,9).flatMap(frame=>{const match=/[/]assets[/]([a-zA-Z0-9_.-]+[.]js):([0-9]+):([0-9]+)/.exec(frame);return match?[{artifact:match[1],line:Number(match[2]),column:Number(match[3])}]:[];});if(technical)console.info('GENESIS_QA_MIGRATION_FRAMES '+JSON.stringify(frames));else console.info('GENESIS_QA_MIGRATION_ERROR '+JSON.stringify({name:typeof qaFailure?.name==='string'&&/^[A-Za-z]+$/.test(qaFailure.name)?qaFailure.name:typeof qaFailure,frames}));}return false;})()`;
   await debug.send('Debugger.setBreakpointByUrl',{url:baseURL+'/assets/'+file,lineNumber,columnNumber,condition});
  }
  for(const artifact of readdirSync(assets).filter(name=>/^private-security-ui-[\w-]+\.js$/.test(name))){
   const content=readFileSync(path.join(assets,artifact),'utf8');let offset=-1,ordinal=0;
   // Exact compiled guard from the failing immutable candidate. The expression
   // only reports booleans and fixed protocol enums and never pauses IndexedDB.
   const custodyGuard='p&&p.userId===e.actor.ownerId&&u.ownerId===f.ownerId&&u.deviceId===e.actor.deviceId&&u.writerProtocol===9&&u.schemaVersion===1&&pe(f.kind).some(e=>e.domains.includes(u.domain))';
   const custodyAt=content.indexOf(custodyGuard);
   if(custodyAt>=0){
    const preceding=content.slice(0,custodyAt),lineNumber=preceding.split('\n').length-1,columnNumber=custodyAt-preceding.lastIndexOf('\n')-1;
    const condition="(()=>{const value={devicePresent:!!p,sameActor:p?.userId===e.actor.ownerId,sameOwner:u.ownerId===f.ownerId,sameDevice:u.deviceId===e.actor.deviceId,writer9:u.writerProtocol===9,schema1:u.schemaVersion===1,domainAllowed:pe(f.kind).some(path=>path.domains.includes(u.domain)),kind:['personal','project','space'].includes(f.kind)?f.kind:'other',domain:['workspace','diary','dream-journal','mindmap','physis','aurora','stoicheion','attachment','local-snapshot','outbox','draft','key-check','shared-project','shared-comment'].includes(u.domain)?u.domain:'other'};if(Object.values(value).some(item=>item===false))console.info('GENESIS_QA_CUSTODY_PREDICATES '+JSON.stringify(value));return false;})()";
    await debug.send('Debugger.setBreakpointByUrl',{url:baseURL+'/assets/'+artifact,lineNumber,columnNumber,condition});
   }
   while((offset=content.indexOf('E2EE_SOURCE_HISTORY_CHANGED',offset+1))!==-1){
    ordinal++;const statement=content.lastIndexOf('throw Error(',offset);if(statement<0||offset-statement>25)continue;
    const previous=content.slice(0,statement),lineNumber=previous.split('\n').length-1,columnNumber=statement-previous.lastIndexOf('\n')-1;
    let details='';
    if(content.slice(Math.max(0,statement-110),statement).includes('t.value.length!==e.bytes'))details=",domain:e.domain,family:e.id.split(':')[0],missing:!t,sameSerial:t?.serial===e.serial,sameSize:t?.value.length===e.bytes";
    const metadata=`artifact:${JSON.stringify(artifact)},ordinal:${ordinal}`;
    const condition=`(()=>{try{console.info('GENESIS_QA_HISTORY_GUARD '+JSON.stringify({${metadata}${details}}));}catch{console.info('GENESIS_QA_HISTORY_GUARD '+JSON.stringify({${metadata}}));}return false;})()`;
    await debug.send('Debugger.setBreakpointByUrl',{url:baseURL+'/assets/'+artifact,lineNumber,columnNumber,condition});
   }
  }
  // Observe only source coordinates at the strict validator, without pausing
  // live IDB transactions or inspecting any key, argument or decrypted value.
  for(const artifact of readdirSync(assets).filter(name=>/^[\w-]+\.js$/.test(name))){
   const source=readFileSync(path.join(assets,artifact),'utf8');
   for(const match of source.matchAll(/throw (?:new )?Error\([`'"]E2EE_INVALID_KEY_BUNDLE[`'"]\)/g)){
    const at=match.index,before=source.slice(0,at),lineNumber=before.split('\n').length-1,columnNumber=at-before.lastIndexOf('\n')-1;
    const condition="(()=>{const frames=(new globalThis.Error()).stack.split(String.fromCharCode(10)).slice(1,10).flatMap(frame=>{const match=/[/]assets[/]([a-zA-Z0-9_.-]+[.]js):([0-9]+):([0-9]+)/.exec(frame);return match?[{artifact:match[1],line:Number(match[2]),column:Number(match[3])}]:[];});console.info('GENESIS_QA_KEY_BUNDLE_REFUSAL '+JSON.stringify(frames));return false;})()";
    await debug.send('Debugger.setBreakpointByUrl',{url:baseURL+'/assets/'+artifact,lineNumber,columnNumber,condition});
   }
  }
  report.diagnosticLogpoint={artifacts:candidates.map(row=>row.file),pauses:false};
 }
 debug.on('Debugger.paused',event=>{
  const code=event.data?.description?.match(/E2EE_[A-Z_]+/)?.[0];
  if(code&&!report.caughtCodes.includes(code)){report.caughtCodes.push(code);report.caughtFrames.push({code,functions:event.callFrames.slice(0,8).map(frame=>frame.functionName)});console.log('DIAGNOSTIC '+code);}
  if(!code&&event.data?.description){const message=event.data.description.split('\n')[0].slice(0,160);if(message!=='Promise'&&!message.startsWith('Error: Minified React error #460'))console.log('SYNTHETIC CAUGHT '+redactPrivateText(message));}
  void debug.send('Debugger.resume').catch(()=>{});
 });
 page.on('pageerror',error=>report.pageErrors.push(redactPrivateText(error.message)));
 page.on('console',message=>{const prefix='GENESIS_QA_KEY_BUNDLE_REFUSAL ';if(message.text().startsWith(prefix)){report.keyBundleRefusals.push(JSON.parse(message.text().slice(prefix.length)));console.log(message.text());save();}});
 page.on('requestfailed',request=>{const url=new URL(request.url());if(url.origin!==baseURL||!/^\/api\/e2ee\/v1\/[a-z-]+$/.test(url.pathname))return;
  const reason=request.failure()?.errorText??'';const code=/^net::ERR_[A-Z_]+$/.test(reason)?reason:'UNKNOWN_NETWORK_FAILURE';
  report.networkFailures.push({path:url.pathname,code});save();
 });
 page.on('console',message=>{const prefix='GENESIS_QA_IDB_FAILURE ',refusal='GENESIS_QA_MIGRATION_REFUSAL ',history='GENESIS_QA_HISTORY_GUARD ',frames='GENESIS_QA_MIGRATION_FRAMES ',predicates='GENESIS_QA_CUSTODY_PREDICATES ',failure='GENESIS_QA_MIGRATION_ERROR ';if(message.text().startsWith(prefix)){report.storageFailures.push(JSON.parse(message.text().slice(prefix.length)));save();}else if(message.text().startsWith(refusal)){report.migrationRefusals.push(message.text().slice(refusal.length));console.log(message.text());save();}else if(message.text().startsWith(history)){report.historyGuards.push(JSON.parse(message.text().slice(history.length)));console.log(message.text());save();}else if(message.text().startsWith(frames)){report.custodyFrames.push(JSON.parse(message.text().slice(frames.length)));console.log(message.text());save();}else if(message.text().startsWith(predicates)){report.custodyPredicates.push(JSON.parse(message.text().slice(predicates.length)));console.log(message.text());save();}else if(message.text().startsWith(failure)){report.migrationErrorFrames.push(JSON.parse(message.text().slice(failure.length)));console.log(message.text());save();}});
 page.on('response',async response=>{
  if(response.url()===baseURL+'/api/bootstrap'){const body=await response.json().catch(()=>null);console.log('BOOTSTRAP '+JSON.stringify({status:response.status(),keyMode:body?.workspace?.keyMode,keyPresent:!!body?.workspace?.key}));}
  if(response.url().startsWith(baseURL+'/api/e2ee/v1/')){
   const path=new URL(response.url()).pathname;
   const packet=response.request().postDataJSON();const action=packet?.command?.action;
   console.log('TRANSPORT '+path+' '+(typeof action==='string'?action:'')+' '+response.status());
   if(response.status()===429){
    const observedAt=Date.now(),header=await response.headerValue('retry-after'),seconds=/^[0-9]{1,3}$/.test(header??'')?Number(header):600;
    report.rateLimits.push({path,action:typeof action==='string'?action:null,observedAt,retryAfterSeconds:seconds>=1&&seconds<=600?seconds:600});save();
   }
  }
  if(response.url().startsWith(baseURL+'/api/')&&response.status()>=400){const body=await response.json().catch(()=>null);report.apiErrors.push({path:new URL(response.url()).pathname,status:response.status(),code:typeof body?.error==='string'&&/^[A-Z0-9_]+$/.test(body.error)?body.error:null});}
 });
 await check('synthetic pilot and ordinary account',async()=>{
  const status=await(await context.request.get('/api/e2ee/v1/status')).json();assert.equal(status.pilotAllowed,true);assert.equal(status.scopes.length,0);
  const session=await(await context.request.get('/api/session')).json();assert.equal(session.user.isAdmin,false);assert(session.user.email.endsWith('@example.invalid'));
 });
 await check('legacy personal task survives reload before transfer',async()=>{
  await page.goto('/?lang=ru#today');
  // Local previews intentionally do not auto-register a service worker. Install
  // the exact production worker, including its real precache and client fence.
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;});
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.getByRole('button',{name:'Создать задачу',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Создать · Личное дело',exact:true});
  await dialog.getByRole('textbox',{name:'Новая задача',exact:true}).fill(canary);await dialog.getByRole('button',{name:'Добавить задачу',exact:true}).click();
  await dialog.waitFor({state:'hidden'});await page.reload();await page.getByRole('button',{name:`Завершить задачу «${canary}»`,exact:true}).waitFor();
 });
 await check('ordinary legacy workspace project is saved before encryption',async()=>{
  if(diagnostics)await debug.send('Debugger.setPauseOnExceptions',{state:'all'});
  await page.getByRole('button',{name:'Дела',exact:true}).first().click();await page.getByRole('button',{name:'Создать проект',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Новый проект',exact:true});await dialog.getByRole('textbox',{name:'Новый проект или подпроект',exact:true}).fill('Private workspace project');
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace'&&response.request().method()==='PUT',{timeout:20000});void saved.catch(()=>{});
  await dialog.getByRole('button',{name:/^(Сохранить|Создать проект)$/}).click();assert((await saved).ok());await debug.send('Debugger.setPauseOnExceptions',{state:'none'});
 });
 if(sharedJourney)await check('ordinary owner has real legacy shared space project and task content before transfer',async()=>{
  const session=await(await context.request.get('/api/session')).json(),headers={Origin:baseURL,'X-CSRF-Token':session.csrf};
  const post=async(path,data)=>{const response=await context.request.post('/api/'+path,{headers,data});assert(response.ok(),path+': '+response.status());return response.json();};
  const space=(await post('shared/spaces',{title:'PRIVATE SHARED SPACE '+canary})).space;
  const project=(await post(`shared/spaces/${space.id}/projects`,{title:'PRIVATE SHARED PROJECT '+canary,layout:'board'})).project;
  const body=await(await context.request.get(`/api/shared/projects/${project.id}`)).json(),status=body.statuses.find(row=>!row.isDone);assert(status);
  const file=sharedFilesJourney?Buffer.alloc(1300*1024,'SYNTHETIC PRIVATE FILE\n'):null;
  if(file)file.write(canary+'\n');
  const image=sharedFilesJourney?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII=','base64'):null;
  const task=(await post(`shared/projects/${project.id}/tasks`,{title:'PRIVATE SHARED TASK '+canary,description:'Retained shared task body '+canary,statusId:status.id,requestId:crypto.randomUUID(),
   ...file?{attachments:[{name:'retained-private-file.txt',data:'data:text/plain;base64,'+file.toString('base64')}],imageData:'data:image/png;base64,'+image.toString('base64')}:{}})).task;
  sharedFixture={space,project,task,file,image};
  if(file){
   assert.equal(task.attachments.length,1);const source=new URL(task.attachments[0].url,baseURL);assert.equal(source.origin,baseURL);
   const response=await context.request.get(source.href);assert(response.ok());assert.deepEqual(await response.body(),file);
   report.sharedFile={bytes:file.length,legacyReadback:true};
  }
 });
 await check('mounted migration creates and requires both recovery downloads',async()=>{
  await page.evaluate(marker=>{
   const user=JSON.parse(localStorage.getItem('genesis-last-user-v2'));if(!user?.uid)throw Error('Missing ordinary cached owner');
   user.syncRouting={mode:'category',defaultAccountIds:[user.uid],categoryAccountIds:{[marker]:[user.uid]}};
   localStorage.setItem('genesis-last-user-v2',JSON.stringify(user));
  },cacheCanary);
  await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
  await page.locator('[data-settings-tab=account]').click();await page.getByRole('button',{name:migration.title,exact:true}).click();
  const dialog=page.locator('.private-migration-dialog');await dialog.getByRole('button',{name:migration.generate,exact:true}).click();
  assert(await dialog.getByRole('button',{name:migration.saved,exact:true}).isDisabled());
  const fileDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:migration.saveFile,exact:true}).click();
  kit=JSON.parse((await downloadBytes(await fileDownload)).toString('utf8'));
  assert(await dialog.getByRole('button',{name:migration.saved,exact:true}).isDisabled());
  const secretDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:migration.saveSecret,exact:true}).click();
  secret=(await downloadBytes(await secretDownload)).toString('utf8').trim();assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button',{name:migration.saved,exact:true}).click();assert(await dialog.getByRole('button',{name:migration.begin,exact:true}).isDisabled());
 });
 await check('recovery confirmation has no horizontal overflow at all required widths',async()=>{
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:1000});
   const size=await page.locator('.private-migration-dialog').evaluate(element=>({scroll:element.scrollWidth,width:element.clientWidth}));assert(size.scroll<=size.width+1);
   await page.screenshot({path:`${output}/migration-confirm-${width}.png`,fullPage:true,animations:'disabled'});
  }
 });
 if(profileOnly){
  await check('profiled transfer pauses without activating its scope',async()=>{
   const dialog=page.locator('.private-migration-dialog');await recoveryInput(dialog);
   await debug.send('Profiler.enable');await debug.send('Profiler.start');
   await dialog.getByRole('button',{name:migration.begin,exact:true}).click();
   await new Promise(resolve=>setTimeout(resolve,45000));
   const {profile}=await debug.send('Profiler.stop');
   const counts=new Map();for(const id of profile.samples??[])counts.set(id,(counts.get(id)??0)+1);
   const hot=profile.nodes.map(node=>({function:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber,column:node.callFrame.columnNumber,samples:counts.get(node.id)??0}))
    .filter(node=>node.samples).sort((a,b)=>b.samples-a.samples);
   writeFileSync(`${output}/migration-cpu-profile.json`,JSON.stringify({synthetic:true,durationMicroseconds:profile.endTime-profile.startTime,samples:profile.samples?.length,hot},null,2));
   await dialog.getByRole('button',{name:migration.stop,exact:true}).click();await dialog.locator('input[type=password]').waitFor({timeout:60000});
   const status=await(await context.request.get('/api/e2ee/v1/status')).json();assert(status.scopes.length>0&&status.scopes.every(scope=>scope.state!=='active'));
  });
 }else{
 await check('all personal sources transfer and activate through the mounted controller',async()=>{
  const dialog=page.locator('.private-migration-dialog');
  if(diagnostics)await debug.send('Debugger.setPauseOnExceptions',{state:'all'});
  if(await continueMigration(dialog,migration.begin,'personal')!=='active')throw new Error('Product migration refused: '+report.caughtCodes.join(', ')+'; '+await dialog.getByRole('alert').innerText());
  await debug.send('Debugger.setPauseOnExceptions',{state:'none'});
  const status=await(await context.request.get('/api/e2ee/v1/status')).json();assert(status.scopes.some(scope=>scope.kind==='personal'&&scope.state==='active'));
  const session=await(await context.request.get('/api/session')).json();assert.equal(session.user.privatePreferencesMode,'e2ee');
  // privateVault is a client-derived routing flag. The identity response is
  // deliberately not an independent cryptographic authority or key export.
  const bootstrap=await context.request.get('/api/bootstrap');assert.equal(bootstrap.status(),409);
  assert.equal((await bootstrap.json()).error,'E2EE_UPGRADE_REQUIRED');
 });
 await check('activated account keeps private preferences out of the ordinary profile cache',async()=>{
  const result=await page.evaluate(marker=>{
   const user=JSON.parse(localStorage.getItem('genesis-last-user-v2'));
   return{mode:user?.privatePreferencesMode,fields:['advicePreferences','uiVisibility','syncRouting'].filter(name=>Object.hasOwn(user,name)),leaked:JSON.stringify(Object.entries(localStorage)).includes(marker)};
  },cacheCanary);
  assert.deepEqual(result,{mode:'e2ee',fields:[],leaked:false});
 });
 await check('normal encrypted reader retains the original task',async()=>{
  await page.reload();const gate=page.locator('.private-vault-dialog');await gate.waitFor();await recoveryInput(gate);
  await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
  await page.getByRole('button',{name:`Завершить задачу «${canary}»`,exact:true}).waitFor();
 });
 await check('normal product edits persist through encrypted queue and reload',async()=>{
  // The first reload deliberately races the network write. Durability is local;
  // a fresh device must wait for the real retried ciphertext acknowledgement.
  const acknowledged=page.waitForResponse(response=>{
   if(new URL(response.url()).pathname!=='/api/e2ee/v1/command'||!response.ok())return false;
   const packet=response.request().postDataJSON();return packet?.command?.action==='put'&&packet.command.payload?.envelope?.context?.objectId==='personal-product-live-v1';
  },{timeout:90000});void acknowledged.catch(()=>{});
  await page.getByRole('button',{name:`Завершить задачу «${canary}»`,exact:true}).click();
  await page.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor();
  await acknowledged;
  await page.reload();const gate=page.locator('.private-vault-dialog');await recoveryInput(gate);await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
  await page.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor();
 });
 await check('offline unlock restores encrypted preferences and the edited task',async()=>{
  await context.setOffline(true);
  try{
   await page.reload();const gate=page.locator('.private-vault-dialog');await gate.waitFor();
   await gate.locator('input[type=password]').fill(secret);await gate.getByRole('button',{name:vault.offline,exact:true}).click();
   await gate.waitFor({state:'hidden'});await page.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor();
   const fields=await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('genesis-last-user-v2'))).filter(key=>['advicePreferences','uiVisibility','syncRouting'].includes(key)));
   assert.deepEqual(fields,[]);await page.screenshot({path:`${output}/offline-private-workspace.png`,fullPage:true,animations:'disabled'});
  }finally{await context.setOffline(false);}
 });
 await check('clean browser cannot open content using identity alone or a wrong secret',async()=>{
  const clean=await browser.newContext({baseURL,locale:'ru-RU'});
  let other;
  try{
   await clean.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
   await clean.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));await login(clean);other=await clean.newPage();
   other.on('pageerror',error=>report.pageErrors.push('clean browser: '+error.message));await other.goto('/?lang=ru#today');
   const gate=other.locator('.private-vault-dialog');await gate.waitFor();assert.equal(await other.getByText(canary,{exact:true}).count(),0);
   await recoveryInput(gate,true);await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.getByRole('alert').waitFor();
   await recoveryInput(gate);await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden',timeout:60000});
   await other.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor();
   await other.screenshot({path:`${output}/clean-recovery.png`,fullPage:true,animations:'disabled'});
  }catch(error){
   if(other){await other.screenshot({path:`${output}/clean-recovery-failure.png`,fullPage:true,animations:'disabled',mask:[other.locator('input[type=password],textarea')]}).catch(()=>{});writeFileSync(`${output}/clean-recovery-failure.txt`,redactPrivateText(await other.locator('body').ariaSnapshot().catch(()=>'')));}
   throw error;
  }finally{await clean.close();}
 });
 if(backupJourney){
  const copy=JSON.parse(readFileSync('contracts/e2ee/content-archive-copy-v1.json','utf8')).ru;
  let archive,selection;
  const openBackups=async()=>{await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();await page.locator('[data-settings-tab=backups]').click();};
  const importPanel=()=>page.locator('section.backup-panel').filter({has:page.getByRole('heading',{name:copy.import,exact:true})});
  const entries=payload=>payload.sections.flatMap(section=>section.data.entries.map((entry,index)=>({section:section.id,index,entry})));
  await check('real device snapshot download decrypts independently and contains the edited private task',async()=>{
   await openBackups();const panel=page.locator('section.backup-panel').filter({has:page.getByRole('heading',{name:copy.deviceSnapshot,exact:true})});
   await panel.getByRole('button',{name:'Создать ключ',exact:true}).click();backupKey=await panel.locator('textarea').inputValue();assert(backupKey.length>=43&&backupKey.length<=64);
   await panel.locator('input[type=checkbox]').nth(0).check();await panel.locator('input[type=checkbox]').nth(1).check();
   const pending=page.waitForEvent('download',{timeout:120000}),refused=panel.getByRole('alert').waitFor({timeout:120000}).then(async()=>{const code=await panel.getByRole('alert').innerText();throw new Error(/^E2EE_[A-Z_]+$/.test(code)?code:'BACKUP_UI_REFUSAL');});
   await panel.getByRole('button',{name:copy.deviceSnapshot,exact:true}).click();archive=(await downloadBytes(await Promise.race([pending,refused]))).toString('utf8');
   assert.equal(archive.includes(canary),false);assert.equal(archive.includes(secret),false);assert.equal(archive.includes(backupKey),false);
   const payload=await openBackup(archive,backupKey),owner=(await(await context.request.get('/api/session')).json()).user.uid;
   assert.equal(payload.ownerId,owner);assert.equal(payload.source,'device_snapshot');assert.equal(payload.billingEvidence,null);
   for(const section of payload.sections){assert.equal(section.data.format,'genesis-content-only-v1');assert.equal(section.data.execution,'history-only');}
   selection=entries(payload).find(row=>row.entry.objectId==='personal-product-live-v1'&&Buffer.from(row.entry.current.bytes,'base64url').toString('utf8').includes(canary));
   assert(selection,'The actual edited product document belongs to the encrypted archive');
   report.contentBackup={backupId:payload.backupId,sections:payload.sections.length,entries:entries(payload).length,byteLength:Buffer.byteLength(archive),execution:'history-only'};
   writeFileSync(`${output}/private-device-content.genesisbackup`,archive);
  });
  await check('wrong backup key refuses and the same original imports as encrypted history with the right key',async()=>{
   const panel=importPanel();await panel.locator('input[type=file]').setInputFiles({name:'device-content.genesisbackup',mimeType:'application/octet-stream',buffer:Buffer.from(archive)});
   await panel.locator('input[type=password]').fill('A'.repeat(43));await panel.getByRole('button',{name:copy.import,exact:true}).click();await panel.getByRole('alert').filter({hasText:copy.error}).waitFor();
   await panel.locator('input[type=password]').fill(backupKey);await panel.getByRole('button',{name:copy.import,exact:true}).click();await panel.getByRole('status').filter({hasText:copy.saved}).waitFor();
   await panel.getByRole('combobox',{name:copy.history,exact:true}).selectOption(`${selection.section}:${selection.index}:current`);
   assert((await panel.locator('pre').innerText()).includes(canary));
  });
  await check('imported history survives cold unlock and leaves the current edited task intact',async()=>{
   await withRateRetry('backup cold reader',async()=>{
    await page.goto('/?lang=ru#today');await page.reload();const gate=page.locator('.private-vault-dialog');await gate.waitFor();await recoveryInput(gate);await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
    await page.getByRole('button',{name:`Вернуть задачу «${canary}»`,exact:true}).waitFor();
   });
   await openBackups();const panel=importPanel();await panel.getByRole('button',{name:copy.history,exact:true}).click();await panel.getByRole('button',{name:report.contentBackup.backupId,exact:true}).click();
   await panel.getByRole('combobox',{name:copy.history,exact:true}).selectOption(`${selection.section}:${selection.index}:current`);assert((await panel.locator('pre').innerText()).includes(canary));
   await page.screenshot({path:`${output}/retained-private-backup.png`,fullPage:true,animations:'disabled',mask:[page.locator('input[type=password],textarea')]});
  });
 }
 if(localeJourney)await check('real locked vault renders all fourteen languages in both themes at all required widths',async()=>{
  const locales=JSON.parse(readFileSync('contracts/e2ee/vault-copy-v1.json','utf8'));
  report.visualCases=[];
  const preference=async data=>{
   const session=await(await context.request.get('/api/session')).json();
   const result=await context.request.put('/api/account/preferences',{headers:{Origin:baseURL,'X-CSRF-Token':session.csrf},
    data:{...data,expectedThemeRevision:session.user.themeRevision}});
   assert(result.ok(),'Synthetic public language/theme preference: '+result.status());
  };
  for(const [language,copy]of Object.entries(locales))for(const scheme of ['light','dark']){
   const theme=scheme==='dark'?'standart-dark':'standart';await preference({language,theme});
   await page.reload();const gate=page.locator('.private-vault-dialog');await gate.getByRole('heading',{name:copy.title,exact:true}).waitFor();
   await page.waitForFunction(value=>document.documentElement.getAttribute('data-genesis-theme')===value,theme);
   assert.equal(await page.getByText(canary,{exact:true}).count(),0,'Locked account must not render its private task');
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
    const bounds=await gate.evaluate(element=>({scroll:element.scrollWidth,width:element.clientWidth,documentScroll:document.documentElement.scrollWidth,documentWidth:document.documentElement.clientWidth}));
    assert(bounds.scroll<=bounds.width+1&&bounds.documentScroll<=bounds.documentWidth+1,language+' '+scheme+' '+width+' horizontal overflow');
    const artifact=`vault-${language}-${scheme}-${width}.png`;await page.screenshot({path:`${output}/${artifact}`,fullPage:true,animations:'disabled'});
    report.visualCases.push({language,scheme,width,status:'PASS',bounds,artifact});save();
   }
   // This is a locked-vault visual check. Keep it locked between captures;
   // repeated full workspace unlocks are a different acceptance scope and
   // would needlessly consume the real 600-requests/10-minute API budget.
  }
  assert.equal(report.visualCases.length,112);await preference({language:'ru',theme:'standart-dark'});
 });
 if(sharedJourney){
  await check('owner can reconfirm sign-in and transfer project and space through mounted controllers',async()=>{
   const identityConfirmation=async confirmed=>{
    const session=await(await context.request.get('/api/session')).json();
    const response=await context.request.post('/api/qa/identity-confirmation',{headers:{Origin:baseURL,'X-CSRF-Token':session.csrf},data:{confirmed}});
    assert(response.ok()&&(await response.json()).synthetic,'Owned synthetic provider confirmation');
   };
   const unlock=async()=>{
    const gate=page.locator('.private-vault-dialog');await gate.waitFor();await recoveryInput(gate);
    await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
    await page.locator('.workspace-startup-gate').waitFor({state:'hidden'});
   };
   const account=async()=>{await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();await page.locator('[data-settings-tab=account]').click();};
   const openTransfer=async(kind,resource)=>withRateRetry(kind+' discovery',async()=>{
    const panel=page.locator('.private-shared-security');await debug.send('Debugger.setPauseOnExceptions',{state:diagnostics?'all':'none'});
    await panel.locator(':scope > button').filter({hasText:sharedCopy.load}).click();
    await Promise.race([panel.getByRole('combobox',{name:sharedMigration.transfer,exact:true}).waitFor(),panel.locator(':scope > [role=status]').waitFor().then(async()=>{throw new Error('Shared discovery refused: '+report.caughtCodes.join(', ')+'; '+await panel.locator(':scope > [role=status]').innerText());})]);
    await panel.getByRole('combobox',{name:sharedMigration.transfer,exact:true}).selectOption(`${kind}:${resource.id}`);
    await panel.getByRole('button',{name:sharedMigration.transfer,exact:true}).first().click();
    const dialog=page.locator('.private-migration-dialog');await recoveryInput(dialog);return dialog;
   });
   const reconfirm=async(dialog,kind,resource)=>{
    let delivered=false;const pattern='**/api/auth/google/start?*';
    const provider=async route=>{
     const url=new URL(route.request().url());assert.equal(url.searchParams.get('purpose'),'login');
     const target=new URL(url.searchParams.get('return_to'),baseURL);assert.equal(target.origin,baseURL);
     await identityConfirmation(true);delivered=true;await route.fulfill({status:302,headers:{location:target.href}});
    };
    await page.route(pattern,provider);
    try{await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),dialog.getByRole('button',{name:migration.reauth,exact:true}).click()]);}
    finally{await page.unroute(pattern,provider);}
    assert(delivered,'The actual reconfirm action must reach the synthetic provider');
    report.identityDelivery='Synthetic Google provider completion; no live provider UI claim';
    await unlock();await account();return openTransfer(kind,resource);
   };
   // Return from the deliberately offline capability to an online unlocked one.
   await page.reload();await unlock();await account();
   for(const [kind,resource]of [['project',sharedFixture.project],['space',sharedFixture.space]]){
    let dialog=await openTransfer(kind,resource);
    if(kind==='project'){
     await identityConfirmation(false);await dialog.getByRole('button',{name:migration.resume,exact:true}).click();
     await dialog.getByRole('alert').filter({hasText:migration.reauthRequired}).waitFor();
     const status=await(await context.request.get('/api/e2ee/v1/status')).json();assert(!status.scopes.some(scope=>scope.kind===kind&&scope.resourceId===resource.id&&scope.state==='active'));
     dialog=await reconfirm(dialog,kind,resource);
    }else await identityConfirmation(true);
    await debug.send('Debugger.setPauseOnExceptions',{state:diagnostics?'all':'none'});
    await withRateRetry(kind+' transfer',async()=>{
     for(let reauth=0;reauth<2;reauth++){
      const previous=report.migrationRefusals.length;
      const outcome=await continueMigration(dialog,migration.resume,kind);
      if(outcome==='active')return;
      await page.waitForTimeout(100);
      if(report.migrationRefusals.slice(previous).includes('E2EE_REAUTH_REQUIRED')){dialog=await reconfirm(dialog,kind,resource);continue;}
      throw new Error(kind+' migration refused: '+report.caughtCodes.join(', ')+'; '+await dialog.getByRole('alert').innerText());
     }
     throw new Error('Owned provider reconfirmation did not admit the transfer');
    });
    await debug.send('Debugger.setPauseOnExceptions',{state:'none'});
    const status=await(await context.request.get('/api/e2ee/v1/status')).json();assert(status.scopes.some(scope=>scope.kind===kind&&scope.resourceId===resource.id&&scope.state==='active'));
    report.transferredScopes.push({kind,state:'active'});save();
   }
  });
  await check('normal shared reader opens transferred task content and refuses the legacy project route',async()=>{
   const legacy=await context.request.get(`/api/shared/projects/${sharedFixture.project.id}`);assert.equal(legacy.status(),409);assert.equal((await legacy.json()).error,'E2EE_UPGRADE_REQUIRED');
   const target=new URL('/',baseURL);target.searchParams.set('affairs','shared');target.searchParams.set('space',sharedFixture.space.id);target.searchParams.set('project',sharedFixture.project.id);target.searchParams.set('projectView','board');target.hash='projects';
   await page.goto(target.href);
   await withRateRetry('normal shared reader',async()=>{
    // A goto to an identical URL with a hash may keep the same document.
    // This check explicitly requires cold entry, including every rate retry.
    await page.reload();const gate=page.locator('.private-vault-dialog');await gate.waitFor();await recoveryInput(gate);await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
    await page.locator(`[data-shared-task-id="${sharedFixture.task.id}"]`).getByText(sharedFixture.task.title,{exact:true}).waitFor({timeout:60000});
   });
   await page.screenshot({path:`${output}/private-shared-task-readback.png`,fullPage:true,animations:'disabled'});
  });
  if(sharedFilesJourney)await check('migrated multi-chunk attachment and photo open through the normal authorized task interface',async()=>{
   await page.locator(`[data-shared-task-id="${sharedFixture.task.id}"]`).getByText(sharedFixture.task.title,{exact:true}).click();
   const dialog=page.getByRole('dialog',{name:sharedFixture.task.title,exact:true});await dialog.waitFor();
   const image=dialog.getByRole('img',{name:'Фото, прикреплённое к задаче',exact:true});await image.waitFor();
   await page.waitForFunction(()=>{const image=document.querySelector('.shared-task-modal[open] .shared-task-image img');return image?.complete&&image.naturalWidth>0;},null,{timeout:60000});
   assert((await image.getAttribute('src')).startsWith('blob:'),'The task displays a locally decrypted image');
   assert.deepEqual(Buffer.from(await image.evaluate(async element=>Array.from(new Uint8Array(await(await fetch(element.src)).arrayBuffer())))),sharedFixture.image);
   const pending=page.waitForEvent('download',{timeout:60000});await dialog.locator('.shared-task-attachments button').filter({hasText:'retained-private-file.txt'}).click();
   assert.deepEqual(await downloadBytes(await pending),sharedFixture.file);
   const source=new URL(sharedFixture.task.attachments[0].url,baseURL);assert.equal(source.origin,baseURL);
   const legacy=await context.request.get(source.href);assert.equal(legacy.status(),409);assert.equal((await legacy.json()).error,'E2EE_UPGRADE_REQUIRED');
   const outsider=await browser.newContext({baseURL});try{const denied=await outsider.request.get(source.href);assert([401,403].includes(denied.status()));assert.equal((await denied.text()).includes(canary),false);}finally{await outsider.close();}
   report.sharedFile={...report.sharedFile,encryptedReadback:true,legacyDownloadDenied:true,anonymousDownloadDenied:true};
   await dialog.screenshot({path:`${output}/private-task-files.png`,animations:'disabled'});
  });
 }
 }
 await check('no unhandled product errors',async()=>assert.deepEqual(report.pageErrors,[]));
 report.status='PASS';
}catch(error){
 report.status='FAIL';report.error=redactPrivateText(error.message);process.exitCode=1;
 if(page){report.finalLocks=await page.evaluate(()=>navigator.locks.query()).catch(()=>null);await page.screenshot({path:`${output}/private-product-failure.png`,fullPage:true,mask:[page.locator('input[type=password],textarea')]}).catch(()=>{});writeFileSync(`${output}/private-product-failure.txt`,redactPrivateText(await page.locator('body').ariaSnapshot().catch(()=>'')));}
 console.error(redactPrivateText(error.message));
}finally{secret=undefined;kit=undefined;backupKey=undefined;save();await context.close();await browser.close();}
