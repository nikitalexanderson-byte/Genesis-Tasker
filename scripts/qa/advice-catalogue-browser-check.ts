import {PublicAdviceCatalogues,publicAdviceCatalogueReader,type AdviceCatalogueKind,type AdviceCatalogueLanguage} from '../../app/e2ee/advice-catalogue.ts';

const report:{runtime:string;publicOnly:true;checks:{name:string;passed:boolean}[];editions:number;error?:string;status?:string}={runtime:navigator.userAgent,publicOnly:true,checks:[],editions:0};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
const reject=async(name:string,code:string,run:()=>Promise<unknown>)=>{let rejected=false;try{await run();}catch(error){rejected=error instanceof Error&&error.message.includes(code);}check(name,rejected);};
try{
 check('secure browser WebCrypto',isSecureContext&&!!crypto.subtle);
 let active=true;const current=()=>{if(!active)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const read=publicAdviceCatalogueReader(new URL('./',location.href),current);
 const manifest=JSON.parse(new TextDecoder().decode(await read('advice-catalogues/v2/manifest.json'))) as {catalogues:{kind:AdviceCatalogueKind;version:string;language:AdviceCatalogueLanguage;path:string}[]};
 const client=new PublicAdviceCatalogues(read,current);const languages=new Set<string>(),versions=new Set<string>();
 for(const edition of manifest.catalogues){
  // A stable public identity is obtained from the public fixture catalogue,
  // never from an account or a private selection request.
  const texts=JSON.parse(new TextDecoder().decode(await read(edition.path))) as Record<string,{title:string;body:string}>;
  const id=Object.keys(texts)[0],text=await client.resolve(edition.kind,edition.version,edition.language,id);
  check(`exact ${edition.kind}/${edition.version}/${edition.language}`,JSON.stringify(text)===JSON.stringify(texts[id]));
  report.editions++;languages.add(edition.language);versions.add(edition.kind+':'+edition.version);
 }
 check('all 162 actual editions / nine versions / eighteen languages',report.editions===162&&versions.size===9&&languages.size===18);
 const first=manifest.catalogues[0],publicTexts=JSON.parse(new TextDecoder().decode(await read(first.path))) as Record<string,{body:string}>;
 const id=Object.keys(publicTexts)[0];
 const independent=await Promise.all(Array.from({length:8},()=>client.resolve(first.kind,first.version,first.language,id)));
 independent[0].body='Caller copy';check('independent caller copies',independent.slice(1).every(row=>row.body===publicTexts[id].body));
 const corrupt=new PublicAdviceCatalogues(async path=>{const bytes=await read(path);if(path!== 'advice-catalogues/v2/manifest.json')bytes[bytes.length-2]^=1;return bytes;},current);
 await reject('changed edition is blocked','CATALOGUE_INTEGRITY',()=>corrupt.resolve(first.kind,first.version,first.language,id));
 active=false;await reject('account closure denies cached text','ACCOUNT_CHANGED',()=>client.resolve(first.kind,first.version,first.language,id));
 const stats=await(await fetch('/request-stats')).json() as {catalogues:number;cookie:boolean;referrer:boolean};
 check('all catalogue HTTP omits cookie and referrer',stats.catalogues>162&&!stats.cookie&&!stats.referrer);
}catch(error){report.error=error instanceof Error?error.message.slice(0,180):'Unexpected browser failure';}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';
document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS public Advice editions';
