import registry from '../../contracts/e2ee/private-paths-v1.json' with {type:'json'};
import {E2EE_DOMAINS} from './envelope.ts';

export type PrivateScopeKind='personal'|'project'|'space';
export type PrivatePath=typeof registry.paths[number];
/** Data inventory has no dependency on the coordinator or source factories. */
export function requiredPrivatePaths(kind:PrivateScopeKind):readonly PrivatePath[]{
 if(registry.version!==1||!['personal','project','space'].includes(kind)||new Set(registry.paths.map(path=>path.id)).size!==registry.paths.length
  ||['personal','project','space'].some(scope=>!registry.paths.some(path=>path.scope===scope))
  ||registry.paths.some(path=>path.domains.length<1||path.domains.some(domain=>!(E2EE_DOMAINS as readonly string[]).includes(domain)
   ||!registry.remoteDomains[path.scope as PrivateScopeKind].includes(domain))))throw new Error('E2EE_INVALID_COVERAGE_REGISTRY');
 return structuredClone(registry.paths.filter(path=>path.scope===kind));
}
