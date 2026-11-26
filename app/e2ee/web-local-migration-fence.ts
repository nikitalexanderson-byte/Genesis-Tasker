import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';

type Marker={protocol:1;ownerId:string;scopeId:string;token:string;phase:'preparing'|'active'};
const prefix='genesis-e2ee-local-write-fence-v1:';
/** Public technical exclusion only. This marker grants no key, identity, ACL,
 * migration lease or permission to activate a server scope. IndexedDB/Web Locks
 * and the signed directory remain authoritative for the protocol itself. */
export function localMigrationMarker(ownerId:string,storage:Pick<Storage,'getItem'>=localStorage):Marker|null{
 assertTechnical(ownerId);const raw=storage.getItem(prefix+ownerId);if(raw===null)return null;
 const value=parseLegacyMigrationJson(raw,'E2EE_CORRUPT_LOCAL_FENCE',4096);exactKeys(value,['protocol','ownerId','scopeId','token','phase']);
 if(value.protocol!==1||value.ownerId!==ownerId||!['preparing','active'].includes(String(value.phase)))throw new Error('E2EE_CORRUPT_LOCAL_FENCE');
 assertTechnical(value.scopeId);assertTechnical(value.token);return value as Marker;
}
export function assertLegacyLocalWriteAllowed(ownerId:string,storage:Pick<Storage,'getItem'>=localStorage){
 if(localMigrationMarker(ownerId,storage))throw new Error('E2EE_LOCAL_LEGACY_WRITE_FORBIDDEN');
}
export function retainLocalMigrationFence(ownerId:string,scopeId:string,token:string,phase:Marker['phase'],storage:Pick<Storage,'getItem'|'setItem'>=localStorage){
 for(const id of [ownerId,scopeId,token])assertTechnical(id);const prior=localMigrationMarker(ownerId,storage);
 if(prior&&(prior.scopeId!==scopeId||prior.token!==token||prior.phase==='active'&&phase!=='active'))throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');
 const next:Marker={protocol:1,ownerId,scopeId,token,phase};storage.setItem(prefix+ownerId,JSON.stringify(next));
 if(JSON.stringify(localMigrationMarker(ownerId,storage))!==JSON.stringify(next))throw new Error('E2EE_STORAGE_UNAVAILABLE');
 if(typeof window!=='undefined')window.dispatchEvent(new Event('genesis-e2ee-local-fence-changed'));
}
/** Called only after the signed cancellation AND transport-marker release were
 * verified by the product controller. Failure/crash never opens legacy writes. */
export function releaseCancelledLocalMigrationFence(ownerId:string,scopeId:string,token:string,storage:Pick<Storage,'getItem'|'removeItem'>=localStorage){
 const prior=localMigrationMarker(ownerId,storage);
 if(!prior||prior.scopeId!==scopeId||prior.token!==token||prior.phase!=='preparing')throw new Error('E2EE_LOCAL_DOWNGRADE_FORBIDDEN');
 storage.removeItem(prefix+ownerId);if(localMigrationMarker(ownerId,storage))throw new Error('E2EE_STORAGE_UNAVAILABLE');
 if(typeof window!=='undefined')window.dispatchEvent(new Event('genesis-e2ee-local-fence-changed'));
}
