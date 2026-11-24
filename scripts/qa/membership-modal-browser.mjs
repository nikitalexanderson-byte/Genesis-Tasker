import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync,existsSync,createReadStream} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';

const output=resolve(process.argv[2]),bundle=resolve(process.argv[3]);assert(output.includes(sep+'output'+sep+'playwright'+sep));assert(!existsSync(output));mkdirSync(output,{recursive:true});
const html=readFileSync(resolve(bundle,'index.html'),'utf8'),styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(row=>row[0]);assert(styles.length);
const result=await build({configFile:false,root:process.cwd(),logLevel:'warn',plugins:[react()],define:{'process.env.NODE_ENV':JSON.stringify('production')},
 build:{write:false,minify:false,target:'es2022',lib:{entry:resolve('scripts/qa/membership-modal-browser-check.tsx'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const assets=Array.isArray(result)?result.flatMap(row=>row.output):result.output,entry=assets.find(row=>row.type==='chunk'&&row.isEntry);assert(entry);
const report={synthetic:true,scope:'actual native membership modal, focus and editor custody; no crypto/account authority',entrySha256:createHash('sha256').update(entry.code).digest('hex'),checks:[],status:'RUNNING'};
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'");
 const path=new URL(request.url,'http://localhost').pathname;if(request.method!=='GET'){response.writeHead(405).end();return;}
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles.join('')}</head><body><div id="root"></div><script type="module" src="/check.js"></script></body></html>`);return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(entry.code);return;}
 const file=resolve(bundle,'.'+decodeURIComponent(path));if(!file.startsWith(bundle+sep)||!existsSync(file)||!['.css','.woff','.woff2','.png','.svg','.webp','.jpg'].includes(extname(file))){response.writeHead(404).end();return;}
 const types={'.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
 response.setHeader('Content-Type',types[extname(file)]);createReadStream(file).pipe(response);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const browser=await chromium.launch({headless:true});
try{
 for(const width of [360,390,768,1440])for(const dark of [false,true]){
  const page=await browser.newPage({viewport:{width,height:1000}}),label=`${width}-${dark?'dark':'light'}`;
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(value=>{document.documentElement.setAttribute('data-genesis-theme',value?'standart-dark':'standart');document.documentElement.setAttribute('data-genesis-palette','violet');},dark);
   const editor=page.getByRole('dialog',{name:'Synthetic team editor',exact:true});await editor.waitFor();await editor.getByRole('button',{name:'Review access',exact:true}).click();
   const gate=page.getByRole('dialog',{name:'Проверка изменений доступа',exact:true});await gate.waitFor();assert(await gate.evaluate(element=>element.matches(':modal')));
   assert(await page.locator('#genesis-app-content').evaluate(element=>element.inert));
   const size=await gate.evaluate(element=>{const style=getComputedStyle(element),bounds=element.getBoundingClientRect();return{scroll:element.scrollWidth,width:element.clientWidth,x:bounds.x,y:bounds.y,outerWidth:bounds.width,height:bounds.height,position:style.position,border:style.borderWidth,background:style.backgroundColor,styles:[...document.styleSheets].map(sheet=>({href:sheet.href,rules:sheet.cssRules.length}))};});
   report.currentLayout=size;
   if(size.outerWidth!==width)report.matchingStyles=await gate.evaluate(element=>{const found=[];const walk=rules=>{for(const rule of rules){if(rule.selectorText&&rule.style&&(rule.style.width||rule.style.maxWidth||rule.style.borderWidth||rule.style.border)){try{if(element.matches(rule.selectorText))found.push({selector:rule.selectorText,style:rule.style.cssText});}catch{/* Unsupported browser selector cannot affect this element. */}}if(rule.cssRules)walk(rule.cssRules);}};for(const sheet of document.styleSheets)walk(sheet.cssRules);return found;});
   assert(size.scroll<=size.width+1);assert.equal(size.position,'fixed');assert.equal(size.outerWidth,width);assert.equal(size.height,1000);assert.equal(size.border,'0px');
   await page.screenshot({path:resolve(output,label+'.png'),fullPage:true,animations:'disabled'});
   await gate.getByRole('checkbox').check();assert(await gate.getByRole('checkbox').isChecked());
   if(dark)await page.keyboard.press('Escape');else await gate.getByRole('button',{name:'Закрыть и сохранить прогресс',exact:true}).click();await gate.waitFor({state:'hidden'});
   assert.equal(await editor.getByLabel('Retained draft',{exact:true}).inputValue(),'SYNTHETIC RETAINED DRAFT');assert(await editor.evaluate(element=>element.matches(':modal')));
   assert.equal(await page.locator('#genesis-app-content').evaluate(element=>element.inert),false);report.checks.push({label,status:'PASS'});
  }catch(error){report.checks.push({label,status:'FAIL',error:error.message});throw error;}finally{await page.close();}
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,checks:report.checks.map(row=>({label:row.label,status:row.status})),output}));
