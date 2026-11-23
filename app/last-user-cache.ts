import type {GenesisUser} from './cloud-sync.ts';
import {hasLocalSignOut} from './local-sign-out.ts';
import {privateWorkspaceProtected} from './private-workspace-storage.ts';
import {localMigrationMarker} from './e2ee/web-local-migration-fence.ts';
import {parseLegacyMigrationJson} from './e2ee/legacy-json.ts';

export const LAST_USER_CACHE_KEY='genesis-last-user-v2';
const fields=['advicePreferences','uiVisibility','syncRouting'] as const;
const privateOwners=new Set<string>();
type CacheStorage=Pick<Storage,'getItem'|'setItem'>;
/** Presentation/routing only. The caller supplies confirmed deny-legacy state;
 * this flag never approves a device or opens encrypted content. */
export function privateUserProfile(user:GenesisUser,required:boolean):GenesisUser{
 const result={...user};delete result.privateVault;
 if(required){result.privateVault=true;result.privatePreferencesMode='e2ee';}
 return result;
}
function profile(raw:string):GenesisUser{
 const value=parseLegacyMigrationJson(raw,'E2EE_USER_CACHE_INVALID',4*1024*1024);
 if(!value||typeof value!=='object'||Array.isArray(value)||!('uid' in value)||typeof value.uid!=='string')throw new Error('E2EE_USER_CACHE_INVALID');
 return value as GenesisUser;
}
export function privateUserCacheRequired(user:GenesisUser,storage:Pick<Storage,'getItem'>=localStorage){
 if(Object.hasOwn(user,'privatePreferencesMode')||privateOwners.has(user.uid)||privateWorkspaceProtected(user.uid)||localMigrationMarker(user.uid,storage)?.phase==='active')return true;
 const raw=storage.getItem(LAST_USER_CACHE_KEY);if(raw===null)return false;
 const cached=profile(raw);return cached.uid===user.uid&&Object.hasOwn(cached,'privatePreferencesMode');
}
function projection(user:GenesisUser):GenesisUser{
 const result=privateUserProfile(user,true);
 for(const name of fields)delete result[name];
 return result;
}
/** Only inert preference content is exposed by migration history. The exact
 * profile original, including technical metadata, stays in protected custody. */
export function userCachePreferenceOriginal(raw:string,ownerId:string){
 const user=profile(raw);if(user.uid!==ownerId)return null;
 return Object.fromEntries(fields.filter(name=>Object.hasOwn(user,name)).map(name=>[name,user[name]]));
}
/** All profile writers share this boundary, including stale callbacks without
 * the server hint. Never overwrite a unique legacy original before custody. */
export function cacheLastUser(user:GenesisUser,storage:CacheStorage=localStorage):boolean{
 if(hasLocalSignOut(storage as Storage))return false;
 const marker=localMigrationMarker(user.uid,storage);
 if(marker?.phase==='preparing')return false;
 if(!privateUserCacheRequired(user,storage)){storage.setItem(LAST_USER_CACHE_KEY,JSON.stringify(user));return true;}
 privateOwners.add(user.uid);
 const raw=storage.getItem(LAST_USER_CACHE_KEY);
 if(raw!==null){const original=userCachePreferenceOriginal(raw,user.uid);if(original&&Object.keys(original).length)return false;}
 storage.setItem(LAST_USER_CACHE_KEY,JSON.stringify(projection(user)));return true;
}
/** Called only with a verified, independently unlocked private device. A disk,
 * readback, lock or account error preserves the exact plaintext legacy original.
 * The callback must acknowledge durable encrypted storage and cold readback. */
export async function retainPrivateUserCache(ownerId:string,retain:(raw:string)=>Promise<void>,current:()=>void,storage:CacheStorage=localStorage){
 current();privateOwners.add(ownerId);
 const raw=storage.getItem(LAST_USER_CACHE_KEY);if(raw===null)return;
 const user=profile(raw);if(user.uid!==ownerId)return;
 if(fields.some(name=>Object.hasOwn(user,name))){await retain(raw);current();}
 if(storage.getItem(LAST_USER_CACHE_KEY)!==raw)throw new Error('E2EE_LOCAL_WORK_CAPTURE_CHANGED');
 current();storage.setItem(LAST_USER_CACHE_KEY,JSON.stringify(projection(user)));
}
