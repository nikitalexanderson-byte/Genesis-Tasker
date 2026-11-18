import {PersonalAuroraSource} from '../e2ee/aurora-source';
import {PersonalStoicheionSource} from '../e2ee/stoicheion-source';
import {decodeE2eeBytes,encodeE2eeBytes} from '../e2ee/envelope';
import {backupJson} from '../backup-format';
import {exactKeys} from '../e2ee/keys';
import type {MigrationSourceContext} from '../e2ee/migration';

type Bridge={postMessage:(value:string)=>void;postChunk:(id:string,index:number,last:boolean,value:string)=>void};
declare global {interface Window {GenesisAuroraSourceBridge:Bridge;GenesisAuroraSourceRuntime:{append:(job:string,index:number,last:boolean,value:string)=>boolean;
  resolveChunk:(job:string,id:string,index:number,last:boolean,value:string)=>void;close:()=>void}}}
const MAX=48*1024*1024,CHUNK=131072,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const decoder=new TextDecoder('utf-8',{fatal:true});
let job='',input='',started=false,closed=false;
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
    try{value=backupJson(decoder.decode(wire),MAX) as Record<string,unknown>;}finally{wire.fill(0);}
    exactKeys(value,['protocol','source','ownerId','scopeId','local','previous','context','remote']);
    if(value.protocol!==1||!['aurora','stoicheion'].includes(String(value.source))||typeof value.ownerId!=='string'||typeof value.scopeId!=='string'||typeof value.local!=='string'
      ||!Array.isArray(value.previous)||value.previous.length>32)throw new Error('E2EE_AURORA_SOURCE_INVALID');
    local.push(decodeE2eeBytes(value.local,1,16*1024*1024));for(const old of value.previous)local.push(decodeE2eeBytes(old,1,16*1024*1024));
    const ports={
      storage:{getItem(){throw new Error('E2EE_SOURCE_MUTATION');},key:()=>null,length:0},memory(){throw new Error('E2EE_SOURCE_MUTATION');},assertCurrent:current,
      legacyAurora:async()=>value.remote,legacyStoicheion:async()=>value.remote,
      openLegacy:(envelope:{iv:string;ciphertext:string},purpose:string):Promise<unknown>=>new Promise((resolve,reject)=>{
        current();const id=crypto.randomUUID();pending.set(id,{resolve,reject,chunks:''});
        try{send({job,id,kind:'open',envelope,purpose});}catch(error){pending.delete(id);reject(error);}
      }),
    };
    const source=value.source==='aurora'?new PersonalAuroraSource(value.ownerId,value.scopeId,ports):new PersonalStoicheionSource(value.ownerId,value.scopeId,ports);
    const result=await source.reconcile(local[0],local.slice(1),value.context as MigrationSourceContext);content.push(...result.content.map(row=>row.bytes));
    current();send({job,kind:'complete',complete:result.complete,content:result.content.map(row=>({domain:row.domain,objectId:row.objectId,bytes:encodeE2eeBytes(row.bytes)}))});
  }catch(error){
    if(!closed)send({job,kind:'error',code:error instanceof Error&&/^E2EE_[A-Z_]{1,100}$/.test(error.message)?error.message:'E2EE_AURORA_RECONCILIATION_FAILED'});
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
    if(!Number.isSafeInteger(index)||index<0||call.chunks.length!==index*CHUNK||call.chunks.length+value.length>24*1024*1024||!last&&value.length!==CHUNK)throw new Error('E2EE_AURORA_BRIDGE_INVALID');
    call.chunks+=value;if(!last)return;pending.delete(request);
    const bytes=decodeE2eeBytes(call.chunks,1,16*1024*1024);
    try{const response=backupJson(decoder.decode(bytes)) as {error?:unknown;value?:unknown};
      if(response.error)call.reject(new Error(typeof response.error==='string'&&/^E2EE_[A-Z_]{1,100}$/.test(response.error)?response.error:'E2EE_AURORA_RECONCILIATION_FAILED'));
      else call.resolve(response.value);
    }catch(error){call.reject(error);}finally{bytes.fill(0);}
  },
  close(){closed=true;input='';for(const call of pending.values())call.reject(new Error('E2EE_AURORA_RUNTIME_CLOSED'));pending.clear();},
};
