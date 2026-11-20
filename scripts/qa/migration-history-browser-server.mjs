// Owned loopback fixture. No real account, custody, network migration or activation.
import http from 'node:http';
import {build} from 'vite';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/migration-history-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const expected=[],block=Buffer.alloc(65536);
try{for(const seed of [47,0,17,31]){const hashes=[];for(let path=0;path<6;path++){for(let offset=0;offset<block.length;offset++)block[offset]=(offset*31+path*17+seed)&255;const digest=createHash('sha256'),size=path?3:1024*1024+7;
 for(let at=0;at<size;at+=block.length)digest.update(block.subarray(0,Math.min(block.length,size-at)));hashes.push(digest.digest('base64url'));}expected.push(hashes);}}finally{block.fill(0);}
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");if(request.method!=='GET'){response.writeHead(405).end();return;}
 const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS coordinator history</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}if(path==='/expected.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(expected));return;}
 response.writeHead(path==='/favicon.ico'?204:404).end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
