/** Equality for already bounded, validated private JSON. Command encoding has
 * deliberately narrower number/string limits and is not a content codec. */
export function samePrivateJson(left:unknown,right:unknown):boolean{
 const pending:[unknown,unknown][]=[[left,right]];let nodes=0;
 while(pending.length){if(++nodes>1000000)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');const [a,b]=pending.pop()!;if(a===b)continue;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  if(Array.isArray(a)){const rows=b as unknown[];if(a.length!==rows.length)return false;for(let i=0;i<a.length;i++)pending.push([a[i],rows[i]]);}
  else{const keys=Object.keys(a),other=b as Record<string,unknown>;if(keys.length!==Object.keys(other).length)return false;for(const key of keys){if(!Object.hasOwn(other,key))return false;pending.push([(a as Record<string,unknown>)[key],other[key]]);}}
 }return true;
}
