'use client';
import {Fragment,useEffect,useState,type ReactNode} from 'react';

/** A successful cutover retires legacy observers/editors together. The new
 * mount reads only through the already unlocked encrypted product session. */
export function PrivateProductBoundary({children}:{children:ReactNode}){
 const [generation,setGeneration]=useState(0);
 useEffect(()=>{const refresh=()=>setGeneration(value=>value+1);window.addEventListener('genesis-private-migration-complete',refresh);return()=>window.removeEventListener('genesis-private-migration-complete',refresh);},[]);
 return <Fragment key={generation}>{children}</Fragment>;
}
