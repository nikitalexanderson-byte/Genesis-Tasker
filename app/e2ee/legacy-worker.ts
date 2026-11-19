import {personalLegacyTransportProtected} from './legacy-transport.ts';
import {IndexedDbLegacyTransportMarkers,LEGACY_UNBOUND_TRANSPORT_LOCK,type LegacyTransportLocks} from './legacy-transport-fence.ts';
import {assertTechnical} from './keys.ts';

export const LEGACY_WORKER_STATUS='GENESIS_E2EE_LEGACY_TRANSPORT_STATUS';
const MAX_PREFERENCES=64*1024,MAX_OLD_RESPONSE=64*1024*1024;
type MarkerReader=Pick<IndexedDbLegacyTransportMarkers,'get'|'any'>;
type WorkerGate={locks?:LegacyTransportLocks;markers:()=>MarkerReader};
/** The unknown-owner background worker uses the same global exclusion as old
 * sockets. Current page receipt calls already hold their owner's operation and
 * explicitly borrow it to avoid queuing behind an exclusive migration waiting
 * for that same page. This flag is a local lifecycle contract, no ACL authority. */
export async function legacyWorkerBackground<T>(options:WorkerGate,operation:()=>Promise<T>,borrowedOwner:string|null=null):Promise<T>{
 if(!options.locks?.request)throw new Error('E2EE_BROWSER_LOCKS_REQUIRED');
 if(borrowedOwner!==null){assertTechnical(borrowedOwner);if(await options.markers().get(borrowedOwner))throw new Error('E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN');return operation();}
 return options.locks.request(LEGACY_UNBOUND_TRANSPORT_LOCK,{mode:'shared'},async()=>{
  if(await options.markers().any())throw new Error('E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN');return operation();
 });
}
function denied(code:string,status=409) { return new Response(JSON.stringify({error:code}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}); }
function storageFailure(error:unknown) { return error instanceof Error&&error.message==='E2EE_CORRUPT_LOCAL_FENCE'
  ?denied('E2EE_CORRUPT_LOCAL_FENCE'):denied('E2EE_STORAGE_UNAVAILABLE',503); }
async function readBounded(stream:ReadableStream<Uint8Array>|null,maximum:number):Promise<Uint8Array<ArrayBuffer>> {
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>MAX_OLD_RESPONSE)throw new Error('E2EE_INVALID_RESOURCE_LIMIT');
  if(!stream)return new Uint8Array();const reader=stream.getReader();let bytes=new Uint8Array(Math.min(8192,maximum)),total=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;const next=total+value.byteLength;
      if(next>maximum){void reader.cancel().catch(()=>{});throw new Error('E2EE_LEGACY_RESPONSE_TOO_LARGE');}
      // A maliciously fragmented stream must not allocate millions of separate
      // retained chunk objects below the byte budget. Grow one bounded buffer.
      if(next>bytes.byteLength){const grown=new Uint8Array(Math.min(maximum,Math.max(next,bytes.byteLength*2)));grown.set(bytes.subarray(0,total));bytes=grown;}
      bytes.set(value,total);total=next;}
  }finally{reader.releaseLock();}
  return bytes.slice(0,total);
}
async function privateRequest(request:Request,path:string) {
  if(path==='account/preferences'&&!['GET','HEAD','OPTIONS'].includes(request.method)) {
    // Malformed, opaque and oversized preference bodies are PRIVATE. Never
    // classify unknown bytes as technical metadata or forward a partial body.
    try { const bytes=await readBounded(request.clone().body,MAX_PREFERENCES);
      return personalLegacyTransportProtected(request.method,path,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    }catch{return true;}
  }
  return personalLegacyTransportProtected(request.method,path);
}

/** Same-origin personal transport only. No session/ACL/key authority. Identified
 * application requests already hold their page's shared owner lock: acquiring it
 * again in SW would deadlock behind a queued exclusive migration. */
export function legacyWorkerGuard(options:{origin:string;apiPrefix:string;locks?:LegacyTransportLocks;
  markers:()=>MarkerReader;fetch:(request:Request)=>Promise<Response>;responseLimit?:number}) {
  return async(request:Request):Promise<Response>=>{
    const url=new URL(request.url);
    if(url.origin!==options.origin||!url.pathname.startsWith(options.apiPrefix))return options.fetch(request);
    const path=url.pathname.slice(options.apiPrefix.length);
    if(!await privateRequest(request,path))return options.fetch(request);
    const locks=options.locks;if(!locks?.request)return denied('E2EE_BROWSER_LOCKS_REQUIRED',503);
    const owner=request.headers.get('X-Genesis-Account-Id');
    if(owner!==null) {
      try { assertTechnical(owner);if(await options.markers().get(owner))return denied('E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN'); }
      catch(error){return storageFailure(error);}
      return options.fetch(new Request(request,{cache:'no-store'}));
    }
    // Unknown old client: serialize all its private network IO with preparation.
    // Any marker is a conservative deny superset, NEVER a read/export permission.
    return locks.request(LEGACY_UNBOUND_TRANSPORT_LOCK,{mode:'shared'},async()=>{
      try { if(await options.markers().any())return denied('E2EE_UPGRADE_REQUIRED'); }
      catch(error){return storageFailure(error);}
      const response=await options.fetch(new Request(request,{cache:'no-store'}));
      try {
        // Old pages cannot keep a transfer beyond a released network permit.
        // Bound only these unidentified legacy readers; current clients retain
        // streaming and their full response-parse lock in the application API.
        const body=response.body===null?null:await readBounded(response.body,options.responseLimit??MAX_OLD_RESPONSE);
        const headers=new Headers(response.headers);headers.delete('Content-Encoding');headers.delete('Content-Length');headers.set('Cache-Control','no-store');
        return new Response(body,{status:response.status,statusText:response.statusText,headers});
      }catch(error){return error instanceof Error&&error.message==='E2EE_LEGACY_RESPONSE_TOO_LARGE'
        ?denied('E2EE_LEGACY_RESPONSE_TOO_LARGE'):denied('E2EE_NETWORK_INTERRUPTED',503);}
    });
  };
}

/** Classic SW bundle entry. Storage opens lazily, not during public shell boot. */
export function installLegacyTransportWorker(target:{location:{origin:string};registration:{scope:string};navigator:{locks?:LegacyTransportLocks};
  addEventListener:(type:'message',listener:(event:MessageEvent)=>void)=>void}) {
  let markers:IndexedDbLegacyTransportMarkers|null=null,backgroundReady=false;
  const origin=target.location.origin,apiPrefix=new URL('api/',target.registration.scope).pathname;
  target.addEventListener('message',event=>{
    if(event.data?.type===LEGACY_WORKER_STATUS)event.ports[0]?.postMessage({type:LEGACY_WORKER_STATUS,protocol:target.navigator.locks?.request?(backgroundReady?2:1):0});
  });
  const guard=legacyWorkerGuard({origin,apiPrefix,locks:target.navigator.locks,
    markers:()=>markers??(markers=new IndexedDbLegacyTransportMarkers()),fetch:request=>fetch(request)});
  return Object.assign(guard,{completeBackgroundInstall:()=>{backgroundReady=true;},background:<T,>(operation:()=>Promise<T>,borrowedOwner:string|null=null)=>legacyWorkerBackground({locks:target.navigator.locks,markers:()=>markers??(markers=new IndexedDbLegacyTransportMarkers())},operation,borrowedOwner),handles:(request:Request)=>{
    const url=new URL(request.url);if(url.origin!==origin||!url.pathname.startsWith(apiPrefix))return false;
    const path=url.pathname.slice(apiPrefix.length);
    return path==='account/preferences'&&!['GET','HEAD','OPTIONS'].includes(request.method)||personalLegacyTransportProtected(request.method,path);
  }});
}
