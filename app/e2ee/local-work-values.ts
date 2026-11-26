import {encodeE2eeBytes} from './envelope.ts';

/** JSON.stringify(File) is empty. Keep selected, not yet uploaded import/file
 * bytes under the local migration root before any network IO. This is content,
 * never a grant to execute a captured command or reopen a filesystem path. */
export async function capturePrivateLocalValues(input:unknown,assertCurrent:()=>void,maximum=64*1024*1024):Promise<unknown>{
 let size=0,nodes=0;
 const walk=async(value:unknown,depth:number):Promise<unknown>=>{
  assertCurrent();if(depth>100||++nodes>200000)throw new Error('E2EE_SOURCE_TOO_LARGE');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');return value;}
  if(typeof value==='string'){size+=new TextEncoder().encode(value).length;if(size>maximum)throw new Error('E2EE_SOURCE_TOO_LARGE');return value;}
  if(typeof Blob!=='undefined'&&value instanceof Blob){
   if(!Number.isSafeInteger(value.size)||value.size<0||value.size>maximum-size)throw new Error('E2EE_SOURCE_TOO_LARGE');
   size+=value.size;const bytes=new Uint8Array(await value.arrayBuffer());
   try{assertCurrent();if(bytes.length!==value.size)throw new Error('E2EE_LOCAL_WORK_CAPTURE_CHANGED');
    return{format:'genesis-selected-file-v1',size:bytes.length,mediaType:value.type,
     filename:typeof File!=='undefined'&&value instanceof File?value.name:'',
     modifiedAt:typeof File!=='undefined'&&value instanceof File?value.lastModified:null,encoding:'base64url',bytes:encodeE2eeBytes(bytes)};
   }finally{bytes.fill(0);}
  }
  if(value instanceof Uint8Array){size+=value.length;if(size>maximum)throw new Error('E2EE_SOURCE_TOO_LARGE');return{format:'genesis-local-bytes-v1',encoding:'base64url',bytes:encodeE2eeBytes(value)};}
  if(Array.isArray(value)){if(value.length>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');const result=[];for(const child of value)result.push(await walk(child,depth+1));return result;}
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
  const output:Record<string,unknown>=Object.create(null);
  for(const [name,field]of Object.entries(Object.getOwnPropertyDescriptors(value))){
   if(!field.enumerable)continue;if(!Object.hasOwn(field,'value'))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
   if(field.value===undefined)continue;output[name]=await walk(field.value,depth+1);
  }
  return output;
 };
 return walk(input,0);
}
