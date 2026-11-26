// Owned loopback only. Synthetic signed lease transport, no production account.
import http from 'node:http';
import {build} from 'vite';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyE2eeCommand,e2eeCommandHash} from '../../app/e2ee/commands.ts';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/streamed-planning-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;
if(!script)throw new Error('Synthetic browser entry missing');
const actors=new Map(),receipts=new Map(),sourceHash=createHash('sha256').update('SYNTHETIC STREAMED SOURCE').digest('base64url');
const server=http.createServer(async(request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
 const path=new URL(request.url,'http://localhost').pathname;
 const json=(value,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
 try{
  if(request.method==='GET'&&path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS streamed preparation</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
  if(request.method==='GET'&&path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
  if(request.method==='GET'&&path==='/source.json'){json({sourceHash});return;}
  if(request.method==='POST'&&['/actor','/lease'].includes(path)){
   let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>128*1024)throw new Error('SYNTHETIC_REQUEST_LIMIT');chunks.push(chunk);}
   const raw=Buffer.concat(chunks).toString('utf8'),value=JSON.parse(raw);
   if(path==='/actor'){
    if(actors.has(value.ownerId))throw new Error('SYNTHETIC_ACTOR_EXISTS');
    actors.set(value.ownerId,{deviceId:value.deviceId,scopeId:value.scopeId,signer:await crypto.subtle.importKey('spki',Buffer.from(value.signingKey,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']),fence:1});json({registered:true});return;
   }
   const actor=actors.get(value.command.ownerId);if(!actor)throw new Error('SYNTHETIC_ACTOR_MISSING');
   const command=await verifyE2eeCommand(value,actor.signer),hash=await e2eeCommandHash(command);
   if(command.deviceId!==actor.deviceId||command.scopeId!==actor.scopeId||command.payload.sourceHash!==sourceHash)throw new Error('SYNTHETIC_ACTOR_BINDING');
   const old=receipts.get(command.operationId);if(old){if(old.hash!==hash||old.raw!==raw)throw new Error('SYNTHETIC_REPLAY_CHANGED');json(old.result);return;}
   let result;if(command.action==='migration-start')result={fence:actor.fence,generation:2,leaseUntil:Math.floor(Date.now()/1000)+3600};
   else if(command.action==='migration-resume'){if(command.payload.fence!==actor.fence)throw new Error('SYNTHETIC_FENCE');result={fence:++actor.fence,generation:2,leaseUntil:Math.floor(Date.now()/1000)+3600,pendingReceipt:null};}
   else throw new Error('SYNTHETIC_NO_UPLOAD_OR_ACTIVATION');
   receipts.set(command.operationId,{hash,raw,result});json(result);return;
  }
  response.writeHead(path==='/favicon.ico'?204:404).end();
 }catch{json({error:'SYNTHETIC_LEASE_REFUSED'},400);}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
