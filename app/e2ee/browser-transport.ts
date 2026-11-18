import {e2eeRequest} from '../cloud-sync';
import type {ScopeTransport} from './scope-client.ts';

/** Uses the existing account session, CSRF, timeout and account-switch aborts. */
export function authenticatedScopeTransport(signal?:AbortSignal):ScopeTransport {
  return {
    directory:scopeId=>e2eeRequest('/directory',{scopeId},signal),
    command:packet=>e2eeRequest('/command',packet,signal),
    read:packet=>e2eeRequest('/read',packet,signal),
  };
}
