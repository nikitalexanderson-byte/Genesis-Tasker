import { getRuntimeLanguage } from "./i18n";
import unavailable from "./api-availability-copy.json";
import billingCopy from "./billing-safety-copy.json";
export const isTemporaryApiStatus = (status: number) => [408, 502, 503, 504].includes(status);
export const apiUnavailableMessage = () => unavailable[getRuntimeLanguage()] ?? unavailable.en;
export function billingApiErrorMessage(code:unknown,path:string,method='GET'):string|null {
  if(code!=='BILLING_SETTLEMENT_REQUIRED')return null;
  const copy=billingCopy[getRuntimeLanguage()]??billingCopy.en;
  return method.toUpperCase()==='DELETE'&&(path==='/account'||/^\/admin\/users\/[^/]+$/.test(path))
    ?copy.accountDeletionBlocked:copy.settlementRequired;
}
