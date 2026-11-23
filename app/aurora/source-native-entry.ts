import {PersonalContentRestore} from '../e2ee/personal-content-restore';
import {DomainContentRestore} from '../e2ee/domain-content-restore';
import {SharedContentRestore,type SharedRestoreSource} from '../e2ee/shared-content-restore';
import {sharedRestoreArchiveSource} from '../e2ee/shared-content-restore-archive';
import {domainRestoreArchiveSource} from '../e2ee/domain-content-restore-archive';
import {personalRestoreArchiveSource} from '../e2ee/personal-content-restore-archive';
import {PersonalAuroraSource} from '../e2ee/aurora-source';
import {PersonalStoicheionSource} from '../e2ee/stoicheion-source';
import {PersonalAdviceSource} from '../e2ee/advice-source';
import {PersonalTasksSource} from '../e2ee/tasks-source';
import {PersonalDiarySource} from '../e2ee/diary-source';
import {normalizeNativeDiaryCapture} from '../e2ee/diary-native-source';
import {PersonalMindmapsSource} from '../e2ee/mindmaps-source';
import {normalizeNativeMindmapsCapture} from '../e2ee/mindmaps-native-source';
import {PersonalPhysisSource} from '../e2ee/physis-source';
import {normalizeNativePhysisCapture} from '../e2ee/physis-native-source';
import {PersonalRemindersSource} from '../e2ee/reminders-source';
import {normalizeNativeReminderCapture} from '../e2ee/reminders-native-source';
import {PersonalArchivesSource} from '../e2ee/archives-source';
import {normalizeNativeArchivesSource,nativeArchivesRemote} from '../e2ee/archives-native-source';
import {RelationalPrivatePathSource} from '../e2ee/relational-path-source';
import {normalizeNativePrivatePathRemote} from '../e2ee/private-path-fragments';
import {streamNativeSourceResults} from '../e2ee/native-source-stream';
import {PublicAdviceCatalogues} from '../e2ee/advice-catalogue';
import {E2eeAdviceProduct,type AdviceProductPorts} from '../e2ee/advice-product';
import type {FeatureDocumentPort,FeatureDocumentView} from '../e2ee/feature-document';
import {normalizeNativeAdviceCapture} from '../e2ee/advice-native-source';
import {canonicalJson} from './forecast';
import {decodeE2eeBytes,encodeE2eeBytes} from '../e2ee/envelope';
import {backupJson} from '../backup-format';
import {assertTechnical,exactKeys} from '../e2ee/keys';
import type {MigrationSourceContext} from '../e2ee/migration';
import type {PrivatePathAdapter} from '../e2ee/migration-sources';
import {SharedLiveModel,validateSharedLiveContext,type SavedSharedRequest} from '../e2ee/shared-live';
import {SharedPrivateBulk,validatePrivateBulkJournal} from '../e2ee/shared-private-bulk';
import {SharedPrivateTransfer,validatePrivateTransferJournal,privateTaskTransferInput,type PrivateTransferPorts} from '../e2ee/shared-private-transfer';
import type {ProductEdit,ProductVersion} from '../e2ee/shared-product';
import type {SharedDomainBinding} from '../e2ee/shared-domain';
import {SharedAggregateModel,validatePersonalSharedState,seedPersonalSharedState,type PersonalSharedState} from '../e2ee/shared-aggregate';
import {planMembershipOperation,membershipOperationFingerprint,validateMembershipOperationSnapshot} from '../e2ee/membership-operation-plan';
import {membershipOperationResult} from '../e2ee/membership-operation-result';
import type {MembershipAtomicReceipt} from '../e2ee/membership-atomic-receipts';
import {membershipProjectAccessProbe,membershipProjectAccessFingerprint,privateProjectAccessView,privateProjectAccessMembers} from '../e2ee/membership-project-access';
import type {SharedProjectAccessDraft} from '../shared-project-access';
import {membershipAtomicOperationPlan,type MembershipAtomicProducts} from '../e2ee/membership-atomic-contract';
import {MembershipOperationDrafts,type MembershipOperationDraft} from '../e2ee/membership-operation-drafts';
import {captureMembershipOperationSnapshot,type MembershipOpenedScope} from '../e2ee/membership-operation-selection';
import {membershipOperationEdits} from '../e2ee/membership-operation-edits';
import {membershipOperationEditBatches} from '../e2ee/membership-operation-compose';
import {samePrivateJson} from '../e2ee/product-json';
import {verifyMembershipAtomicPrivateEffects,type MembershipAtomicEffectsInput} from '../e2ee/membership-atomic-effects';

type Bridge={postMessage:(value:string)=>void;postChunk:(id:string,index:number,last:boolean,value:string)=>void};
declare global {interface Window {GenesisAuroraSourceBridge:Bridge;GenesisAuroraSourceRuntime:{append:(job:string,index:number,last:boolean,value:string)=>boolean;
  resolveChunk:(job:string,id:string,index:number,last:boolean,value:string)=>void;close:()=>void}}}
const privateAccessErrorCodes=new Set(['INVALID_PROJECT_ACCESS','PROJECT_ACCESS_CONFLICT','PROJECT_ACCESS_OPERATION_REUSED','LAST_OWNER','PROJECT_ACCESS_MANAGER_UNRESTRICTED','PROJECT_ACCESS_PERMISSION_CHANGED','PROJECT_ACCESS_REVIEW_REQUIRED','PROJECT_ACCESS_LOCAL_QUEUE','PROJECT_ACCESS_RECEIPT_INVALID']);
const nativeProductErrorCode=(value:unknown)=>typeof value==='string'&&(/^E2EE_[A-Z_]{1,100}$/.test(value)||privateAccessErrorCodes.has(value))?value:'E2EE_AURORA_RECONCILIATION_FAILED';

const MAX=512*1024*1024,CHUNK=131072,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const decoder=new TextDecoder('utf-8',{fatal:true});
let job='',input='',started=false,closed=false,replyMaximum=16*1024*1024;
const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void;chunks:string}>();
function current(){if(closed)throw new Error('E2EE_AURORA_RUNTIME_CLOSED');}
function send(value:unknown){
  current();const raw=JSON.stringify(value);if(raw.length>24*1024*1024)throw new Error('E2EE_MIGRATION_TOO_LARGE');
  if(raw.length<=CHUNK)window.GenesisAuroraSourceBridge.postMessage(raw);
  else {const id=crypto.randomUUID();for(let offset=0,index=0;offset<raw.length;offset+=CHUNK,index++)window.GenesisAuroraSourceBridge.postChunk(id,index,offset+CHUNK>=raw.length,raw.slice(offset,offset+CHUNK));}
}
async function run(encoded:string){
  const local:Uint8Array[]=[],content:Uint8Array[]=[];
  try{
    const wire=decodeE2eeBytes(encoded,1,MAX);let value:Record<string,unknown>;
    try{value=backupJson(decoder.decode(wire),MAX,8000000) as Record<string,unknown>;}finally{wire.fill(0);}
    if(value.mode==='membership-owner-effects-v2'){
      exactKeys(value,['protocol','mode','input']);if(value.protocol!==1)throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
      exactKeys(value.input,['request','scope','pages','entities','versions','candidates']);const result=verifyMembershipAtomicPrivateEffects(value.input as MembershipAtomicEffectsInput);
      current();send({job,kind:'membership-operation-complete',value:result});return;
    }
    if(value.mode==='membership-operation-edits-v2'){
      exactKeys(value,['protocol','mode','input']);if(value.protocol!==1)throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
      exactKeys(value.input,['binding','actorId','intentId','createdAt','plan','snapshot','entities','versions']);
      const input=value.input as Parameters<typeof membershipOperationEdits>[0],snapshot=validateMembershipOperationSnapshot(input.snapshot),plan=planMembershipOperation(snapshot,input.plan.operation);
      if(!samePrivateJson(plan,input.plan))throw new Error('E2EE_MEMBERSHIP_STALE');const edits=membershipOperationEdits({...input,snapshot,plan});
      current();send({job,kind:'membership-operation-complete',value:{batches:membershipOperationEditBatches(edits)}});return;
    }
    if(value.mode==='membership-atomic-plan-v2'){
      exactKeys(value,['protocol','mode','actorId','intentId','spaceId','reviewFingerprint','snapshot','operation','products']);
      if(value.protocol!==1||typeof value.actorId!=='string'||typeof value.intentId!=='string'||typeof value.spaceId!=='string'||typeof value.reviewFingerprint!=='string'||!Array.isArray(value.products))throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
      const snapshot=validateMembershipOperationSnapshot(value.snapshot);
      if(snapshot.actorId!==value.actorId||snapshot.spaceId!==value.spaceId||membershipOperationFingerprint(snapshot,value.operation)!==value.reviewFingerprint)throw new Error('E2EE_MEMBERSHIP_STALE');
      const operation=planMembershipOperation(snapshot,value.operation);
      const result=membershipAtomicOperationPlan(value.actorId,value.intentId,value.spaceId,value.reviewFingerprint,operation,value.products as MembershipAtomicProducts[]);
      current();send({job,kind:'membership-operation-complete',value:result});return;
    }
    if(value.mode==='membership-operation-v1'){
      exactKeys(value,['protocol','mode','snapshot','operation']);if(value.protocol!==1)throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
      const result=planMembershipOperation(value.snapshot,value.operation);current();send({job,kind:'membership-operation-complete',value:result});return;
    }
    if(value.mode==='shared-content-restore-v1'){
      exactKeys(value,['protocol','mode','ownerId','action','args']);if(value.protocol!==1||typeof value.ownerId!=='string')throw new Error('E2EE_RESTORE_CONTENT_INVALID');
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'personal-restore-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const model=new SharedContentRestore({ownerId:value.ownerId,current,load:async id=>await invoke('load',{id}) as {value:unknown;serial:number}|null,save:async(id,document,expected)=>await invoke('save',{id,document,expected}) as number,list:async()=>await invoke('list') as string[],capture:binding=>invoke('capture',{binding}),request:async(binding,path,input)=>await invoke('request',{binding,path,input}) as Record<string,unknown>});
      let result:unknown;const args=value.args;
      if(value.action==='create'){exactKeys(args,['payload','sectionIndex','entryIndex','versionId']);const source=await sharedRestoreArchiveSource(value.ownerId,args.payload,args.sectionIndex as number,args.entryIndex as number,args.versionId as string,current),id=await model.create(source.backupId,source.source as SharedRestoreSource);result={state:await model.preview(id)};}
      else if(value.action==='pending'){exactKeys(args,[]);result={items:await model.pending()};}
      else if(value.action==='confirm'){exactKeys(args,['id','fingerprint']);result={state:await model.confirm(args.id as string,args.fingerprint as string)};}
      else{exactKeys(args,['id']);if(value.action==='inspect')result={state:await model.inspect(args.id as string)};else if(value.action==='preview')result={state:await model.preview(args.id as string)};else if(value.action==='apply')result={state:await model.apply(args.id as string)};else throw new Error('E2EE_RESTORE_CONTENT_INVALID');}
      current();send({job,kind:'personal-restore-complete',value:result});return;
    }
    if(value.mode==='domain-restore-v1'){
      exactKeys(value,['protocol','mode','ownerId','action','args']);if(value.protocol!==1||typeof value.ownerId!=='string')throw new Error('E2EE_RESTORE_CONTENT_INVALID');
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'personal-restore-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const model=new DomainContentRestore({ownerId:value.ownerId,current,load:async id=>await invoke('load',{id}) as {value:unknown;serial:number}|null,save:async(id,document,expected)=>await invoke('save',{id,document,expected}) as number,list:async()=>await invoke('list') as string[],read:domain=>invoke('read',{domain}),add:async(domain,record)=>{await invoke('add',{domain,record});},flush:async domain=>{await invoke('flush',{domain});}});
      let result:unknown;const args=value.args;
      if(value.action==='create'){exactKeys(args,['payload','sectionIndex','entryIndex','versionId']);const source=await domainRestoreArchiveSource(value.ownerId,args.payload,args.sectionIndex as number,args.entryIndex as number,args.versionId as string,current),id=await model.create(source.backupId,source.source);result={state:await model.preview(id)};}
      else if(value.action==='pending'){exactKeys(args,[]);result={items:await model.pending()};}
      else if(value.action==='confirm'){exactKeys(args,['id','fingerprint']);result={state:await model.confirm(args.id as string,args.fingerprint as string)};}
      else{exactKeys(args,['id']);if(value.action==='inspect')result={state:await model.inspect(args.id as string)};else if(value.action==='preview')result={state:await model.preview(args.id as string)};else if(value.action==='apply')result={state:await model.apply(args.id as string)};else throw new Error('E2EE_RESTORE_CONTENT_INVALID');}
      current();send({job,kind:'personal-restore-complete',value:result});return;
    }
    if(value.mode==='personal-restore-v1'){
      exactKeys(value,['protocol','mode','ownerId','action','args']);if(value.protocol!==1||typeof value.ownerId!=='string')throw new Error('E2EE_RESTORE_CONTENT_INVALID');
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'personal-restore-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const model=new PersonalContentRestore({ownerId:value.ownerId,current,load:async id=>await invoke('load',{id}) as {value:unknown;serial:number}|null,save:async(id,document,expected)=>await invoke('save',{id,document,expected}) as number,list:async()=>await invoke('list') as string[],read:()=>invoke('read'),apply:async(snapshot,expectedContentRevision,alreadyStaged)=>{await invoke('apply',{snapshot,expectedContentRevision,alreadyStaged});}});
      let result:unknown;const args=value.args;
      if(value.action==='create'){exactKeys(args,['payload','sectionIndex','entryIndex','versionId']);const source=await personalRestoreArchiveSource(value.ownerId,args.payload,args.sectionIndex as number,args.entryIndex as number,args.versionId as string,current),id=await model.create(source.backupId,source.source);result={state:await model.preview(id)};}
      else if(value.action==='pending'){exactKeys(args,[]);result={items:await model.pending()};}
      else if(value.action==='confirm'){exactKeys(args,['id','fingerprint']);result={state:await model.confirm(args.id as string,args.fingerprint as string)};}
      else{exactKeys(args,['id']);if(value.action==='inspect')result={state:await model.inspect(args.id as string)};else if(value.action==='preview')result={state:await model.preview(args.id as string)};else if(value.action==='apply')result={state:await model.apply(args.id as string)};else throw new Error('E2EE_RESTORE_CONTENT_INVALID');}
      current();send({job,kind:'personal-restore-complete',value:result});return;
    }
    if(value.mode==='membership-drafts-v1'){
      exactKeys(value,['protocol','mode','ownerId','action','args']);if(value.protocol!==1||typeof value.ownerId!=='string')throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'membership-drafts-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const model=new MembershipOperationDrafts({ownerId:value.ownerId,current,
        load:async id=>await invoke('load',{id}) as {value:unknown;serial:number}|null,
        save:async(id,document,expected)=>await invoke('save',{id,document,expected}) as number,
        list:async()=>await invoke('list') as string[],
        capture:operation=>captureMembershipOperationSnapshot(operation,{actorId:value.ownerId as string,current,
          bindings:async()=>await invoke('bindings') as {kind:'space'|'project';resourceId:string;scopeId:string}[],
          graph:spaceId=>invoke('graph',{spaceId}),state:targets=>invoke('state',{targets}),
          open:async(kind,resourceId,scopeId)=>await invoke('open',{kind,resourceId,scopeId}) as MembershipOpenedScope,
          read:async(scopeId,entity)=>await invoke('read',{scopeId,entity}) as ProductVersion,
        }),
      });
      let result:unknown;const args=value.args;
      if(value.action==='create'){exactKeys(args,['operation',...(args&&typeof args==='object'&&Object.hasOwn(args,'id')?['id']:[])]);const id=await model.create(args.operation as MembershipOperationDraft['operation'],args.id as string|undefined);result={id,state:await model.inspect(id)};}
      else if(value.action==='pending'){exactKeys(args,[]);result={items:await model.pending()};}
      else if(value.action==='cancel'){exactKeys(args,['id']);result={state:await model.cancel(args.id as string)};}
      else if(value.action==='fork'){exactKeys(args,['id']);const id=await model.fork(args.id as string);result={id,state:await model.inspect(id)};}
      else if(value.action==='result'){exactKeys(args,['id','receipt']);result={result:membershipOperationResult(await model.inspect(args.id as string),args.receipt as MembershipAtomicReceipt|null)};}
      else if(value.action==='snapshot'){exactKeys(args,['operation']);result={snapshot:await model.snapshot(args.operation as MembershipOperationDraft['operation'])};}
      else if(value.action==='checkAccess'){exactKeys(args,['id','fingerprint']);const draft=await model.follow(args.id as string);if(draft.operation.kind!=='project-grants'||typeof args.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(args.fingerprint))throw new Error('PROJECT_ACCESS_CONFLICT');if(!draft.resolves&&!draft.started){const snapshot=await model.snapshot(draft.operation);if(args.fingerprint!==membershipProjectAccessFingerprint(snapshot,draft.operation.userId))throw new Error('PROJECT_ACCESS_CONFLICT');}result={ok:true};}
      else if(value.action==='access'){exactKeys(args,['spaceId','userId','desired']);const probe=membershipProjectAccessProbe(args.spaceId as string,args.userId as string),snapshot=await model.snapshot(probe);
        result=await privateProjectAccessView(snapshot,probe.userId,args.desired as SharedProjectAccessDraft|null,{current,
          open:async(scope,kind,resourceId)=>await invoke('accessOpen',{scope,kind,resourceId}) as import('../e2ee/product-contract').ProductEntity[],
          read:async(scopeId,entity)=>await invoke('read',{scopeId,entity}) as ProductVersion,
          history:async(scopeId,entityId,before)=>await invoke('accessHistory',{scopeId,entityId,before}) as {versions:ProductVersion[];nextBefore:number|null},
        });const after=await model.snapshot(probe);if(membershipProjectAccessFingerprint(after,probe.userId)!==membershipProjectAccessFingerprint(snapshot,probe.userId))throw new Error('E2EE_MEMBERSHIP_STALE');
      }
      else if(value.action==='accessMembers'){exactKeys(args,['spaceId']);const probe=membershipProjectAccessProbe(args.spaceId as string,value.ownerId),snapshot=await model.snapshot(probe);const catalogue=await invoke('memberCatalogue',{scope:snapshot.spaceScope}) as {root:ProductVersion;members:{userId:string;displayName:string}[]};result=privateProjectAccessMembers(snapshot,catalogue.root,catalogue.members);const after=await model.snapshot(probe);if(membershipProjectAccessFingerprint(after,probe.userId)!==membershipProjectAccessFingerprint(snapshot,probe.userId))throw new Error('E2EE_MEMBERSHIP_STALE');}
      else if(value.action==='confirm'){exactKeys(args,['id','fingerprint']);result={state:await model.confirm(args.id as string,args.fingerprint as string)};}
      else{exactKeys(args,['id']);if(value.action==='inspect')result={state:await model.inspect(args.id as string)};
        else if(value.action==='follow')result={state:await model.follow(args.id as string)};
        else if(value.action==='preview')result={state:await model.preview(args.id as string)};
        else if(value.action==='start')result={state:await model.start(args.id as string)};
        else throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');}
      current();send({job,kind:'membership-drafts-complete',value:result});return;
    }
    if(value.mode==='shared-bulk-v1'){
      exactKeys(value,['protocol','mode','ownerId','method','path','body']);if(value.protocol!==1||typeof value.ownerId!=='string'||typeof value.method!=='string'||typeof value.path!=='string')throw new Error('E2EE_PRIVATE_BULK_INVALID');const ownerId=value.ownerId;
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'shared-bulk-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const transfer=new SharedPrivateTransfer({ownerId,current,load:async id=>{const result=await invoke('transferLoad',{id});if(result===null)return null;exactKeys(result,['value','serial']);return{value:validatePrivateTransferJournal(result.value,ownerId),serial:result.serial as number};},save:async(document,expected)=>await invoke('transferSave',{document:validatePrivateTransferJournal(document,ownerId),expected}) as number,capture:async projectId=>await invoke('request',{projectId,method:'GET',path:'execution/capture',body:{}}) as Awaited<ReturnType<PrivateTransferPorts['capture']>>,request:async(projectId,path,body)=>await invoke('request',{projectId,method:'POST',path,body}) as Record<string,unknown>,copyFile:async(sourceProjectId,destinationProjectId,source,destination)=>{const result=await invoke('copyTransferFile',{sourceProjectId,destinationProjectId,source,destination});exactKeys(result,['verified']);if(result.verified!==true)throw new Error('E2EE_TRANSFER_READBACK_CHANGED');}});
      const model=new SharedPrivateBulk({ownerId,current,move:input=>transfer.execute(input),load:async id=>{const result=await invoke('load',{id});if(result===null)return null;exactKeys(result,['value','serial']);return{value:validatePrivateBulkJournal(result.value,ownerId),serial:result.serial as number};},save:async(document,expected)=>await invoke('save',{document:validatePrivateBulkJournal(document,ownerId),expected}) as number,list:async()=>await invoke('list') as string[],projects:async()=>await invoke('projects') as {project:Record<string,unknown>;tasks:Record<string,unknown>[];statuses:Record<string,unknown>[]}[],query:async(filter,sort,cursor)=>await invoke('query',{filter,sort,cursor}) as import('../cloud-sync').SharedTaskPage,request:async(projectId,method,path,body)=>await invoke('request',{projectId,method,path,body}) as Record<string,unknown>});
      if(value.method==='POST'&&['/shared/bulk/transfer-task','/shared/bulk/resume-transfer'].includes(value.path)){
       let command:import('../e2ee/shared-private-transfer').TransferInput;
       if(value.path.endsWith('/resume-transfer')){exactKeys(value.body,['id']);assertTechnical(value.body.id);const saved=await invoke('transferLoad',{id:value.body.id});exactKeys(saved,['value','serial']);command=validatePrivateTransferJournal(saved.value,ownerId).input;if(command.requestId!==value.body.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
       else{exactKeys(value.body,['projectId','taskId','input']);command=privateTaskTransferInput(value.body.projectId as string,value.body.taskId as string,value.body.input as Record<string,unknown>);}
       await transfer.execute(command);current();const result=await invoke('request',{projectId:command.destinationProjectId,method:'GET',path:`tasks/${command.rootTaskId}`,body:{}});current();send({job,kind:'shared-bulk-complete',value:result});return;
      }
      const result=await model.request(value.method,value.path,value.body as Record<string,unknown>);current();send({job,kind:'shared-bulk-complete',value:result});return;
    }
    if(value.mode==='shared-aggregate-v1'){
      exactKeys(value,['protocol','mode','actorId','method','path','body']);if(value.protocol!==1||typeof value.actorId!=='string'||typeof value.method!=='string'||typeof value.path!=='string')throw new Error('E2EE_SHARED_REQUEST_INVALID');
      const actorId=value.actorId,invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'shared-aggregate-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const view=(input:unknown)=>{exactKeys(input,['document','base','pending','remoteRevision','conflict']);const result=input as FeatureDocumentView<PersonalSharedState>;result.document=validatePersonalSharedState(result.document,actorId);result.base=validatePersonalSharedState(result.base,actorId);if(result.conflict)result.conflict.document=validatePersonalSharedState(result.conflict.document,actorId);return result;};
      const model=new SharedAggregateModel({actorId,current,
        layoutSeed:()=>invoke('layoutSeed'),
        bindings:async()=>await invoke('bindings') as SharedDomainBinding[],
        request:async(binding,method,path,body={})=>await invoke('scopedRequest',{binding,method,path,body}) as Record<string,unknown>,
        personal:{read:async()=>{try{return view(await invoke('personalRead'));}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_PRIVATE_SEED_REQUIRED')throw error;
          const seed=seedPersonalSharedState(await invoke('personalSeed'),actorId,await invoke('readHistorySeed'));return view(await invoke('personalRead',{seed}));}},
          write:async input=>view(await invoke('personalWrite',{document:validatePersonalSharedState(input,actorId)})),
          flush:async()=>view(await invoke('personalFlush')),
          resolve:async()=>{throw new Error('E2EE_CONFLICT_REVIEW_REQUIRED');}},
      });const result=await model.request(value.method,value.path,value.body as Record<string,unknown>);current();send({job,kind:'shared-aggregate-complete',value:result});return;
    }
    if(value.mode==='shared-product-v1'){
      exactKeys(value,['protocol','mode','binding','actorId','online','method','path','body','resumeId']);
      if(value.protocol!==1||typeof value.actorId!=='string'||typeof value.method!=='string'||typeof value.path!=='string')throw new Error('E2EE_SHARED_REQUEST_INVALID');
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'shared-product-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      if(typeof value.online!=='boolean')throw new Error('E2EE_SHARED_REQUEST_INVALID');
      const model=new SharedLiveModel({binding:value.binding as SharedDomainBinding,actorId:value.actorId,online:value.online,current,
        context:async()=>validateSharedLiveContext(await invoke('context')),
        localVersions:async()=>await invoke('localVersions') as import('../e2ee/shared-product.ts').PendingProductVersion[],
          history:async(entityId,before)=>await invoke('history',{entityId,before}) as {versions:ProductVersion[];origins:import('../e2ee/product-proofs.ts').VerifiedProductOrigin[];nextBefore:number|null},
          sourceTable:async table=>await invoke('sourceTable',{table}) as Record<string,unknown>[],
          eventCache:{load:async()=>await invoke('eventLoad') as Record<string,unknown>[]|null,save:async events=>{await invoke('eventSave',{events});}},
        completionProposals:async()=>await invoke('completionProposals') as import('../e2ee/product-proofs.ts').VerifiedProductProposal[],
        approvalPreview:async entityId=>await invoke('approvalPreview',{entityId}) as {proposalId:string;payloadHash:string;version:ProductVersion}[],
        approve:(review,intentId)=>invoke('approve',{review,intentId}),
        stageFile:async(reference,bytes)=>{const value=await invoke('stageFile',{reference,data:encodeE2eeBytes(bytes)});exactKeys(value,['staged']);if(value.staged!==true)throw new Error('E2EE_PRIVATE_FILE_UNAVAILABLE');},
        readFile:async reference=>{const value=await invoke('readFile',{reference});exactKeys(value,['data','size','filename','mediaType']);if(value.size!==reference.size||value.filename!==reference.filename||value.mediaType!==reference.mediaType)throw new Error('E2EE_PRIVATE_FILE_CORRUPT');return{bytes:decodeE2eeBytes(value.data,reference.size),filename:reference.filename,mediaType:reference.mediaType};},
        versions:async()=>{const heads=await invoke('heads');if(!Array.isArray(heads)||heads.length>10000)throw new Error('E2EE_PRODUCT_INDEX_INVALID');const rows:ProductVersion[]=[];let size=0;
          for(const head of heads){exactKeys(head,['entityId']);const row=await invoke('version',{entityId:head.entityId}) as ProductVersion;size+=JSON.stringify(row).length;if(size>128*1024*1024)throw new Error('E2EE_PRODUCT_CONTENT_TOO_LARGE');rows.push(row);}return rows;},
        stage:async(edits:ProductEdit[],intentId:string)=>await invoke('stage',{edits,intentId}) as string,
        flush:intentId=>invoke('flush',{intentId}),
        membership:async(operation,intentId,expectedFingerprint)=>await invoke('membership',{operation,intentId,expectedFingerprint}) as Record<string,unknown>,
        invitationService:async plan=>await invoke('invitationService',{plan}) as {result:unknown;state:unknown},
        membershipView:async(userId,desired)=>await invoke('membershipView',{userId,desired}) as Record<string,unknown>,
        loadRequest:async id=>await invoke('requestLoad',{id}) as {value:SavedSharedRequest;serial:number}|null,
        saveRequest:async(document,expected)=>await invoke('requestSave',{document,expected}) as number,
      });
      const result=value.resumeId===null?await model.request(value.method,value.path,value.body as Record<string,unknown>):await model.resume(value.resumeId as string);
      current();send({job,kind:'shared-product-complete',value:result});return;
    }
    if(value.mode==='advice-product-v1'){
      exactKeys(value,['protocol','mode','ownerId','scopeId','offline','language','preferences','action','args']);
      if(value.protocol!==1||typeof value.ownerId!=='string'||typeof value.scopeId!=='string'||typeof value.offline!=='boolean')throw new Error('E2EE_ADVICE_CONTENT_INVALID');
      const invoke=(method:string,payload:unknown={}):Promise<unknown>=>new Promise((resolve,reject)=>{current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});try{send({job,id,kind:'advice-product-call',method,payload});}catch(error){pending.delete(id);reject(error);}});
      const ports:AdviceProductPorts={ownerId:value.ownerId,scopeId:value.scopeId,mode:value.offline?'offline':'online',current,
        preferences:async()=>value.preferences as Awaited<ReturnType<AdviceProductPorts['preferences']>>,language:()=>value.language as ReturnType<AdviceProductPorts['language']>,
        publicBytes:async path=>{const result=await invoke('publicBytes',{path});if(typeof result!=='string')throw new Error('E2EE_ADVICE_CATALOGUE_INVALID');return decodeE2eeBytes(result,2,8*1024*1024);},
        feature:<T,>(id:string,validate:(value:unknown)=>T,seed:()=>Promise<T>):FeatureDocumentPort<T>=>{
          const validateView=(value:unknown)=>{exactKeys(value,['document','base','pending','remoteRevision','conflict']);const view=value as FeatureDocumentView<T>;view.document=validate(view.document);view.base=validate(view.base);if(view.conflict)view.conflict.document=validate(view.conflict.document);return view;};
          const call=async(action:string,payload:Record<string,unknown>={})=>validateView(await invoke('feature',{id,action,...payload}));
          return{read:async(refresh=true)=>{try{return await call('read',{refresh});}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_PRIVATE_SEED_REQUIRED')throw error;return call('read',{refresh,seed:validate(await seed())});}},
            write:input=>call('write',{document:validate(input)}),resolve:(input,revision)=>call('resolve',{document:validate(input),revision}),flush:()=>call('flush')};
        },
        original:id=>invoke('original',{id}),readPolicy:()=>invoke('policy'),readIssue:ref=>invoke('readIssue',{reference:ref}),
        prepareIssue:async issue=>await invoke('prepareIssue',{issue}) as Awaited<ReturnType<AdviceProductPorts['prepareIssue']>>,
        publishIssue:async(issue,reference)=>await invoke('publishIssue',{issue,reference}) as Awaited<ReturnType<AdviceProductPorts['publishIssue']>>,
        localRead:async id=>await invoke('localRead',{id}) as Awaited<ReturnType<AdviceProductPorts['localRead']>>,
        localWrite:async(id,value,expected)=>{await invoke('localWrite',{id,value,expected});},archivePending:async(intentId,value)=>{await invoke('archivePending',{intentId,value});},
      };
      const product=new E2eeAdviceProduct(ports),args=value.args as Record<string,unknown>;let result:unknown;
      if(value.action==='today')result=await product.today(args.scores as Parameters<E2eeAdviceProduct['today']>[0],args.topics as Parameters<E2eeAdviceProduct['today']>[1],args.from as Parameters<E2eeAdviceProduct['today']>[2]);
      else if(value.action==='record')result=await product.record(args.id as string,args.dayKey as string,args.dismiss as boolean);
      else if(value.action==='saved')result=await product.saved(args.id as string,args.dayKey as string,args.collection as Parameters<E2eeAdviceProduct['saved']>[2]);
      else if(value.action==='resume'){await product.resume();result={ok:true};}else throw new Error('E2EE_ADVICE_METHOD_INVALID');
      current();send({job,kind:'advice-product-complete',value:result});return;
    }
    exactKeys(value,['protocol','source','ownerId','scopeId','local','previous','context','remote']);
    if(value.protocol!==1||!['aurora','stoicheion','advice','tasks','diary','mindmaps','physis','reminders','archives','relational'].includes(String(value.source))||typeof value.ownerId!=='string'||typeof value.scopeId!=='string'||typeof value.local!=='string'
      ||!Array.isArray(value.previous)||value.previous.length>32)throw new Error('E2EE_AURORA_SOURCE_INVALID');
    const localMaximum=value.source==='archives'||value.source==='relational'||value.source==='tasks'?64*1024*1024:16*1024*1024;replyMaximum=localMaximum;
    local.push(decodeE2eeBytes(value.local,1,localMaximum));for(const old of value.previous)local.push(decodeE2eeBytes(old,1,localMaximum));
    const ask=(kind:string,fields:Record<string,unknown>):Promise<unknown>=>new Promise((resolve,reject)=>{
      current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});
      try{send({job,id,kind,...fields});}catch(error){pending.delete(id);reject(error);}
    });
    const catalogues=new PublicAdviceCatalogues(async path=>{
      if(value.source!=='advice')throw new Error('E2EE_ADVICE_CATALOGUE_INVALID');
      const result=await ask('public-catalogue',{path});current();if(typeof result!=='string')throw new Error('E2EE_ADVICE_CATALOGUE_INVALID');
      return decodeE2eeBytes(result,2,8*1024*1024);
    },current);
    const ports={
      storage:{getItem(){throw new Error('E2EE_SOURCE_MUTATION');},key:()=>null,length:0},memory(){throw new Error('E2EE_SOURCE_MUTATION');},assertCurrent:current,
      legacyAurora:async()=>value.remote,legacyStoicheion:async()=>value.remote,legacyAdvice:async()=>value.remote,legacyTasks:async()=>value.remote,legacyDiary:async()=>value.remote,legacyMindmaps:async()=>value.remote,legacyReminders:async()=>value.remote,catalogues,
      openLegacy:(envelope:{iv:string;ciphertext:string},purpose:string):Promise<unknown>=>ask('open',{envelope,purpose}),
    };
    const physisPorts={assertCurrent:current,memory:async()=>{throw new Error('E2EE_SOURCE_MUTATION');},legacyPhysis:async()=>value.remote,
      openVault:async(vault:import('../physis/crypto').PhysisVault)=>{
        if(value.source!=='physis')throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
        const packet=vault.version===2?vault.account:vault.password;
        const accepted=await ports.openLegacy({iv:packet.iv,ciphertext:packet.ciphertext},`physis-vault:${vault.version}:${vault.keyVersion}`);
        current();if(accepted!==true)throw new Error('E2EE_PHYSIS_UNLOCK_REQUIRED');
        return(id:string,envelope:import('../physis/crypto').PhysisEnvelope)=>ports.openLegacy({iv:envelope.iv,ciphertext:envelope.ciphertext},`physis-record:${id}:${vault.keyVersion}`);
      }};
    const archiveReaders={assertCurrent:current,openPhysis:async(owner:string,id:string,input:unknown)=>{
      if(owner!==value.ownerId||!input||typeof input!=='object'||Array.isArray(input))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
      const envelope=input as {iv:string;ciphertext:string;keyVersion:number};
      const raw=await ports.openLegacy({iv:envelope.iv,ciphertext:envelope.ciphertext},`archive-physis:${id}:${envelope.keyVersion}`);
      if(typeof raw!=='string')throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');return raw;
    },openAccount:async(owner:string,envelope:{iv:string;ciphertext:string},purpose:string)=>{
      if(owner!==value.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const raw=await ports.openLegacy(envelope,purpose);
      if(typeof raw!=='string')throw new Error('E2EE_ARCHIVE_SOURCE_INVALID');return raw;
    }};
    let relational:PrivatePathAdapter|undefined;
    if(value.source==='relational'){
      const first=backupJson(decoder.decode(local[0]),localMaximum) as Record<string,unknown>;
      const target=first.target as ConstructorParameters<typeof RelationalPrivatePathSource>[0];
      if(target?.ownerId!==value.ownerId||target?.scopeId!==value.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
      relational=new RelationalPrivatePathSource(target,{assertCurrent:current,capture:async()=>{throw new Error('E2EE_SOURCE_MUTATION');},read:async()=>normalizeNativePrivatePathRemote(value.remote,current)});
    }
    const source:PrivatePathAdapter=relational??(value.source==='archives'?new PersonalArchivesSource(value.ownerId,value.scopeId,{...archiveReaders,
      captureLocal:async()=>{throw new Error('E2EE_SOURCE_MUTATION');},legacyArchives:async()=>nativeArchivesRemote(value.remote,value.context as MigrationSourceContext,current)}):value.source==='aurora'?new PersonalAuroraSource(value.ownerId,value.scopeId,ports):value.source==='stoicheion'?new PersonalStoicheionSource(value.ownerId,value.scopeId,ports):value.source==='tasks'?new PersonalTasksSource(value.ownerId,value.scopeId,ports):value.source==='diary'?new PersonalDiarySource(value.ownerId,value.scopeId,ports):value.source==='mindmaps'?new PersonalMindmapsSource(value.ownerId,value.scopeId,ports):value.source==='physis'?new PersonalPhysisSource(value.ownerId,value.scopeId,physisPorts):value.source==='reminders'?new PersonalRemindersSource(value.ownerId,value.scopeId,ports):new PersonalAdviceSource(value.ownerId,value.scopeId,ports));
    let prepared=local.slice(),nativeMetadata:unknown,diaryMetadata:unknown,mindmapsMetadata:unknown,physisMetadata:unknown;
    if(value.source==='archives'){
      prepared=[];for(const bytes of local.slice()){
        const normalized=await normalizeNativeArchivesSource(backupJson(decoder.decode(bytes),64*1024*1024),archiveReaders),encoded=new TextEncoder().encode(JSON.stringify(normalized));
        local.push(encoded);prepared.push(encoded);
      }
    }
    if(value.source==='reminders'){
      prepared=[];for(const bytes of local.slice()){
        const normalized=await normalizeNativeReminderCapture(backupJson(decoder.decode(bytes)),current),encoded=new TextEncoder().encode(JSON.stringify(normalized));
        local.push(encoded);prepared.push(encoded);
      }
    }
    if(value.source==='physis'){
      prepared=[];for(const bytes of local.slice()){
        const normalized=normalizeNativePhysisCapture(backupJson(decoder.decode(bytes)),current),encoded=new TextEncoder().encode(JSON.stringify(normalized.snapshot));
        local.push(encoded);prepared.push(encoded);if(physisMetadata===undefined)physisMetadata=normalized.metadata;
      }
    }
    if(value.source==='mindmaps'){
      prepared=[];for(const bytes of local.slice()){
        const normalized=normalizeNativeMindmapsCapture(backupJson(decoder.decode(bytes)),current),encoded=new TextEncoder().encode(JSON.stringify(normalized.snapshot));
        local.push(encoded);prepared.push(encoded);if(mindmapsMetadata===undefined)mindmapsMetadata=normalized.metadata;
      }
    }
    if(value.source==='diary'){
      prepared=[];for(const bytes of local.slice()){
        const normalized=normalizeNativeDiaryCapture(backupJson(decoder.decode(bytes)),current),encoded=new TextEncoder().encode(JSON.stringify(normalized.snapshot));
        local.push(encoded);prepared.push(encoded);if(diaryMetadata===undefined)diaryMetadata=normalized.metadata;
      }
    }
    if(value.source==='advice'){
      const raw=local.map(bytes=>backupJson(decoder.decode(bytes)) as Record<string,unknown>);
      if(raw[0]&&Object.hasOwn(raw[0],'documents')){
        const identity=(snapshot:Record<string,unknown>)=>Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='capturedAt'));
        for(const previous of raw.slice(1))if(canonicalJson(identity(previous))!==canonicalJson(identity(raw[0])))throw new Error('E2EE_ADVICE_HISTORY_REVIEW_REQUIRED');
        prepared=[];for(const snapshot of raw){const normalized=await normalizeNativeAdviceCapture(snapshot,value.remote,current);const bytes=new TextEncoder().encode(JSON.stringify(normalized.snapshot));local.push(bytes);prepared.push(bytes);if(nativeMetadata===undefined)nativeMetadata=normalized.metadata;}
      }
    }
    const result=await source.reconcile(prepared[0],prepared.slice(1),value.context as MigrationSourceContext);
    if(nativeMetadata!==undefined)result.content.push({domain:'workspace',objectId:'personal-advice-native-metadata-v1',bytes:new TextEncoder().encode(JSON.stringify(nativeMetadata))});
    if(diaryMetadata!==undefined)(result.localContent??=[]).push({domain:'diary',objectId:'personal-diary-native-history-v1',bytes:new TextEncoder().encode(JSON.stringify(diaryMetadata))});
    if(mindmapsMetadata!==undefined)(result.localContent??=[]).push({domain:'mindmap',objectId:'personal-mindmap-native-history-v1',bytes:new TextEncoder().encode(JSON.stringify(mindmapsMetadata))});
    if(physisMetadata!==undefined)(result.localContent??=[]).push({domain:'physis',objectId:'personal-physis-native-history-v1',bytes:new TextEncoder().encode(JSON.stringify(physisMetadata))});
    const localContent=result.localContent??[];content.push(...[...result.content,...localContent].map(row=>row.bytes));
    const counts=await streamNativeSourceResults(result,part=>ask('result-part',{part}),current);
    current();send({job,kind:'complete-stream',protocol:1,complete:result.complete,...counts});
  }catch(error){
    if(!closed)send({job,kind:'error',code:nativeProductErrorCode(error instanceof Error?error.message:null)});
  }finally{local.forEach(bytes=>bytes.fill(0));content.forEach(bytes=>bytes.fill(0));window.GenesisAuroraSourceRuntime.close();}
}
window.GenesisAuroraSourceRuntime={
  append(id,index,last,value){
    current();if(started||!UUID.test(id)||index<0||!Number.isSafeInteger(index)||value.length>CHUNK||!last&&value.length!==CHUNK
      ||job&&job!==id||input.length!==index*CHUNK||input.length+value.length>MAX*4/3+4)throw new Error('E2EE_AURORA_BRIDGE_INVALID');
    job=id;input+=value;if(last){started=true;const encoded=input;input='';void run(encoded);}return true;
  },
  resolveChunk(id,request,index,last,value){
    current();if(id!==job||!UUID.test(request)||value.length>CHUNK)throw new Error('E2EE_AURORA_BRIDGE_INVALID');
    const call=pending.get(request);if(!call)return;
    if(!Number.isSafeInteger(index)||index<0||call.chunks.length!==index*CHUNK||call.chunks.length+value.length>Math.ceil(replyMaximum*4/3)+4||!last&&value.length!==CHUNK)throw new Error('E2EE_AURORA_BRIDGE_INVALID');
    call.chunks+=value;if(!last)return;pending.delete(request);
    const bytes=decodeE2eeBytes(call.chunks,1,replyMaximum);
    try{const response=backupJson(decoder.decode(bytes)) as {error?:unknown;value?:unknown};
      if(response.error)call.reject(new Error(nativeProductErrorCode(response.error)));
      else call.resolve(response.value);
    }catch(error){call.reject(error);}finally{bytes.fill(0);}
  },
  close(){closed=true;input='';for(const call of pending.values())call.reject(new Error('E2EE_AURORA_RUNTIME_CLOSED'));pending.clear();},
};
