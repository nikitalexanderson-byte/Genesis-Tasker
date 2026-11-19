// Loopback-only synthetic acceptance; no arbitrary files or user-data routes.
import http from 'node:http';
import {build} from 'vite';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',build:{write:false,minify:false,target:'es2022',
 lib:{entry:resolve(root,'scripts/qa/tasks-source-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output;
const script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Missing synthetic task-source entry');
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'");
 if(request.method!=='GET'){response.writeHead(405).end();return;}
 if(request.url==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS task source</title><h1>Synthetic task-source acceptance</h1><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(request.url==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
 if(request.url==='/favicon.ico'){response.writeHead(204).end();return;}
 response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
