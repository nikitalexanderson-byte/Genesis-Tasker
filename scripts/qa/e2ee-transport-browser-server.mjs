// Loopback-only, allowlisted synthetic resources. Never serves the checkout.
import http from 'node:http';
import {build} from 'vite';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',define:{
  'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),
  'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify(''),
  'process.env.NEXT_PUBLIC_GENESIS_MINDMAPS':JSON.stringify('false'),
  'process.env.NODE_ENV':JSON.stringify('production'),
},build:{write:false,minify:false,target:'es2022',
  lib:{entry:resolve(root,'scripts/qa/e2ee-transport-browser-check.ts'),formats:['es'],fileName:'check'},
  rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output;
const script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('No browser entry built');
let count=0,preferenceCount=0,owner='browser-api-'+randomUUID(),protectedProfile=false;
const slow=new Map();
const workerProgram=`importScripts('/e2ee-worker.js');const guarded=GenesisLegacyTransportWorker.installLegacyTransportWorker(self);self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{if(guarded.handles(event.request))event.respondWith(guarded(event.request));});`;
const server=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
  const path=new URL(request.url,'http://localhost').pathname;
  if(path==='/api/account/preferences'&&request.method==='PUT') {
    preferenceCount++;request.resume();response.setHeader('Content-Type','application/json');response.end(JSON.stringify({user:{uid:owner}}));return;
  }
  if(request.method!=='GET'){response.writeHead(405).end();return;}
  if(path==='/worker.js'){response.setHeader('Content-Type','text/javascript');response.end(workerProgram);return;}
  if(path==='/e2ee-worker.js'){response.setHeader('Content-Type','text/javascript');response.end(readFileSync(resolve(root,'public/e2ee-legacy-transport-worker.js')));return;}
  if(path==='/api/workspace/slow') {
    const id=new URL(request.url,'http://localhost').searchParams.get('id');if(!id||!/^[-a-zA-Z0-9]{1,100}$/.test(id)||slow.has(id)){response.writeHead(400).end();return;}
    count++;response.setHeader('Content-Type','application/json');response.write('{"synthetic":');slow.set(id,response);response.on('close',()=>slow.delete(id));return;
  }
  if(path==='/slow-status'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({active:[...slow.keys()]}));return;}
  if(path==='/release-slow'){const id=new URL(request.url,'http://localhost').searchParams.get('id');slow.get(id)?.end('true}');slow.delete(id);response.setHeader('Content-Type','application/json');response.end('{}');return;}
  if(path==='/profile-active'){owner='browser-active-'+randomUUID();protectedProfile=true;response.setHeader('Content-Type','application/json');response.end('{}');return;}
  if(path==='/profile-legacy'){owner='browser-api-'+randomUUID();protectedProfile=false;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({owner}));return;}
  if(path==='/api/session'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({csrf:'synthetic-csrf',loginId:'synthetic-login',user:{uid:owner,...(protectedProfile?{privatePreferencesMode:'e2ee'}:{})}}));return;}
  if(path==='/api/e2ee/v1/status'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({cryptoProtocol:1,scopes:[],pilotAllowed:false}));return;}
  if(path==='/api/advice/saved') {
    count++;response.setHeader('Content-Type','application/json');
    if(request.headers['x-genesis-account-id']!==undefined&&request.headers['x-genesis-account-id']!==owner){response.writeHead(409).end(JSON.stringify({error:'E2EE_ACCOUNT_CHANGED'}));return;}
    response.end(JSON.stringify({synthetic:true}));return;
  }
  if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html lang="en"><title>GENESIS transport fixture</title><h1>Synthetic transport barrier</h1><pre id="result">Loading</pre><script type="module" src="/check.js"></script></html>');return;}
  if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
  if(path==='/private-probe'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({synthetic:true,request:++count}));return;}
  if(path==='/probe-count'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({count,preferenceCount}));return;}
  response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
