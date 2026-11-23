import {assertTechnical,exactKeys} from './keys.ts';
import {snapshotE2eeValue,type WireValue} from './commands.ts';

export const NATIVE_UI_PREFERENCES_ID='native-ui-preferences-v1';
const pendingNames=new Set(['display','input','time','weekStart','gregorianYearStart','language','stoicheionDivinationDisabled','sharedProjectsEnabled','theme','themeRevision','darkPalette']);
/** Retention/export only. A native cache is never applied as web preferences or
 * as a credential, subscription, grant, key or executable imported request. */
export function validateNativeUiPreferences(input:unknown,ownerId:string){
 exactKeys(input,['format','ownerId','values','pending']);assertTechnical(ownerId);
 if(input.format!=='genesis-native-ui-preferences-v1'||input.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 for(const field of ['values','pending'] as const){
  const values=input[field];if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length>1024)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
  for(const [key,value]of Object.entries(values))if(!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)||typeof value!=='string'||value.length>65536||field==='pending'&&!pendingNames.has(key))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 }
 if(new TextEncoder().encode(JSON.stringify(input)).length>256*1024)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 return snapshotE2eeValue(input as WireValue);
}
