import {useCallback,useLayoutEffect,useRef} from 'react';
import {registerReminderMigrationEditor,withReminderEditorTask} from './reminder-migration-memory';

export function useReminderMigrationCapture(ownerId:string,source:string,capture:()=>unknown){
 const latest=useRef(capture);useLayoutEffect(()=>{latest.current=capture;});
 useLayoutEffect(()=>registerReminderMigrationEditor(ownerId,source,()=>latest.current()),[ownerId,source]);
}
export function useReminderMigrationTask(ownerId:string){return useCallback(<T,>(operation:()=>Promise<T>)=>withReminderEditorTask(ownerId,operation),[ownerId]);}
