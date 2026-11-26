import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createSecureContext,TLSSocket} from 'node:tls';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sealBackup,newBackupRecoveryKey} from '../../app/backup-format.ts';
import {resolveBackendPhp,backendPhpEnvironment} from './backend-php.mjs';
import {cleanupBackendRuntime} from './backend-cleanup.mjs';
import {waitForQaBackend} from './backend-ready.mjs';

const root=process.cwd(),args=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,'').split('=');return[key,rest.join('=')];}));
const runId=args['run-id']??'drive-provider-'+Date.now();assert(/^[a-zA-Z0-9-]{6,80}$/.test(runId));
const output=path.resolve(args.output??`output/qa/${runId}`);assert(!existsSync(output),'Fresh output required');mkdirSync(output,{recursive:true});
const runtime=path.join(output,'runtime'),php=await resolveBackendPhp(args.php);
const report={synthetic:true,scope:'real PHP HTTP/SQLite/cURL + isolated TLS Google simulator',status:'RUNNING',checks:[],providerCalls:[],networkPolicy:'CONNECT allowlist terminates locally; no upstream forwarding; no live credentials',sources:[]};
for(const file of ['scripts/qa/drive-provider-http.mjs','scripts/qa/backend-fixture.php','server/src/private-drive.php','app/backup-format.ts'])report.sources.push({path:file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
const save=()=>writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
const check=async(name,action)=>{try{await action();report.checks.push({name,status:'PASS'});console.log('PASS Drive '+name);save();}catch(error){report.checks.push({name,status:'FAIL',error:error.message});throw error;}};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const sockets=new Set(),ownedFiles=new Map(),uploads=new Map();let api,proxy,provider,sub,mode='',generated=0;
const metadata=row=>({id:row.metadata.id,size:String(Buffer.byteLength(row.file)),spaces:['appDataFolder'],appProperties:row.metadata.appProperties,createdTime:'2026-11-24T00:00:00Z',trashed:false});
try{
 const cert=path.join(output,'qa-cert.pem'),key=path.join(output,'qa-key.pem');
 const openssl=args.openssl??'C:/Program Files/Git/usr/bin/openssl.exe';
 const certificate=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,'-subj','/CN=GENESIS isolated Drive QA','-addext','subjectAltName=DNS:www.googleapis.com,DNS:oauth2.googleapis.com,DNS:openidconnect.googleapis.com'],{windowsHide:true,stdio:'ignore'});
 assert.equal(certificate.status,0,'Create synthetic local TLS identity');
 provider=createServer(async(req,res)=>{
  try{
   const parts=[];for await(const part of req)parts.push(part);const body=Buffer.concat(parts),url=new URL(req.url,'https://'+req.headers.host);
   assert(['www.googleapis.com','oauth2.googleapis.com','openidconnect.googleapis.com'].includes(url.hostname));
   report.providerCalls.push({host:url.hostname,path:url.pathname,method:req.method,bytes:body.length});
   const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(url.hostname==='oauth2.googleapis.com')return json({access_token:'isolated-drive-access',refresh_token:'isolated-drive-refresh',expires_in:3600,scope:mode==='missing-scope'?'openid email':'openid email https://www.googleapis.com/auth/drive.appdata'});
   if(url.hostname==='openidconnect.googleapis.com')return json({sub:mode==='wrong-sub'?'isolated-foreign-owner':sub});
   if(mode==='one-401'){mode='';return json({error:{code:401}},401);}
   if(url.pathname==='/drive/v3/files/generateIds')return json({ids:['isolated_drive_file_'+(++generated)]});
   if(url.pathname==='/upload/drive/v3/files'&&url.searchParams.get('uploadType')==='multipart'){
    const boundary=/boundary=([^;]+)/.exec(req.headers['content-type'])?.[1];assert(boundary);
    const sections=body.toString('utf8').split('--'+boundary);assert.equal(sections.length,4);
    const metadata=JSON.parse(sections[1].slice(sections[1].indexOf('\r\n\r\n')+4).trim());
    const file=sections[2].slice(sections[2].indexOf('\r\n\r\n')+4,-2);assert(!ownedFiles.has(metadata.id));ownedFiles.set(metadata.id,{metadata,file});
    if(mode==='lost-upload-ack'){res.destroy();return;}return json({id:metadata.id},201);
   }
   if(url.pathname==='/upload/drive/v3/files'&&req.method==='POST'&&url.searchParams.get('uploadType')==='resumable'){
    const id=crypto.randomUUID();uploads.set(id,{metadata:JSON.parse(body),file:Buffer.alloc(0)});
    res.writeHead(200,{Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id='+id});return res.end();
   }
   if(url.pathname==='/upload/drive/v3/files'&&req.method==='PUT'){
    const row=uploads.get(url.searchParams.get('upload_id'));assert(row);const range=req.headers['content-range'];
    if(range.startsWith('bytes */')){res.writeHead(308,row.file.length?{Range:'bytes=0-'+(row.file.length-1)}:{});return res.end();}
    const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);assert(match);assert.equal(Number(match[1]),row.file.length);assert.equal(body.length,Number(match[2])-Number(match[1])+1);
    if(mode==='partial-resumable'){row.file=Buffer.concat([row.file,body.subarray(0,256*1024)]);return json({error:{code:503}},503);}
    row.file=Buffer.concat([row.file,body]);if(row.file.length===Number(match[3])){ownedFiles.set(row.metadata.id,{metadata:row.metadata,file:row.file.toString('utf8')});return json({id:row.metadata.id});}
    res.writeHead(308,{Range:'bytes=0-'+(row.file.length-1)});return res.end();
   }
   if(url.pathname==='/drive/v3/files'){
    if(mode==='redirect'){res.writeHead(302,{Location:'https://example.invalid/forbidden'});return res.end();}
    if(mode==='oversized-list'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(' '.repeat(600000));}
    const files=[...ownedFiles.values()].map(metadata);if(mode==='duplicate-list'&&files.length)files.push(files[0]);return json({files});
   }
   const id=url.pathname.slice('/drive/v3/files/'.length),row=ownedFiles.get(id);if(!row)return json({error:{code:404}},404);
   if(url.searchParams.get('alt')==='media'){res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(mode==='corrupt-readback'?row.file.slice(0,-1)+'!':row.file);}
   const meta=metadata(row);if(mode==='foreign-metadata')meta.appProperties={...meta.appProperties,owner:'0'.repeat(64)};return json(meta);
  }catch{res.writeHead(500);res.end('{"error":"ISOLATED_PROVIDER_FIXTURE"}');}
 });
 const secureContext=createSecureContext({key:readFileSync(key),cert:readFileSync(cert)});
 proxy=createServer((_req,res)=>{res.writeHead(403);res.end();});
 proxy.on('connect',(req,socket,head)=>{
  if(!/^(?:www|oauth2|openidconnect)\.googleapis\.com:443$/.test(req.url)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)socket.unshift(head);
  const secure=new TLSSocket(socket,{isServer:true,secureContext});sockets.add(secure);secure.on('error',()=>secure.destroy());secure.on('close',()=>sockets.delete(secure));provider.emit('connection',secure);
 });
 const proxyPort=await listen(proxy),portProbe=createServer();const apiPort=await listen(portProbe);await new Promise(resolve=>portProbe.close(resolve));
 const origin='http://127.0.0.1:'+apiPort;
 const setup=spawnSync(php,['scripts/qa/backend-fixture.php','--dir='+runtime,'--origin='+origin,'--run-id='+runId,'--drive','--backup'],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(setup.status,0,'Prepare owned backend fixture');
 sub='synthetic-qa-'+runId+'-business';
 // The same Google sub that backend-fixture.php places in its synthetic user.
 const users=JSON.parse(readFileSync(path.join(runtime,'users.json'),'utf8'));assert.equal(users.users.business.id,'qa-'+runId+'-business');
 const startApi=async()=>{api=spawn(php,['-d','curl.cainfo='+cert,'-d','disable_functions=mail','-S','127.0.0.1:'+apiPort,'scripts/qa/backend-router.php'],{cwd:root,windowsHide:true,env:{...process.env,...backendPhpEnvironment(php),HTTPS_PROXY:'http://127.0.0.1:'+proxyPort,https_proxy:'http://127.0.0.1:'+proxyPort,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',GENESIS_FULL_QA:'isolated',GENESIS_FULL_QA_DIR:runtime.replaceAll('\\','/')},stdio:'ignore'});await waitForQaBackend(api,origin,runId);};
 const restartApi=async()=>{const stopped=new Promise(resolve=>api.once('close',resolve));api.kill();await stopped;await startApi();report.backendRestarts=(report.backendRestarts??0)+1;};
 await startApi();
 const cookies=new Map();let csrf='',owner='';
 const request=async(route,body,extra={})=>{
  const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),Origin:origin,'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...(owner?{'X-Genesis-Account-Id':owner}:{}),...extra},...body===undefined?{}:{body:JSON.stringify(body)}});
  for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const value=await response.json();return{status:response.status,value};
 };
 assert.equal((await request('qa/login?tier=business')).status,200);const sessionReply=await request('session'),session=sessionReply.value;assert.equal(sessionReply.status,200);assert(session.user,'Synthetic session: '+String(session.error??'missing user'));csrf=session.csrf;owner=session.user.uid;
 const call=(route,body)=>request('private-drive/v1/'+route,body);
 const connect=async()=>{const begun=await call('connect',{consentVersion:'encrypted-drive-backup-336-v1'});assert.equal(begun.status,200);const authorized=await call('authorize',{attemptId:begun.value.attemptId,serverAuthCode:'isolated-server-code'});return{...authorized,attemptId:begun.value.attemptId};};
 await check('wrong primary account cannot establish a connection',async()=>{mode='wrong-sub';const result=await connect();assert.equal(result.value.error,'DRIVE_ACCOUNT_MISMATCH');mode='';});
 await check('missing Drive scope cannot establish a connection',async()=>{mode='missing-scope';const result=await connect();assert.equal(result.value.error,'DRIVE_AUTH_STALE');mode='';});
 let connection;
 await check('actual HTTP authorize binds identity and consumes the attempt',async()=>{const result=await connect();assert.equal(result.status,200,JSON.stringify(result.value));connection=result.value.connectionId;assert(connection);assert.equal((await call('authorize',{attemptId:result.attemptId,serverAuthCode:'isolated-server-code'})).value.error,'DRIVE_AUTH_STALE');});
 const backupId=crypto.randomUUID(),file=await sealBackup({schema:1,backupId,source:'device_snapshot',ownerId:owner,createdAt:new Date().toISOString(),client:'web',billingEvidence:null,sections:[]},newBackupRecoveryKey());
 const operation={connectionId:connection,operationId:crypto.randomUUID(),backupId,sha256:createHash('sha256').update(file).digest('hex'),bytes:Buffer.byteLength(file)};
 let prepared;
 await check('prepared file ID and exact retry survive a real backend process restart',async()=>{prepared=await call('prepare',operation);assert.equal(prepared.status,200);await restartApi();assert.deepEqual(await call('prepare',operation),prepared);assert.equal(generated,1);});
 await check('commit requires full provider metadata and byte-exact downloaded ciphertext',async()=>{const result=await call('commit',{...operation,file});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.verified,true);assert.equal(ownedFiles.size,1);assert.deepEqual(await call('commit',{...operation,file}),result);assert.equal(ownedFiles.size,1);});
 await check('clean local journal can discover and download the provider copy',async()=>{const listed=await call('list',{connectionId:connection,pageToken:null});assert.equal(listed.status,200);assert.equal(listed.value.files.length,1);assert.equal((await call('download',{connectionId:connection,fileId:prepared.value.fileId})).value.file,file);});
 await check('corrupt provider bytes refuse download',async()=>{mode='corrupt-readback';const result=await call('download',{connectionId:connection,fileId:prepared.value.fileId});assert.equal(result.value.error,'DRIVE_READBACK_FAILED');mode='';});
 await check('foreign provider metadata refuses download',async()=>{mode='foreign-metadata';const result=await call('download',{connectionId:connection,fileId:prepared.value.fileId});assert.equal(result.value.error,'DRIVE_FILE_CHANGED');mode='';});
 await check('duplicate provider list refuses rather than losing an object',async()=>{mode='duplicate-list';assert.equal((await call('list',{connectionId:connection,pageToken:null})).value.error,'DRIVE_FILE_CHANGED');mode='';});
 await check('changed immutable operation and wrong owner refuse',async()=>{const changed=await call('prepare',{...operation,sha256:'0'.repeat(64)});assert.equal(changed.value.error,'DRIVE_IDEMPOTENCY_CONFLICT');const other=await request('private-drive/v1/status',undefined,{'X-Genesis-Account-Id':'foreign'});assert.equal(other.value.error,'E2EE_ACCOUNT_CHANGED');});
 await check('401 refresh preserves the same connected owner',async()=>{const before=report.providerCalls.filter(row=>row.host==='oauth2.googleapis.com').length;mode='one-401';assert.equal((await call('list',{connectionId:connection,pageToken:null})).status,200);assert.equal(report.providerCalls.filter(row=>row.host==='oauth2.googleapis.com').length,before+1);});
 await check('provider redirect and oversized response fail within the allowed endpoint',async()=>{for(const failure of ['redirect','oversized-list']){mode=failure;const result=await call('list',{connectionId:connection,pageToken:null});assert(result.status>=400);assert.equal(typeof result.value.error,'string');}mode='';});
 const artifact=async(data)=>{const backupId=crypto.randomUUID(),createdAt=new Date().toISOString(),file=await sealBackup({schema:1,backupId,source:'device_snapshot',ownerId:owner,createdAt,client:'web',billingEvidence:null,sections:data?[{id:'workspace',source:'device',completeness:'available',capturedAt:createdAt,revision:null,count:1,pending:0,notices:[],data:{synthetic:data}}]:[]},newBackupRecoveryKey());return{file,operation:{connectionId:connection,operationId:crypto.randomUUID(),backupId,sha256:createHash('sha256').update(file).digest('hex'),bytes:Buffer.byteLength(file)}};};
 await check('lost upload ACK retries the allocated file without another create',async()=>{const item=await artifact(),prepared=await call('prepare',item.operation);assert.equal(prepared.status,200);const before=generated,creates=report.providerCalls.filter(row=>row.path==='/upload/drive/v3/files'&&row.method==='POST').length;mode='lost-upload-ack';assert((await call('commit',{...item.operation,file:item.file})).status>=400);mode='';const result=await call('commit',{...item.operation,file:item.file});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(generated,before);assert.equal(report.providerCalls.filter(row=>row.path==='/upload/drive/v3/files'&&row.method==='POST').length,creates+1);});
 await check('resumable retry after backend death reads accepted offset and sends exact remaining bytes',async()=>{const item=await artifact('X'.repeat(4*1024*1024));assert(item.operation.bytes>5*1024*1024);assert.equal((await call('prepare',item.operation)).status,200);mode='partial-resumable';assert((await call('commit',{...item.operation,file:item.file})).status>=400);mode='';await restartApi();const result=await call('commit',{...item.operation,file:item.file});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.verified,true);assert.equal(uploads.size,1);assert.equal(ownedFiles.get(result.value.fileId).file,item.file);report.resumable={bytes:item.operation.bytes,acceptedPrefix:256*1024,providerSessions:1,byteExact:true};});
 await check('oversized declared archive refuses before provider allocation',async()=>{const before=generated;assert.equal((await call('prepare',{...operation,operationId:crypto.randomUUID(),bytes:24*1024*1024+1})).value.error,'DRIVE_INVALID');assert.equal(generated,before);});
 await check('disconnect retires old intents without deleting provider files',async()=>{const count=ownedFiles.size;assert.equal((await call('disconnect',{connectionId:connection})).status,200);assert.equal(ownedFiles.size,count);assert.equal((await call('prepare',operation)).value.error,'DRIVE_CONNECTION_CHANGED');assert(!report.providerCalls.some(row=>row.method==='DELETE'));});
 report.status='PASS';report.limitations=['Google provider is modeled behind an isolated TLS proxy; no real Google OAuth UI, production credentials, device, live account or provider payment used.','Actual backend restart after prepare and partial provider upload; not every crash boundary, native process death/SAF, maximum-size artifact or full product UI acceptance.'];
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{
 if(api&&api.exitCode===null&&!api.killed){const stopped=new Promise(resolve=>api.once('close',resolve));api.kill();await stopped;}
 for(const socket of sockets)socket.destroy();if(proxy)await new Promise(resolve=>proxy.close(resolve));if(provider)provider.close();
 if(existsSync(path.join(runtime,'owner.json')))report.cleanup=cleanupBackendRuntime(runtime,output);
 save();
}
