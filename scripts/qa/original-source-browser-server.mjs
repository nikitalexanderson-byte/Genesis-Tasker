// Owned loopback fixtures only. Never serves the unused public old private key.
import http from 'node:http';
import {build} from 'vite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/original-source-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;if(!script)throw new Error('Synthetic entry missing');
const server=http.createServer((request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
 if(request.method!=='GET'){response.writeHead(405).end();return;}const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS original source</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
 if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}if(path==='/favicon.ico'){response.writeHead(204).end();return;}
 if(path==='/web.json'||path==='/native.json')try{
  const file=path==='/web.json'?'tests/fixtures/e2ee/source-stage-web-v1.json':'output/release-3.3.6/runtime/original-source-native-api34-vector-01.json',raw=readFileSync(resolve(root,file));if(raw.length>256*1024)throw new Error('Synthetic fixture limit');
  let value=JSON.parse(raw);if(path==='/web.json'){const{ownerId,scopeId,deviceId,generation,cryptoEpoch,securityEpoch,keyId}=value.scope;
   value={synthetic:true,original:{ownerId,scopeId,deviceId,generation,cryptoEpoch,securityEpoch},keyId,rootKey:value.rootKey,publicKeySpki:value.publicKeySpki,target:value.target,reference:value.reference,
    paths:value.expectedPaths.map(row=>({id:row.id,plaintext:row.bytes})),records:value.records};}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));
 }catch{response.writeHead(503).end('Synthetic fixture unavailable');}else response.writeHead(404).end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
