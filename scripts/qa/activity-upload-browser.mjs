import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,readFileSync,writeFileSync,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const output=path.resolve(process.argv[2]);assert(output.includes(path.sep+'output'+path.sep+'playwright'+path.sep)&&!existsSync(output));mkdirSync(output,{recursive:true});
const report={synthetic:true,status:'RUNNING',scope:'Actual cloud-sync + Chromium IndexedDB/Web Locks/service worker; synthetic session metadata; no unlocked vault or live provider',checks:[],sources:[]};
for(const file of ['app/cloud-sync.ts','contracts/e2ee/legacy-transport-v1.json','public/e2ee-legacy-transport-worker.js','scripts/qa/e2ee-transport-browser-check.ts','scripts/qa/e2ee-transport-browser-server.mjs','scripts/qa/activity-upload-browser.mjs'])report.sources.push({path:file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
const log=createWriteStream(path.join(output,'server.log')),server=spawn(process.execPath,['scripts/qa/e2ee-transport-browser-server.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.pipe(log);server.stderr.pipe(log);
let browser;
try{
 const url=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Synthetic browser server did not start')),30000);server.once('error',reject);server.once('exit',()=>reject(Error('Synthetic browser server stopped')));server.stdout.on('data',bytes=>{text+=bytes;for(const line of text.split('\n')){try{const value=JSON.parse(line);if(value.synthetic===true&&/^http:\/\/127\.0\.0\.1:\d+\/$/.test(value.url)){clearTimeout(timeout);resolve(value.url);return;}}catch{/* Public startup log. */}}});});
 browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>globalThis.genesisTransportFixture?.state().ready);
 const invoke=(method,...args)=>page.evaluate(async({method,args})=>globalThis.genesisTransportFixture[method](...args),{method,args});
 const check=async(name,action)=>{report.phase=name;await action();report.checks.push({name,status:'PASS'});console.log('PASS activity '+name);};
 await invoke('registerWorker');await invoke('resetProfile');const owner=await invoke('productSession');assert(owner);let before=await invoke('counters');
 await check('ordinary legacy account retains both existing uploads',async()=>{const result=await invoke('productActivity');assert(result.every(row=>row.ok===true),'Legacy activity result: '+JSON.stringify(result));const after=await invoke('counters');assert.equal(after.metricsCount,before.metricsCount+1);assert.equal(after.usageCount,before.usageCount+1);before=after;});
 await invoke('freeze',owner);
 await check('preparing personal marker refuses current application uploads before HTTP',async()=>{const result=await invoke('productActivity');assert(result.every(row=>row.error==='E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN'));assert.deepEqual(await invoke('counters'),before);});
 await check('old page raw fetch cannot bypass the service worker',async()=>{for(const route of ['/metrics','/metrics/','/feature-usage','/feature-usage/']){const result=await invoke('oldRequest',route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"private-marker":"synthetic"}'});assert.equal(result.status,409);}assert.deepEqual(await invoke('counters'),before);});
 await check('active locked profile suppresses optional uploads without opening a vault',async()=>{const active=await invoke('activeProfile');assert.equal(await invoke('marker',active),null);assert((await invoke('productActivity')).every(row=>row.ok===true));assert.deepEqual(await invoke('counters'),before);});
 await check('another legacy account still has its independent route',async()=>{const other=await invoke('resetProfile');assert.notEqual(other,owner);await invoke('productSession');assert((await invoke('productActivity')).every(row=>row.ok===true));const after=await invoke('counters');assert.equal(after.metricsCount,before.metricsCount+1);assert.equal(after.usageCount,before.usageCount+1);});
 report.status='PASS';await context.close();
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await browser?.close();if(server.exitCode===null){const stopped=new Promise(resolve=>server.once('close',resolve));server.kill();await stopped;}log.end();writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');}
