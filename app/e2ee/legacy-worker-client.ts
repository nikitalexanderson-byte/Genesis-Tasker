const STATUS='GENESIS_E2EE_LEGACY_TRANSPORT_STATUS';
const MIGRATION_WINDOW='GENESIS_E2EE_MIGRATION_WINDOW';
/** Read-only capability check. Never force skipWaiting, reload tabs, clear caches
 * or start migration when an older worker still controls the application. */
export async function requireLegacyTransportWorker(container:ServiceWorkerContainer=navigator.serviceWorker):Promise<void> {
  if(!container?.controller)throw new Error('E2EE_SERVICE_WORKER_REQUIRED');
  const worker=container.controller;
  return new Promise<void>((resolve,reject)=>{
    const channel=new MessageChannel();
    const finish=(error?:Error)=>{clearTimeout(timer);channel.port1.close();channel.port2.close();if(error)reject(error);else resolve();};
    const timer=setTimeout(()=>finish(new Error('E2EE_WORKER_UPGRADE_REQUIRED')),2500);
    channel.port1.onmessage=event=>{
      if(event.data?.type!==STATUS||event.data?.protocol!==2||container.controller!==worker){finish(new Error('E2EE_WORKER_UPGRADE_REQUIRED'));return;}finish();
    };
    channel.port1.onmessageerror=()=>finish(new Error('E2EE_WORKER_UPGRADE_REQUIRED'));
    try { worker.postMessage({type:STATUS},[channel.port2]); }catch{finish(new Error('E2EE_WORKER_UPGRADE_REQUIRED'));}
  });
}
/** Old/other application tabs cannot attest a local writer barrier. Preparation
 * requires a single same-origin window, including uncontrolled clients. Check
 * again at each write-fenced protocol phase; never close or reload other tabs. */
export async function requireExclusiveMigrationWindow(container:ServiceWorkerContainer=navigator.serviceWorker):Promise<void>{
 await requireLegacyTransportWorker(container);const worker=container.controller;
 if(!worker)throw new Error('E2EE_SERVICE_WORKER_REQUIRED');
 return new Promise<void>((resolve,reject)=>{
  const channel=new MessageChannel();let done=false;
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);channel.port1.close();channel.port2.close();if(error)reject(error);else resolve();};
  const timer=setTimeout(()=>finish(new Error('E2EE_OTHER_WINDOWS_OPEN')),2500);
  channel.port1.onmessage=event=>{
   if(event.data?.type!==MIGRATION_WINDOW||event.data?.protocol!==1||event.data?.exclusive!==true||container.controller!==worker){finish(new Error('E2EE_OTHER_WINDOWS_OPEN'));return;}finish();
  };
  channel.port1.onmessageerror=()=>finish(new Error('E2EE_OTHER_WINDOWS_OPEN'));
  try{worker.postMessage({type:MIGRATION_WINDOW},[channel.port2]);}catch{finish(new Error('E2EE_WORKER_UPGRADE_REQUIRED'));}
 });
}
