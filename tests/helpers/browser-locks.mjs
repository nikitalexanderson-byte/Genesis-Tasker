/** Browser-platform IO fixture, not a replacement for application policy.
 * FIFO shared/exclusive permits, queued aborts and release on both outcomes.
 * Actual LockManager/IndexedDB acceptance lives in the Chromium QA harness. */
export class FixtureLockManager {
  states=new Map();
  request(name,options,callback) {
    if(typeof options==='function'){callback=options;options={};}
    const mode=options?.mode??'exclusive',signal=options?.signal;
    if(!['shared','exclusive'].includes(mode)||typeof callback!=='function')return Promise.reject(new TypeError('Invalid lock request'));
    if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Aborted','AbortError'));
    const state=this.states.get(name)??{active:new Set(),queue:[]};this.states.set(name,state);
    return new Promise((resolve,reject)=>{
      const job={name,mode,callback,resolve,reject,signal};
      job.abort=()=>{const index=state.queue.indexOf(job);if(index>=0){state.queue.splice(index,1);reject(signal.reason??new DOMException('Aborted','AbortError'));this.drain(state);}};
      signal?.addEventListener('abort',job.abort,{once:true});state.queue.push(job);this.drain(state);
    });
  }
  drain(state) {
    if([...state.active].some(job=>job.mode==='exclusive'))return;
    while(state.queue.length) {
      const next=state.queue[0];if(next.mode==='exclusive'&&state.active.size)return;
      state.queue.shift();state.active.add(next);next.signal?.removeEventListener('abort',next.abort);
      Promise.resolve().then(()=>next.callback(Object.freeze({name:next.name,mode:next.mode}))).then(next.resolve,next.reject).finally(()=>{state.active.delete(next);this.drain(state);});
      if(next.mode==='exclusive')return;
    }
  }
  async query(){return{held:[...this.states.values()].flatMap(state=>[...state.active].map(({name,mode})=>({name,mode}))),pending:[...this.states.values()].flatMap(state=>state.queue.map(({name,mode})=>({name,mode})))};}
}
