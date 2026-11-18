// Loopback-only resources built from the real panel and explicit synthetic data.
import http from 'node:http';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const result=await build({configFile:false,root,logLevel:'warn',plugins:[react()],define:{
  'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),
  'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify(''),
  'process.env.NODE_ENV':JSON.stringify('production'),
},build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/backup-journal-browser.tsx'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output;
const entry=output.find(row=>row.type==='chunk'&&row.isEntry),styles=output.filter(row=>row.type==='asset'&&row.fileName.endsWith('.css'));
if(!entry)throw new Error('Missing synthetic backup entry');
const assets=new Map(output.map(row=>['/'+row.fileName,row.type==='chunk'?row.code:row.source]));
for(const name of ['latin','latin-ext','cyrillic','cyrillic-ext','greek','greek-ext','vietnamese']){
  const path=`/fonts/experimental/Inter-${name}.woff2`;assets.set(path,readFileSync(resolve(root,'public'+path)));
}
http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'");
  const path=new URL(request.url,'http://localhost').pathname;
  if(request.method!=='GET'){response.writeHead(405).end();return;}
  if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>GENESIS synthetic backup recovery</title>${styles.map(row=>`<link rel="stylesheet" href="/${row.fileName}">`).join('')}</head><body><div id="root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`);return;}
  if(path==='/favicon.ico'){response.writeHead(204).end();return;}
  if(assets.has(path)){response.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':'text/javascript');response.end(assets.get(path));return;}
  response.writeHead(404).end();
}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({url:`http://127.0.0.1:${this.address().port}/`,synthetic:true}));});
