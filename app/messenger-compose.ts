/** Encrypted local composition, independent of a submitted message command.
 * The transport adapter supplies owner admission and an actual cross-tab CAS. */
export type MessengerComposeEdit={id:string;seq:number;senderId:string;revision:number;sourceText:string};
export type MessengerCompose={format:'genesis-messenger-compose-v1';ownerId:string;chatId:string;token:string;sequence:number;text:string;edit:MessengerComposeEdit|null};
type Current=()=>void;
export type MessengerComposePorts={admit:()=>Current;read:(key:string,current:Current)=>Promise<string|null>;compare:(key:string,expected:string|null,next:string,current:Current)=>Promise<void>};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const exact=(input:unknown,keys:string[]):Record<string,unknown>=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!==keys.sort().join(','))throw new Error('MESSENGER_DRAFT_INVALID');return input as Record<string,unknown>;};
const text=(value:unknown)=>{if(typeof value!=='string'||value.length>131072)throw new Error('MESSENGER_DRAFT_INVALID');return value;};
export function parseMessengerCompose(input:unknown,ownerId:string,chatId:string):MessengerCompose{
 const value=exact(input,['format','ownerId','chatId','token','sequence','text','edit']);
 if(value.format!=='genesis-messenger-compose-v1'||value.ownerId!==ownerId||value.chatId!==chatId||typeof value.token!=='string'||!uuid.test(value.token)||!uuid.test(chatId)||!Number.isSafeInteger(value.sequence)||Number(value.sequence)<1)throw new Error('MESSENGER_DRAFT_INVALID');
 let edit:MessengerComposeEdit|null=null;
 if(value.edit!==null){const row=exact(value.edit,['id','seq','senderId','revision','sourceText']);if(typeof row.id!=='string'||!uuid.test(row.id)||row.senderId!==ownerId||!Number.isSafeInteger(row.seq)||Number(row.seq)<1||!Number.isSafeInteger(row.revision)||Number(row.revision)<1)throw new Error('MESSENGER_DRAFT_INVALID');edit={id:row.id,seq:Number(row.seq),senderId:ownerId,revision:Number(row.revision),sourceText:text(row.sourceText)};}
 return{format:'genesis-messenger-compose-v1',ownerId,chatId,token:value.token,sequence:Number(value.sequence),text:text(value.text),edit};
}
export const messengerComposeCell=(chatId:string)=>'draft:'+chatId+':compose-v1';
export const serializeMessengerCompose=(value:MessengerCompose)=>JSON.stringify(parseMessengerCompose(value,value.ownerId,value.chatId));
export class MessengerCompositions{
 private tail:Promise<unknown>=Promise.resolve();private observed=new Map<string,string>();
 constructor(readonly ownerId:string,private readonly ports:MessengerComposePorts){if(!ownerId||ownerId.length>256)throw new Error('MESSENGER_DRAFT_INVALID');}
 private run<T>(work:(current:Current)=>Promise<T>){const current=this.ports.admit();current();const pending=this.tail.catch(()=>undefined).then(()=>{current();return work(current);});this.tail=pending;return pending;}
 private fresh(chatId:string,content='',edit:MessengerComposeEdit|null=null):MessengerCompose{return parseMessengerCompose({format:'genesis-messenger-compose-v1',ownerId:this.ownerId,chatId,token:crypto.randomUUID(),sequence:1,text:content,edit},this.ownerId,chatId);}
 private async keep(value:MessengerCompose,current:Current){await this.ports.compare('draft:'+value.chatId+':compose-history:'+value.token+':'+value.sequence,null,serializeMessengerCompose(value),current);current();}
 load(chatId:string){return this.run(async current=>{
  if(!uuid.test(chatId))throw new Error('MESSENGER_DRAFT_INVALID');const key=messengerComposeCell(chatId),raw=await this.ports.read(key,current);current();
  if(raw!==null){const value=parseMessengerCompose(JSON.parse(raw),this.ownerId,chatId);this.observed.set(chatId,serializeMessengerCompose(value));return value;}
  // The legacy raw text is retained in its original encrypted cell. It is
  // never parsed as an object or removed merely because this reader opened.
  const legacy=await this.ports.read('draft:'+chatId,current);current();const value=this.fresh(chatId,legacy??'');
  const encoded=serializeMessengerCompose(value);await this.ports.compare(key,null,encoded,current);current();this.observed.set(chatId,encoded);return value;
 });}
 snapshot(chatId:string){const raw=this.observed.get(chatId);if(raw===undefined)throw new Error('MESSENGER_DRAFT_NOT_READY');return parseMessengerCompose(JSON.parse(raw),this.ownerId,chatId);}
 save(input:MessengerCompose,previousToken=input.token){const submitted=parseMessengerCompose(structuredClone(input),this.ownerId,input.chatId);return this.run(async current=>{
  const old=this.snapshot(submitted.chatId);if(old.token!==previousToken)throw new Error('MESSENGER_DRAFT_CHANGED');const value=parseMessengerCompose({...submitted,sequence:old.token===submitted.token?old.sequence:1},this.ownerId,submitted.chatId),before=serializeMessengerCompose(old);
  if(before===serializeMessengerCompose(value))return value;
  if(old.token===value.token)value.sequence=old.sequence+1;
  const next=serializeMessengerCompose(value);
  if(before===next)return value;
  if(old.token!==value.token)await this.keep(old,current);
  await this.ports.compare(messengerComposeCell(value.chatId),before,next,current);current();this.observed.set(value.chatId,next);return value;
 });}
 /** Only an exact accepted command can retire its composition. A revised
  * composition keeps its content with a fresh create token; another edit or
  * tab's composition is never cleared by this acknowledgement. */
 acknowledge(chatId:string,prepared:string|null){return this.run(async current=>{
  const raw=await this.ports.read(messengerComposeCell(chatId),current);current();if(raw===null)throw new Error('MESSENGER_DRAFT_NOT_READY');
  const live=parseMessengerCompose(JSON.parse(raw),this.ownerId,chatId);
  if(prepared===null){this.observed.set(chatId,serializeMessengerCompose(live));return live;}
  const accepted=parseMessengerCompose(JSON.parse(prepared),this.ownerId,chatId);
  if(live.token!==accepted.token){this.observed.set(chatId,serializeMessengerCompose(live));return live;}
  await this.keep(accepted,current);
  const same=serializeMessengerCompose(live)===serializeMessengerCompose(accepted),next=this.fresh(chatId,same?'':live.text,same?null:live.edit),encoded=serializeMessengerCompose(next);
  if(!same)await this.keep(live,current);
  await this.ports.compare(messengerComposeCell(chatId),raw,encoded,current);current();this.observed.set(chatId,encoded);return next;
 });}
 async flush(){await this.tail;}
 forget(){this.observed.clear();}
}
