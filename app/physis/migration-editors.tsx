import {createContext,useCallback,useContext,useLayoutEffect,useRef,type ReactNode} from 'react';
import type {PhysisEditorModel} from './store';

const PhysisMigrationContext=createContext<PhysisEditorModel|null>(null);
export function PhysisMigrationProvider({model,children}:{model:PhysisEditorModel;children:ReactNode}){
 return <PhysisMigrationContext.Provider value={model}>{children}</PhysisMigrationContext.Provider>;
}
/** Capture committed form state, including intermediate numeric strings. A
 * callback never exports a DOM node, promise, action function or password input.
 * The store retains its final value when this form unmounts. */
export function usePhysisMigrationCapture(source:string,capture:()=>unknown){
 const model=useContext(PhysisMigrationContext),latest=useRef(capture);
 useLayoutEffect(()=>{latest.current=capture;});
 useLayoutEffect(()=>model?.registerMigrationEditor(()=>({source,state:latest.current()})),[model,source]);
}
export function usePhysisMigrationTask(){
 const model=useContext(PhysisMigrationContext);
 return useCallback(<T,>(operation:()=>Promise<T>)=>model?model.withEditorTask(operation):operation(),[model]);
}
