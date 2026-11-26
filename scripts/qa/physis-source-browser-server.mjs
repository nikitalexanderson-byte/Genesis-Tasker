// Immutable loopback-only bundle of actual forms and synthetic security peers.
import http from 'node:http';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',plugins:[react()],define:{'process.env.NODE_ENV':JSON.stringify('production'),'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_GENESIS_API_URL:'/api'})},
 build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/physis-source-browser-check.tsx'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,entry=output.find(row=>row.type==='chunk'&&row.isEntry);
if(!entry)throw new Error('Missing synthetic Physis entry');
const assets=new Map(output.map(row=>['/'+row.fileName,row.type==='chunk'?row.code:row.source])),styles=output.filter(row=>row.type==='asset'&&row.fileName.endsWith('.css'));
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'");
 if(request.method!=='GET'){response.writeHead(405).end();return;}const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>GENESIS synthetic Physis</title>${styles.map(row=>`<link rel="stylesheet" href="/${row.fileName}">`).join('')}</head><body><div id="root"></div><pre id="result">Starting</pre><script type="module" src="/${entry.fileName}"></script></body></html>`);return;}
 if(path==='/favicon.ico'){response.writeHead(204).end();return;}
 if(assets.has(path)){response.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');response.end(assets.get(path));return;}
 response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
