/** An existing encrypted workspace owns its empty collections, including deleted habits. */
export function shouldSeedRemoteWorkspace(hasRemoteStructure: boolean, localItemCount: number): boolean {
  return !hasRemoteStructure && localItemCount > 0;
}

/** A delayed initial response must not erase changes made since that request began. */
export function mergeInitialWorkspaceCollection<T extends {id:string}>(initial:readonly T[],current:readonly T[],remote:readonly T[]):T[] {
  const before=new Map(initial.map(item=>[item.id,item]));
  const now=new Map(current.map(item=>[item.id,item]));
  const merged=new Map(remote.map(item=>[item.id,item]));
  for(const item of initial)if(!now.has(item.id))merged.delete(item.id);
  for(const item of current)if(!before.has(item.id)||JSON.stringify(item)!==JSON.stringify(before.get(item.id)))merged.set(item.id,item);
  return [...merged.values()];
}
