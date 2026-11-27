import { languageDirection } from "./region-language";
import {useEffect,useId,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OlympianIsopsephyContent,OlympianIsopsephyDialog,type OlympianDeity} from './OlympianIsopsephy';
import {useOlympianCopy} from './olympian-knowledge';
import type {Language} from './i18n';
import type {OlympianNavigation} from './OlympianKnowledge';
import content from './olympian-isopsephy.json';
import './globals.css';
import './experimental-theme.css';
import './dark-theme.css';
import './dark-palettes.css';
import './universal-ui.css';
import './olympian-native.css';

type Boot={language:Language;dark:boolean;palette:string;colors:Record<string,string>};
declare global {interface Window {GenesisOlympianBridge:{navigate:(kind:string,id:string)=>void};GenesisOlympianRuntime:{init:(payload:string)=>void;back:()=>void;theme:(payload:string)=>void}}}
const decode=(payload:string)=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload),c=>c.charCodeAt(0))));
function theme(boot:Boot){
 document.documentElement.lang=boot.language; document.documentElement.dir=languageDirection(boot.language);
 document.documentElement.dataset.genesisTheme=boot.dark?'standart-dark':'standart';
 document.documentElement.dataset.genesisPalette=boot.palette;
 for(const [name,value] of Object.entries(boot.colors))if(/^--[a-z-]+$/.test(name)&&/^#[a-f0-9]{6,8}$/i.test(value))document.documentElement.style.setProperty(name,value);
}
let back=()=>window.GenesisOlympianBridge.navigate('close','');
function Catalog({boot}:{boot:Boot}){
 const [selected,setSelected]=useState<OlympianDeity|null>(null),[query,setQuery]=useState('');
 const {copy,error,retry}=useOlympianCopy(boot.language),id=useId();
 const navigation:OlympianNavigation={onOpenStoicheion:letter=>window.GenesisOlympianBridge.navigate('letter',letter??''),onOpenSector:sector=>window.GenesisOlympianBridge.navigate('sector',sector)};
 useEffect(()=>{back=()=>selected?setSelected(null):window.GenesisOlympianBridge.navigate('close','');return()=>{back=()=>window.GenesisOlympianBridge.navigate('close','');};},[selected]);
 return <main lang={boot.language} data-no-translate>
  <div aria-hidden={selected?true:undefined} inert={selected?true:undefined}>
   <OlympianIsopsephyContent language={boot.language} onSelect={setSelected} {...navigation} search={copy?{id,query,onChange:setQuery,copy}:undefined}/>
   {error?<button type="button" onClick={retry}>{content.locales[boot.language].title} ↻</button>:null}
  </div>
  {selected?<OlympianIsopsephyDialog embedded deity={selected} language={boot.language} onSelect={deity=>{setSelected(deity);window.scrollTo(0,0);}} onBack={()=>setSelected(null)} onClose={()=>window.GenesisOlympianBridge.navigate('close','')} {...navigation}/>:null}
 </main>;
}
let initialized=false;
window.GenesisOlympianRuntime={init(payload){if(initialized)return;initialized=true;const boot=decode(payload) as Boot;theme(boot);document.documentElement.dataset.olympianNative='true';
 const fit=()=>{const height=window.visualViewport?.height||window.innerHeight;if(height>0)document.documentElement.style.setProperty('--olympian-native-height',`${Math.floor(height)}px`);};
 fit();window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);
 createRoot(document.getElementById('root')!).render(<Catalog boot={boot}/>);},back(){back();},theme(payload){theme(decode(payload));}};
