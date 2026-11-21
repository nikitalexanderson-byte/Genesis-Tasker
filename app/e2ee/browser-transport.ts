import {e2eeRequest} from '../cloud-sync';
import type {ScopeTransport} from './scope-client.ts';
import {SignedMigrationTransport} from './migration-transport.ts';
import type {MigrationPlanningSession} from './migration-session.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import type {VerifiedDirectory} from './directory.ts';
import type {MigrationSources} from './migration.ts';

/** Uses the existing account session, CSRF, timeout and account-switch aborts. */
export function authenticatedScopeTransport(signal?:AbortSignal):ScopeTransport {
  return {
    directory:scopeId=>e2eeRequest('/directory',{scopeId},signal),
    command:packet=>e2eeRequest('/command',packet,signal),
    read:packet=>e2eeRequest('/read',packet,signal),
  };
}

export function authenticatedMigrationTransport(device:UnlockedWebDevice,directory:VerifiedDirectory,sources:MigrationSources,signal?:AbortSignal,planning?:MigrationPlanningSession){
  sources.assertBinding?.(directory.ownerId,directory.scopeId,directory.kind);
  if(planning)device.requireDurableProvider();
  return new SignedMigrationTransport(device,directory,sources.allowedContentDomains,async(path,body,observation,operationSignal)=>{
    if(!operationSignal)return e2eeRequest(path,body,signal,observation);
    const controller=new AbortController(),abort=()=>controller.abort(),signals=[signal,operationSignal].filter((value):value is AbortSignal=>value!==undefined);
    for(const candidate of signals){candidate.addEventListener('abort',abort,{once:true});if(candidate.aborted)abort();}
    try{return await e2eeRequest(path,body,controller.signal,observation);}finally{for(const candidate of signals)candidate.removeEventListener('abort',abort);}
  },planning);
}
