import {E2eeFeatureDocument,type FeatureDocumentPort} from './feature-document.ts';
import {E2eePrivateDocument} from './product-repository.ts';
import {requirePrivateAccount} from './product-session.ts';
import {exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {assertImmutableSession,validateDocument,type AuroraDocument,type PreparedAuroraResult,type AuroraResultSeal} from '../aurora/session.ts';
import {verifyPreparedSolution} from '../aurora/result.ts';
import {mergeAuroraDocuments,type AuroraConflict} from '../aurora/repository.ts';
import {canonicalJson} from '../aurora/forecast.ts';

export function privateAuroraDocument(ownerId:string):FeatureDocumentPort<AuroraDocument>{
 return new E2eeFeatureDocument({ownerId,domain:'aurora',objectId:'personal-aurora-live-v1',
  validate:value=>validateDocument(value as AuroraDocument,ownerId),seed:async read=>{
   const value=await read('personal-aurora-workspace-v1');exactKeys(value,['protocol','ownerId','document','resultIds']);
   if(value.protocol!==1||value.ownerId!==ownerId||!Array.isArray(value.resultIds)||value.resultIds.some(id=>typeof id!=='string'))throw new Error('E2EE_AURORA_SOURCE_INVALID');
   return validateDocument(value.document as AuroraDocument,ownerId);
  }});
}
/** Both the browser and bundled native engine use the same domain validator,
 * merge rules and issued-session invariants. The native port owns its keys. */
export class AuroraPrivateRepository{
 #serial:Promise<unknown>=Promise.resolve();#last:AuroraDocument|null=null;
 syncState:'saved'|'offline'|'conflict'='saved';
 constructor(private readonly ownerId:string,private readonly document:FeatureDocumentPort<AuroraDocument>){}
 #operation<T>(run:()=>Promise<T>):Promise<T>{const task=this.#serial.catch(()=>undefined).then(run);this.#serial=task;return task;}
 async #validate(value:unknown){return validateDocument(structuredClone(value) as AuroraDocument,this.ownerId);}
 #immutable(before:AuroraDocument,after:AuroraDocument){
  for(const previous of before.sessions){const next=after.sessions.find(row=>row.id===previous.id);if(next)assertImmutableSession(previous,next);
   else if(!after.removed.some(row=>row.id===previous.id))throw new Error('AURORA_EXPLICIT_DELETION_REQUIRED');}
  for(const row of before.removed)if(!after.removed.some(next=>next.id===row.id&&Date.parse(next.removedAt)>=Date.parse(row.removedAt)))throw new Error('AURORA_EXPLICIT_DELETION_REQUIRED');
 }
 async #settle(){
  let view=await this.document.read();await this.#validate(view.document);await this.#validate(view.base);
  if(view.conflict){
   try{const merged=await mergeAuroraDocuments(view.base,view.document,await this.#validate(view.conflict.document));
    view=await this.document.resolve(merged,view.conflict.revision);
   }catch(error){this.syncState='conflict';throw error instanceof Error&&error.message==='E2EE_CONFLICT_REVIEW_STALE'?error:new Error('AURORA_REVISION_CONFLICT');}
  }
  if(view.pending){try{view=await this.document.flush();}
   catch(error){if(error instanceof Error&&/E2EE_(?:OBJECT_CONFLICT|PRODUCT_CONFLICT_REVIEW_REQUIRED)/.test(error.message)){this.syncState='conflict';throw new Error('AURORA_REVISION_CONFLICT');}throw error;}}
  this.syncState=view.pending?'offline':'saved';return view;
 }
 load(){return this.#operation(async()=>{const view=await this.#settle();this.#last=await this.#validate(view.document);return structuredClone(this.#last);});}
 restoreView(){return this.#operation(async()=>{const view=await this.#settle(),value=await this.#validate(view.document);return{checkpoint:'aurora:'+view.remoteRevision,pending:view.pending,records:[...value.sessions.map(session=>({id:session.id,revision:1,deleted:false,value:session,localOnly:false})),...value.removed.map(row=>({id:row.id,revision:1,deleted:true,value:null,localOnly:false}))]};});}
 restoreAdd(input:unknown){return this.#operation(async()=>{const view=await this.document.read(false),before=await this.#validate(view.document);const session=structuredClone(input) as AuroraDocument['sessions'][number];if(view.pending||view.conflict||before.sessions.some(row=>row.id===session.id)||before.removed.some(row=>row.id===session.id))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');const next=await this.#validate({...before,sessions:[...before.sessions,session]});this.#immutable(before,next);await this.document.write(next);const saved=await this.#settle();this.#last=await this.#validate(saved.document);});}
 save(input:AuroraDocument){const snapshot=structuredClone(input);return this.#operation(async()=>{
  const value=await this.#validate(snapshot),view=await this.document.read(false),before=this.#last??view.document;
  this.#immutable(before,value);
  const next=canonicalJson(before)===canonicalJson(view.document)?value:await mergeAuroraDocuments(before,value,view.document);
  await this.document.write(next);const saved=await this.#settle();this.#last=await this.#validate(saved.document);return structuredClone(this.#last);
 });}
 conflictVersions(){return this.#operation(async():Promise<AuroraConflict|null>=>{
  const view=await this.document.read();if(!view.conflict)return null;
  const local=await this.#validate(view.document),remote=await this.#validate(view.conflict.document),base=await this.#validate(view.base);
  const same=(a:unknown,b:unknown)=>canonicalJson(a??null)===canonicalJson(b??null);
  return{local,remote,sessionIds:local.sessions.filter(left=>{const original=base.sessions.find(row=>row.id===left.id),right=remote.sessions.find(row=>row.id===left.id);
   return !same(left,original)&&!same(left,right)&&!same(right,original);}).map(row=>row.id)};
 });}
 recoverAsCopy(newIds:Readonly<Record<string,string>>,now:string){const ids=structuredClone(newIds);return this.#operation(async()=>{
  if(!Number.isFinite(Date.parse(now)))throw new Error('AURORA_INVALID_SESSION');
  const view=await this.document.read();if(!view.conflict)throw new Error('E2EE_CONFLICT_REVIEW_STALE');
  const local=await this.#validate(view.document),remote=await this.#validate(view.conflict.document),base=await this.#validate(view.base),used=new Set([...local.sessions,...remote.sessions,...local.removed,...remote.removed].map(row=>row.id));
  for(const [source,id]of Object.entries(ids)){if(!local.sessions.some(row=>row.id===source)||!id||id.length>150||used.has(id))throw new Error('AURORA_COPY_ID_COLLISION');used.add(id);}
  const copies=local.sessions.filter(row=>ids[row.id]).map(row=>({...row,id:ids[row.id],updatedAt:now,historyOrigins:[...new Set([...(row.historyOrigins??[]),row.id])],
   context:{...row.context,situationId:ids[row.id],answerEvidence:row.context.answerEvidence.map(evidence=>({...evidence,situationId:ids[row.id]}))}}));
  const without=(value:AuroraDocument)=>({...value,sessions:value.sessions.filter(row=>!ids[row.id])});
  const merged=await mergeAuroraDocuments(without(base),without(local),without(remote));
  const next=await this.#validate({...merged,activeSessionId:ids[local.activeSessionId??'']??remote.activeSessionId,
   sessions:[...merged.sessions,...remote.sessions.filter(row=>ids[row.id]),...copies]});
  this.#immutable(remote,next);await this.document.resolve(next,view.conflict.revision);
  const saved=await this.#settle();this.#last=await this.#validate(saved.document);return structuredClone(this.#last);
 });}
}
const decoder=new TextDecoder('utf-8',{fatal:true});
const resultId=(id:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new Error('AURORA_RESULT_MISMATCH');return id;};
/** The local result is already encrypted before the manifest is added to its
 * session. Publishing binds a signed, immutable ciphertext reference. Payment
 * authorization remains a separate server decision on every result opening. */
export class E2eeAuroraResults{
 constructor(private readonly ownerId:string){}
 #account(){return requirePrivateAccount(this.ownerId);}
 #document(id:string){const account=this.#account(),{client,directory}=account.personal();resultId(id);
  return new E2eePrivateDocument<{protocol:1;ownerId:string;id:string;solution:unknown}>({device:account.device,client,scopeId:directory.scopeId,domain:'aurora',objectId:`aurora-result-live:${id}`,
   assertCurrent:()=>{account.requireOpen();if(this.#account()!==account)throw new Error('E2EE_ACCOUNT_CHANGED');},assertWrite:()=>account.requireOpen(),
   validate:value=>{exactKeys(value,['protocol','ownerId','id','solution']);if(value.protocol!==1||value.ownerId!==this.ownerId||value.id!==id)throw new Error('AURORA_RESULT_MISMATCH');
    return value as {protocol:1;ownerId:string;id:string;solution:unknown};}});
 }
 async seal(solution:unknown,id:string):Promise<AuroraResultSeal>{
  resultId(id);const document=this.#document(id);
  await document.save({protocol:1,ownerId:this.ownerId,id,solution:structuredClone(solution)},{serial:null,remoteRevision:0});
  return{kind:'aurora-e2ee-reference-v1',objectId:`aurora-result-live:${id}`};
 }
 async #migrated(manifest:PreparedAuroraResult){
  const account=this.#account(),row=await account.personal().client.read('aurora',`aurora-result:${resultId(manifest.id)}`);account.requireOpen();
  if(!row)throw new Error('E2EE_AURORA_RESULT_MISSING');
  try{const value=parseLegacyMigrationJson(decoder.decode(row.bytes),'E2EE_AURORA_SOURCE_INVALID',16*1024*1024);
   exactKeys(value,['protocol','ownerId','id','methodVersion','contextHash','forecastHashes','solution','createdAt']);
   if(value.protocol!==1||value.ownerId!==this.ownerId||value.id!==manifest.id)throw new Error('AURORA_RESULT_MISMATCH');
   return await verifyPreparedSolution(value.solution,manifest);
  }finally{row.bytes.fill(0);}
 }
 async prepare(manifest:PreparedAuroraResult){
  const account=this.#account();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');
  const document=this.#document(manifest.id);let local;
  try{local=await document.load('online');}
  catch(error){if(!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;
   if('kind'in manifest)throw new Error('E2EE_AURORA_RESULT_MISSING');
   await document.save({protocol:1,ownerId:this.ownerId,id:manifest.id,solution:await this.#migrated(manifest)},{serial:null,remoteRevision:0});
   local=await document.load('offline');
  }
  if('kind'in manifest&&(manifest.kind!=='aurora-e2ee-reference-v1'||manifest.objectId!==`aurora-result-live:${manifest.id}`))throw new Error('AURORA_RESULT_MISMATCH');
  await verifyPreparedSolution(local.value.solution,manifest);account.requireOpen();
  if(local.conflict||local.remoteRevision>1)throw new Error('AURORA_RESULT_IMMUTABLE');
  if(local.pending)await document.flush();account.requireOpen();
  await account.personal().client.prepareAuroraResult(manifest.id,manifest.methodVersion);account.requireOpen();
 }
 async open(id:string,reference:unknown){
  resultId(id);exactKeys(reference,['kind','scopeId','generation','objectId','revision','payloadHash']);
  const account=this.#account(),{directory,client}=account.personal();
  if(reference.kind!=='aurora-e2ee-reference-v1'||reference.scopeId!==directory.scopeId||reference.generation!==directory.generation
   ||reference.objectId!==`aurora-result-live:${id}`||reference.revision!==1)throw new Error('AURORA_RESULT_MISMATCH');
  await client.assertObjectReference('aurora',reference.objectId,reference.revision,reference.payloadHash);account.requireOpen();
  const local=await this.#document(id).load('online');account.requireOpen();
  if(local.pending||local.conflict||local.remoteRevision!==1)throw new Error('AURORA_RESULT_IMMUTABLE');return local.value.solution;
 }
}
