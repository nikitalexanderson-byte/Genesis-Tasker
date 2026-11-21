import {E2eeFeatureDocument} from './feature-document.ts';
import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validateAdviceMigrationPreferences} from './advice-source.ts';
import {uiVisibility,DEFAULT_UI_VISIBILITY,type UiVisibility,type AccountLayout} from '../ui-visibility.ts';
import type {AdvicePreferences} from '../daily-advice.ts';
import type {GenesisUser,SyncRouting} from '../cloud-sync.ts';

export type PrivatePreferences={protocol:1;ownerId:string;advicePreferences:AdvicePreferences;uiVisibility:UiVisibility;syncRouting:SyncRouting};
export type PrivatePreferencePatch={advicePreferences?:Partial<AdvicePreferences>;uiVisibility?:Partial<UiVisibility>;uiLayout?:Partial<AccountLayout>;syncRouting?:SyncRouting};
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_PRIVATE_PREFERENCES_INVALID');}
function strings(value:unknown):asserts value is string[]{if(!Array.isArray(value)||value.length>10000||new Set(value).size!==value.length||value.some(item=>typeof item!=='string'||item.length>256||!item))throw new Error('E2EE_PRIVATE_PREFERENCES_INVALID');}
function visibility(input:unknown):UiVisibility{object(input);for(const key of Object.keys(input))if(!Object.hasOwn(DEFAULT_UI_VISIBILITY,key))throw new Error('E2EE_PRIVATE_PREFERENCES_REVIEW_REQUIRED');
 for(const key of ['hiddenMenuItems','hiddenSubmenus','hiddenTodayBlocks','enabledCalendars'])if(input[key]!==undefined)strings(input[key]);
 const normalized=uiVisibility(input as Partial<UiVisibility>);
 for(const [key,value]of Object.entries(input))if(JSON.stringify(value)!==JSON.stringify(normalized[key as keyof UiVisibility]))throw new Error('E2EE_PRIVATE_PREFERENCES_REVIEW_REQUIRED');return normalized;}
function routing(input:unknown):SyncRouting{exactKeys(input,['mode','defaultAccountIds','categoryAccountIds']);if(!['fixed','choose','category'].includes(String(input.mode)))throw new Error('E2EE_PRIVATE_PREFERENCES_INVALID');
 strings(input.defaultAccountIds);object(input.categoryAccountIds);if(Object.keys(input.categoryAccountIds).length>10000)throw new Error('E2EE_PRIVATE_PREFERENCES_INVALID');
 for(const [key,value]of Object.entries(input.categoryAccountIds)){if(!key||key.length>256||['__proto__','constructor','prototype'].includes(key))throw new Error('E2EE_PRIVATE_PREFERENCES_INVALID');strings(value);}return input as SyncRouting;}
function validate(input:unknown,owner:string):PrivatePreferences{exactKeys(input,['protocol','ownerId','advicePreferences','uiVisibility','syncRouting']);if(input.protocol!==1||input.ownerId!==owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 return{protocol:1,ownerId:owner,advicePreferences:validateAdviceMigrationPreferences(input.advicePreferences),uiVisibility:visibility(input.uiVisibility),syncRouting:routing(input.syncRouting)};}
const decoder=new TextDecoder('utf-8',{fatal:true});
const stores=new WeakMap<WebPrivateAccount,E2eePrivatePreferences>();
export function privatePreferences(owner:string){const account=requirePrivateAccount(owner);let store=stores.get(account);if(!store){store=new E2eePrivatePreferences(account);stores.set(account,store);}return store;}
export class E2eePrivatePreferences{
 #document:E2eeFeatureDocument<PrivatePreferences>;#serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount){const owner=account.ownerId;
  this.#document=new E2eeFeatureDocument({ownerId:owner,domain:'workspace',objectId:'personal-preferences-live-v1',validate:value=>validate(value,owner),seed:async read=>{
   const seed=await read('personal-private-preferences-v1');exactKeys(seed,['protocol','ownerId','original']);if(seed.protocol!==1||seed.ownerId!==owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   exactKeys(seed.original,['categoryMapJson','visibilityJson','routingMode','routingTargetsJson']);const original=seed.original;
   const parse=(value:unknown,fallback:unknown)=>value===null?fallback:typeof value==='string'?parseLegacyMigrationJson(value,'E2EE_PRIVATE_PREFERENCES_INVALID',1024*1024):(()=>{throw new Error('E2EE_PRIVATE_PREFERENCES_INVALID');})();
   const adviceRow=await account.personal().client.read('workspace','personal-advice-preferences-v1');account.requireOpen();if(!adviceRow)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
   let advice:unknown;try{const value=parseLegacyMigrationJson(decoder.decode(adviceRow.bytes),'E2EE_PRIVATE_PREFERENCES_INVALID',16*1024*1024);object(value);
    if(value.protocol!==1||value.ownerId!==owner||!Object.hasOwn(value,'preferences'))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');advice=value.preferences;}finally{adviceRow.bytes.fill(0);}
   const categoryMap=parse(original.categoryMapJson,{}),targets=parse(original.routingTargetsJson,[]);
   return validate({protocol:1,ownerId:owner,advicePreferences:advice,uiVisibility:parse(original.visibilityJson,{}),syncRouting:{mode:original.routingMode??'fixed',
    defaultAccountIds:Array.isArray(targets)&&!targets.length?[owner]:targets,categoryAccountIds:Array.isArray(categoryMap)&&!categoryMap.length?{}:categoryMap}},owner);
  }});
 }
 #operation<T>(run:()=>Promise<T>):Promise<T>{const task=this.#serial.catch(()=>undefined).then(async()=>{this.account.requireOpen();if(requirePrivateAccount(this.account.ownerId)!==this.account)throw new Error('E2EE_ACCOUNT_CHANGED');return run();});this.#serial=task;return task;}
 read(){return this.#operation(async()=>{const view=await this.#document.read();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return structuredClone(view.document);});}
 apply(user:GenesisUser){return this.#operation(async()=>{if(user.uid!==this.account.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const view=await this.#document.read();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return{...user,...structuredClone({advicePreferences:view.document.advicePreferences,uiVisibility:view.document.uiVisibility,syncRouting:view.document.syncRouting})};});}
 update(patch:PrivatePreferencePatch){const input=structuredClone(patch);return this.#operation(async()=>{const view=await this.#document.read();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');const prior=view.document;
  const value=validate({...prior,advicePreferences:input.advicePreferences?{...prior.advicePreferences,...input.advicePreferences}:prior.advicePreferences,
   uiVisibility:{...prior.uiVisibility,...input.uiVisibility,...input.uiLayout},syncRouting:input.syncRouting??prior.syncRouting},this.account.ownerId);
  await this.#document.write(value);await this.#document.flush();return value;
 });}
}
