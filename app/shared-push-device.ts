/** A device receipt is an opaque identifier, never a credential or cached message. */
export const sharedPushDeviceKey=(userId:string)=>`genesis.shared-push.${userId}`;

/** Browser push APIs cannot be aborted; a late subscription must never activate a closed form. */
export function waitForSharedPush<T>(work:Promise<T>,signal:AbortSignal,onLate?:(value:T)=>void,timeoutMs=15000):Promise<T> {
  return new Promise((resolve,reject)=>{
    let done=false,stopped=false;
    const clear=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);};
    const abort=()=>{if(done)return;done=true;stopped=true;clear();reject(new DOMException("Aborted","AbortError"));};
    const timer=setTimeout(()=>{if(done)return;done=true;stopped=true;clear();reject(new Error("PUSH_CONNECTION_FAILED"));},timeoutMs);
    signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
    work.then(value=>{if(done){if(stopped)try{onLate?.(value);}catch{/* A failed cleanup does not authorize server registration. */}return;}done=true;clear();resolve(value);},error=>{if(done)return;done=true;clear();reject(error);});
  });
}
