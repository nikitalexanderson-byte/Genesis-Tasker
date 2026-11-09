import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AuroraWizard} from '../../app/aurora/AuroraWizard';
import {AuroraRepository,type AuroraAccess,type Sealed} from '../../app/aurora/repository';
import {expectedSourceDraw,snapshotFromSavedDraw} from '../../app/aurora/draw-policy';
import {newSession} from '../../app/aurora/session';
import {recordField} from '../../app/aurora/context';
import {diagnosticQuestions,newForecastTest} from '../../app/aurora/forecast-test';
import {SCENARIOS} from '../../app/aurora/catalog/scenarios';
import type {AuroraHost} from '../../app/aurora/host';
import '../../app/globals.css';
import '../../app/experimental-theme.css';
import '../../app/dark-theme.css';
import '../../app/dark-palettes.css';
import '../../app/universal-ui.css';
import '../../app/aurora/native.css';

// Development-only entry. Not referenced by either production build. No actual
// account, API, checkout, mail or device notification is used by this fixture.
const params=new URL(location.href).searchParams;
const reversedCount=params.has('reversed')?Number(params.get('reversed')):params.get('upright')==='1'?0:null;
const qaCase=(params.get('case')??'').replace(/[^a-z0-9-]/giu,'').slice(0,64),owner='aurora-synthetic-qa'+(qaCase?':'+qaCase:''),remoteKey='aurora-synthetic-remote'+(qaCase?':'+qaCase:''),stamp=new Date().toISOString(),seed=Array.from({length:10000},(_,i)=>i).find(i=>reversedCount!==null?expectedSourceDraw(i).filter(card=>card.reversed).length===reversedCount:expectedSourceDraw(i)[5].reversed)!;
const primary=snapshotFromSavedDraw({id:`qa-source-${seed}`,seed,day:stamp.slice(0,10),createdAt:stamp,cards:expectedSourceDraw(seed)});
if(params.get('native')==='1')document.documentElement.dataset.auroraNative='true';
document.documentElement.dataset.genesisTheme=params.get('scheme')==='dark'?'standart-dark':'standart';
document.documentElement.dataset.genesisPalette=params.get('palette')??'forest';
const key=crypto.subtle.importKey('raw',new Uint8Array(32).fill(23),'AES-GCM',false,['encrypt','decrypt']);
const b64=(bytes:Uint8Array)=>{let text='';for(let offset=0;offset<bytes.length;offset+=16384)text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(text);},decode=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
let offline=false,closed=()=>{},announce=(message:string)=>{console.info(message);};
const access:AuroraAccess={check(){},async request<T>(_path:string,init:RequestInit={}){
 if(offline)throw new TypeError('Synthetic offline');if(_path!=='/aurora-workspace')throw new Error('QA_ROUTE_INVALID');
 const stored=localStorage.getItem(remoteKey),old=stored?JSON.parse(stored):null;
 if((init.method??'GET')==='GET')return {document:old} as T;
 const body=JSON.parse(String(init.body));if(old?.iv===body.iv&&old?.ciphertext===body.ciphertext)return {revision:old.revision} as T;
 if((old?.revision??0)!==body.expectedRevision)throw new Error('AURORA_REVISION_CONFLICT');
 const value={...body,revision:body.expectedRevision+1};localStorage.setItem(remoteKey,JSON.stringify(value));return {revision:value.revision} as T;
},async seal(value,scope){const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},await key,new TextEncoder().encode(JSON.stringify(value)));return {iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};},
async open<T>(envelope:Sealed,scope:string){const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:new TextEncoder().encode(scope)},await key,decode(envelope.ciphertext));return JSON.parse(new TextDecoder().decode(plain)) as T;}};
const repo=new AuroraRepository(owner,localStorage,access);
const host:AuroraHost={ownerId:owner,language:params.get('lang')??'ru',client:'web',canAddTask:true,load:()=>repo.load(),save:doc=>repo.save(doc),syncState:()=>repo.syncState,
 conflictVersions:()=>repo.conflictVersions(),recoverConflict:(ids,now)=>repo.recoverAsCopy(ids,now),
 sealResult:(value,id)=>access.seal(value,`aurora-result:v1:${id}`),prepareResult:async value=>{localStorage.setItem(`aurora-synthetic-result:${value.id}`,JSON.stringify(value));},
 readResult:async id=>{const raw=localStorage.getItem(`aurora-synthetic-result:${id}`);if(!raw)throw new Error('MODELING_RESULT_NOT_READY');return {id,solution:await access.open(JSON.parse(raw),`aurora-result:v1:${id}`)};},
 billing:async<T,>(path:string)=>{if(!path.startsWith('/billing/modeling/catalog'))throw new Error('QA_CHECKOUT_DISABLED');return {forecastElitePlus:true,methods:[],routing:{preferredProvider:'yookassa'}} as T;},
 openCheckout:()=>{throw new Error('QA_CHECKOUT_DISABLED');},addTask:value=>announce(`Учебный черновик задачи: ${value.title}`),speak:()=>announce('Учебное произношение по нажатию.'),close:()=>closed()};
async function example(reload=true){
 const doc=await repo.load(),s=newSession({id:crypto.randomUUID(),ownerId:owner,now:new Date().toISOString(),primary,timezone:'Europe/Moscow'});
 s.selectedSectorId='east';s.goalText='Проверить основание следующего рабочего шага';s.goalTags=['clarity','strategy'];s.curatorId='athena';s.profileState='integration';s.stage=4;s.highestStage=4;
 s.intake={question:'Получим ли мы содержательное уточнение требования?',domain:'work',event_description:'Учебный пример: участник получил две разные версии требования.',current_constraint:'Учебный пример: доступен письменный канал без обязательства срочного ответа.',available_resources:'Есть время для одного короткого запроса.',unknown_description:'Какое правило действительно применяется.'};
 s.context.originalQuestion=s.intake.question;
 const fields={event_description:s.intake.event_description,current_constraint:s.intake.current_constraint,available_resources:s.intake.available_resources,desired_change:s.goalText,direct_evidence:false,info_access:true,repetition_known:false,prior_exception:false,phase_known:true,horizon_defined:true,outcome_not_known:true,resource_available:true,external_dependency:false,voluntary_commitment:false,attempted_again:false,values_share_constraint:false,clear_scope:true,earliest_difference:true};
 for(const [field,value]of Object.entries(fields))s.context=recordField(s.context,{id:crypto.randomUUID(),field,value,exactUserText:`Учебное явно заданное условие: ${String(value)}`,kind:'reported_event',confirmed:true,beforeInterpretation:true});
 const end=new Date(Date.now()+7*86400000),deadline=new Date(Date.now()+86400000),local=(d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
 s.forecastForm={target:'Ответственный пришлёт содержательное уточнение применимого требования.',success:'В ответе будет указан конкретный действующий пункт и его источник.',failure:'В выбранный период нет содержательного уточнения по вопросу.',conditions:'Запрос передан по действующему согласованному каналу.',end:local(end),conditionDeadline:local(deadline),scenarioId:'east-information-onset',horizonBasis:'Учебное условие: согласован ответ в течение недели.',horizonMode:'absolute',anchorEvent:'',startOffsetMinutes:0,durationMinutes:1440};
 if(params.get('exampleStage')==='5') {
  s.stage=5;s.highestStage=5;
  s.forecastTest={...newForecastTest(),page:0,outcome:'response',outcomeUnknown:'true',mechanism:'information',phase:'onset',windowDays:365,basis:'observation',verification:'written',preference:'clarify',confirmed:false};
  for(const question of diagnosticQuestions(s.forecastTest,'east').flat())s.forecastTest.answers[question.resolvesFields[0]]='unknown';
  for(const predicate of SCENARIOS.find(row=>row.id==='east-information-onset')!.required.slice(0,2))s.forecastTest.answers[predicate.field]=predicate.value?'true':'false';
 }
 await repo.save({...doc,activeSessionId:s.id,sessions:[...doc.sessions,s]});if(reload)location.reload();
}
function Preview(){const [open,setOpen]=useState(true),[message,setMessage]=useState('Локальный стенд · только синтетические данные');
 useEffect(()=>{closed=()=>setOpen(false);announce=setMessage;return()=>{closed=()=>{};announce=()=>{};};},[]);
 return <><div className="aurora-qa-bar"><strong>{message}</strong><button type="button" onClick={()=>setOpen(true)}>Открыть метод</button><button type="button" onClick={()=>void example()}>Заполнить учебный пример</button><button type="button" onClick={()=>{offline=!offline;setMessage(offline?'Учебная проверка без сети':'Учебное подключение восстановлено');}}>{offline?'Вернуть связь':'Без сети'}</button><a href="?scheme=light">Светлая</a><a href="?scheme=dark">Тёмная</a></div>{open?<AuroraWizard host={host} primary={primary}/>:<p style={{padding:80}}>Метод закрыт. Сохранённая работа доступна после открытия.</p>}</>;
}
const style=document.createElement('style');style.textContent='.aurora-qa-bar{position:fixed;inset:0 0 auto;z-index:1200;display:flex;gap:12px;align-items:center;padding:8px;background:var(--surface);font:12px/1.4 Arial;color:var(--ink);height:52px;overflow:auto}.aurora-qa-bar button,.aurora-qa-bar a{flex-shrink:0;min-height:36px;padding:6px;border:1px solid var(--line);color:var(--ink);background:var(--surface);border-radius:6px}.aurora-backdrop{top:52px}.aurora-dialog{max-height:calc(100dvh - 84px)}';document.head.appendChild(style);
if(qaCase&&params.get('autofill')==='1'&&!localStorage.getItem(remoteKey))await example(false);
createRoot(document.getElementById('root')!).render(<Preview/>);
