import {e2eeRequest,loadGenesisSession} from '../../app/cloud-sync';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show();};
const select=async(mode:string)=>{const response=await fetch('/control?mode='+mode);if(!response.ok)throw new Error('Fixture control failed');};
const request=()=>e2eeRequest<{sourceHash:string}>('/source',{scopeId:'personal:http-policy-owner'});
try{
 check('actual authenticated client establishes only the synthetic account',(await loadGenesisSession())?.uid==='http-policy-owner');
 const before=JSON.stringify(Object.entries(localStorage).sort());
 await select('redirect');let refused=false;try{await request();}catch{refused=true;}
 check('actual browser refuses a307 before another origin can supply E2EE data',refused);
 const metrics=await(await fetch('/metrics.json')).json() as {forwardedRequests:number;forwardedCsrf:boolean};
 check('no signed request or CSRF header reaches the other explicit loopback origin',metrics.forwardedRequests===0&&!metrics.forwardedCsrf);
 await select('private-error');let message='',payload:unknown;
 try{await request();}catch(error){if(error instanceof Error)message=error.message;if(error&&typeof error==='object'&&'payload'in error)payload=error.payload;}
 check('unknown private server error text cannot escape through the actual exception',message.length>0&&!message.includes('synthetic-private-error-canary')&&!JSON.stringify(payload??null).includes('synthetic-private-error-canary'));
 await select('valid-error');message='';try{await request();}catch(error){message=error instanceof Error?error.message:'';}
 check('valid migration fencing keeps its existing stable error code',message==='E2EE_MIGRATION_FENCED');
 await select('success');check('an ordinary successful E2EE response still reaches the caller',(await request()).sourceHash==='synthetic-original-origin');
 for(const mode of ['reserved-user','reserved-csrf']){await select(mode);message='';try{await request();}catch(error){message=error instanceof Error?error.message:'';}check('successful E2EE content cannot publish '+mode+' authority',message==='E2EE_INVALID_RESPONSE');}
 check('all refusals preserve the existing local records',JSON.stringify(Object.entries(localStorage).sort())===before);
 report.status=report.checks.every(row=>row.passed)?'PASS':'FAIL';document.title=report.status+' GENESIS E2EE HTTP policy';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.message:String(error);}
show();
