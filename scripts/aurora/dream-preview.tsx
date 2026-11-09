import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DiaryProvider} from '../../app/DiaryProvider';
import {DiaryRepository} from '../../app/diary-storage';
import {DreamJournal,DreamJournalToday} from '../../app/DreamJournal';
import {DreamJournalSettings} from '../../app/DreamJournalSettings';
import DiaryPage from '../../app/DiaryPage';
import type {GenesisUser} from '../../app/cloud-sync';
import {type Language} from '../../app/i18n';
import {uiVisibility} from '../../app/ui-visibility';
import '../../app/globals.css';
import '../../app/experimental-theme.css';
import '../../app/dark-theme.css';
import '../../app/dark-palettes.css';
import '../../app/universal-ui.css';

// Local fixture only. Real repository/ciphertext and production components, synthetic user.
const params=new URL(location.href).searchParams;
const language=(params.get('lang')??'ru') as Language;
// A late callback after abort exercises the real editor guards without microphone access.
class SyntheticRecognition {
 lang='ru';continuous=true;interimResults=false;
 onresult:((event:{resultIndex:number;results:{isFinal:boolean;0:{transcript:string}}[]})=>void)|null=null;
 onerror:(()=>void)|null=null;onend:(()=>void)|null=null;
 start(){const receive=this.onresult;setTimeout(()=>receive?.({resultIndex:0,results:[{isFinal:true,0:{transcript:'Учебная поздняя расшифровка'}}]}),1500);}
 stop(){this.onend?.();}abort(){}
}
Object.assign(window,{SpeechRecognition:SyntheticRecognition});
document.documentElement.dataset.genesisTheme=params.get('scheme')==='dark'?'standart-dark':'standart';
document.documentElement.dataset.genesisPalette=params.get('palette')??'green';
const owner='dream-synthetic-qa',today=new Date().toLocaleDateString('en-CA'),key=crypto.subtle.importKey('raw',new Uint8Array(32).fill(25),'AES-GCM',false,['encrypt','decrypt']);
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value)),decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const rows=new Map<string,Record<string,unknown>>(JSON.parse(sessionStorage.getItem('dream-qa-remote')??'[]'));
const deleted=new Map<string,Record<string,unknown>>(JSON.parse(sessionStorage.getItem('dream-qa-deleted')??'[]'));
let preferences=JSON.parse(sessionStorage.getItem('dream-qa-preferences')??'{"todayMode":"all-day","revision":0}');
const persist=()=>{sessionStorage.setItem('dream-qa-remote',JSON.stringify([...rows]));sessionStorage.setItem('dream-qa-deleted',JSON.stringify([...deleted]));sessionStorage.setItem('dream-qa-preferences',JSON.stringify(preferences));};
const repository=new DiaryRepository(owner,sessionStorage,{
 check(){},async privateId(id){return id;},
 async request<T>(path:string,init:RequestInit={}){
  if(path.startsWith('/diary/dream-clock'))return {today,timeZone:new URLSearchParams(path.split('?')[1]).get('timeZone')} as T;
  if(path==='/diary/dream-voice')return {allowed:true} as T;
  const body=init.body?JSON.parse(String(init.body)):null;
  if(path==='/diary/settings')return {settings:{syncEnabled:true,revision:0},deleted:[],snapshot:'a'.repeat(64)} as T;
  if(path==='/diary/dream-settings'){if(body.expectedRevision!==preferences.revision)throw new Error('DREAM_SETTINGS_CONFLICT');preferences={todayMode:body.todayMode,revision:preferences.revision+1};persist();return {dreamSettings:preferences} as T;}
  if(path==='/diary')return {notes:[...rows.values()],deleted:[...deleted.values()],dreamSettings:preferences} as T;
  const id=path.split('/').at(-1)!,old=rows.get(id),updatedAt=new Date().toISOString();
  if(init.method==='DELETE'){if(old?.revision!==body.expectedRevision)throw new Error('DIARY_REVISION_CONFLICT');rows.delete(id);const marker={id,revision:body.expectedRevision+1,updatedAt,localOnly:false};deleted.set(id,marker);persist();return {...marker,deleted:true} as T;}
  if((old?.revision??0)!==body.expectedRevision)throw new Error('DIARY_REVISION_CONFLICT');
  rows.set(id,{...body,id,revision:body.expectedRevision+1,updatedAt});persist();return {revision:body.expectedRevision+1,updatedAt} as T;
 },
 async seal(value,scope){const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},await key,new TextEncoder().encode(JSON.stringify(value)));return {iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};},
 async open<T>(envelope:{iv:string;ciphertext:string},scope:string){const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:new TextEncoder().encode(scope)},await key,decode(envelope.ciphertext));return JSON.parse(new TextDecoder().decode(plain)) as T;}
});
const user={uid:owner,taskCalendarMode:'profane',featureAccess:{schemaVersion:1,policyRevision:'synthetic-qa',enforcementEnabled:true,declaredPlan:'premium',effectivePlan:'premium',lifetimePremium:true,validUntil:null,evaluatedAt:new Date().toISOString(),allowedFeatures:['dream-journal','dream-voice'],freeFeatures:[]}} as unknown as GenesisUser;
function Preview(){const [screen,setScreen]=useState(params.get('screen')??'dream'),[enabled,setEnabled]=useState(()=>sessionStorage.getItem('dream-qa-enabled')!=='false');
 const currentUser={...user,language,uiVisibility:uiVisibility({dreamJournalEnabled:enabled})};
 return <DiaryProvider userId={owner} ready repositoryOverride={repository}>
 <nav aria-label="Локальная проверка"><button onClick={()=>setScreen('dream')}>Сон</button><button onClick={()=>setScreen('diary')}>Общий дневник</button><button onClick={()=>setScreen('today')}>Сегодня</button><button id="dream-qa-toggle" aria-pressed={enabled} onClick={()=>setEnabled(value=>{sessionStorage.setItem('dream-qa-enabled',String(!value));return !value;})}>Дневник снов</button><a href="?scheme=light">Светлая</a><a href="?scheme=dark">Тёмная</a></nav>
 <main style={{maxWidth:1000,margin:'24px auto',padding:16}}>{screen==='settings'?<><section className="account-preferences" data-settings-group="habits"><h3>Ежедневная практика — Трекинг привычек</h3></section><DreamJournalSettings language={language} enabled={enabled} onEnabledChange={setEnabled}/></>:screen==='dream'?<DreamJournal user={currentUser} date={today} language={language}/>:screen==='today'?<DreamJournalToday user={currentUser} date={today} language={language} plans={[]} entries={[]}/>:<DiaryPage language={language} onClose={()=>setScreen('dream')}/>}</main>
 </DiaryProvider>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
