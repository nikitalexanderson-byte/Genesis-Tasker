// Two explicit loopback origins and synthetic sessions only; no workspace files.
import http from 'node:http';
import {build} from 'vite';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const bundle=await build({root,configFile:false,logLevel:'error',define:{'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify(''),'process.env.NEXT_PUBLIC_GENESIS_MINDMAPS':JSON.stringify('false'),'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/e2ee-http-policy-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const items=Array.isArray(bundle)?bundle.flatMap(row=>row.output):bundle.output,script=items.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Missing synthetic policy entry');
let origin='',mode='redirect',forwardedRequests=0,forwardedCsrf=false;
const foreign=http.createServer((request,response)=>{
 response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Access-Control-Allow-Credentials','true');response.setHeader('Cache-Control','no-store');
 if(request.method==='OPTIONS'){response.setHeader('Access-Control-Allow-Methods','POST');response.setHeader('Access-Control-Allow-Headers',request.headers['access-control-request-headers']??'');response.writeHead(204).end();return;}
 if(request.method!=='POST'||request.url!=='/synthetic-receiver'){response.writeHead(404).end();return;}
 forwardedRequests++;forwardedCsrf||=request.headers['x-csrf-token']==='synthetic-policy-csrf';request.resume();response.setHeader('Content-Type','application/json');response.end(JSON.stringify({sourceHash:'synthetic-foreign-origin'}));
});
await new Promise(done=>foreign.listen(0,'127.0.0.1',done));const foreignOrigin=`http://127.0.0.1:${foreign.address().port}`;
const primary=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; connect-src 'self' ${foreignOrigin}; object-src 'none'`);const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path==='/api/session'&&request.method==='GET'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({user:{uid:'http-policy-owner'},csrf:'synthetic-policy-csrf',loginId:'synthetic-policy-login'}));return;}
 if(path==='/api/e2ee/v1/source'&&request.method==='POST'){
  request.resume();if(request.headers['x-csrf-token']!=='synthetic-policy-csrf'){response.writeHead(403).end();return;}
  if(mode==='redirect'){response.writeHead(307,{Location:foreignOrigin+'/synthetic-receiver'}).end();return;}
  response.setHeader('Content-Type','application/json');
  if(mode==='private-error'){response.writeHead(409).end(JSON.stringify({error:'E2EE_PRIVATE synthetic-private-error-canary',feature:'synthetic'}));return;}
  if(mode==='valid-error'){response.writeHead(409).end(JSON.stringify({error:'E2EE_MIGRATION_FENCED'}));return;}
  if(mode==='reserved-csrf'){response.end(JSON.stringify({sourceHash:'synthetic',csrf:'b'.repeat(48)}));return;}
  if(mode==='reserved-user'){response.end(JSON.stringify({sourceHash:'synthetic',user:{uid:'http-policy-owner',email:'synthetic@example.invalid'}}));return;}
  response.end(JSON.stringify({sourceHash:'synthetic-original-origin'}));return;
 }
 if(request.method!=='GET'){response.writeHead(405).end();return;}
 if(path==='/control'){const selected=url.searchParams.get('mode');if(!['redirect','private-error','valid-error','success','reserved-user','reserved-csrf'].includes(selected)){response.writeHead(400).end();return;}mode=selected;response.setHeader('Content-Type','application/json');response.end('{}');return;}
 if(path==='/metrics.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({forwardedRequests,forwardedCsrf}));return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><title>GENESIS E2EE HTTP policy</title><pre id="result">Running</pre><script type="module" src="/check.js"></script>');return;}
 response.writeHead(path==='/favicon.ico'?204:404).end();
});
await new Promise(done=>primary.listen(0,'127.0.0.1',done));origin=`http://127.0.0.1:${primary.address().port}`;console.log(JSON.stringify({url:origin+'/',foreignOrigin,synthetic:true,noProductionRequests:true}));
