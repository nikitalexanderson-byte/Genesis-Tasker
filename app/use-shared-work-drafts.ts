"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {personalDocumentAccess,PERSONAL_DOCUMENT_READY_EVENT} from './cloud-sync';
import {SharedWorkDraftJournal,SHARED_WORK_DRAFT_PREFIX,type WorkDraft,type SharedWorkDraftPurpose} from './shared-work-draft-journal';
import {sharedEditorIndexedStorage,SHARED_EDITOR_DRAFT_MAX_BYTES} from './shared-editor-indexed-storage';

/** Private device journal only; this hook never sends a shared mutation. */
export function useSharedWorkDrafts<T>(userId:string,projectId:string,purpose:SharedWorkDraftPurpose,active:boolean,validate:(value:unknown)=>T){
 const validator=useRef(validate),epoch=useRef(0),reads=useRef(0),writes=useRef(0),pending=useRef(0),own=useRef<WorkDraft<T>|null>(null),currentJournal=useRef<SharedWorkDraftJournal<T>|null>(null);
 const [journal,setJournal]=useState<SharedWorkDraftJournal<T>|null>(null),[rows,setRows]=useState<WorkDraft<T>[]>([]),[error,setError]=useState<unknown>(null),[status,setStatus]=useState<'idle'|'saving'|'saved'|'error'>('idle'),[loaded,setLoaded]=useState(false);
 useEffect(()=>{validator.current=validate;},[validate]);
 useEffect(()=>{
  const generation=++epoch.current;
  const largeEditor=['templates','template-apply','automations','data-import'].includes(purpose);
  const value=new SharedWorkDraftJournal<T>({storage:localStorage,...(largeEditor?{asyncStorage:sharedEditorIndexedStorage(localStorage),maxBytes:purpose==='data-import'?44_000_000:SHARED_EDITOR_DRAFT_MAX_BYTES}:{}),access:personalDocumentAccess(userId),userId,projectId,purpose,validate:value=>validator.current(value)});
  currentJournal.current=value;own.current=null;reads.current++;setJournal(value);setRows([]);setError(null);setStatus('idle');setLoaded(false);
  const beforeUnload=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);
  return()=>{epoch.current=generation+1;currentJournal.current=null;window.removeEventListener('beforeunload',beforeUnload);void value.flush().catch(()=>undefined).finally(()=>value.dispose());};
 },[userId,projectId,purpose]);
 const refresh=useCallback(async()=>{
  if(!journal||currentJournal.current!==journal)return;const generation=epoch.current,read=++reads.current;
  try{const next=await journal.list();if(generation===epoch.current&&read===reads.current){setRows(next);setError(null);setLoaded(true);}}
  catch(reason){if(generation===epoch.current&&read===reads.current){setError(reason);setStatus('error');setLoaded(true);}}
 },[journal]);
 useEffect(()=>{if(!active)return;const initial=window.setTimeout(()=>void refresh(),0),prefix=`${SHARED_WORK_DRAFT_PREFIX}${userId}:${projectId}:${purpose}:`;const storage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(prefix))void refresh();},ready=()=>void refresh(),unsubscribe=journal?.subscribe(ready);window.addEventListener('storage',storage);window.addEventListener(PERSONAL_DOCUMENT_READY_EVENT,ready);return()=>{window.clearTimeout(initial);unsubscribe?.();window.removeEventListener('storage',storage);window.removeEventListener(PERSONAL_DOCUMENT_READY_EVENT,ready);};},[active,refresh,userId,projectId,purpose,journal]);
 const stage=useCallback(async(value:T)=>{
  if(!journal||currentJournal.current!==journal)throw new Error('DRAFT_NOT_READY');const generation=epoch.current,write=++writes.current;reads.current++;pending.current++;setStatus('saving');
  try{const record=await journal.write(value);if(generation===epoch.current){own.current=record;setRows(current=>[record,...current.filter(row=>row.id!==record.id)]);if(write===writes.current){setStatus('saved');setError(null);}}return record;}
  catch(reason){if(generation===epoch.current){setError(reason);setStatus('error');}throw reason;}
  finally{pending.current--;}
 },[journal]);
 const remove=useCallback(async(record:Pick<WorkDraft<T>,'id'|'raw'>)=>{
  if(!journal||currentJournal.current!==journal)throw new Error('DRAFT_NOT_READY');const generation=epoch.current;reads.current++;pending.current++;
  try{await journal.remove(record);if(generation===epoch.current){if(own.current?.id===record.id)own.current=null;setRows(current=>current.filter(row=>row.id!==record.id));setError(null);}await refresh();}
  catch(reason){if(generation===epoch.current){setError(reason);setStatus('error');}throw reason;}
  finally{pending.current--;}
 },[journal,refresh]);
 const clearCurrent=useCallback(async(source:WorkDraft<T>|null)=>{
  if(!journal||currentJournal.current!==journal)throw new Error('DRAFT_NOT_READY');const generation=epoch.current;await journal.flush().catch(()=>undefined);if(generation!==epoch.current)throw new Error('DRAFT_CLOSED');if(own.current)await remove(own.current);
  let changed=false;if(source&&source.id!==journal.writerId){try{await remove(source);}catch(reason){if(reason instanceof Error&&reason.message==='DRAFT_CHANGED')changed=true;else throw reason;}}
  if(generation===epoch.current)setStatus('idle');return {changed};
 },[journal,remove]);
 return {rows,error,status,ready:journal!==null,loaded,writerId:journal?.writerId??null,refresh,stage,remove,clearCurrent};
}
