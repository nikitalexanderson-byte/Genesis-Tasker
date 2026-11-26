import {backupJson} from '../backup-format.ts';

/** Keep the original text until decoded duplicate property names have been
 * rejected. JSON.parse/JSONObject alone silently replace private old fields. */
export function parseLegacyMigrationJson(value:unknown,errorCode='E2EE_LEGACY_SOURCE_INVALID',maximum=16*1024*1024):unknown{
 const invalid=():never=>{throw new Error(errorCode);};
 if(typeof value!=='string'||value.length>maximum||!Number.isSafeInteger(maximum)||maximum<1||maximum>512*1024*1024)invalid();
 try{
  const result=backupJson(value as string,maximum,8000000),source=value as string,stack:(Set<string>|null)[]=[];
  for(let index=0;index<source.length;index++){
   const char=source[index];if(char==='{'||char==='['){stack.push(char==='{'?new Set():null);if(stack.length>41)invalid();}
   else if(char==='}'||char===']')stack.pop();else if(char==='"'){
    const start=index;index++;while(index<source.length&&source[index]!=='"'){if(source[index]==='\\')index++;index++;}
    let next=index+1;while(next<source.length&&/\s/u.test(source[next]))next++;
    if(source[next]===':'){const names=stack.at(-1);if(!names)return invalid();const key=JSON.parse(source.slice(start,index+1)) as string;if(names.has(key))invalid();names.add(key);}
   }
  }
  return result;
 }catch{return invalid();}
}
