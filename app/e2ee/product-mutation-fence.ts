import {assertTechnical} from './keys.ts';

// Scheduling only: migration must still verify every owner, key, source and
// signed operation. Keep custody stable until its actual operation has drained.
const held=new Map<string,number>();
export function holdPrivateProductMutations(ownerId:string){
 assertTechnical(ownerId);held.set(ownerId,(held.get(ownerId)??0)+1);let released=false;
 return()=>{if(released)return;released=true;const remaining=(held.get(ownerId)??1)-1;if(remaining)held.set(ownerId,remaining);else held.delete(ownerId);};
}
export function requirePrivateProductMutation(ownerId:string){
 if(held.has(ownerId))throw new Error('E2EE_MIGRATION_BUSY');
}
