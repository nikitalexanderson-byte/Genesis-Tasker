// Own synthetic loopback fixtures only. No arbitrary path or provider routes.
import http from 'node:http';
import {build} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/file-stream-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('No synthetic entry');
const fixtures={'/web.json':'tests/fixtures/e2ee/file-stream-web-v1.json','/keys.json':'tests/fixtures/e2ee/v1.json','/native.json':'output/release-3.3.6/runtime/file-stream-native-api34-vector-01.json'};
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
 if(request.method!=='GET'){response.writeHead(405).end();return;}const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS file stream</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}if(path==='/favicon.ico'){response.writeHead(204).end();return;}
 if(Object.hasOwn(fixtures,path)){try{const bytes=readFileSync(resolve(root,fixtures[path]));if(bytes.length>128*1024)throw new Error('Synthetic fixture limit');response.setHeader('Content-Type','application/json');response.end(bytes);}catch{response.writeHead(503).end('Synthetic fixture unavailable');}return;}
 response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
