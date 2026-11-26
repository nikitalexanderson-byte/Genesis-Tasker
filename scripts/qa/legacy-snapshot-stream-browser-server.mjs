// Owned synthetic loopback only. Expected bytes are generated independently of
// the browser's encoder, parser, CryptoKey objects and encrypted local store.
import http from 'node:http';
import {build} from 'vite';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),inventory=JSON.parse(await readFile(resolve(root,'contracts/e2ee/private-paths-v1.json'),'utf8')),paths=inventory.paths.filter(row=>row.scope==='project').map(row=>row.id);
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/legacy-snapshot-stream-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const raw=createHash('sha256'),hashes=[],sizes=paths.map((_,index)=>index?3:9*1024*1024+7),block=Buffer.alloc(65535);let rawSize=0;
const text=value=>{raw.update(value,'utf8');rawSize+=Buffer.byteLength(value);};text('{"protocol":1,"ownerId":"content-owner","scopeId":"project:legacy-reader","paths":[');
try{for(const[index,path]of paths.entries()){if(index)text(',');text(`{"id":${JSON.stringify(path)},"bytes":"`);const hash=createHash('sha256');for(let at=0;at<sizes[index];at+=block.length){const n=Math.min(block.length,sizes[index]-at);for(let j=0;j<n;j++)block[j]=((at+j)*31+index*17)&255;hash.update(block.subarray(0,n));text(block.subarray(0,n).toString('base64url'));}hashes.push(hash.digest('base64url'));text('"}');}text(']}');}finally{block.fill(0);}const expected={rawHash:raw.digest('base64url'),rawSize,hashes,sizes};
const server=http.createServer((request,response)=>{response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");if(request.method!=='GET'){response.writeHead(405).end();return;}
 const path=new URL(request.url,'http://localhost').pathname;if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS legacy snapshot stream</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}if(path==='/expected.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(expected));return;}response.writeHead(path==='/favicon.ico'?204:404).end();});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
