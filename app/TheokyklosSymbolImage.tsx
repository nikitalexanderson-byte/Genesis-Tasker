"use client";
import {useEffect,useLayoutEffect,useRef,useState,type SVGProps} from 'react';

/** Retry a failed CDN request without changing or replacing the original artwork. */
export function TheokyklosSymbolImage({href,...props}:Omit<SVGProps<SVGImageElement>,'href'|'onError'>&{href:string}){
 const [attempt,setAttempt]=useState(0),[failed,setFailed]=useState(false);
 const element=useRef<SVGImageElement>(null);
 useLayoutEffect(()=>{
  const image=element.current;if(!image)return;
  const fail=()=>setFailed(true),loaded=()=>setFailed(false);
  image.addEventListener('error',fail);image.addEventListener('load',loaded);
  return()=>{image.removeEventListener('error',fail);image.removeEventListener('load',loaded);};
 },[]);
 useEffect(()=>{
  if(!failed||attempt>=2)return;
  const timer=window.setTimeout(()=>{setAttempt(value=>value+1);setFailed(false);},attempt===0?400:1200);
  return()=>window.clearTimeout(timer);
 },[attempt,failed]);
 const source=attempt?`${href}${href.includes('?')?'&':'?'}genesis-symbol-retry=${attempt}`:href;
 return <image {...props} ref={element} href={source}/>;
}
