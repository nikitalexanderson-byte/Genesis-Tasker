import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {hash} from './full-lib.mjs';
import {createStartupRouting} from './startup-routing.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const timeoutMs=15000;

function installStartupObserver() {
  const state=window.__genesisSharedStartup={errorEvents:[],readyEvents:[]};
  const message='Не удалось загрузить данные';
  addEventListener('genesis-personal-document-ready',()=>state.readyEvents.push(performance.now()));
  new MutationObserver(records=>{
    const panel=document.querySelector('.today-tasks-panel');
    // Preserve short-lived errors even if another mutation removes the node in the same batch.
    const removedError=records.some(record=>{
      const target=record.target.nodeType===Node.ELEMENT_NODE?record.target:record.target.parentElement;
      return target?.closest?.('.today-tasks-panel')&&(record.oldValue?.includes(message)
        || [...record.addedNodes].some(node=>node.textContent?.includes(message)));
    });
    if((panel?.textContent?.includes(message)||removedError)&&state.errorEvents.length<32)state.errorEvents.push(performance.now());
  }).observe(document,{childList:true,subtree:true,characterData:true,characterDataOldValue:true});
}

function assertNoStartupError(observation) {
  assert.equal(observation.errorEvents.length,0,'Today displayed a transient shared-data startup error');
  assert.equal(observation.visibleError,false,'Today still displays a shared-data startup error');
}

const observation=page=>page.evaluate(()=>({
  errorEvents:window.__genesisSharedStartup.errorEvents,
  readyEvents:window.__genesisSharedStartup.readyEvents,
  visibleError:document.querySelector('.today-tasks-panel')?.textContent?.includes('Не удалось загрузить данные')??false,
}));

function bounded(promise,message) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeoutMs);})])
    .finally(()=>clearTimeout(timer));
}

/** A separate mandatory gate; it does not alter the existing web feature matrix or its 229 IDs. */
export async function runSharedStartup({baseURL,output}) {
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL),'Only an isolated loopback origin is allowed');
  const directory=path.join(output,'startup');
  assert(!existsSync(directory),'Fresh startup evidence required');mkdirSync(directory,{recursive:true});
  const reportFile=path.join(directory,'results.json');
  const report={schemaVersion:1,gate:'shared-startup-before-first-poll',startedAt:new Date().toISOString(),status:'RUNNING',
    sources:['app/cloud-sync.ts','app/use-shared-task-page.ts','app/GenesisCalendar.tsx','scripts/qa/web-shared-startup.mjs','scripts/qa/startup-routing.mjs']
      .map(file=>({path:file,sha256:hash(readFileSync(path.join(root,file)))})),cases:[],routingErrors:[],teardownErrors:[]};
  const save=()=>writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  let browser;
  try {
    browser=await chromium.launch({headless:true});report.browser={name:'Chromium',version:browser.version()};
    const canaryContext=await browser.newContext();
    try {
      const page=await canaryContext.newPage();await page.setContent('<section class="today-tasks-panel"></section>');
      await page.evaluate(installStartupObserver);
      await page.evaluate(()=>{const error=document.createElement('p');error.textContent='Не удалось загрузить данные';
        document.querySelector('.today-tasks-panel').append(error);error.remove();});
      const observed=await observation(page);
      assert.equal(observed.visibleError,false);
      assert.throws(()=>assertNoStartupError(observed),/transient shared-data startup error/);
      report.observerControl={status:'PASS',removedBannerStillRecorded:true,rejectsTransientError:true};
    } finally {await canaryContext.close();}
    save();
    for(const tier of ['business','premium4life']) {
      const context=await browser.newContext({baseURL,viewport:{width:390,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});
      const routing=createStartupRouting(baseURL);
      try {
        await context.route(/https?:\/\//,routing.handle);
        await context.addInitScript(origin=>{
          if(location.origin===origin)localStorage.setItem('genesis-language-v1','ru');
        },new URL(baseURL).origin);
        await context.addInitScript(installStartupObserver);
        const login=await context.request.get(`/api/qa/login?tier=${tier}`);
        assert(login.ok()&&(await login.json()).synthetic,'Synthetic ordinary account required');
        const page=await context.newPage();page.setDefaultTimeout(timeoutMs);
        for(const operation of ['initial','reload']) {
          const row={id:`startup.${tier}.${operation}`,planId:tier,operation,status:'RUNNING',events:[],routeErrors:[]};
          report.cases.push(row);save();
          let bootstrapCount=0,sharedCount=0,resolveShared;
          const firstShared=new Promise(resolve=>{resolveShared=resolve;});
          const events=row.events,started=performance.now(),stamp=()=>Math.round(performance.now()-started);
          const pageErrors=[];const pageError=()=>pageErrors.push('Uncaught page error');page.on('pageerror',pageError);
          const bootstrapRoute=async route=>{
            const index=++bootstrapCount;events.push({event:'bootstrap-request',index,ms:stamp()});
            const response=await route.fetch();
            if(index===1) {
              // Mount Today and flush its effects while bootstrap is held. Old clients issue the
              // shared request with an empty owner here; fixed clients join this initialization.
              await page.locator('.today-tasks-panel').waitFor({state:'attached'});
              await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
              events.push({event:'today-mounted-before-bootstrap',ms:stamp()});
            }
            await route.fulfill({response});events.push({event:'bootstrap-fulfilled',index,ms:stamp()});
          };
          const sharedRoute=async route=>{
            const index=++sharedCount;events.push({event:'shared-request',index,ms:stamp()});
            const response=await route.fetch();
            if(index===1)await page.waitForFunction(()=>window.__genesisSharedStartup.readyEvents.length>0,null,{timeout:timeoutMs});
            // The first shared response is always delivered after owner initialization. An old
            // empty-owner capture must fail now, before its normal five-second retry can hide it.
            await route.fulfill({response});events.push({event:'shared-fulfilled',index,status:response.status(),ms:stamp()});
            if(index===1)resolveShared(response.status());
          };
          routing.begin(row,bootstrapRoute,sharedRoute);
          try {
            if(operation==='initial')await page.goto('/#today');else await page.reload();
            assert.equal(await bounded(firstShared,'First shared startup response was not delivered'),200);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            row.observation=await observation(page);row.sharedRequestsAtAcceptance=sharedCount;row.pageErrors=pageErrors;
            assertNoStartupError(row.observation);assert.equal(sharedCount,1,'Startup acceptance must precede the next poll');
            assert.equal(row.routeErrors.length,0);assert.equal(pageErrors.length,0);assert(row.observation.readyEvents.length>0);
            assert(events.some(event=>event.event==='today-mounted-before-bootstrap'));
            row.status='PASS';
          } catch(error) {
            row.status='FAIL';row.error=error.message.split('\n')[0];
            row.observation??=await observation(page).catch(()=>null);
            row.sharedRequestsAtAcceptance=sharedCount;
          } finally {
            const file=path.join(directory,`${tier}-${operation}.png`);
            try {await page.screenshot({path:file,fullPage:true,animations:'disabled'});row.evidence=[{path:path.relative(root,file).replaceAll('\\','/'),sha256:hash(readFileSync(file))}];}
            catch {row.status='FAIL';row.error??='Startup screenshot unavailable';}
            page.off('pageerror',pageError);routing.end();
            await bounded(routing.drain(row),'Startup operation routes did not settle');
            if(row.routeErrors.length){row.status='FAIL';row.error??='Startup route did not complete';}
            row.durationMs=stamp();save();console.log(`${row.status} ${row.id}`);
          }
        }
      } finally {
        routing.end();
        let cleanupError;
        try {await bounded(routing.drain(),'Startup context routes did not settle');}
        catch(error){cleanupError=error;}
        finally {
          routing.closing();
          try {await context.close();}catch(error){cleanupError??=error;}
          finally {
            try {await bounded(routing.drain(),'Late startup routes did not settle after context close');}
            catch(error){cleanupError??=error;}
            finally {
              report.routingErrors.push(...routing.errors);report.teardownErrors.push(...routing.teardownErrors);
              if(cleanupError)report.routingErrors.push(cleanupError.message);
              for(const row of report.cases)if(row.routeErrors.length){row.status='FAIL';row.error??='Startup route did not complete';}
              save();
            }
          }
        }
      }
    }
    report.status=report.cases.length===4&&report.cases.every(row=>row.status==='PASS')&&report.routingErrors.length===0?'PASS':'FAIL';
  } catch {report.status='FAIL';report.error='Shared startup gate could not complete; see recorded cases and route diagnostics';}
  finally {await browser?.close();report.finishedAt=new Date().toISOString();save();}
  return {status:report.status,passed:report.cases.filter(row=>row.status==='PASS').length,total:report.cases.length,
    observerControl:report.observerControl?.status??'FAIL',report:path.relative(root,reportFile).replaceAll('\\','/'),sha256:hash(readFileSync(reportFile))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await runSharedStartup({baseURL:process.env.GENESIS_QA_WEB_ORIGIN,output:path.resolve(process.env.GENESIS_QA_WEB_OUTPUT??'output/playwright/shared-startup')});
  console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;
}
