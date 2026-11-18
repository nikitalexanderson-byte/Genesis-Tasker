import policy from '../../contracts/e2ee/legacy-transport-v1.json' with {type:'json'};

/** Content classification shared with PHP/Android. This grants no network access
 * and does not assert that the product's multitab transport barrier is installed. */
export function personalLegacyTransportProtected(method:string,path:string,body?:unknown):boolean{
  if(policy.version!==1)throw new Error('E2EE_INVALID_TRANSPORT_POLICY');
  const route=path.replace(/^\/+/, '').split('?',1)[0];method=method.toUpperCase();
  if(policy.personalPrefixes.some(prefix=>route===prefix||route.startsWith(`${prefix}/`)||route.startsWith(`${prefix}-`))||policy.personalExact.includes(route))return true;
  if(route===policy.preferencesPath&&!['GET','HEAD','OPTIONS'].includes(method)&&body!==undefined){
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('E2EE_INVALID_TRANSPORT_POLICY');
    return Object.keys(body).some(key=>!policy.metadataPreferenceKeys.includes(key));
  }
  return false;
}
