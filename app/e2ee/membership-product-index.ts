import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {assertTechnical} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {productEntity,type ProductEntity} from './product-contract.ts';

const digest=(value:unknown)=>{const bytes=canonicalE2eeValue(value as WireValue);try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}};
/** Complete verified business-head index, including tombstones. Hash each row
 * first so a large workflow cannot force one giant canonical wire document. */
export function membershipProductIndexHash(scopeId:string,input:ProductEntity[]){
 assertTechnical(scopeId);if(input.length>10000)throw new Error('E2EE_SCOPE_OBJECT_LIMIT');const rows=input.map(productEntity).sort((a,b)=>a.entityId<b.entityId?-1:a.entityId>b.entityId?1:0);
 if(new Set(rows.map(row=>row.entityId)).size!==rows.length)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
 return digest({format:'genesis-membership-product-index-v1',scopeId,entities:rows.map(digest)});
}
