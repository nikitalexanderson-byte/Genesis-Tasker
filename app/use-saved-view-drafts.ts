"use client";
import {useEffect,useRef,useState} from 'react';
import {personalDocumentAccess} from './cloud-sync';
import {SharedWorkDraftJournal,type WorkDraft} from './shared-work-draft-journal';
import {useSharedWorkDrafts} from './use-shared-work-drafts';
import {SAVED_VIEW_DEVICE_SCOPE,legacySavedViewDeviceDraft,savedViewDeviceEdit,settledSavedViewEdit,validateSavedViewDeviceDraft,type SavedViewDeviceDraft,type SavedViewEditorDraft} from './saved-view-device-drafts';

/** Account-private input only. This hook never sends an HTTP mutation. */
export function useSavedViewDrafts(userId:string,opened:boolean,initial:()=>SavedViewEditorDraft){
 const [draft,setDraft]=useState(initial),[record,setRecord]=useState<SavedViewDeviceDraft|null>(null),[migrationError,setMigrationError]=useState<unknown>(null),[migrating,setMigrating]=useState(true),[migrationVersion,setMigrationVersion]=useState(0);
 const live=useRef(true),own=useRef<SavedViewDeviceDraft|null>(null),input=useRef(draft),source=useRef<WorkDraft<SavedViewDeviceDraft>|null>(null),migrated=useRef(false);
 const journal=useSharedWorkDrafts(userId,SAVED_VIEW_DEVICE_SCOPE,'saved-views',opened,validateSavedViewDeviceDraft);
 const journalReady=journal.ready,refreshJournal=journal.refresh;
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const accept=(value:SavedViewDeviceDraft)=>{own.current=value;input.current=value.edit;setRecord(value);setDraft(value.edit);};
 const persist=async(value:SavedViewDeviceDraft)=>{if(!live.current)throw Error('DRAFT_CLOSED');await journal.stage(value);if(!live.current)throw Error('DRAFT_CLOSED');accept(value);};
 const locked=Boolean(record&&record.phase!=='editing');
 const write=(value:SavedViewEditorDraft)=>{if(own.current&&own.current.phase!=='editing')return;const next=savedViewDeviceEdit(value);accept(next);void journal.stage(next).catch(()=>undefined);};
 const update=(edit:(previous:SavedViewEditorDraft)=>SavedViewEditorDraft)=>write(edit(input.current));
 useEffect(()=>{
  if(!opened||!journalReady||migrated.current)return;
  let cancelled=false;
  const migrate=async()=>{
   const key=`genesis.shared-views.draft.${userId}`,requestKey=key+'.request';
   const oldDraft=localStorage.getItem(key),oldRequest=localStorage.getItem(requestKey);
   if(oldDraft===null&&oldRequest===null)return;
   // A separate writer keeps a concurrent editor or another imported request intact.
   const legacy=new SharedWorkDraftJournal<SavedViewDeviceDraft>({storage:localStorage,access:personalDocumentAccess(userId),userId,projectId:SAVED_VIEW_DEVICE_SCOPE,purpose:'saved-views',validate:validateSavedViewDeviceDraft});
   try{
    await legacy.write(legacySavedViewDeviceDraft(oldDraft,oldRequest));
    if(cancelled||!live.current)return;
    if(localStorage.getItem(key)===oldDraft&&localStorage.getItem(requestKey)===oldRequest){if(oldDraft!==null)localStorage.removeItem(key);if(oldRequest!==null)localStorage.removeItem(requestKey);}
    else setMigrationError(Error('DRAFT_CHANGED'));
    await refreshJournal();
   }finally{legacy.dispose();}
  };
  setMigrating(true);setMigrationError(null);
  void migrate().then(()=>{if(!cancelled&&live.current){migrated.current=true;setMigrating(false);}}).catch(error=>{if(!cancelled&&live.current){setMigrationError(error);setMigrating(false);}});
  return()=>{cancelled=true;};
 },[opened,userId,journalReady,refreshJournal,migrationVersion]);
 useEffect(()=>{if(!draft.dirty||journal.status!=='error')return;const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[draft.dirty,journal.status]);
 const adopt=async(row:WorkDraft<SavedViewDeviceDraft>)=>{
  if(own.current?.phase!=='editing'&&own.current!==null)throw Error('DRAFT_PENDING');
  await persist(validateSavedViewDeviceDraft(row.value));source.current=row;
  if(row.id!==journal.writerId){try{await journal.remove(row);source.current=null;}catch(error){if(!(error instanceof Error&&error.message==='DRAFT_CHANGED'))throw error;}}
  else source.current=null;
 };
 const finish=async()=>{
  const value=own.current;if(!value||value.phase!=='received')throw Error('DRAFT_PENDING');const next=settledSavedViewEdit(value);
  // Retain later legacy input before removing its old source or the acknowledged command.
  await persist(savedViewDeviceEdit(next));
  if(source.current&&source.current.id!==journal.writerId){try{await journal.remove(source.current);}catch(error){if(!(error instanceof Error&&error.message==='DRAFT_CHANGED'))throw error;}}
  source.current=null;return {draft:next,receipt:value.receipt,action:value.command!.action};
 };
 const resumeEditing=async()=>{const value=own.current;if(!value||value.phase!=='rejected'&&!(value.phase==='pending'&&value.attempts===0))throw Error('DRAFT_PENDING');await persist(savedViewDeviceEdit(value.edit));};
 const retryMigration=()=>{migrated.current=false;setMigrationVersion(value=>value+1);};
 return {draft,record,current:own,locked,write,update,persist,adopt,finish,resumeEditing,migrating,ready:journal.ready&&!migrationError&&!migrating,rows:journal.rows.filter(row=>row.id!==journal.writerId),status:journal.status,error:migrationError??journal.error,remove:journal.remove,refresh:journal.refresh,retryMigration};
}
