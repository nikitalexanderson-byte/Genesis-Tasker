/** One persistent, fail-closed router owns both startup navigations of a tier. */
export function createStartupRouting(baseURL) {
  let operation=null,closing=false;
  const pending=new Set(),errors=[],teardownErrors=[];
  const handle=route=>{
    const owner=operation;
    const invocation={owner,promise:null};
    invocation.promise=(async()=>{
      try {
        const url=new URL(route.request().url());
        if(closing||url.origin!==baseURL)return await route.abort();
        if(owner&&url.pathname==='/api/bootstrap')return await owner.bootstrap(route);
        if(owner&&url.pathname==='/api/shared/tasks')return await owner.shared(route);
        await route.continue();
      } catch(error) {
        const message=String(error?.message??error).split('\n')[0];
        if(closing&&/Target page, context or browser has been closed/.test(message)) {
          teardownErrors.push(message);return;
        }
        errors.push(message);owner?.row.routeErrors.push(message);
        // A routing failure never releases the request onto the external network.
        try {await route.abort();}catch(abortError){errors.push(`Abort failed: ${String(abortError?.message??abortError).split('\n')[0]}`);}
      }
    })();
    pending.add(invocation);
    void invocation.promise.finally(()=>pending.delete(invocation));
    return invocation.promise;
  };
  return {handle,errors,teardownErrors,
    begin(row,bootstrap,shared){operation={row,bootstrap,shared};},
    end(){operation=null;},
    closing(){closing=true;operation=null;},
    async drain(row){
      for(;;){const active=[...pending].filter(item=>!row||item.owner?.row===row);if(!active.length)return;await Promise.all(active.map(item=>item.promise));}
    },
  };
}
