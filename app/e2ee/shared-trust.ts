import {E2eeFeatureDocument} from './feature-document.ts';
import {requirePrivateAccount} from './product-session.ts';
import {assertTechnical,exactKeys,type PublicDeviceKeys} from './keys.ts';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';

export type SharedScopeTrust={scopeId:string;ownerId:string;kind:'project'|'space';resourceId:string;authority:PublicDeviceKeys;fingerprint:string;acceptedAt:string};
export type SharedTrustProposal=Omit<SharedScopeTrust,'fingerprint'|'acceptedAt'>;
type State={protocol:1;ownerId:string;scopes:SharedScopeTrust[]};
export async function sharedScopeFingerprint(value:SharedTrustProposal){
 exactKeys(value,['scopeId','ownerId','kind','resourceId','authority']);for(const key of ['scopeId','ownerId','resourceId'] as const)assertTechnical(value[key]);
 if(!['project','space'].includes(value.kind))throw new Error('E2EE_SHARED_TRUST_INVALID');exactKeys(value.authority,['signingKey','receivingKey']);
 await crypto.subtle.importKey('spki',decodeE2eeBytes(value.authority.signingKey,91),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 await crypto.subtle.importKey('raw',decodeE2eeBytes(value.authority.receivingKey,65),{name:'ECDH',namedCurve:'P-256'},false,[]);
 return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',canonicalE2eeValue(value as unknown as WireValue))));
}
/** Server-provided group keys never become a trust anchor on their own. An
 * explicit fingerprint comparison is saved inside the member's personal vault,
 * so recovery on a new device can recover the same prior trust decision. */
export class E2eeSharedTrust{
 #document:E2eeFeatureDocument<State>;#serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly ownerId:string){this.#document=new E2eeFeatureDocument({ownerId,domain:'key-check',objectId:'personal-shared-trust-live-v1',validate:async value=>{
  exactKeys(value,['protocol','ownerId','scopes']);if(value.protocol!==1||value.ownerId!==ownerId||!Array.isArray(value.scopes)||value.scopes.length>4096)throw new Error('E2EE_SHARED_TRUST_INVALID');const seen=new Set<string>();
  for(const row of value.scopes){exactKeys(row,['scopeId','ownerId','kind','resourceId','authority','fingerprint','acceptedAt']);
   const {fingerprint,acceptedAt,...proposal}=row;if(seen.has(String(row.scopeId))||typeof acceptedAt!=='string'||!Number.isFinite(Date.parse(acceptedAt))||fingerprint!==await sharedScopeFingerprint(proposal as SharedTrustProposal))throw new Error('E2EE_SHARED_TRUST_INVALID');seen.add(row.scopeId as string);}
  return value as State;
 },seed:async()=>({protocol:1,ownerId,scopes:[]})});}
 async list(){const view=await this.#document.read();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return structuredClone(view.document.scopes);}
 accept(input:SharedTrustProposal,comparedFingerprint:string){const proposal=structuredClone(input),task=this.#serial.catch(()=>undefined).then(async()=>{const fingerprint=await sharedScopeFingerprint(proposal);requirePrivateAccount(this.ownerId).requireOpen();
  if(comparedFingerprint!==fingerprint)throw new Error('E2EE_SHARED_FINGERPRINT_MISMATCH');const view=await this.#document.read();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
  const old=view.document.scopes.find(row=>row.scopeId===proposal.scopeId);if(old&&old.fingerprint!==fingerprint)throw new Error('E2EE_SHARED_AUTHORITY_CHANGED');
  const scopes=[...view.document.scopes.filter(row=>row.scopeId!==proposal.scopeId),{...proposal,fingerprint,acceptedAt:old?.acceptedAt??new Date().toISOString()}];
  await this.#document.write({...view.document,scopes});await this.#document.flush();
 });this.#serial=task;return task;
 }
 async open(scopeId:string){assertTechnical(scopeId);const account=requirePrivateAccount(this.ownerId),trust=(await this.list()).find(row=>row.scopeId===scopeId);
  if(!trust)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');account.requireOpen();
  return account.openScope({scopeId,kind:trust.kind,resourceId:trust.resourceId,state:'active'},trust.authority,trust.ownerId);
 }
}
