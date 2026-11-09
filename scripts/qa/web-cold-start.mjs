import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

// Run against the compiled release, with a fresh anonymous context for every
// viewport. Source/SSR tests cannot catch cycles introduced by manual chunks.
const origin=process.env.GENESIS_QA_WEB_ORIGIN??'http://127.0.0.1:4390/';
const output=path.resolve(process.env.GENESIS_QA_WEB_OUTPUT??'output/release-325/web/cold-start');
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
try {
  for(const width of [360,390,768,1440]) for(const colorScheme of ['light','dark']) {
    const context=await browser.newContext({viewport:{width,height:900},colorScheme});
    const page=await context.newPage(),errors=[],failedScripts=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('requestfailed',request=>{if(request.resourceType()==='script')failedScripts.push(request.url());});
    try {
      const response=await page.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});
      assert.equal(response?.status(),200,'Public entry must return HTTP 200');
      await page.getByRole('button',{name:/Google/}).first().waitFor({timeout:20000});
      assert.deepEqual(errors,[],'Compiled client must initialize without JavaScript errors');
      assert.deepEqual(failedScripts,[],'Every startup script must load');
      await page.screenshot({path:path.join(output,`${width}-${colorScheme}.png`),fullPage:false});
      results.push({width,colorScheme,status:'PASS',pageErrors:errors,failedScripts});
    } catch(error) {
      results.push({width,colorScheme,status:'FAIL',reason:error.message,pageErrors:errors,failedScripts});
    } finally {await context.close();}
  }
} finally {
  await browser.close();
  writeFileSync(path.join(output,'results.json'),JSON.stringify({origin,results},null,2)+'\n');
}
console.log(JSON.stringify({states:results.length,passed:results.filter(r=>r.status==='PASS').length}));
assert(results.every(r=>r.status==='PASS'),'One or more cold release starts failed');
