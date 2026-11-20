// Owned loopback fixtures only; native vector contains public synthetic roots.
import http from 'node:http';
import {build} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/content-plan-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const size=9*1024*1024+7,block=Buffer.alloc(65536),expected=[];
try{for(let path=0;path<2;path++){const digest=createHash('sha256');for(let index=0;index<block.length;index++)block[index]=(index*31+path*17)&255;for(let at=0;at<size;at+=block.length)digest.update(block.subarray(0,Math.min(block.length,size-at)));expected.push(digest.digest('base64url'));}}finally{block.fill(0);}
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");if(request.method!=='GET'){response.writeHead(405).end();return;}
 const path=new URL(request.url,'http://localhost').pathname;if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS content plan</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}if(path==='/expected.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(expected));return;}
 if(path==='/favicon.ico'){response.writeHead(204).end();return;}if(path==='/native.json')try{const raw=readFileSync(resolve(root,'output/release-3.3.6/runtime/content-plan-native-api34-vector-01.json'));if(raw.length>1024*1024)throw new Error('Public fixture limit');response.setHeader('Content-Type','application/json');response.end(raw);}catch{response.writeHead(503).end('Synthetic fixture unavailable');}else response.writeHead(404).end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
