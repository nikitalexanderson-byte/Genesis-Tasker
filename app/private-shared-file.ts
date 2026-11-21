import {sharedCollaborationRequest} from './cloud-sync';
import {privateAccountView,privateAccountIsRequired,requirePrivateAccount} from './e2ee/product-session';
import {decodeE2eeBytes} from './e2ee/envelope';
import {exactKeys} from './e2ee/keys';

export function privateSharedFileOwner(){const view=privateAccountView();return view.ownerId&&privateAccountIsRequired(view.ownerId)?view.ownerId:null;}
export async function readPrivateSharedFile(source:string,ownerId:string,signal?:AbortSignal){
 const account=requirePrivateAccount(ownerId),url=new URL(source,window.location.origin);
 if(url.origin!==window.location.origin||url.search||url.hash||!/^\/api\/shared\/tasks\/[A-Za-z0-9_-]{1,160}\/(?:image|attachments\/[A-Za-z0-9_-]{1,160})$/.test(url.pathname))throw new Error('E2EE_PRIVATE_FILE_INVALID');
 const result=await sharedCollaborationRequest<unknown>(url.pathname.slice('/api/shared'.length),{signal});account.requireOpen();if(requirePrivateAccount(ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');signal?.throwIfAborted();
 exactKeys(result,['data','size','filename','mediaType']);if(!Number.isSafeInteger(result.size)||Number(result.size)<1||Number(result.size)>10*1024*1024||typeof result.filename!=='string'||result.filename.length>512||typeof result.mediaType!=='string'||result.mediaType.length>128)throw new Error('E2EE_PRIVATE_FILE_CORRUPT');
 return{bytes:decodeE2eeBytes(result.data,Number(result.size)),filename:result.filename,mediaType:result.mediaType};
}
