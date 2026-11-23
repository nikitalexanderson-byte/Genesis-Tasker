/** Synchronous reads expose only an already unlocked in-memory product view.
 * Writes return the durable encrypted acknowledgement; callers must await it
 * before closing a destructive editor. No plaintext localStorage fallback. */
type Bridge={read:()=>unknown;write:(value:unknown)=>Promise<void>;assertCurrent:()=>void};
const bridges=new Map<string,Bridge>(),protectedOwners=new Set<string>();
// The legacy workspace key is supplied by the product rather than duplicated
// here. A public owner marker never grants decryption or server authority.
const keys=new Map<string,string>();
export function privateWorkspaceProtected(ownerId:string){return protectedOwners.has(ownerId);}
export function protectPrivateWorkspaceOwner(ownerId:string,key:string){protectedOwners.add(ownerId);keys.set(key,ownerId);}
export function installPrivateWorkspaceStorage(ownerId:string,key:string,bridge:Bridge){protectPrivateWorkspaceOwner(ownerId,key);bridges.set(ownerId,bridge);return()=>{if(bridges.get(ownerId)===bridge)bridges.delete(ownerId);};}
export function privateWorkspaceBridge(key:string):Bridge|null{
 const owner=keys.get(key);if(!owner)return null;
 if(!protectedOwners.has(owner))return null;const bridge=bridges.get(owner);if(!bridge)throw new Error('E2EE_UNLOCK_REQUIRED');bridge.assertCurrent();return bridge;
}
export function retirePrivateWorkspaceStorage(ownerId?:string){if(ownerId)bridges.delete(ownerId);else bridges.clear();}
export function privateWorkspaceOwner(key:string){return keys.get(key)??null;}
