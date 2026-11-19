import {assertTechnical} from './e2ee/keys.ts';
import type {ReminderMigrationLocal} from './e2ee/reminders-source.ts';

type Editor={source:string;read:()=>unknown};
type Session={mounted:Map<object,Editor>;detached:ReminderMigrationLocal['editors'];tasks:number};
const sessions=new Map<string,Session>();let listening=false;
function session(ownerId:string){
 assertTechnical(ownerId);if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('genesis-local-session-ended',clearReminderMigrationMemory);}
 let value=sessions.get(ownerId);if(!value){value={mounted:new Map(),detached:[],tasks:0};sessions.set(ownerId,value);}return value;
}
/** Retain committed reminder form state across navigation in the current login.
 * No new disk cache, secret input reader, network or notification operation. */
export function registerReminderMigrationEditor(ownerId:string,source:string,read:()=>unknown){
 if(!source||source.length>128)throw new Error('E2EE_REMINDER_SOURCE_INVALID');const value=session(ownerId),token={};value.mounted.set(token,{source,read});
 return()=>{if(sessions.get(ownerId)!==value||!value.mounted.delete(token))return;
  if(value.detached.length>=1000)throw new Error('E2EE_REMINDER_SOURCE_TOO_LARGE');value.detached.push({source,state:structuredClone(read()),mounted:false});};
}
export async function withReminderEditorTask<T>(ownerId:string,operation:()=>Promise<T>):Promise<T>{
 const value=session(ownerId);value.tasks++;try{return await operation();}finally{value.tasks--;}
}
export function captureReminderMigrationEditors(ownerId:string){
 const value=sessions.get(ownerId);if(!value)return[];if(value.tasks)throw new Error('E2EE_REMINDER_OPERATION_IN_PROGRESS');
 const editors=[...value.detached,...[...value.mounted.values()].map(row=>({source:row.source,state:structuredClone(row.read()),mounted:true}))];
 if(editors.length>1000)throw new Error('E2EE_SOURCE_TOO_LARGE');return structuredClone(editors);
}
export function clearReminderMigrationMemory(){sessions.clear();}
