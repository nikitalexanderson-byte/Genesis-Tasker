import type {BackupMigrationForm} from './backup-migration-memory.ts';

/** Mirror accepted input BEFORE scheduling a React update. A view can disappear
 * before its next layout effect; the last rendered tree is not the last input.
 * A failed native retention leaves both the mirror and the React state intact. */
export function backupPanelMirror(retain:((form:BackupMigrationForm)=>void)|undefined){
 let values:Record<string,unknown>={},file:File|null=null,busy=false,operation='';
 const form=(state=values,selected=file,working=busy,id=operation):BackupMigrationForm=>({file:selected,settled:!working,state:{...state,operationId:id}});
 return{
  initialize(name:string,value:unknown){if(name==='file'){if(file===null)file=value as File|null;}
   else if(name!=='busy'&&!Object.hasOwn(values,name))values={...values,[name]:value};},
  operationId:()=>operation,
  setOperationId(value:string){retain?.(form(values,file,busy,value));operation=value;},
  update<T>(name:string,action:T|((previous:T)=>T)):T{
   const previous=(name==='file'?file:name==='busy'?busy:values[name]) as T;
   const next=typeof action==='function'?(action as (previous:T)=>T)(previous):action;
   const state=name==='file'||name==='busy'?values:{...values,[name]:next};
   const selected=name==='file'?next as File|null:file,working=name==='busy'?next as boolean:busy;
   retain?.(form(state,selected,working));values=state;file=selected;busy=working;return next;
  },
  snapshot:()=>form(),
  publish(){retain?.(form());},
 };
}
