import {useLayoutEffect,useRef} from 'react';
import {registerPersonalMigrationSource,personalMigrationSourcesChanged,type PersonalMigrationMemory} from './personal-migration-memory';

/** Registration lifetime follows the actual owner/repository. The callback
 * always reads the latest render, including input not yet in a disk journal. */
export function usePersonalMigrationSource<K extends keyof PersonalMigrationMemory>(ownerId:string|null,kind:K,read:()=>PersonalMigrationMemory[K],lifetime:unknown=null){
 // Publish only committed render input. Layout cleanups retire the previous
 // owner before the next layout publishes its reader.
 const held=useRef(read);
 useLayoutEffect(()=>{held.current=read;});
 useLayoutEffect(()=>ownerId?registerPersonalMigrationSource(ownerId,kind,()=>held.current()):undefined,[ownerId,kind,lifetime]);
 useLayoutEffect(()=>{if(ownerId)personalMigrationSourcesChanged(ownerId);});
}
