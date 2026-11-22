import {useLayoutEffect,useRef} from 'react';
import {registerPersonalMigrationSource,personalMigrationSourcesChanged,type PersonalMigrationMemory} from './personal-migration-memory';

/** Registration lifetime follows the actual owner/repository. The callback
 * always reads the latest render, including input not yet in a disk journal. */
export function usePersonalMigrationSource<K extends keyof PersonalMigrationMemory>(ownerId:string|null,kind:K,read:()=>PersonalMigrationMemory[K],lifetime:unknown=null){
 // Each owner/repository has its own cell. An old effect's cleanup cannot read
 // the next account's render through a reused ref.
 const held=useRef<{ownerId:string|null;kind:K;lifetime:unknown;read:()=>PersonalMigrationMemory[K]}|null>(null);
 if(!held.current||held.current.ownerId!==ownerId||held.current.kind!==kind||held.current.lifetime!==lifetime)held.current={ownerId,kind,lifetime,read};
 const cell=held.current;cell.read=read;
 useLayoutEffect(()=>ownerId?registerPersonalMigrationSource(ownerId,kind,()=>cell.read()):undefined,[ownerId,kind,cell]);
 useLayoutEffect(()=>{if(ownerId)personalMigrationSourcesChanged(ownerId);});
}
