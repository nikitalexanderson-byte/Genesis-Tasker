"use client";
import {useCallback,useMemo,useSyncExternalStore} from "react";
import {isTaskListOrder,type TaskListOrder} from "./task-list-order";
import type {SharedTaskSort} from "./cloud-sync";
type Reads=Record<string,string[]>;
const memory=new Map<string,string>();
const volatile=new Set<string>();
const DEFAULT='{"sort":"position","reads":{}}';
function read(key:string,fallback:string):string {if(volatile.has(key))return memory.get(key)??fallback;try{return localStorage.getItem(key)??fallback;}catch{return memory.get(key)??fallback;}}
function useDeviceSetting(key:string,fallback:string) {
  const subscribe=useCallback((notify:()=>void)=>{
    const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)notify();};
    const local=(event:Event)=>{if((event as CustomEvent<string>).detail===key)notify();};
    window.addEventListener("storage",storage);window.addEventListener("genesis:device-setting",local);
    return()=>{window.removeEventListener("storage",storage);window.removeEventListener("genesis:device-setting",local);};
  },[key]);
  const snapshot=useCallback(()=>read(key,fallback),[key,fallback]);
  const raw=useSyncExternalStore(subscribe,snapshot,()=>fallback);
  const update=useCallback((change:(current:string)=>string)=>{
    const current=read(key,fallback),next=change(current);if(next===current)return;
    memory.set(key,next);try{localStorage.setItem(key,next);volatile.delete(key);}catch{volatile.add(key);/* Device storage can be unavailable; the current session still works. */}
    window.dispatchEvent(new CustomEvent("genesis:device-setting",{detail:key}));
  },[key,fallback]);
  return {raw,update};
}
function parse(raw:string):{sort:TaskListOrder;reads:Reads} {
  try{const saved=JSON.parse(raw);return {sort:isTaskListOrder(saved.sort)?saved.sort:"position",reads:saved.reads&&typeof saved.reads==="object"?saved.reads:{}};}catch{return {sort:"position",reads:{}};}
}
export function usePersonalTaskDisplay(userId:string) {
  const {raw,update}=useDeviceSetting(`genesis:personal-task-display:${userId}`,DEFAULT);
  const state=useMemo(()=>parse(raw),[raw]);
  const setSort=useCallback((sort:TaskListOrder)=>update(current=>JSON.stringify({...parse(current),sort})),[update]);
  const markRead=useCallback((taskId:string,ids:string[])=>update(raw=>{
    const current=parse(raw),read=new Set(current.reads[taskId]??[]);if(ids.every(id=>read.has(id)))return raw;
    const reads={...current.reads,[taskId]:[...new Set([...read,...ids])].slice(-200)};
    return JSON.stringify({...current,reads:Object.fromEntries(Object.entries(reads).slice(-2000))});
  }),[update]);
  return {...state,setSort,markRead};
}
export function useSharedTaskSort(userId:string) {
  const {raw,update}=useDeviceSetting(`genesis:shared-task-sort:${userId}`,"position");
  const sort:SharedTaskSort=isTaskListOrder(raw)||raw==="priority"?raw:"position";
  const setSort=useCallback((sort:SharedTaskSort)=>update(()=>sort),[update]);
  return [sort,setSort] as const;
}
