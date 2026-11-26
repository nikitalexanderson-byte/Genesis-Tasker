/** Recheck the NATIVE view/account capability in the renderer immediately before
 * a pending promise adopts its value. Main-thread admission alone cannot cover
 * the additional evaluateJavascript/renderer queue. No private reply is exempt. */
export function assertNativeBackupSession(current:(operationId:string)=>boolean,operationId:string){
 let accepted=false;try{accepted=current(operationId)===true;}catch{/* Native exception details stay out of UI/errors. */}
 if(!accepted)throw new Error('BACKUP_OWNER');
}
export function acceptNativeBackupReply(method:string,operationId:string,response:unknown,current:(operationId:string)=>boolean):unknown{
 if(!response||typeof response!=='object'||Array.isArray(response))throw new Error('BACKUP_TRANSFER');
 const row=response as Record<string,unknown>,fields=Object.keys(row);
 if(fields.length!==1||!['error','value'].includes(fields[0]))throw new Error('BACKUP_TRANSFER');
 if(Object.hasOwn(row,'error'))throw new Error(typeof row.error==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(row.error)?row.error:'BACKUP_NATIVE_FAILED');
 if(row.value===undefined)throw new Error('BACKUP_TRANSFER');
 // Cleanup/navigation may finish after their own account transport retirement.
 // Their exact receipts contain no private result or restored authority.
 if(method==='operationEnd'){
  if(row.value!==true)throw new Error('BACKUP_TRANSFER');
 }else if(method==='restart'){
  if(!row.value||typeof row.value!=='object'||Array.isArray(row.value)||Object.keys(row.value).length)throw new Error('BACKUP_TRANSFER');
 }else assertNativeBackupSession(current,operationId);
 return row.value;
}
