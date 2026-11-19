type Ports={begin:(operationId:string)=>Promise<{operationId:string}>;end:(operationId:string)=>Promise<unknown>;restart:()=>Promise<unknown>};

/** One native owner permit covers the complete UI job, including picker waits
 * and all nested RPCs. Caller-selected IDs allow cleanup after a lost begin
 * receipt. The native side alone owns/drains the actual capability. */
export function nativeBackupOperations(ports:Ports){
 let busy=false,token='',restart=false;
 return{
  token:()=>token,
  requestRestart(){if(!token)throw new Error('E2EE_INVALID_LEGACY_OPERATION');restart=true;},
  async run<T>(action:()=>Promise<T>):Promise<T>{
   if(busy)throw new Error('E2EE_NESTED_LEGACY_OPERATION');const id=crypto.randomUUID();busy=true;restart=false;
   let failed=false,problem:unknown,value:T|undefined;
   try{
    const receipt=await ports.begin(id);if(!receipt||typeof receipt!=='object'||Object.keys(receipt).length!==1||receipt.operationId!==id)throw new Error('E2EE_INVALID_LEGACY_OPERATION');
    token=id;value=await action();
   }catch(error){failed=true;problem=error;}
   token='';
   try{await ports.end(id);if(!failed&&restart)await ports.restart();}
   catch(error){if(!failed){failed=true;problem=error;}}
   finally{busy=false;restart=false;}
   if(failed)throw problem;return value as T;
  },
 };
}
