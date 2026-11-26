import catalogue from '../../contracts/e2ee/private-path-sources-v1.json' with {type:'json'};
import {requiredPrivatePaths,type PrivateScopeKind} from './private-paths.ts';
/** Fixed source allowlist. Request values never become SQL identifiers. */
export function privatePathSource(kind:PrivateScopeKind,pathId:string){
 const declared=requiredPrivatePaths(kind).find(path=>path.id===pathId),source=catalogue.paths.find(path=>path.id===pathId);
 if(catalogue.version!==1||!declared||!source||source.scope!==kind||JSON.stringify(source.server)!==JSON.stringify(declared.server))throw new Error('E2EE_SOURCE_PATH_FORBIDDEN');
 return{...source,tables:source.server.map(name=>{const row=catalogue.tables.find(value=>value.table===name);if(!row)throw new Error('E2EE_SOURCE_PATH_FORBIDDEN');return{table:row.table,columns:[...row.columns]};})};
}
export function validatePrivatePathPage(kind:PrivateScopeKind,pathId:string,table:string,offset:number,byteOffset:number){
 if(!privatePathSource(kind,pathId).tables.some(row=>row.table===table)||!Number.isSafeInteger(offset)||offset<0||offset>=Number.MAX_SAFE_INTEGER
  ||!Number.isSafeInteger(byteOffset)||byteOffset<0||byteOffset>64*1024*1024)throw new Error('E2EE_SOURCE_PATH_FORBIDDEN');
}
