import {e2eeRequest} from '../cloud-sync';
import type {ScopeTransport} from './scope-client.ts';
import {SignedMigrationTransport} from './migration-transport.ts';
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

export function authenticatedMigrationTransport(device:UnlockedWebDevice,directory:VerifiedDirectory,sources:MigrationSources,signal?:AbortSignal){
  sources.assertBinding?.(directory.ownerId,directory.scopeId,directory.kind);
  return new SignedMigrationTransport(device,directory,sources.allowedContentDomains,(path,body)=>e2eeRequest(path,body,signal));
}
