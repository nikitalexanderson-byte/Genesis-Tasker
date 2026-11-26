// Explicit loopback fixtures only. Never serves a workspace or real account.
import http from 'node:http';
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',define:{'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify(''),'process.env.NEXT_PUBLIC_GENESIS_MINDMAPS':JSON.stringify('false'),'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/remote-original-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const prefix=Buffer.from('\ufeff {\r\n"sourceHash":"synthetic", "private":"SYNTHETIC-RAW-CANARY α😀'),suffix=Buffer.from('"}\r\n'),size=2*1024*1024+7,block=Buffer.alloc(65536,97),duplicate=Buffer.from('\ufeff {"sourceHash":"first", "sourceHash":"second"}\r\n');
const digest=createHash('sha256');digest.update(prefix);for(let at=0;at<size;at+=block.length)digest.update(block.subarray(0,Math.min(block.length,size-at)));digest.update(suffix);
const expected={largeBytes:prefix.length+size+suffix.length,largeHash:digest.digest('base64url'),duplicateBytes:duplicate.length,duplicateHash:createHash('sha256').update(duplicate).digest('base64url')};let mode='large',reads=0;
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path==='/api/session'&&request.method==='GET'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({user:{uid:'remote-browser-owner'},csrf:'synthetic-csrf',loginId:'synthetic-remote-original'}));return;}
 if(path==='/api/e2ee/v1/read'&&request.method==='POST'){
  reads++;
  request.resume();if(request.headers['x-csrf-token']!=='synthetic-csrf'){response.writeHead(403).end();return;}response.setHeader('Content-Type','application/json; charset=utf-8');
  if(mode==='duplicate'){response.end(duplicate);return;}response.write(prefix);for(let at=0;at<size;at+=block.length)response.write(block.subarray(0,Math.min(block.length,size-at)));response.end(suffix);return;
 }
 if(request.method!=='GET'){response.writeHead(405).end();return;}
 if(path==='/control'){const kind=url.searchParams.get('mode');if(!['large','duplicate'].includes(kind)){response.writeHead(400).end();return;}mode=kind;response.setHeader('Content-Type','application/json');response.end('{}');return;}
 if(path==='/expected.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(expected));return;}
 if(path==='/metrics.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({reads}));return;}
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS remote original quarantine</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}response.writeHead(path==='/favicon.ico'?204:404).end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true,expected})));
