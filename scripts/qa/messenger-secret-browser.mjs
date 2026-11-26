import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {createWriteStream,readFileSync,writeFileSync,mkdirSync,existsSync,createReadStream} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {cleanupBackendRuntime} from './backend-cleanup.mjs';
import {resolveBackendPhp,backendPhpEnvironment} from './backend-php.mjs';
import {waitForQaBackend} from './backend-ready.mjs';
import {hash,sourceSnapshot} from './full-lib.mjs';

const output=resolve(process.argv[2]),bundle=resolve(process.argv[3]);
assert(output.includes(sep+'output'+sep+'playwright'+sep)&&!existsSync(output));mkdirSync(output,{recursive:true});
const migrationFocus=process.env.GENESIS_QA_SECRET_FOCUS==='private-migration';
const input=sourceSnapshot(process.cwd()),runtime=resolve(output,'runtime'),copies=JSON.parse(readFileSync('app/messenger-copy.json','utf8'));
const result=await build({configFile:false,root:process.cwd(),logLevel:'warn',plugins:[react()],define:{'process.env.NODE_ENV':JSON.stringify('production'),'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify('/'),'process.env.NEXT_PUBLIC_GENESIS_MINDMAPS':JSON.stringify('true')},
 build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(migrationFocus?'scripts/qa/messenger-migration-browser-check.tsx':'scripts/qa/messenger-secret-browser-check.tsx'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const artifacts=Array.isArray(result)?result.flatMap(row=>row.output):result.output,entry=artifacts.find(row=>row.type==='chunk'&&row.isEntry),css=artifacts.filter(row=>row.type==='asset'&&row.fileName.endsWith('.css')).map(row=>row.source).join('\n');assert(entry);
if(migrationFocus)writeFileSync(resolve(output,'check-entry.js'),entry.code);
const styles=[...readFileSync(resolve(bundle,'index.html'),'utf8').matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(row=>row[0]).join('');
const report={synthetic:true,status:'RUNNING',scope:'Actual Messenger, WebCrypto and IndexedDB; actual synthetic login, modeled chat transport with substituted peer key; no server enrollment or private-vault storage claim',sourceCommit:input.commit,sourceSha256:input.sha256,entrySha256:hash(entry.code),checks:[],visualCases:[],messageWrites:0};
if(migrationFocus)report.scope='Actual mounted personal migration/recovery and complete product source factory against PHP/SQLite; actual Messenger, WebCrypto and IndexedDB; synthetic identity and modeled chat transport; not whole-app or all-path acceptance';
let apiPort,api,apiClosed,browser,page,ephemeralSecret='';const apiLog=createWriteStream(resolve(output,'local-api.log'));
const redact=value=>ephemeralSecret?String(value).replaceAll(ephemeralSecret,'[redacted synthetic secret]'):String(value);
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');response.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){const upstream=http.request({hostname:'127.0.0.1',port:apiPort,path:url.pathname+url.search,method:request.method,headers:request.headers},incoming=>{response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);});upstream.on('error',()=>response.writeHead(502).end());request.pipe(upstream);return;}
 if(migrationFocus&&url.pathname==='/'&&url.searchParams.get('qa-normal')==='1'){
  response.setHeader('Content-Type','text/html; charset=utf-8');createReadStream(resolve(bundle,'_public-locales/ru/index.html')).pipe(response);return;
 }
 if(url.pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/check.css"></head><body><main id="root"></main><script type="module" src="/check.js"></script></body></html>`);return;}
 if(url.pathname==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(entry.code);return;}
 if(url.pathname==='/check.css'){response.setHeader('Content-Type','text/css');response.end(css);return;}
 const file=resolve(bundle,'.'+decodeURIComponent(url.pathname)),extension=extname(file);
 const mime={'.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp',...(migrationFocus?{'.js':'text/javascript','.json':'application/json','.html':'text/html','.webmanifest':'application/manifest+json','.ico':'image/x-icon','.mp3':'audio/mpeg','.wav':'audio/wav','.avif':'image/avif','.ttf':'font/ttf','.txt':'text/plain','.zip':'application/zip','.md':'text/markdown','.xml':'application/xml'}:{})};
 if(!file.startsWith(bundle+sep)||!existsSync(file)||!mime[extension]){if(migrationFocus)(report.staticFailures??=[]).push({path:url.pathname,status:404});response.writeHead(404).end();return;}
 response.setHeader('Content-Type',mime[extension]);createReadStream(file).pipe(response);
});
try{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
 const reservation=http.createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));apiPort=reservation.address().port;await new Promise(done=>reservation.close(done));
 const fixtureId=migrationFocus?'secret-local-migration62':'secret-key-ui58';
 const php=await resolveBackendPhp(process.argv[4]),prepared=spawnSync(php,['-d','disable_functions=curl_exec,mail','scripts/qa/backend-fixture.php',`--dir=${runtime}`,`--origin=${origin}`,`--run-id=${fixtureId}`,...(migrationFocus?['--e2ee']:[])],{encoding:'utf8',windowsHide:true,env:{...process.env,...backendPhpEnvironment(php)}});
 assert.equal(prepared.status,0,'Owned synthetic backend preparation');
 api=spawn(php,['-d','disable_functions=curl_exec,mail','-S',`127.0.0.1:${apiPort}`,'scripts/qa/backend-router.php'],{windowsHide:true,env:{...process.env,...backendPhpEnvironment(php),GENESIS_FULL_QA:'isolated',GENESIS_FULL_QA_DIR:runtime.replaceAll('\\','/')},stdio:['ignore','pipe','pipe']});
 apiClosed=new Promise(done=>api.once('close',done));api.stdout.pipe(apiLog);api.stderr.pipe(apiLog);await waitForQaBackend(api,`http://127.0.0.1:${apiPort}`,fixtureId);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:1000}});page=await context.newPage();let fixture,changed=false,loseFirstAck=true;const writes=[],messages=[];
 const pageErrors=report.pageErrors=[];page.on('pageerror',error=>{pageErrors.push({name:error.name,technicalCode:error.message.match(/\b(?:E2EE|MESSENGER|KEY_STORAGE)_[A-Z_]+\b/)?.[0]??null,frames:error.stack?.split('\n').slice(1,5)??[]});});
 if(migrationFocus){
  const diagnostic=await context.newCDPSession(page);await diagnostic.send('Debugger.enable');let points=0;
  for(const match of entry.code.matchAll(/if\s*\(\s*([\w$]+)\s*===\s*["']E2EE_REAUTH_REQUIRED["']\s*\)\s*return\s+[\w$]+\.reauthRequired\s*;/g)){
   const preceding=entry.code.slice(0,match.index),tail=preceding.slice(-300),assignment=new RegExp('(?:let|const|var)\\s+'+match[1]+'\\s*=\\s*([\\w$]+)\\s+instanceof Error').exec(tail);assert(assignment,'Actual failure mapper parameter');const reason=assignment[1];
   const condition=`(()=>{const error=${reason},message=error instanceof Error?error.message:'',code=/^E2EE_[A-Z_]+$/.test(message)?message:'NON_TECHNICAL_ERROR',frames=(typeof error?.stack==='string'?error.stack:'').split(String.fromCharCode(10)).slice(1,9).flatMap(frame=>{const found=/[/]check[.]js:([0-9]+):([0-9]+)/.exec(frame);return found?[{line:Number(found[1]),column:Number(found[2])}]:[];});console.info('GENESIS_QA_MESSAGE_MIGRATION_FAILURE '+JSON.stringify({code,frames}));return false;})()`;
   await diagnostic.send('Debugger.setBreakpointByUrl',{url:origin+'/check.js',lineNumber:preceding.split('\n').length-1,columnNumber:match.index-preceding.lastIndexOf('\n')-1,condition});points++;
  }
  assert(points>0,'Non-pausing migration refusal observer required');report.diagnosticLogpoints=points;
  page.on('console',message=>{const prefix='GENESIS_QA_MESSAGE_MIGRATION_FAILURE ';if(message.text().startsWith(prefix)){const value=JSON.parse(message.text().slice(prefix.length));(report.migrationRefusals??=[]).push(value);console.log('DIAGNOSTIC messenger-migration '+JSON.stringify(value));}});
 }
 await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.route('**/api/shared/messenger/**',async route=>{
  fixture??=await page.evaluate(()=>window.genesisSecretQa);
  if(!fixture&&migrationFocus){await route.continue();return;}
  assert(fixture,'Only public fixture metadata');
  const request=route.request(),url=new URL(request.url()),path=url.pathname.slice('/api/shared/messenger'.length),now='2026-11-24T00:00:00Z';
  const peer=changed?fixture.replacement:fixture.peer;
  const chat={id:fixture.chatId,kind:'secret',title:'QA secret peer',projectId:null,updatedAt:now,unread:0,members:[
   {userId:fixture.ownerId,name:'QA owner',role:'owner',status:'active',deviceId:fixture.deviceId,keyId:fixture.own.keyId,publicKey:fixture.own.publicKey},
   {userId:fixture.peerId,name:'QA secret peer',role:'member',status:'active',deviceId:fixture.peerDevice,keyId:peer.keyId,publicKey:peer.publicKey}]};
  let body;
  if(path==='/devices'&&request.method()==='POST'){const sent=request.postDataJSON();assert.equal(sent.id,fixture.deviceId);assert.deepEqual(sent.publicKey,fixture.own.publicKey);assert(!Object.hasOwn(sent.publicKey,'d'));body={devices:[{id:fixture.deviceId,keyId:fixture.own.keyId,revokedAt:null}]};}
  else if(path==='/conversations')body={conversations:[chat],hiddenConversations:[]};
  else if(path===`/conversations/${fixture.chatId}`)body=chat;
  else if(path===`/conversations/${fixture.chatId}/messages`&&request.method()==='GET')body={messages:[{id:fixture.messageId,seq:1,senderId:fixture.peerId,revision:1,text:null,payload:fixture.payload,createdAt:now,updatedAt:now,deletedAt:null},...messages],nextCursor:null};
  else if(path===`/conversations/${fixture.chatId}/messages`&&request.method()==='POST'){
   const sent=request.postDataJSON();assert.deepEqual(Object.keys(sent).sort(),['deviceId','id','payload']);assert.equal(sent.deviceId,fixture.deviceId);assert(!JSON.stringify(sent).includes('Retained unsent secret draft'));
   const raw=request.postData(),old=messages.find(row=>row.id===sent.id);writes.push({method:'POST',raw});report.messageWrites++;
   if(old)assert.deepEqual(old.payload,sent.payload,'Unknown outcome repeats the exact message payload');else messages.push({id:sent.id,seq:2,senderId:fixture.ownerId,revision:1,text:null,payload:sent.payload,createdAt:now,updatedAt:now,deletedAt:null});
   if(loseFirstAck){loseFirstAck=false;await route.abort('failed');return;}body={ok:true,id:sent.id,revision:1};
  }
  else if(request.method()==='PATCH'&&path.startsWith(`/conversations/${fixture.chatId}/messages/`)){
   const sent=request.postDataJSON(),row=messages.find(row=>row.id===sent.id);assert(row);assert.equal(sent.expectedRevision,row.revision);assert.equal(path,`/conversations/${fixture.chatId}/messages/${row.id}`);
   writes.push({method:'PATCH',raw:request.postData()});report.messageWrites++;row.payload=sent.payload;row.revision++;body={ok:true,id:row.id,revision:row.revision};
  }
  else if(path.endsWith('/read'))body={ok:true};
  else{report.unexpectedRoutes=(report.unexpectedRoutes??0)+1;await route.fulfill({status:405,json:{error:'UNEXPECTED_SYNTHETIC_ROUTE'}});return;}
  await route.fulfill({status:200,json:body});
 });
 assert((await context.request.get(origin+'/api/qa/login?tier=business')).ok());
 if(migrationFocus){
  // Let the ordinary released workspace initialize/save its actual canonical
  // document. loadGenesisWorkspace alone does not mount its editor or create
  // an initial server workspace; supplying {} is not a product workspace.
  await page.goto(origin+'/?qa-normal=1&lang=ru#today');await page.getByRole('button',{name:'Создать задачу',exact:true}).first().click();
  const taskDialog=page.getByRole('dialog',{name:'Создать · Личное дело',exact:true});
  await taskDialog.getByRole('textbox',{name:'Новая задача',exact:true}).fill('Retained ordinary migration task62');await taskDialog.getByRole('button',{name:'Добавить задачу',exact:true}).click();await taskDialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Завершить задачу «Retained ordinary migration task62»',exact:true}).waitFor();
  // A second ordinary navigation confirms persistence through the real product
  // reader before the Messenger-only composition screen is opened.
  await page.reload();await page.getByRole('button',{name:'Завершить задачу «Retained ordinary migration task62»',exact:true}).waitFor();
 }
 await page.goto(origin);
 const c=copies.en;await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByText('Retained secret history',{exact:true}).waitFor();
 assert(await page.getByRole('button',{name:c.security,exact:true}).isVisible());await page.getByRole('textbox',{name:c.message,exact:true}).fill('Retained unsent secret draft');
 const waitForComposition=async(text,editing=false)=>{const deadline=Date.now()+10000;let retained=false;while(!retained&&Date.now()<deadline){retained=await page.evaluate(([value,edit])=>window.genesisSecretQaCompositionRetained?.(value,edit)??false,[text,editing]);if(!retained)await page.waitForTimeout(25);}assert(retained,'The actual encrypted composition must be readable');};
 await waitForComposition('Retained unsent secret draft');report.checks.push({name:'original message decrypts and draft reaches actual encrypted local storage',status:'PASS'});
 if(migrationFocus){
  const checkpoint=name=>{console.log('PASS messenger-migration '+name);writeFileSync(resolve(output,'progress.json'),JSON.stringify({status:'RUNNING',checks:report.checks,phase:name},null,2));};
  await context.addInitScript(value=>{window.genesisSecretQaPublic=value;},fixture);
  const second=await context.newPage();await second.goto(origin);await second.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await second.getByRole('textbox',{name:c.message,exact:true}).waitFor();
  await page.bringToFront();await page.getByRole('textbox',{name:c.message,exact:true}).fill('First tab owns this edit');await waitForComposition('First tab owns this edit');
  await second.bringToFront();await second.getByRole('textbox',{name:c.message,exact:true}).fill('Competing unsent draft');await second.getByRole('alert').waitFor();await second.close();await page.bringToFront();
  await page.getByRole('button',{name:c.send,exact:true}).click();await page.getByRole('button',{name:c.retry,exact:true}).waitFor();
  const before=await page.evaluate(()=>window.genesisSecretQaLocalCells());assert.equal(before.privateMode,false);assert(before.cells.some(row=>row.name.includes(':compose-conflict:')&&row.sha256));assert(before.cells.length>=3);assert(before.cells.every(row=>row.sha256));assert.equal(messages.length,1);assert.equal(writes.length,1);
  report.checks.push({name:'nonempty ordinary IDB contains durable composition, competing draft and unknown-outcome command before migration',status:'PASS'});
  checkpoint('nonempty ordinary message cells');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/'});await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA_WORKER_READINESS_TIMEOUT')),30000))]);});
  // The actual worker must control this document for the production migration
  // fence. Reload through the network, keeping the exact unknown command.
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByRole('button',{name:c.retry,exact:true}).waitFor();
  checkpoint('actual service worker controls the retained pending command');
  const migration=JSON.parse(readFileSync('contracts/e2ee/migration-copy-v1.json','utf8')).en;
  await page.getByRole('button',{name:migration.title,exact:true}).click();const dialog=page.locator('.private-migration-dialog');await dialog.getByRole('button',{name:migration.generate,exact:true}).click();
  const downloadBytes=async download=>{const stream=await download.createReadStream();assert(stream);const parts=[];for await(const chunk of stream)parts.push(chunk);return Buffer.concat(parts);};
  const fileDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:migration.saveFile,exact:true}).click();const kit=await downloadBytes(await fileDownload);
  assert(await dialog.getByRole('button',{name:migration.saved,exact:true}).isDisabled());
  const secretDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:migration.saveSecret,exact:true}).click();const secret=(await downloadBytes(await secretDownload)).toString('utf8').trim();ephemeralSecret=secret;assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button',{name:migration.saved,exact:true}).click();
  const enterRecovery=async target=>{await target.locator('input[type=file]').setInputFiles({name:'synthetic-recovery.json',mimeType:'application/json',buffer:kit});await target.locator('input[type=password]').fill(secret);};
  await enterRecovery(dialog);await dialog.getByRole('button',{name:migration.begin,exact:true}).click();
  checkpoint('mounted migration submitted with independently downloaded recovery material');
  const outcome=await Promise.race([dialog.waitFor({state:'hidden',timeout:1200000}).then(()=>'active'),dialog.getByRole('alert').waitFor({timeout:1200000}).then(()=>'refused')]);
  assert.equal(outcome,'active',outcome==='refused'?await dialog.getByRole('alert').innerText():'Actual mounted migration completes');
  const status=await(await context.request.get(origin+'/api/e2ee/v1/status')).json();assert(status.scopes.some(row=>row.kind==='personal'&&row.state==='active'));assert.equal((await context.request.get(origin+'/api/bootstrap')).status(),409);
  const after=await page.evaluate(()=>window.genesisSecretQaLocalCells());assert.equal(after.privateMode,true);assert.deepEqual(after.cells,before.cells,'All originals must already exist in protected cells before any fallback read');
  assert.equal(writes.length,1,'Migration must not drain a retained message');report.checks.push({name:'actual mounted complete-source migration adopts every original message cell without executing its pending command',status:'PASS'});
  checkpoint('active personal scope and direct protected cell readback');
  await page.reload();const gate=page.locator('.private-vault-dialog');await gate.waitFor();
  assert.equal(await page.getByRole('textbox',{name:c.message,exact:true}).count(),0);await enterRecovery(gate);
  const coldLanguage=await gate.getAttribute('lang'),coldCopy=JSON.parse(readFileSync('contracts/e2ee/vault-copy-v1.json','utf8'))[coldLanguage];assert(coldCopy,'Observe the actual account language on the cold vault');
  await gate.getByRole('button',{name:coldCopy.unlock,exact:true}).click();await gate.waitFor({state:'hidden',timeout:120000});
  await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByText('Retained secret history',{exact:true}).waitFor();await page.getByRole('button',{name:c.retry,exact:true}).waitFor();
  const cold=await page.evaluate(()=>window.genesisSecretQaLocalCells());assert.equal(cold.privateMode,true);assert.deepEqual(cold.cells,before.cells);assert.equal(writes.length,1);report.checks.push({name:'cold actual vault unlock preserves device, peer pin, all protected drafts and pending command; identity alone displays no composer',status:'PASS'});
  assert(await page.evaluate(()=>window.genesisSecretQaTaskRetained===true),'Actual private workspace reader retains the ordinary task');
  checkpoint('cold recovery and exact retained cells');
  await page.getByRole('button',{name:c.retry,exact:true}).click();await waitForComposition('');assert.equal(messages.length,1);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
  assert.deepEqual(pageErrors,[]);assert.equal(report.unexpectedRoutes??0,0);report.checks.push({name:'explicit post-migration retry repeats exact ciphertext once and clears only its accepted composition',status:'PASS'});report.status='PASS';
 }else if(process.env.GENESIS_QA_SECRET_FOCUS==='concurrency'){
  await context.addInitScript(value=>{window.genesisSecretQaPublic=value;},fixture);const second=await context.newPage();await second.goto(origin);await second.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await second.getByRole('textbox',{name:c.message,exact:true}).waitFor();
  await page.bringToFront();await page.getByRole('textbox',{name:c.message,exact:true}).fill('First tab owns this edit');await waitForComposition('First tab owns this edit');
  await second.bringToFront();await second.getByRole('textbox',{name:c.message,exact:true}).fill('Competing unsent draft');await second.getByRole('alert').waitFor();
  assert.equal(await second.getByRole('textbox',{name:c.message,exact:true}).inputValue(),'Competing unsent draft');assert(await second.evaluate(()=>window.genesisSecretQaConflictRetained()));assert(await page.evaluate(()=>window.genesisSecretQaCompositionRetained('First tab owns this edit',false)));
  await second.getByRole('button',{name:c.send,exact:true}).click();await second.getByRole('alert').waitFor();await second.waitForFunction(()=>!document.querySelector('.messenger-loading'));assert.equal(report.messageWrites,0);assert.equal(report.unexpectedRoutes??0,0);assert.deepEqual(pageErrors,[]);
  report.checks.push({name:'real two-tab Web Locks CAS retains both encrypted intents and prevents a failed save from sending',status:'PASS'});report.status='PASS';
 }else{
 const sendingBlocked=async text=>{const send=page.getByRole('button',{name:text.send,exact:true});assert(await send.count()===0||await send.isDisabled(),'Send must be unavailable after a key change');};
 changed=true;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByRole('status').filter({hasText:c.keyChanged}).waitFor();
 assert.equal(await page.getByRole('button',{name:c.security,exact:true}).count(),0);await sendingBlocked(c);assert(await page.evaluate(()=>window.genesisSecretQaDraftRetained()));
 report.checks.push({name:'changed peer key warns, removes stale security code and blocks sending without replacing draft',status:'PASS'});
 for(const language of Object.keys(copies))for(const dark of [false,true])for(const width of [360,390,768,1440]){
  await page.getByLabel('QA language',{exact:true}).selectOption(language);await page.setViewportSize({width,height:1000});await page.evaluate(value=>{document.documentElement.setAttribute('data-genesis-theme',value?'standart-dark':'standart');document.documentElement.setAttribute('data-genesis-palette','violet');},dark);
  // The active error is intentionally translated after language selection on
  // the next actual refresh; no React state or failure result is injected.
  await page.getByRole('button',{name:copies[language].refresh,exact:true}).click();const notice=page.getByRole('status').filter({hasText:copies[language].keyChanged});await notice.waitFor();
  await sendingBlocked(copies[language]);assert.equal(await page.getByRole('button',{name:copies[language].security,exact:true}).count(),0);
  const geometry=await notice.evaluate(element=>{const b=element.getBoundingClientRect();return{left:b.left,right:b.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2};});assert(geometry.left>=0&&geometry.right<=width+2&&!geometry.overflow);
  const label=`${language}-${width}-${dark?'dark':'light'}`;await page.screenshot({path:resolve(output,label+'.png'),animations:'disabled',fullPage:true});report.visualCases.push({label,status:'PASS'});
 }
 await context.addInitScript(value=>{window.genesisSecretQaPublic=value;},fixture);await page.reload();await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByRole('status').filter({hasText:c.keyChanged}).waitFor();
 assert(await page.evaluate(()=>window.genesisSecretQaDraftRetained()));await sendingBlocked(c);
 changed=false;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByText('Retained secret history',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:c.message,exact:true}).inputValue(),'Retained unsent secret draft');
 assert.equal(report.messageWrites,0);report.checks.push({name:'cold browser retains old pin and draft; original peer keys still decrypt history',status:'PASS'});
 await page.getByRole('button',{name:c.send,exact:true}).click();await page.getByRole('button',{name:c.retry,exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByRole('button',{name:c.retry,exact:true}).click();
 await waitForComposition('');assert.equal(await page.getByRole('textbox',{name:c.message,exact:true}).inputValue(),'');assert.equal(messages.length,1);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
 report.checks.push({name:'lost acknowledgement keeps the exact encrypted command through cold retry and clears only its durable composition',status:'PASS'});
 await page.getByRole('button',{name:c.edit,exact:true}).click();await page.getByRole('textbox',{name:c.message,exact:true}).fill('Edited retained message');await waitForComposition('Edited retained message',true);
 await page.reload();await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByRole('button',{name:c.save,exact:true}).click();await page.locator('.messenger-messages').getByText('Edited retained message',{exact:true}).waitFor();
 assert.equal(messages.length,1);assert.equal(messages[0].revision,2);assert.equal(writes.length,3);assert.equal(writes[2].method,'PATCH');await waitForComposition('');
 assert.equal(report.unexpectedRoutes??0,0);assert.deepEqual(pageErrors,[]);report.checks.push({name:'cold edit retains the original message ID and base revision and never becomes a new POST',status:'PASS'});report.status='PASS';
 }
}catch(error){report.status='FAIL';report.error=redact(error.message);process.exitCode=1;if(page){await page.screenshot({path:resolve(output,'failure.png'),mask:[page.locator('input,textarea')]}).catch(()=>{});writeFileSync(resolve(output,'failure.txt'),redact(await page.locator('body').ariaSnapshot().catch(()=>'')));}}
finally{
 ephemeralSecret='';
 if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));
 if(api&&api.exitCode===null&&api.signalCode===null)api.kill();if(apiClosed)await apiClosed;apiLog.end();
 if(existsSync(resolve(runtime,'owner.json')))report.cleanup=cleanupBackendRuntime(runtime,output);
 report.sourceUnchanged=sourceSnapshot(process.cwd()).sha256===input.sha256;writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,visualCases:report.visualCases.length,output,error:report.error??null}));
