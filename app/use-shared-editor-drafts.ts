"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {GenesisApiError} from './cloud-sync';
import {useSharedWorkDrafts} from './use-shared-work-drafts';
import type {WorkDraft} from './shared-work-draft-journal';
import {editorDeviceEdit,sendEditorDeviceDraft,validateEditorDeviceDraft,type EditorDeviceDraft,type EditorOperation,type EditorPurpose} from './shared-editor-device-drafts';

export function useSharedEditorDrafts<T>(userId:string,spaceId:string,projectId:string,purpose:EditorPurpose,validateEditor:(value:unknown)=>T){
 const validate=useCallback((value:unknown)=>validateEditorDeviceDraft(value,spaceId,projectId,purpose,validateEditor),[spaceId,projectId,purpose,validateEditor]);
 const device=useSharedWorkDrafts(userId,projectId,purpose,true,validate);
 const [document,setDocument]=useState<EditorDeviceDraft<T>|null>(null),[source,setSource]=useState<WorkDraft<EditorDeviceDraft<T>>|null>(null);
 const current=useRef(document),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[userId,spaceId,projectId,purpose]);
 const set=useCallback((value:EditorDeviceDraft<T>|null)=>{current.current=value;setDocument(value);},[]);
 const persist=async(value:EditorDeviceDraft<T>)=>{if(!live.current)throw Error('DRAFT_CLOSED');const safe=validate(JSON.parse(JSON.stringify(value)));await device.stage(safe);if(!live.current)throw Error('DRAFT_CLOSED');set(safe);};
 const update=(editor:T)=>{
  if(current.current&&current.current.phase!=='editing')return;
  const safe=validate(JSON.parse(JSON.stringify(editorDeviceEdit(spaceId,projectId,purpose,editor))));set(safe);void device.stage(safe).catch(()=>undefined);
 };
 const prepare=async(editor:T,operation:EditorOperation)=>{
  if(current.current&&current.current.phase!=='editing')throw Error('SHARED_EDITOR_PENDING');
  await persist({...editorDeviceEdit(spaceId,projectId,purpose,editor),phase:'pending',operation});
 };
 const send=async(send:(request:EditorOperation)=>Promise<unknown>)=>{
  const value=current.current;if(!value)throw Error('DRAFT_NOT_READY');
  if(value.phase==='received')return value.receipt;
  const received=await sendEditorDeviceDraft(value,{persist,send,definitiveRejection:reason=>reason instanceof GenesisApiError&&[400,403,404,409,422].includes(reason.status)&&typeof reason.payload?.error==='string'?reason.payload.error:null});
  return received.receipt;
 };
 const finish=async()=>{await device.clearCurrent(source);if(live.current){set(null);setSource(null);}};
 const restore=async(row:WorkDraft<EditorDeviceDraft<T>>)=>{
  if(current.current)throw Error('SHARED_EDITOR_PENDING');const value=validate(row.value);set(value);
  try{await persist(value);}catch(error){if(live.current)set(null);throw error;}setSource(row);
  try{await device.remove(row);if(live.current)setSource(null);}catch(error){if(!(error instanceof Error&&error.message==='DRAFT_CHANGED'))throw error;}
  return value.editor;
 };
 const resumeEditing=async()=>{
  const value=current.current;if(!value||value.phase!=='rejected'&&!(value.phase==='pending'&&value.attempts===0))throw Error('SHARED_EDITOR_PENDING');
  await persist(editorDeviceEdit(spaceId,projectId,purpose,value.editor));return value.editor;
 };
 return {device,document,current,persist,update,prepare,send,finish,restore,resumeEditing,
  locked:Boolean(document&&document.phase!=='editing'),rows:device.rows.filter(row=>row.id!==device.writerId&&row.id!==source?.id)};
}
export type SharedEditorDraftController<T>=ReturnType<typeof useSharedEditorDrafts<T>>;
