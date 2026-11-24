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
const input=sourceSnapshot(process.cwd()),runtime=resolve(output,'runtime'),copies=JSON.parse(readFileSync('app/messenger-copy.json','utf8'));
const result=await build({configFile:false,root:process.cwd(),logLevel:'warn',plugins:[react()],define:{'process.env.NODE_ENV':JSON.stringify('production'),'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api')},
 build:{write:false,minify:false,target:'es2022',lib:{entry:resolve('scripts/qa/messenger-secret-browser-check.tsx'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const artifacts=Array.isArray(result)?result.flatMap(row=>row.output):result.output,entry=artifacts.find(row=>row.type==='chunk'&&row.isEntry),css=artifacts.filter(row=>row.type==='asset'&&row.fileName.endsWith('.css')).map(row=>row.source).join('\n');assert(entry);
const styles=[...readFileSync(resolve(bundle,'index.html'),'utf8').matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(row=>row[0]).join('');
const report={synthetic:true,status:'RUNNING',scope:'Actual Messenger, WebCrypto and IndexedDB; actual synthetic login, modeled chat transport with substituted peer key; no server enrollment or private-vault storage claim',sourceCommit:input.commit,sourceSha256:input.sha256,entrySha256:hash(entry.code),checks:[],visualCases:[],messageWrites:0};
let apiPort,api,apiClosed,browser;const apiLog=createWriteStream(resolve(output,'local-api.log'));
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');response.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){const upstream=http.request({hostname:'127.0.0.1',port:apiPort,path:url.pathname+url.search,method:request.method,headers:request.headers},incoming=>{response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);});upstream.on('error',()=>response.writeHead(502).end());request.pipe(upstream);return;}
 if(url.pathname==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<link rel="stylesheet" href="/check.css"></head><body><main id="root"></main><script type="module" src="/check.js"></script></body></html>`);return;}
 if(url.pathname==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(entry.code);return;}
 if(url.pathname==='/check.css'){response.setHeader('Content-Type','text/css');response.end(css);return;}
 const file=resolve(bundle,'.'+decodeURIComponent(url.pathname)),extension=extname(file);
 if(!file.startsWith(bundle+sep)||!existsSync(file)||!['.css','.woff2','.woff','.png','.svg','.webp','.jpg'].includes(extension)){response.writeHead(404).end();return;}
 response.setHeader('Content-Type',({'.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[extension]);createReadStream(file).pipe(response);
});
try{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
 const reservation=http.createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));apiPort=reservation.address().port;await new Promise(done=>reservation.close(done));
 const php=await resolveBackendPhp(process.argv[4]),prepared=spawnSync(php,['-d','disable_functions=curl_exec,mail','scripts/qa/backend-fixture.php',`--dir=${runtime}`,`--origin=${origin}`,'--run-id=secret-key-ui58'],{encoding:'utf8',windowsHide:true,env:{...process.env,...backendPhpEnvironment(php)}});
 assert.equal(prepared.status,0,'Owned synthetic backend preparation');
 api=spawn(php,['-d','disable_functions=curl_exec,mail','-S',`127.0.0.1:${apiPort}`,'scripts/qa/backend-router.php'],{windowsHide:true,env:{...process.env,...backendPhpEnvironment(php),GENESIS_FULL_QA:'isolated',GENESIS_FULL_QA_DIR:runtime.replaceAll('\\','/')},stdio:['ignore','pipe','pipe']});
 apiClosed=new Promise(done=>api.once('close',done));api.stdout.pipe(apiLog);api.stderr.pipe(apiLog);await waitForQaBackend(api,`http://127.0.0.1:${apiPort}`,'secret-key-ui58');
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage();let fixture,changed=false;
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.name));
 await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.route('**/api/shared/messenger/**',async route=>{
  fixture??=await page.evaluate(()=>window.genesisSecretQa);assert(fixture,'Only public fixture metadata');
  const request=route.request(),url=new URL(request.url()),path=url.pathname.slice('/api/shared/messenger'.length),now='2026-11-24T00:00:00Z';
  const peer=changed?fixture.replacement:fixture.peer;
  const chat={id:fixture.chatId,kind:'secret',title:'QA secret peer',projectId:null,updatedAt:now,unread:0,members:[
   {userId:fixture.ownerId,name:'QA owner',role:'owner',status:'active',deviceId:fixture.deviceId,keyId:fixture.own.keyId,publicKey:fixture.own.publicKey},
   {userId:fixture.peerId,name:'QA secret peer',role:'member',status:'active',deviceId:fixture.peerDevice,keyId:peer.keyId,publicKey:peer.publicKey}]};
  let body;
  if(path==='/devices'&&request.method()==='POST'){const sent=request.postDataJSON();assert.equal(sent.id,fixture.deviceId);assert.deepEqual(sent.publicKey,fixture.own.publicKey);assert(!Object.hasOwn(sent.publicKey,'d'));body={devices:[{id:fixture.deviceId,keyId:fixture.own.keyId,revokedAt:null}]};}
  else if(path==='/conversations')body={conversations:[chat],hiddenConversations:[]};
  else if(path===`/conversations/${fixture.chatId}`)body=chat;
  else if(path===`/conversations/${fixture.chatId}/messages`&&request.method()==='GET')body={messages:[{id:fixture.messageId,seq:1,senderId:fixture.peerId,revision:1,text:null,payload:fixture.payload,createdAt:now,updatedAt:now,deletedAt:null}],nextCursor:null};
  else if(path.endsWith('/read'))body={ok:true};
  else{report.messageWrites++;await route.fulfill({status:405,json:{error:'UNEXPECTED_SYNTHETIC_ROUTE'}});return;}
  await route.fulfill({status:200,json:body});
 });
 assert((await context.request.get(origin+'/api/qa/login?tier=business')).ok());await page.goto(origin);
 const c=copies.en;await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByText('Retained secret history',{exact:true}).waitFor();
 assert(await page.getByRole('button',{name:c.security,exact:true}).isVisible());await page.getByRole('textbox',{name:c.message,exact:true}).fill('Retained unsent secret draft');
 await page.waitForFunction(async()=>await window.genesisSecretQaDraftRetained?.());report.checks.push({name:'original message decrypts and draft reaches actual encrypted local storage',status:'PASS'});
 changed=true;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByRole('status').filter({hasText:c.keyChanged}).waitFor();
 assert.equal(await page.getByRole('button',{name:c.security,exact:true}).count(),0);assert(await page.getByRole('button',{name:c.send,exact:true}).isDisabled());assert(await page.evaluate(()=>window.genesisSecretQaDraftRetained()));
 report.checks.push({name:'changed peer key warns, removes stale security code and blocks sending without replacing draft',status:'PASS'});
 for(const language of Object.keys(copies))for(const dark of [false,true])for(const width of [360,390,768,1440]){
  await page.getByLabel('QA language',{exact:true}).selectOption(language);await page.setViewportSize({width,height:1000});await page.evaluate(value=>{document.documentElement.setAttribute('data-genesis-theme',value?'standart-dark':'standart');document.documentElement.setAttribute('data-genesis-palette','violet');},dark);
  // The active error is intentionally translated after language selection on
  // the next actual refresh; no React state or failure result is injected.
  await page.getByRole('button',{name:copies[language].refresh,exact:true}).click();const notice=page.getByRole('status').filter({hasText:copies[language].keyChanged});await notice.waitFor();
  assert(await page.getByRole('button',{name:copies[language].send,exact:true}).isDisabled());assert.equal(await page.getByRole('button',{name:copies[language].security,exact:true}).count(),0);
  const geometry=await notice.evaluate(element=>{const b=element.getBoundingClientRect();return{left:b.left,right:b.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2};});assert(geometry.left>=0&&geometry.right<=width+2&&!geometry.overflow);
  const label=`${language}-${width}-${dark?'dark':'light'}`;await page.screenshot({path:resolve(output,label+'.png'),animations:'disabled',fullPage:true});report.visualCases.push({label,status:'PASS'});
 }
 await context.addInitScript(value=>{window.genesisSecretQaPublic=value;},fixture);await page.reload();await page.getByRole('button',{name:'QA secret peer',exact:false}).first().click();await page.getByRole('status').filter({hasText:c.keyChanged}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:c.message,exact:true}).inputValue(),'Retained unsent secret draft');assert(await page.getByRole('button',{name:c.send,exact:true}).isDisabled());
 changed=false;await page.getByRole('button',{name:c.refresh,exact:true}).click();await page.getByText('Retained secret history',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:c.message,exact:true}).inputValue(),'Retained unsent secret draft');
 assert.equal(report.messageWrites,0);assert.deepEqual(pageErrors,[]);report.checks.push({name:'cold browser retains old pin and draft; original peer keys still decrypt history',status:'PASS'});report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{
 if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));
 if(api&&api.exitCode===null&&api.signalCode===null)api.kill();if(apiClosed)await apiClosed;apiLog.end();
 if(existsSync(resolve(runtime,'owner.json')))report.cleanup=cleanupBackendRuntime(runtime,output);
 report.sourceUnchanged=sourceSnapshot(process.cwd()).sha256===input.sha256;writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,visualCases:report.visualCases.length,output,error:report.error??null}));
