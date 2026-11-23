// Mounted product migration against the real loopback PHP/SQLite API.
// Only identity/provider delivery is supplied by the isolated QA fixture.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const baseURL=process.env.GENESIS_QA_WEB_ORIGIN;
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''));
const output=process.env.GENESIS_QA_WEB_OUTPUT;
assert(output);mkdirSync(output,{recursive:true});
const migration=JSON.parse(readFileSync('contracts/e2ee/migration-copy-v1.json','utf8')).ru;
const vault=JSON.parse(readFileSync('contracts/e2ee/vault-copy-v1.json','utf8')).ru;
const report={synthetic:true,scope:'mounted web product + real PHP/SQLite',status:'RUNNING',checks:[],apiErrors:[],pageErrors:[],caughtCodes:[],caughtFrames:[]};
const browser=await chromium.launch({headless:true});report.browser=browser.version();
let page,secret,kit;
const diagnostics=process.env.GENESIS_QA_FOLLOWUP_SCOPE==='diagnostics';
const profileOnly=process.env.GENESIS_QA_FOLLOWUP_SCOPE==='profile';
const sharedJourney=process.env.GENESIS_QA_FOLLOWUP_SCOPE==='shared';
const sharedCopy=JSON.parse(readFileSync('contracts/e2ee/shared-security-copy-v1.json','utf8')).ru;
const sharedMigration=JSON.parse(readFileSync('contracts/e2ee/shared-migration-copy-v1.json','utf8')).ru;
const canary='PRIVATE-PRODUCT-'+crypto.randomUUID();
const cacheCanary='PRIVATE-CACHE-'+crypto.randomUUID();
let sharedFixture;
const save=()=>writeFileSync(`${output}/private-product-results.json`,JSON.stringify(report,null,2)+'\n');
const check=async(name,operation)=>{
 try{await operation();report.checks.push({name,status:'PASS'});console.log('PASS private-product '+name);save();}
 catch(error){report.checks.push({name,status:'FAIL',error:error.message});throw error;}
};
const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow',acceptDownloads:true});
await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
const login=async target=>{const response=await target.request.get('/api/qa/login?tier=business');assert(response.ok()&&(await response.json()).synthetic);};
const downloadBytes=async download=>{const stream=await download.createReadStream();assert(stream);const parts=[];for await(const chunk of stream)parts.push(chunk);return Buffer.concat(parts);};
const recoveryInput=async(dialog,wrong=false)=>{
 await dialog.locator('input[type=file]').setInputFiles({name:'synthetic-recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(kit))});
 await dialog.locator('input[type=password]').fill(wrong?'A'.repeat(43):secret);
};
try{
 await login(context);page=await context.newPage();page.setDefaultTimeout(20000);
 const debug=await context.newCDPSession(page);await debug.send('Debugger.enable');
 debug.on('Debugger.paused',event=>{
  const code=event.data?.description?.match(/E2EE_[A-Z_]+/)?.[0];
  if(code&&!report.caughtCodes.includes(code)){report.caughtCodes.push(code);report.caughtFrames.push({code,functions:event.callFrames.slice(0,8).map(frame=>frame.functionName)});console.log('DIAGNOSTIC '+code);}
  if(!code&&event.data?.description){const message=event.data.description.split('\n')[0].slice(0,160);if(message!=='Promise'&&!message.startsWith('Error: Minified React error #460'))console.log('SYNTHETIC CAUGHT '+message);}
  void debug.send('Debugger.resume').catch(()=>{});
 });
 page.on('pageerror',error=>report.pageErrors.push(error.message));
 page.on('response',async response=>{
  if(response.url()===baseURL+'/api/bootstrap'){const body=await response.json().catch(()=>null);console.log('BOOTSTRAP '+JSON.stringify({status:response.status(),keyMode:body?.workspace?.keyMode,keyPresent:!!body?.workspace?.key}));}
  if(response.url().startsWith(baseURL+'/api/e2ee/v1/')){
   const path=new URL(response.url()).pathname;
   const packet=response.request().postDataJSON();const action=packet?.command?.action;
   console.log('TRANSPORT '+path+' '+(typeof action==='string'?action:'')+' '+response.status());
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
  const task=(await post(`shared/projects/${project.id}/tasks`,{title:'PRIVATE SHARED TASK '+canary,description:'Retained shared task body '+canary,statusId:status.id,requestId:crypto.randomUUID()})).task;
  sharedFixture={space,project,task};
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
  const dialog=page.locator('.private-migration-dialog');await recoveryInput(dialog);
  if(diagnostics)await debug.send('Debugger.setPauseOnExceptions',{state:'all'});
  await dialog.getByRole('button',{name:migration.begin,exact:true}).click();
  await Promise.race([dialog.waitFor({state:'hidden',timeout:1200000}),dialog.getByRole('alert').waitFor({timeout:1200000}).then(async()=>{throw new Error('Product migration refused: '+report.caughtCodes.join(', ')+'; '+await dialog.getByRole('alert').innerText());})]);
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
   if(other){await other.screenshot({path:`${output}/clean-recovery-failure.png`,fullPage:true,animations:'disabled'}).catch(()=>{});writeFileSync(`${output}/clean-recovery-failure.txt`,await other.locator('body').ariaSnapshot().catch(()=>''));}
   throw error;
  }finally{await clean.close();}
 });
 if(sharedJourney){
  await check('owned project and space transfer through the mounted shared controller',async()=>{
   // Return from the deliberately offline capability to an online unlocked one.
   await page.reload();let gate=page.locator('.private-vault-dialog');await gate.waitFor();await recoveryInput(gate);
   await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
   await page.locator('.workspace-startup-gate').waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();await page.locator('[data-settings-tab=account]').click();
   for(const [kind,resource]of [['project',sharedFixture.project],['space',sharedFixture.space]]){
    const panel=page.locator('.private-shared-security');await panel.locator(':scope > button').filter({hasText:sharedCopy.load}).click();
    await panel.getByRole('combobox',{name:sharedMigration.transfer,exact:true}).selectOption(`${kind}:${resource.id}`);
    await panel.getByRole('button',{name:sharedMigration.transfer,exact:true}).first().click();
    const dialog=page.locator('.private-migration-dialog');await recoveryInput(dialog);await debug.send('Debugger.setPauseOnExceptions',{state:'all'});
    await dialog.getByRole('button',{name:migration.resume,exact:true}).click();
    await Promise.race([dialog.waitFor({state:'hidden',timeout:1200000}),dialog.getByRole('alert').waitFor({timeout:1200000}).then(async()=>{throw new Error(kind+' migration refused: '+report.caughtCodes.join(', ')+'; '+await dialog.getByRole('alert').innerText());})]);
    await debug.send('Debugger.setPauseOnExceptions',{state:'none'});
    const status=await(await context.request.get('/api/e2ee/v1/status')).json();assert(status.scopes.some(scope=>scope.kind===kind&&scope.resourceId===resource.id&&scope.state==='active'));
   }
  });
  await check('normal shared reader opens transferred task content and refuses the legacy project route',async()=>{
   const legacy=await context.request.get(`/api/shared/projects/${sharedFixture.project.id}`);assert.equal(legacy.status(),409);assert.equal((await legacy.json()).error,'E2EE_UPGRADE_REQUIRED');
   const target=new URL('/',baseURL);target.searchParams.set('affairs','shared');target.searchParams.set('space',sharedFixture.space.id);target.searchParams.set('project',sharedFixture.project.id);target.searchParams.set('projectView','board');target.hash='projects';
   await page.goto(target.href);const gate=page.locator('.private-vault-dialog');await gate.waitFor();await recoveryInput(gate);await gate.getByRole('button',{name:vault.unlock,exact:true}).click();await gate.waitFor({state:'hidden'});
   await page.locator(`[data-shared-task-id="${sharedFixture.task.id}"]`).getByText(sharedFixture.task.title,{exact:true}).waitFor({timeout:60000});
   await page.screenshot({path:`${output}/private-shared-task-readback.png`,fullPage:true,animations:'disabled'});
  });
 }
 }
 await check('no unhandled product errors',async()=>assert.deepEqual(report.pageErrors,[]));
 report.status='PASS';
}catch(error){
 report.status='FAIL';report.error=error.message;process.exitCode=1;
 if(page){report.finalLocks=await page.evaluate(()=>navigator.locks.query()).catch(()=>null);await page.screenshot({path:`${output}/private-product-failure.png`,fullPage:true}).catch(()=>{});writeFileSync(`${output}/private-product-failure.txt`,await page.locator('body').ariaSnapshot().catch(()=>''));}
 console.error(error.message);
}finally{secret=undefined;kit=undefined;save();await context.close();await browser.close();}
