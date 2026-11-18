import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const workerImports=new Map(['e2ee-legacy-transport-worker.js','habit-reminder-worker.js','advice-notification-worker.js'].map(name=>
  [name,readFileSync(new URL(`../../public/${name}`,import.meta.url),'utf8')]));

/** Run the actual production worker and its actual security import. Only the
 * precache manifest is supplied by each isolated synthetic cache fixture. */
export function runServiceWorker(source,globals) {
  globals.self.navigator??={};
  const context=createContext({...globals,TextEncoder,TextDecoder,Headers,DOMException,AbortController});
  context.importScripts=(...urls)=>{
    for(const value of urls) {
      const url=new URL(value,globals.self.registration.scope);
      if(url.origin!==new URL(globals.self.registration.scope).origin)throw new Error('Unexpected worker import origin');
      const imported=workerImports.get(url.pathname.split('/').at(-1));
      if(imported)runInContext(imported,context);
      else if(!url.pathname.endsWith('/precache-manifest.js'))throw new Error('Unexpected worker import');
    }
  };
  runInContext(source,context);
}
