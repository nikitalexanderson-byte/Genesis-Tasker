// Loopback only. Bundles a synthetic harness; never serves arbitrary project/private paths.
import http from 'node:http';
import { build } from 'vite';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',build:{write:false,minify:false,target:'es2022',
  lib:{entry:resolve(root,'scripts/qa/e2ee-runtime-browser-check.ts'),formats:['es'],fileName:'check'},
  rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output;
const script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('No browser entry built');
const server=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
  if(request.method!=='GET'){response.writeHead(405).end();return;}
  const path=new URL(request.url,'http://localhost').pathname;
  if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS E2EE runtime check</title><h1>Synthetic E2EE runtime</h1><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
  if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
  const fixtures={'/runtime.json':'tests/fixtures/e2ee/v1-runtime.json','/native.json':'output/release-3.3.6/runtime/kotlin-runtime.json'};
  if(Object.hasOwn(fixtures,path)){response.setHeader('Content-Type','application/json');response.end(readFileSync(resolve(root,fixtures[path])));return;}
  response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
