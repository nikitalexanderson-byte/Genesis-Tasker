/** Only the HTTP adapter may turn an actual bounded Retry-After into this
 * technical error. It contains no response body or authentication material. */
export class E2eeReadRateError extends Error {
 readonly seconds:number;
 constructor(seconds:number){
  super('E2EE_HTTP_ERROR');
  if(!Number.isInteger(seconds)||seconds<0||seconds>600)throw new Error('E2EE_INVALID_RETRY_AFTER');
  this.seconds=seconds;
 }
}
/** The same immutable read is retried. Source observations and mutations use
 * their existing explicit protocols. Every timer is bounded to1s and checks
 * lock/owner again before another request. Wall-clock changes cannot extend it. */
export async function retryE2eeRead<T>(read:()=>Promise<T>,current:()=>void,ports:{now?:()=>number;sleep?:(ms:number)=>Promise<void>}={}){
 const now=ports.now??(()=>performance.now()),sleep=ports.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;attempt<3;attempt++){
  current();
  try{const result=await read();current();return result;}
  catch(error){
   current();if(!(error instanceof E2eeReadRateError)||attempt===2)throw error;
   if(!Number.isInteger(error.seconds)||error.seconds<0||error.seconds>600)throw new Error('E2EE_INVALID_RETRY_AFTER');
   const until=now()+error.seconds*1000;
   while(now()<until){current();await sleep(Math.min(1000,until-now()));current();}
  }
 }
 throw new Error('E2EE_HTTP_ERROR');
}
