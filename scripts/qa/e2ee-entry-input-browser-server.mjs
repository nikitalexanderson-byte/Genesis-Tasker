// Loopback-only public synthetic cryptographic audit. No arbitrary file serving.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const paths=['app/e2ee/keys.ts','app/e2ee/device-vault.ts','app/e2ee/directory.ts','app/e2ee/envelope.ts','app/e2ee/commands.ts','app/e2ee/storage.ts',
 'scripts/qa/e2ee-entry-input-browser-check.ts','scripts/qa/e2ee-entry-input-browser-server.mjs','tests/fixtures/e2ee/v1-runtime.json','pnpm-lock.yaml','app/e2ee/personal-device-entry.ts','app/e2ee/personal-device-target.ts','app/e2ee/product-session.ts','app/e2ee/scope-setup.ts'];
const hashes=()=>paths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')}));
const inputs=hashes();
const result=await build({configFile:false,root,logLevel:'warn',build:{write:false,minify:false,target:'es2022',
 lib:{entry:resolve(root,'scripts/qa/e2ee-entry-input-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output;
const script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Audit entry not built');
if(JSON.stringify(inputs)!==JSON.stringify(hashes()))throw new Error('Audit input changed while bundling');
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'");
 if(request.method!=='GET'){response.writeHead(405).end();return;}
 const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS internal key audit</title><h1>Synthetic internal key audit</h1><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/favicon.ico'){response.writeHead(204).end();return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
 if(path==='/runtime.json'){response.setHeader('Content-Type','application/json');response.end(readFileSync(resolve(root,'tests/fixtures/e2ee/v1-runtime.json')));return;}
 if(path==='/inputs.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({inputs,unchanged:JSON.stringify(inputs)===JSON.stringify(hashes()),synthetic:true}));return;}
 response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
