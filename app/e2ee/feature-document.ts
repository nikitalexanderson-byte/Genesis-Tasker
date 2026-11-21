import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eePrivateDocument,type PrivateDocumentView} from './product-repository.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {exactKeys} from './keys.ts';
import type {E2eeContext} from './envelope.ts';

type State<T>={protocol:1;ownerId:string;document:T;base:T};
export type FeatureDocumentView<T>={document:T;base:T;pending:boolean;remoteRevision:number;conflict:{document:T;revision:number}|null};
type Binding<T>={account:WebPrivateAccount;document:E2eePrivateDocument<State<T>>;view:PrivateDocumentView<State<T>>|null};
/** Domain editors retain the exact baseline of their first pending edit inside
 * the encrypted document. Offline edits/reloads therefore preserve a real merge
 * base. The object supplies no legacy fallback, entitlement or executable import. */
export class E2eeFeatureDocument<T>{
 #binding:Binding<T>|null=null;#serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly options:{ownerId:string;domain:E2eeContext['domain'];objectId:string;validate:(value:unknown)=>T;
  seed:(read:(id:string)=>Promise<unknown>)=>Promise<T>}){}
 #current(binding:Binding<T>){binding.account.requireOpen();if(requirePrivateAccount(this.options.ownerId)!==binding.account)throw new Error('E2EE_ACCOUNT_CHANGED');}
 #bind(account:WebPrivateAccount){
  if(this.#binding?.account===account)return this.#binding;const {client,directory}=account.personal();
  const binding={} as Binding<T>;binding.account=account;binding.view=null;
  binding.document=new E2eePrivateDocument({device:account.device,client,scopeId:directory.scopeId,domain:this.options.domain,objectId:this.options.objectId,
   assertCurrent:()=>this.#current(binding),assertWrite:()=>this.#current(binding),validate:value=>{exactKeys(value,['protocol','ownerId','document','base']);
    if(value.protocol!==1||value.ownerId!==this.options.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    return{protocol:1,ownerId:this.options.ownerId,document:this.options.validate(value.document),base:this.options.validate(value.base)};}});
  return this.#binding=binding;
 }
 #operation<R>(run:(binding:Binding<T>)=>Promise<R>):Promise<R>{
  const account=requirePrivateAccount(this.options.ownerId),task=this.#serial.catch(()=>undefined).then(async()=>{const binding=this.#bind(account);this.#current(binding);return run(binding);});this.#serial=task;return task;
 }
 #view(binding:Binding<T>):FeatureDocumentView<T>{this.#current(binding);const view=binding.view;if(!view)throw new Error('E2EE_PRODUCT_READ_REQUIRED');
  return{document:structuredClone(view.value.document),base:structuredClone(view.value.base),pending:view.pending,remoteRevision:view.remoteRevision,
   conflict:view.conflict?{document:structuredClone(view.conflict.value.document),revision:view.conflict.revision}:null};
 }
 async #load(binding:Binding<T>,refresh=false){
  if(binding.view&&!refresh)return this.#view(binding);
  try{binding.view=await binding.document.load(binding.account.mode);}
  catch(error){if(binding.account.mode!=='online'||!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;
   const document=this.options.validate(await this.options.seed(async id=>{const row=await binding.account.personal().client.read(this.options.domain,id);this.#current(binding);if(!row)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
    try{return parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(row.bytes),'E2EE_PRIVATE_DOCUMENT_CORRUPT',64*1024*1024);}finally{row.bytes.fill(0);}}));
   this.#current(binding);const value:State<T>={protocol:1,ownerId:this.options.ownerId,document,base:structuredClone(document)},serial=await binding.document.save(value,{serial:null,remoteRevision:0});
   binding.view={value,serial,remoteRevision:0,pending:true,conflict:null};
  }return this.#view(binding);
 }
 read(refresh=true){return this.#operation(binding=>this.#load(binding,refresh));}
 write(input:T){const document=this.options.validate(structuredClone(input));return this.#operation(async binding=>{await this.#load(binding);const prior=binding.view!;
  const value:State<T>={protocol:1,ownerId:this.options.ownerId,document,base:structuredClone(prior.pending?prior.value.base:prior.value.document)},serial=await binding.document.save(value,prior);
  binding.view={...prior,value,serial,pending:true};return this.#view(binding);
 });}
 resolve(input:T,expectedConflictRevision:number){const document=this.options.validate(structuredClone(input));return this.#operation(async binding=>{
  if(binding.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');await this.#load(binding,true);const prior=binding.view!;
  if(!prior.conflict||prior.conflict.revision!==expectedConflictRevision)throw new Error('E2EE_CONFLICT_REVIEW_STALE');
  const value:State<T>={protocol:1,ownerId:this.options.ownerId,document,base:structuredClone(prior.conflict.value.document)};
  const serial=await binding.document.reviewConflict(value,{serial:prior.serial,remoteRevision:prior.conflict.revision});
  binding.view={value,serial,remoteRevision:prior.conflict.revision,pending:true,conflict:null};return this.#view(binding);
 });}
 flush(){return this.#operation(async binding=>{await this.#load(binding);const prior=binding.view!;if(prior.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
  if(!prior.pending||binding.account.mode==='offline')return this.#view(binding);
  await binding.document.flush();binding.view=await binding.document.load('offline');this.#current(binding);
  if(binding.view.pending||JSON.stringify(binding.view.value)!==JSON.stringify(prior.value))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return this.#view(binding);
 });}
}
