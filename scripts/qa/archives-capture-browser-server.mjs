// Own loopback fixture only. The actual React panel has synthetic provider
// ports; CSP blocks every network connection, including production accounts.
import http from 'node:http';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',plugins:[react()],define:{'process.env.NODE_ENV':JSON.stringify('production'),'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_GENESIS_API_URL:'/api'})},
 build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/archives-capture-browser-check.tsx'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(value=>value.output):result.output,entry=output.find(value=>value.type==='chunk'&&value.isEntry);if(!entry)throw new Error('Missing archive capture entry');
const assets=new Map(output.map(value=>['/'+value.fileName,value.type==='chunk'?value.code:value.source])),styles=output.filter(value=>value.type==='asset'&&value.fileName.endsWith('.css'));
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'");
 if(request.method!=='GET'){response.writeHead(405).end();return;}const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>GENESIS synthetic archives</title>${styles.map(value=>`<link rel="stylesheet" href="/${value.fileName}">`).join('')}<style>body{max-width:900px;margin:24px auto;padding:0 16px;font:16px system-ui}pre{white-space:pre-wrap;font:13px ui-monospace}</style></head><body><div id="root"></div><pre id="result">Starting</pre><script type="module" src="/${entry.fileName}"></script></body></html>`);return;}
 if(path==='/favicon.ico'){response.writeHead(204).end();return;}
 if(assets.has(path)){response.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');response.end(assets.get(path));return;}response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true,entry:entry.fileName,sha256:createHash('sha256').update(entry.code).digest('hex')})));
