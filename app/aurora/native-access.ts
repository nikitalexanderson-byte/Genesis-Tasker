import type {AuroraAccess,Sealed} from './repository';

export type NativeAuroraBridge={
 checkSession:(operationId:string)=>void;
 getItem:(key:string,operationId:string)=>string|null;
 setItem:(key:string,value:string,operationId:string)=>void;
 removeItem:(key:string,operationId:string)=>void;
 keys:(operationId:string)=>string;
};
export type NativeAuroraRpc=<T>(method:string,payload:unknown)=>Promise<T>;

/** The native capability is never a boolean shared between editor operations.
 * Each storage/RPC closure carries the exact live token selected by its caller. */
export function createNativeAuroraAccess(bridge:NativeAuroraBridge,rpc:NativeAuroraRpc,operationId=''):AuroraAccess {
 let cachedKeys:string[]|null=null;
 const keys=()=>{
  bridge.checkSession(operationId);
  if(!cachedKeys){const value:unknown=JSON.parse(bridge.keys(operationId));
   if(!Array.isArray(value)||value.length>1025||value.some(key=>typeof key!=='string')||new Set(value).size!==value.length)throw new Error('AURORA_INVALID_RESPONSE');
   cachedKeys=value as string[];
  }return cachedKeys;
 };
 const access:AuroraAccess={
  check:()=>bridge.checkSession(operationId),
  request:<T>(path:string,init:RequestInit={})=>rpc<T>('request',{path,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):null,...(operationId?{operationId}:{})}),
  seal:(value,scope)=>rpc<Sealed>('seal',{value,scope,...(operationId?{operationId}:{})}),
  open:<T>(value:Sealed,scope:string)=>rpc<T>('open',{value,scope,...(operationId?{operationId}:{})}),
  async withLegacyOperation(operation){
   access.check();
   if(operationId){const result=await operation(access);access.check();return result;}
   // This ID remains known after a lost begin receipt. Native end-before-begin
   // tombstones cancel a delayed acquisition without orphaning its mutex.
   const token=crypto.randomUUID();
   try {
    const receipt=await rpc<{operationId:string}>('operationBegin',{operationId:token});
    if(receipt.operationId!==token)throw new Error('E2EE_INVALID_LEGACY_OPERATION');
    const bound=createNativeAuroraAccess(bridge,rpc,token);bound.check();
    const result=await operation(bound);bound.check();return result;
   } finally {await rpc('operationEnd',{operationId:token});}
  },
  ...(operationId?{storage:{
   get length(){return keys().length;},
   key:(index:number)=>keys()[index]??null,
   getItem:(key:string)=>bridge.getItem(key,operationId)||null,
   setItem:(key:string,value:string)=>{bridge.setItem(key,value,operationId);cachedKeys=null;},
   removeItem:(key:string)=>{bridge.removeItem(key,operationId);cachedKeys=null;},
  }}:{}),
 };return access;
}
