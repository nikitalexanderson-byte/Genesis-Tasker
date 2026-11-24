// Actual WebCrypto/HPKE scope clients against the migrated PHP/SQLite store.
// The CLI fixture supplies identities and the pre-migration legacy roster only.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRecoveryKit,freshSecret,publicDeviceKeys,sealRoot,openRoot,forwardRoot} from '../../app/e2ee/keys.ts';
import {UnlockedWebDevice} from '../../app/e2ee/device-vault.ts';
import {E2eeScopeClient} from '../../app/e2ee/scope-client.ts';
import {signE2eeCommand} from '../../app/e2ee/commands.ts';
import {verifyDeviceDirectory} from '../../app/e2ee/directory.ts';
import {deviceAccessProofBytes} from '../../app/e2ee/device-access-contract.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot} from '../../app/e2ee/envelope.ts';
import {sealE2eeFile,envelopePayloadHash} from '../../app/e2ee/files.ts';
import {membershipAtomicPlanHash,membershipAtomicChangeHash,membershipAtomicPageRef,membershipAtomicBatchHash} from '../../app/e2ee/membership-atomic-contract.ts';
import {validateMembershipAtomicReceipt} from '../../app/e2ee/membership-atomic-receipts.ts';
import {InvitationRecipient,validateRecipientRequest} from '../../app/e2ee/invitation-recipient.ts';
import {invitationAdmissionPage} from '../../app/e2ee/invitation-admission.ts';
import {sharedInvitationService,verifySharedInvitationResult} from '../../app/e2ee/shared-invitation-request.ts';
import {E2eeDeviceDocument} from '../../app/e2ee/device-document.ts';
import {resolveBackendPhp} from './backend-php.mjs';
import {cleanupBackendRuntime} from './backend-cleanup.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,'').split('=');return[key,rest.join('=')];}));
const id=args['run-id']??`membership-clients-${Date.now()}`;
const scenario=args.scenario??'existing-member';assert(['existing-member','admission'].includes(scenario),'Known focused scenario required');
assert.match(id,/^[a-zA-Z0-9-]{6,80}$/);
const output=path.resolve(root,args.output??`output/qa/${id}`);assert(!existsSync(output),'Fresh output required');mkdirSync(output,{recursive:true});
const runtime=path.join(output,'runtime'),php=await resolveBackendPhp(args.php);
const report={status:'RUNNING',scope:'Real PHP/SQLite store + WebCrypto/HPKE production scope clients; synthetic in-memory encrypted device storage',checks:[],limitations:['CLI transport does not cover HTTP/session middleware or rate policy','Legacy identities/ACL are synthetic setup; no real provider or user data','Newcomer is an existing workspace member enrolling their first trusted device; this is not the invitation/owner-review UI'],sourceSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')};
const save=()=>writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
report.scenario=scenario;
if(scenario==='admission')report.limitations[2]='Actual new recipient invitation/consent/atomic admission/device approval, with CLI transport and in-memory encrypted vault; not owner-review or invitation UI';
const run=(script,input)=>{
 const result=spawnSync(php,['-d','disable_functions=curl_exec,mail',script,`--dir=${runtime}`],{cwd:root,input:JSON.stringify(input),encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
 if(result.status!==0)writeFileSync(path.join(output,'store-failure.log'),result.stderr);
 assert.equal(result.status,0,`Synthetic PHP helper failed (${script}); see store-failure.log`);
 const response=JSON.parse(result.stdout);if(!response.ok){report.lastRefusal={action:input.action,command:input.body?.command?.action??null,code:response.error};throw new Error(response.error);}return response.value;
};
const store=(action,body={},actor='business',scopeId='')=>run('scripts/qa/membership-client-store.php',{action,body,actor,scopeId});
class Records {
 rows=new Map();async get(id){return structuredClone(this.rows.get(id)??null);}async list(prefix){return[...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){signal?.throwIfAborted();for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);const next=new Map(this.rows);for(const row of changes)if(row.value===null)next.delete(row.key);else next.set(row.key,structuredClone(row.value));this.rows=next;}
}
class Keys {rows=new Map();async get(id){return structuredClone(this.rows.get(id)??null);}async create(id,bundle){assert(!this.rows.has(id));this.rows.set(id,{serial:1,bundle:structuredClone(bundle)});}}
const devices=[],secrets=[],scopeRoots=new Map(),clients=new Map();let owner,setup;
const check=async(name,work)=>{try{await work();report.checks.push({name,status:'PASS'});console.log('PASS '+name);save();}catch(error){report.checks.push({name,status:'FAIL',error:error.message});throw error;}};
const makeDevice=async userId=>{const authority=await createRecoveryKit(userId);secrets.push(authority.secret);const storage=new Records(),keyStorage=new Keys(),device=await UnlockedWebDevice.provision(userId,authority.secret,authority.kit,storage,keyStorage);devices.push(device);return{device,authority,storage,keyStorage};};
const directory=async(scopeId,actor='business')=>verifyDeviceDirectory(setup.ownerId,scopeId,owner.authority.kit.authority,store('directory',{},actor,scopeId).events);
const signed=async(scopeId,action,payload,actor='business',device=owner.device)=>{
 const frame=await directory(scopeId,actor);return signE2eeCommand({protocol:1,ownerId:setup.ownerId,scopeId,deviceId:device.deviceId,action,expectedRevision:frame.checkpoint.revision,checkpointHash:frame.checkpoint.hash,securityEpoch:frame.securityEpoch,operationId:crypto.randomUUID(),payload},device.keys().signing.privateKey);
};
const transport=actor=>({directory:async scopeId=>store('directory',{},actor,scopeId),command:async packet=>store('command',packet,actor),read:async packet=>store('read',packet,actor)});
const scopeClient=(device,scopeId,actor='business')=>new E2eeScopeClient(device,setup.ownerId,scopeId,owner.authority.kit.authority,transport(actor));
const send=async(scopeId,action,payload)=>store('command',await signed(scopeId,action,payload));
const text=value=>new TextDecoder().decode(value.bytes);

async function seedScope(kind,resourceId) {
 const scopeId=kind+':'+resourceId,rootBytes=freshSecret(),keyId=crypto.randomUUID();secrets.push(rootBytes);scopeRoots.set(scopeId,{bytes:rootBytes,keyId,epoch:1});
 const context={ownerId:setup.ownerId,scopeId,cryptoEpoch:1,keyId};
 const command={protocol:1,ownerId:setup.ownerId,scopeId,deviceId:owner.device.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{kind,resourceId,keyId,generation:1,recoveryKit:owner.authority.kit,recoveryCapsule:await sealRoot(rootBytes,owner.authority.kit.authority.receivingKey,{...context,recipientId:'recovery'}),deviceKeys:await publicDeviceKeys(owner.device.keys()),deviceCapsule:await sealRoot(rootBytes,(await publicDeviceKeys(owner.device.keys())).receivingKey,{...context,recipientId:owner.device.deviceId})}};
 command.payload.selfProof=(await signE2eeCommand(command,owner.device.keys().signing.privateKey)).signature;
 store('bootstrap',await signE2eeCommand(command,owner.authority.keys.signing.privateKey));
 const migrationId=crypto.randomUUID(),source=store('source',{},'business',scopeId),lease=await send(scopeId,'migration-start',{migrationId,sourceHash:source.sourceHash});
 let operation;
 if(kind!=='personal'){
  const frame=await directory(scopeId),objectId='product-version:'+crypto.randomUUID();
  const file=await sealE2eeFile(await importE2eeRoot(rootBytes),owner.device.keys().signing.privateKey,{cryptoProtocol:1,suite:E2EE_SUITE,ownerId:setup.ownerId,scopeId,domain:'shared-project',objectId,schemaVersion:1,dataGeneration:1,writerProtocol:9,cryptoEpoch:1,securityEpoch:frame.securityEpoch,revision:1,keyId,deviceId:owner.device.deviceId,operationId:crypto.randomUUID()},new TextEncoder().encode('SYNTHETIC ROOT '+resourceId),{filename:'root.json',mediaType:'application/json'});
  for(const envelope of [...file.chunks,file.manifest]){const packet=await signed(scopeId,'put',{envelope,expectedObjectRevision:0,migrationId,fence:lease.fence});store('command',await signE2eeCommand({...packet.command,operationId:envelope.context.operationId},owner.device.keys().signing.privateKey));}
  const metadata=kind==='space'?{protocol:1}:{protocol:2,spaceId:setup.spaceId,parentProjectId:null,projectCategoryId:null,boardStatusId:null,projectType:'project',layout:'list',isInbox:resourceId===setup.inboxId,archived:false};
  operation={action:'create',entityId:scopeId,kind,expectedRevision:0,domain:'shared-project',objectId,payloadHash:await envelopePayloadHash(file.manifest),parentId:null,metadata,proposalId:null};
 }
 const manifest=store('manifest',{},'business',scopeId),verifiedCheckpoint=encodeE2eeBytes(freshSecret());
 await send(scopeId,'migration-verify',{migrationId,fence:lease.fence,...manifest,verifiedCheckpoint});
 await send(scopeId,'migration-commit',{migrationId,fence:lease.fence,manifestHash:manifest.manifestHash,objectCount:manifest.objectCount,verifiedCheckpoint,generation:1});
 if(operation){
  const bootstrapId=crypto.randomUUID();await send(scopeId,'product-bootstrap-start',{intentId:crypto.randomUUID(),bootstrapId,sourceManifestHash:manifest.manifestHash,expectedCount:1});
  const part=await send(scopeId,'product-bootstrap-stage',{intentId:crypto.randomUUID(),bootstrapId,partIndex:0,items:[{operation,authorId:setup.ownerId}]});
  await send(scopeId,'product-bootstrap-complete',{intentId:crypto.randomUUID(),bootstrapId,parts:[{partIndex:0,proofHash:part.proofHash}],expectedCount:1});
 }
 const client=scopeClient(owner.device,scopeId);await client.refresh();clients.set(scopeId,client);return client;
}

async function enroll(target,actor,scopeId,history=[]) {
 const keys=await publicDeviceKeys(target.device.keys()),challenge=store('challenge',{deviceId:target.device.deviceId,keys},actor,scopeId);
 const selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},target.device.keys().signing.privateKey,deviceAccessProofBytes(challenge))));
 const current=scopeRoots.get(scopeId),recipient={ownerId:setup.ownerId,scopeId,cryptoEpoch:current.epoch,keyId:current.keyId,recipientId:target.device.deviceId};
 const capsule=current.bytes?await sealRoot(current.bytes,keys.receivingKey,recipient):await forwardRoot(current.capsule,owner.authority.keys.receiving.privateKey,{...recipient,recipientId:'recovery'},keys.receivingKey,recipient);
 const historyCapsules=[];for(const old of history)historyCapsules.push({cryptoEpoch:old.epoch,keyId:old.keyId,capsule:await sealRoot(old.bytes,keys.receivingKey,{ownerId:setup.ownerId,scopeId,cryptoEpoch:old.epoch,keyId:old.keyId,recipientId:target.device.deviceId})});
 // The trusted owner signs; the requesting member delivers the packet under
 // the same session binding which obtained the one-time challenge.
 store('command',await signed(scopeId,'enroll',{challenge,selfProof,capsule,historyCapsules}),actor);
 const client=scopeClient(target.device,scopeId,actor);await client.refresh();return client;
}

// A separate personal authority is required for recipient consent. This is
// synthetic setup through real signed commands, not a membership grant.
async function seedRecipientPersonal(target,actor,userId){
 const scopeId='personal:'+userId,bytes=freshSecret(),keyId=crypto.randomUUID();secrets.push(bytes);
 const context={ownerId:userId,scopeId,cryptoEpoch:1,keyId},keys=await publicDeviceKeys(target.device.keys());
 const command={protocol:1,ownerId:userId,scopeId,deviceId:target.device.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{kind:'personal',resourceId:userId,keyId,generation:1,recoveryKit:target.authority.kit,recoveryCapsule:await sealRoot(bytes,target.authority.kit.authority.receivingKey,{...context,recipientId:'recovery'}),deviceKeys:keys,deviceCapsule:await sealRoot(bytes,keys.receivingKey,{...context,recipientId:target.device.deviceId})}};
 command.payload.selfProof=(await signE2eeCommand(command,target.device.keys().signing.privateKey)).signature;
 store('bootstrap',await signE2eeCommand(command,target.authority.keys.signing.privateKey),actor);
 const sendOwn=async(action,payload)=>{const frame=await verifyDeviceDirectory(userId,scopeId,target.authority.kit.authority,store('directory',{},actor,scopeId).events);return store('command',await signE2eeCommand({protocol:1,ownerId:userId,scopeId,deviceId:target.device.deviceId,action,expectedRevision:frame.checkpoint.revision,checkpointHash:frame.checkpoint.hash,securityEpoch:frame.securityEpoch,operationId:crypto.randomUUID(),payload},target.device.keys().signing.privateKey),actor);};
 const migrationId=crypto.randomUUID(),source=store('source',{},actor,scopeId),lease=await sendOwn('migration-start',{migrationId,sourceHash:source.sourceHash}),manifest=store('manifest',{},actor,scopeId),verifiedCheckpoint=encodeE2eeBytes(freshSecret());
 await sendOwn('migration-verify',{migrationId,fence:lease.fence,...manifest,verifiedCheckpoint});
 await sendOwn('migration-commit',{migrationId,fence:lease.fence,manifestHash:manifest.manifestHash,objectCount:manifest.objectCount,verifiedCheckpoint,generation:1});
 const client=new E2eeScopeClient(target.device,userId,scopeId,target.authority.kit.authority,transport(actor));await client.refresh();clients.set(scopeId,client);return client;
}

async function newRecipientAdmission(newcomer,personal,client,scopeId,oldRoot,oldText){
 const actor='premium4life',unapproved=scopeClient(newcomer.device,scopeId,actor);clients.set('unapproved-new-recipient',unapproved);
 await check('new recipient has neither workspace membership nor a usable shared device before invitation',async()=>{
  assert.throws(()=>store('directory',{},actor,scopeId),/SHARED_PROJECT_NOT_FOUND/);
  await assert.rejects(unapproved.refresh(),/SHARED_PROJECT_NOT_FOUND/);
 });
 const own=await seedRecipientPersonal(newcomer,actor,setup.newcomerId),current=()=>newcomer.device.requireOpen();
 const local=id=>new E2eeDeviceDocument(newcomer.device,'invitation-recipient:'+id,value=>validateRecipientRequest(value,setup.newcomerId,id),current);
 const recipient=new InvitationRecipient({ownerId:setup.newcomerId,current,page:(after,limit)=>own.readSharedInvitationPage(after,limit),state:id=>own.readSharedInvitationResponse(id),service:(payload,id)=>own.executeService('shared-invitation-respond',payload,id),load:id=>local(id).load(),save:async(id,value,expected)=>(await local(id).save(value,expected)).serial});
 const invitation=sharedInvitationService({scopeId,kind:'project',resourceId:setup.projectId,ownerId:setup.ownerId},setup.ownerId,'POST','invitations',{email:setup.newcomerEmail,role:'member'},crypto.randomUUID());
 const issued=await client.executeService(invitation.action,invitation.payload,invitation.intentId);
 verifySharedInvitationResult(invitation,setup.ownerId,issued,await client.readInvitationState(invitation.ids));const invitationId=invitation.ids[0];
 await check('recipient acceptance is durable and idempotent routing consent without content access',async()=>{
  assert((await recipient.list()).some(row=>row.id===invitationId));const accepted=await recipient.respond(invitationId,true);assert.equal(accepted.pendingApproval,true);assert.equal(accepted.admitted,false);assert.equal(accepted.deviceApprovalRequired,true);assert.deepEqual(await recipient.respond(invitationId,true),accepted);
  assert.throws(()=>store('directory',{},actor,scopeId),/SHARED_PROJECT_NOT_FOUND/);
 });
 const pending=invitationAdmissionPage(await client.readPendingInvitationPage(),''),operation=pending.operations.find(row=>row.invitationId===invitationId);
 assert(operation);assert.equal(operation.userId,setup.newcomerId);assert.equal(operation.resourceId,setup.projectId);
 const {plan,pages}=store('plan',{intentId:crypto.randomUUID(),operation}),planHash=membershipAtomicPlanHash(plan),changeHash=membershipAtomicChangeHash(plan),binding={intentId:plan.intentId,planHash};
 assert(plan.scopeIds.includes(scopeId));assert(plan.scopeIds.includes('space:'+setup.spaceId));
 const auth=(action,input)=>personal.authorizeMembershipAtomic(action,input);
 store('begin',{plan,authorization:await auth('membership-atomic-begin',binding)});
 for(const[index,page]of pages.entries())store('page',{...binding,phase:'plan',index,page,authorization:await auth('membership-atomic-page',{...binding,phase:'plan',index,pageHash:membershipAtomicPageRef(index,page).pageHash})});
 const preview=store('preview',{...binding,after:0,authorization:await auth('membership-atomic-preview',{...binding,after:0})});assert.equal(preview.next,null);assert.equal(preview.scopePlans.length,plan.scopeIds.length);
 const packets=[];for(const scope of preview.scopePlans){const source=clients.get(scope.scopeId);await source.refresh();packets.push(await source.prepareMembershipRotation(changeHash,scope.roles.map(({deviceId,role})=>({deviceId,role})),scope.manifest,scope));}
 const page={kind:'rotation-packets',items:packets},packetPages=[membershipAtomicPageRef(0,page)];
 store('page',{...binding,phase:'packets',index:0,page,authorization:await auth('membership-atomic-page',{...binding,phase:'packets',index:0,pageHash:packetPages[0].pageHash})});
 const batchHash=membershipAtomicBatchHash(plan,packetPages);store('seal',{...binding,packetPages,authorization:await auth('membership-atomic-seal',{...binding,batchHash})});
 const commit={...binding,batchHash,authorization:await personal.authorizeMembershipAtomicApply('membership-atomic-commit',{...binding,batchHash})},receipt=store('commit',commit);validateMembershipAtomicReceipt(receipt,plan,packetPages);
 await check('atomic owner admission changes membership once while the new device remains unapproved',async()=>{
  assert.deepEqual(store('commit',commit),receipt);for(const packet of packets){await clients.get(packet.command.scopeId).confirmMembershipRotation(packet);const p=packet.command.payload;scopeRoots.set(packet.command.scopeId,{capsule:p.recoveryCapsule,keyId:p.keyId,epoch:p.cryptoEpoch});assert(!p.capsules.some(row=>row.deviceId===newcomer.device.deviceId));}
  const accepted=await recipient.respond(invitationId,true);assert.equal(accepted.admitted,true);assert.equal(accepted.pendingApproval,false);assert.equal(accepted.deviceApprovalRequired,true);
  await assert.rejects(unapproved.refresh(),/E2EE_REVOKED_DEVICE/);
 });
 const futureText='CONTENT AFTER NEW RECIPIENT ADMISSION';await client.prepare('shared-project','admission-future',new TextEncoder().encode(futureText),0);await client.flush('shared-project','admission-future');
 const admitted=await enroll(newcomer,actor,scopeId,[oldRoot]);clients.set('admitted-recipient',admitted);
 await check('separate requester-bound device approval and explicit history grant open both epochs',async()=>{
  const past=await admitted.read('shared-project','client-history'),future=await admitted.read('shared-project','admission-future');assert.equal(text(past),oldText);assert.equal(text(future),futureText);past.bytes.fill(0);future.bytes.fill(0);
 });
 await check('new participant retains history after a cold encrypted-device unlock',async()=>{
  admitted.close();newcomer.device.lock();const device=await UnlockedWebDevice.unlock(setup.newcomerId,newcomer.authority.secret,newcomer.storage,newcomer.keyStorage);devices.push(device);const cold=scopeClient(device,scopeId,actor);try{await cold.refresh();const past=await cold.read('shared-project','client-history'),future=await cold.read('shared-project','admission-future');assert.equal(text(past),oldText);assert.equal(text(future),futureText);past.bytes.fill(0);future.bytes.fill(0);}finally{cold.close();}
 });
 report.admission={invitation:true,newMembership:true,separateDeviceApproval:true,explicitHistory:true,coldRead:true,rotatedScopes:plan.scopeIds.length};
}

try {
 const prepared=spawnSync(php,['-d','disable_functions=curl_exec,mail','scripts/qa/backend-fixture.php',`--dir=${runtime}`,'--origin=http://127.0.0.1:4380',`--run-id=${id}`,'--e2ee'],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(prepared.status,0,'Owned fixture preparation');
 setup=store('setup',{scenario});owner=await makeDevice(setup.ownerId);const member=await makeDevice(setup.memberId),newcomer=await makeDevice(setup.newcomerId);
 const personal=await seedScope('personal',setup.ownerId);
 for(const [kind,resource]of [['project',setup.projectId],['project',setup.inboxId],['space',setup.spaceId]])await seedScope(kind,resource);
 const scopeId='project:'+setup.projectId,client=clients.get(scopeId),oldRoot=scopeRoots.get(scopeId),oldText='RETAINED HISTORY BEFORE MEMBERSHIP CHANGE';
 await client.prepare('shared-project','client-history',new TextEncoder().encode(oldText),0);await client.flush('shared-project','client-history');
 if(scenario==='admission')await newRecipientAdmission(newcomer,personal,client,scopeId,oldRoot,oldText);
 else {
 const memberClient=await enroll(member,'premium',scopeId);
 await check('current member decrypts original shared history through the production scope reader',async()=>{const value=await memberClient.read('shared-project','client-history');assert.equal(text(value),oldText);value.bytes.fill(0);});
 const before=await directory(scopeId),pendingFile=await sealE2eeFile(await importE2eeRoot(oldRoot.bytes),member.device.keys().signing.privateKey,{cryptoProtocol:1,suite:E2EE_SUITE,ownerId:setup.ownerId,scopeId,domain:'shared-project',objectId:'removed-write',schemaVersion:1,dataGeneration:1,writerProtocol:9,cryptoEpoch:1,securityEpoch:before.securityEpoch,revision:1,keyId:oldRoot.keyId,deviceId:member.device.deviceId,operationId:crypto.randomUUID()},new TextEncoder().encode('DRAFT SIGNED BEFORE REVOCATION'),{filename:'draft.json',mediaType:'application/json'});
 const pendingPut=await signed(scopeId,'put',{envelope:pendingFile.chunks[0],expectedObjectRevision:0,migrationId:null,fence:0},'business',member.device);
 const oldSignedPut=await signE2eeCommand({...pendingPut.command,operationId:pendingFile.chunks[0].context.operationId},member.device.keys().signing.privateKey);
 const planData=store('plan',{intentId:crypto.randomUUID(),userId:setup.memberId}),{plan,pages}=planData,planHash=membershipAtomicPlanHash(plan),changeHash=membershipAtomicChangeHash(plan),binding={intentId:plan.intentId,planHash};
 const auth=(action,input)=>personal.authorizeMembershipAtomic(action,input);
 store('begin',{plan,authorization:await auth('membership-atomic-begin',binding)});
 for(const [index,page]of pages.entries())store('page',{...binding,phase:'plan',index,page,authorization:await auth('membership-atomic-page',{...binding,phase:'plan',index,pageHash:membershipAtomicPageRef(index,page).pageHash})});
 const preview=store('preview',{...binding,after:0,authorization:await auth('membership-atomic-preview',{...binding,after:0})});assert.equal(preview.scopePlans.length,3);assert.equal(preview.next,null);
 const packets=[];
 for(const scope of preview.scopePlans){const source=clients.get(scope.scopeId);await source.refresh();packets.push(await source.prepareMembershipRotation(changeHash,scope.roles.map(({deviceId,role})=>({deviceId,role})),scope.manifest,scope));}
 const packetPage={kind:'rotation-packets',items:packets},packetPages=[membershipAtomicPageRef(0,packetPage)];
 store('page',{...binding,phase:'packets',index:0,page:packetPage,authorization:await auth('membership-atomic-page',{...binding,phase:'packets',index:0,pageHash:packetPages[0].pageHash})});
 const batchHash=membershipAtomicBatchHash(plan,packetPages);
 store('seal',{...binding,packetPages,authorization:await auth('membership-atomic-seal',{...binding,batchHash})});
 const commit={...binding,batchHash,authorization:await personal.authorizeMembershipAtomicApply('membership-atomic-commit',{...binding,batchHash})};
 const receipt=store('commit',commit);validateMembershipAtomicReceipt(receipt,plan,packetPages);
 await check('real atomic three-scope membership receipt retries without another rotation',async()=>{assert.deepEqual(store('commit',commit),receipt);for(const packet of packets)await clients.get(packet.command.scopeId).confirmMembershipRotation(packet);});
 const rotation=packets.find(packet=>packet.command.scopeId===scopeId).command.payload;
 scopeRoots.set(scopeId,{capsule:rotation.recoveryCapsule,keyId:rotation.keyId,epoch:2});
 await check('removed member cannot refresh, read or write through real server ACL and signature checks',async()=>{
  await assert.rejects(memberClient.refresh(),/SHARED_PROJECT_NOT_FOUND/);
  const forgedRead=await signed(scopeId,'get',{domain:'shared-project',objectId:'client-history'},'business',member.device);
  assert.throws(()=>store('read',forgedRead,'premium'),/SHARED_PROJECT_NOT_FOUND/);
  const ownerPacket=await signed(scopeId,'read',{domain:'shared-project',after:'',limit:10});
  const denied=await signE2eeCommand({...ownerPacket.command,deviceId:member.device.deviceId},member.device.keys().signing.privateKey);assert.throws(()=>store('read',denied,'premium'),/SHARED_PROJECT_NOT_FOUND/);
  assert.throws(()=>store('command',oldSignedPut,'premium'),/SHARED_PROJECT_NOT_FOUND/);
  await memberClient.prepare('shared-project','removed-write',new TextEncoder().encode('UNSENT REVOKED DRAFT'),0);await assert.rejects(memberClient.flush('shared-project','removed-write'),/E2EE_REFRESH_REQUIRED/);
 });
 const newText='NEW CONTENT AFTER INDEPENDENT KEY ROTATION';await client.prepare('shared-project','client-future',new TextEncoder().encode(newText),0);await client.flush('shared-project','client-future');
 await check('previous recipient key cannot open any current future-root capsule',async()=>{assert(!rotation.capsules.some(row=>row.deviceId===member.device.deviceId));for(const row of rotation.capsules)await assert.rejects(openRoot(row.capsule,member.device.keys().receiving.privateKey,{ownerId:setup.ownerId,scopeId,cryptoEpoch:2,keyId:rotation.keyId,recipientId:row.deviceId}));});
 const fresh=await enroll(newcomer,'premium4life',scopeId,[oldRoot]);
 await check('first trusted device of another member decrypts old and current epochs with explicit history grants',async()=>{
  const old=await fresh.read('shared-project','client-history'),current=await fresh.read('shared-project','client-future');assert.equal(text(old),oldText);assert.equal(text(current),newText);old.bytes.fill(0);current.bytes.fill(0);
 });
 await check('owner normal reader retains old and new ciphertext after a separate cold device unlock',async()=>{
  owner.device.lock();const coldDevice=await UnlockedWebDevice.unlock(setup.ownerId,owner.authority.secret,owner.storage,owner.keyStorage);devices.push(coldDevice);
  const cold=scopeClient(coldDevice,scopeId);await cold.refresh();try{const before=await cold.read('shared-project','client-history'),after=await cold.read('shared-project','client-future');assert.equal(text(before),oldText);assert.equal(text(after),newText);before.bytes.fill(0);after.bytes.fill(0);}finally{cold.close();}
 });
 }
 report.status='PASS';report.scopes=3;
} catch(error) {report.status='FAIL';report.error=error.message;report.errorFrames=(error.stack??'').split('\n').slice(1).filter(line=>line.trim().startsWith('at ')).slice(0,8);process.exitCode=1;console.error(error.message);}
finally {for(const client of clients.values())client.close();for(const device of devices)device.lock();for(const value of secrets)value.fill(0);if(existsSync(path.join(runtime,'owner.json')))report.cleanup=cleanupBackendRuntime(runtime,output);save();}
