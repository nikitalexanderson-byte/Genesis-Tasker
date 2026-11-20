// Owned loopback fixture only. Never contacts a real account or backend.
import http from 'node:http';
import {build} from 'vite';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/original-legacy-source-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const server=http.createServer((request,response)=>{response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");if(request.method!=='GET'){response.writeHead(405).end();return;}
 const path=new URL(request.url,'http://localhost').pathname;if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS original legacy source</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}response.writeHead(path==='/favicon.ico'?204:404).end();});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
