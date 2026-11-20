// Loopback-only synthetic wire corpus. No account/backend/provider is accessed.
import http from 'node:http';
import {build} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const corpus=JSON.parse(readFileSync(resolve(root,'contracts/e2ee/transport-json-v1.json'),'utf8'));
const result=await build({root,configFile:false,logLevel:'warn',define:{'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify(''),'process.env.NEXT_PUBLIC_GENESIS_MINDMAPS':JSON.stringify('false'),'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/transport-json-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
let selected=0,status=200,owner='wire-owner',mode='corpus',held=null;
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
 const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path==='/control'&&request.method==='GET'){
  const next=Number(url.searchParams.get('case')),code=Number(url.searchParams.get('status')),kind=url.searchParams.get('mode');
  if(!Number.isInteger(next)||next<0||next>=corpus.cases.length||![200,409].includes(code)||!['corpus','code','slow','retire','state'].includes(kind)){response.writeHead(400).end();return;}
  if(kind!=='state'){selected=next;status=code;mode=kind;}if(kind==='retire')owner='wire-retired-owner';
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({held:!!held}));return;
 }
 if(path==='/api/session'&&request.method==='GET'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({csrf:'synthetic-csrf',loginId:'synthetic:'+owner,user:{uid:owner}}));return;}
 if(path==='/api/e2ee/v1/source'&&request.method==='POST'){
  request.resume();if(request.headers['x-csrf-token']!=='synthetic-csrf'){response.writeHead(403).end();return;}
  response.statusCode=status;response.setHeader('Content-Type','application/json; charset=utf-8');
  if(mode==='slow'){response.write('{"sourceHash":');held=response;response.on('close',()=>{held=null;});return;}
  if(mode==='code'){response.end('{"error":"E2EE_SOURCE_CHANGED"}');return;}
  const row=corpus.cases[selected],bytes=row.hex?Buffer.from(row.hex,'hex'):Buffer.from(row.raw,'utf8');
  for(let at=0;at<bytes.length;at+=3)response.write(bytes.subarray(at,at+3));response.end();return;
 }
 if(request.method!=='GET'){response.writeHead(405).end();return;}
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS strict wire JSON</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
 if(path==='/corpus.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(corpus));return;}
 response.writeHead(path==='/favicon.ico'?204:404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
