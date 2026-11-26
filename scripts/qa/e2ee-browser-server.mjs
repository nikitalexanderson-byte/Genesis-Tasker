// Loopback-only fixture server: no repository directory listing or production account access.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const compiledModule=ts.transpileModule(readFileSync(resolve(root,'app/e2ee/envelope.ts'),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const server=http.createServer((request,response)=>{
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
  const path=new URL(request.url,'http://localhost').pathname;
  if(request.method!=='GET'){response.writeHead(405).end();return;}
  if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(
    '<!doctype html><html lang="en"><title>GENESIS synthetic E2EE contract check</title><main><h1>GENESIS synthetic E2EE contract</h1><pre id="result">Running</pre></main><script type="module" src="/check.js"></script></html>');return;}
  if(path==='/envelope.js'){response.setHeader('Content-Type','text/javascript');response.end(compiledModule);return;}
  if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(readFileSync(resolve(root,'scripts/qa/e2ee-browser-check.mjs')));return;}
  const fixtures={'/fixture.json':'tests/fixtures/e2ee/v1.json','/jca.json':'tests/fixtures/e2ee/v1-jca.json'};
  if(Object.hasOwn(fixtures,path)&&existsSync(resolve(root,fixtures[path]))){
    response.setHeader('Content-Type','application/json');response.end(readFileSync(resolve(root,fixtures[path])));return;
  }
  response.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
