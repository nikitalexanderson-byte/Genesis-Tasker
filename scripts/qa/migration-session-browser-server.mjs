// Generated loopback account/lease/legacy responses only. No production data.
import http from 'node:http';
import {build} from 'vite';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyE2eeCommand,e2eeCommandHash} from '../../app/e2ee/commands.ts';
const root=resolve(import.meta.dirname,'../..');
const result=await build({root,configFile:false,logLevel:'warn',define:{'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/api'),'process.env.NEXT_PUBLIC_GENESIS_BASE_PATH':JSON.stringify(''),'process.env.NEXT_PUBLIC_GENESIS_MINDMAPS':JSON.stringify('false'),'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,target:'es2022',lib:{entry:resolve(root,'scripts/qa/migration-session-browser-check.ts'),formats:['es'],fileName:'check'},rolldownOptions:{output:{codeSplitting:false}}}});
const output=Array.isArray(result)?result.flatMap(row=>row.output):result.output,script=output.find(row=>row.type==='chunk'&&row.isEntry)?.code;
if(!script)throw new Error('Synthetic browser entry missing');
const actors=new Map(),receipts=new Map(),reads=[],sourceHash=createHash('sha256').update('SYNTHETIC OWNED SOURCE').digest('base64url');let mode='normal';
const actions=new Set(['legacy-workspace','legacy-aurora','legacy-stoicheion','legacy-advice','legacy-tasks','legacy-diary','legacy-mindmaps','legacy-physis','legacy-reminders','legacy-archives']);
const server=http.createServer(async(request,response)=>{
 response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
 const url=new URL(request.url,'http://localhost'),path=url.pathname;
 const json=(value,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
 try{
  if(request.method==='GET'){
   if(path==='/'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><html><title>GENESIS owned migration capture</title><pre id="result">Running</pre><script type="module" src="/check.js"></script></html>');return;}
   if(path==='/check.js'){response.setHeader('Content-Type','text/javascript');response.end(script);return;}
   if(path==='/api/session'){json({user:{uid:'session-browser-owner'},csrf:'synthetic-session-csrf',loginId:'synthetic-owned-capture'});return;}
   if(path==='/source.json'){json({sourceHash});return;}
   if(path==='/metrics.json'){json({reads});return;}
   if(path==='/control'){const next=url.searchParams.get('mode');if(!['normal','duplicate','http-error','directory-error'].includes(next))throw new Error('SYNTHETIC_MODE');mode=next;json({});return;}
  }
  if(request.method==='POST'&&['/actor','/lease','/api/e2ee/v1/read'].includes(path)){
   let size=0;const chunks=[];for await(const bytes of request){size+=bytes.length;if(size>128*1024)throw new Error('SYNTHETIC_REQUEST_LIMIT');chunks.push(bytes);}
   const raw=Buffer.concat(chunks).toString('utf8'),value=JSON.parse(raw);
   if(path==='/actor'){
    if(value.ownerId!=='session-browser-owner'||actors.has(value.ownerId))throw new Error('SYNTHETIC_ACTOR');
    actors.set(value.ownerId,{deviceId:value.deviceId,scopeId:value.scopeId,directoryRevision:value.directoryRevision,checkpointHash:value.checkpointHash,
     signer:await crypto.subtle.importKey('spki',Buffer.from(value.signingKey,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']),fence:1});json({registered:true});return;
   }
   const actor=actors.get(value.command.ownerId);if(!actor)throw new Error('SYNTHETIC_ACTOR_MISSING');
   const command=await verifyE2eeCommand(value,actor.signer),hash=await e2eeCommandHash(command);
   if(command.deviceId!==actor.deviceId||command.scopeId!==actor.scopeId||command.expectedRevision!==actor.directoryRevision||command.checkpointHash!==actor.checkpointHash||command.payload.sourceHash!==sourceHash)throw new Error('SYNTHETIC_ACTOR_BINDING');
   if(path==='/lease'){
    const old=receipts.get(command.operationId);if(old){if(old.hash!==hash||old.raw!==raw)throw new Error('SYNTHETIC_REPLAY_CHANGED');json(old.result);return;}
    let reply;if(command.action==='migration-start')reply={fence:actor.fence,generation:2,leaseUntil:Math.floor(Date.now()/1000)+3600};
    else if(command.action==='migration-resume'){if(command.payload.fence!==actor.fence)throw new Error('SYNTHETIC_FENCE');reply={fence:++actor.fence,generation:2,leaseUntil:Math.floor(Date.now()/1000)+3600,pendingReceipt:null};}
    else throw new Error('SYNTHETIC_NO_UPLOAD_OR_ACTIVATION');
    receipts.set(command.operationId,{hash,raw,result:reply});json(reply);return;
   }
   if(request.headers['x-csrf-token']!=='synthetic-session-csrf'||!actions.has(command.action)||command.payload.fence!==actor.fence)throw new Error('SYNTHETIC_READ_BINDING');
   response.setHeader('Content-Type','application/json; charset=utf-8');const digest=createHash('sha256');let count=0;
   const write=bytes=>{digest.update(bytes);count+=bytes.length;response.write(bytes);};
   if(mode==='duplicate'){write(Buffer.from('\ufeff {"rows":"first", "rows":"second"}\r\n'));}
   else if(mode==='http-error'){response.statusCode=409;write(Buffer.from(' {"error":"E2EE_SOURCE_CHANGED"}\r\n'));}
   else{
    const prefix=Buffer.from('\ufeff {\r\n"checkpointHash":'+JSON.stringify(actor.checkpointHash)+',"directoryRevision":'+(actor.directoryRevision+(mode==='directory-error'?1:0))+',"rows":[],"private":"SYNTHETIC ORIGINAL α😀');
    write(prefix);const block=Buffer.alloc(65536,97),size=reads.length===0?2*1024*1024+7:17;
    for(let at=0;at<size;at+=block.length)write(block.subarray(0,Math.min(block.length,size-at)));write(Buffer.from('"}\r\n'));
   }
   reads.push({operationId:command.operationId,action:command.action,rawHash:digest.digest('base64url'),size:count,status:response.statusCode});response.end();return;
  }
  response.writeHead(path==='/favicon.ico'?204:404).end();
 }catch{json({error:'SYNTHETIC_CAPTURE_REFUSED'},400);}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,synthetic:true})));
