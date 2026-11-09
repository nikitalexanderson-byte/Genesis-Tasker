import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const directory=path.resolve(process.argv[2]??'android/app/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib');
const results=[];
for(const abi of await readdir(directory))for(const name of await readdir(path.join(directory,abi))){
 if(!name.endsWith('.so'))continue;
 const data=await readFile(path.join(directory,abi,name));
 if(data.subarray(0,4).toString('hex')!=='7f454c46'||data[5]!==1)throw Error(`Unsupported ELF ${abi}/${name}`);
 const wide=data[4]===2;
 const offset=wide?Number(data.readBigUInt64LE(40)):data.readUInt32LE(32);
 const size=data.readUInt16LE(wide?58:46),count=data.readUInt16LE(wide?60:48),strings=data.readUInt16LE(wide?62:50);
 const number=(at)=>wide?Number(data.readBigUInt64LE(at)):data.readUInt32LE(at);
 const stringSection=offset+strings*size,stringsOffset=number(stringSection+(wide?24:16)),stringsSize=number(stringSection+(wide?32:20));
 const table=data.subarray(stringsOffset,stringsOffset+stringsSize),sections=[];
 for(let index=0;index<count;index++){const start=data.readUInt32LE(offset+index*size);sections.push(table.subarray(start,table.indexOf(0,start)).toString());}
 results.push({abi,name,sha256:createHash('sha256').update(data).digest('hex'),symbolTable:sections.includes('.symtab'),debugInfo:sections.includes('.debug_info'),dynamicSymbols:sections.includes('.dynsym'),compressedDebug:sections.includes('.gnu_debugdata')});
}
console.log(JSON.stringify({source:'Merged upstream AndroidX libraries; no release build or upload performed',libraries:results},null,2));
