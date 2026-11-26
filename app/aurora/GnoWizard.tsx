"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState,useMemo,type ReactNode} from 'react';
import {catalogText} from '../catalog-i18n';
import {DialogCloseButton} from '../DialogCloseButton';
import {useDialogAccessibility} from '../use-dialog-accessibility';
import {ExperimentalIcon} from '../ExperimentalIcon';
import {StoicheionCardFace} from '../StoicheionCardFace';
import {getStoicheionLetters} from '../stoicheion-data';
import {RESTORATION_LETTER_FOCI} from '../stoicheion-restoration-data';
import {restorationLocal} from '../stoicheion-restoration-copy';
import {AuroraWizard} from './AuroraWizard';
import {GnoCards} from './GnoCards';
import {gnoCopy,fillGno,type GnoCopy} from './gno-copy';
import {auroraLanguage,loadAuroraLocale,createAuroraTranslator} from './localization';
import {cardInsight} from './card-insights';
import {SOURCE_CIRCLE_REFERENCE} from './source-model';
import {type SectorId} from './registry';
import {GnoIntake} from './GnoIntake';
import {GnoModelLinks} from './GnoModelLinks';
import {guidedCopy,initialIntake,type GuidedCopy} from './gno-guided';
import {CROSS_MODEL_VERSION,bridgeKey,limitKey,sourceCurator} from './gno-models';
import {personalRanking,PERSONAL_RANKING_VERSION} from './gno-personal-ranking';
import {newSession,validateDocument,type AuroraDocument,type AuroraSession} from './session';
import {mergeAuroraDocuments} from './repository';
import {newGnoDraft,DOMAINS,BLOCKERS,MECHANISMS,CORE_QUESTIONS,readiness,answerDraft,nextQuestion,diverseActions,suggestedBridges,bridgeStrength,ratedDecisions,draftBinding,type GnoDraft,type Answer,type Candidate,type GnoObservation,type GnoPlan} from './gno-engine';
import type {PrimaryDrawSnapshot,OptionalTemporalTriadSnapshot} from './types';
import type {AuroraHost} from './host';
import type {OrganonSelection} from './organon';
import {chooseSphragis,ritualInstructions} from './sphragis';
import './gno.css';
import {samePrimaryDraw} from './draw-policy';
import drawAccessCopy from '../draw-access-copy.json';
import {usePersonalMigrationSource} from '../use-personal-migration-source';

const stamp=()=>new Date().toISOString();
const localDay=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
function Field({label,children}:{label:string;children:ReactNode}){return <label className="gno-field"><span>{label}</span>{children}</label>;}
function AnswerQuestion({title,answer,onAnswer,c,g,migrationOwner}:{title:string;answer?:Answer;onAnswer:(answer:Answer)=>void;c:GnoCopy;g:GuidedCopy;migrationOwner:string|null}){
 const [value,setValue]=useState<Answer['value']>(answer?.value??'unknown'),[basis,setBasis]=useState<NonNullable<Answer['basis']>|''>(answer?.basis??'');
 usePersonalMigrationSource(migrationOwner,'aurora',()=>({current:null,state:{form:'gno-answer',title,value,basis,answer},settled:true}));
 const bases=['observed','checked','assumed','obstacle'] as const;
 return <fieldset className="gno-question"><legend>{title}</legend><div className="gno-answer-buttons">{(['yes','no','unknown'] as const).map(id=><label key={id}><input type="radio" name={'answer-'+title} checked={value===id} onChange={()=>{setValue(id);setBasis('');}}/><span>{c[id]}</span></label>)}</div>
  <Field label={c.evidence}><select aria-label={c.evidence} value={basis} onChange={e=>setBasis(e.target.value as typeof basis)}><option value="">{g.select}</option>{bases.map((id,i)=><option value={id} key={id} disabled={value==='yes'&&id==='obstacle'}>{g.bases[i]}</option>)}</select></Field>
  <button type="button" className="secondary-button" disabled={value!=='unknown'&&!basis} onClick={()=>onAnswer({value:basis==='assumed'?'unknown':value,detail:basis?g.bases[bases.indexOf(basis)]:c.unknown,basis:basis||'assumed',at:stamp()})}>{c.record}</button>
 </fieldset>;
}

export function GnoWizard({host,primary,temporal=null}:{host:AuroraHost;primary:PrimaryDrawSnapshot|null;temporal?:OptionalTemporalTriadSnapshot|null}){
 const language=auroraLanguage(host.language),c=gnoCopy(language),g=guidedCopy(language);
 const [document,setDocument]=useState<AuroraDocument|null>(null),docRef=useRef<AuroraDocument|null>(null);
 const [active,setActive]=useState(''),[status,setStatus]=useState<'loading'|'saving'|'saved'|'offline'>('loading'),[error,setError]=useState(false),[conflict,setConflict]=useState(false),[busy,setBusy]=useState(false),[legacy,setLegacy]=useState(false);
 const [reload,setReload]=useState(0);
 const [oldTranslate,setOldTranslate]=useState<{language:string;t:(s:string)=>string}|null>(null);
 const [inspected,setInspected]=useState<SectorId>('center'),[pickingSupport,setPickingSupport]=useState(false),[detailOpen,setDetailOpen]=useState(false),[more,setMore]=useState(false),[editingQuestion,setEditingQuestion]=useState<string|null>(null),[taskAdded,setTaskAdded]=useState(false);
 const [execution,setExecution]=useState<GnoObservation['execution']>('not_done'),[outcome,setOutcome]=useState<GnoObservation['outcome']>('unknown'),[note,setNote]=useState(''),[wordError,setWordError]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),saving=useRef<Promise<boolean>|null>(null),mounted=useRef(true),body=useRef<HTMLDivElement|null>(null),title=useRef<HTMLHeadingElement|null>(null);
 const migrationOwner=host.captureMigration?host.ownerId:null;
 usePersonalMigrationSource(migrationOwner,'aurora',()=>({current:legacy?null:host.captureMigration?.(docRef.current)??null,
  state:{document:docRef.current,active,legacy,inspected,pickingSupport,detailOpen,more,editingQuestion,taskAdded,execution,outcome,note},
  settled:!busy&&status!=='loading'&&status!=='saving',
 }),host);
 const t=oldTranslate?.language===language?oldTranslate.t:(s:string)=>s;
 const visible=document?.sessions.filter(s=>s.gno)??[];
 const session=visible.find(s=>s.id===active),d=session?.gno;
 const historical=!!session&&!samePrimaryDraw(session.primary,primary);
 const currentPrimary=useRef(primary);
 useLayoutEffect(()=>{currentPrimary.current=primary;},[primary]);
 const install=useCallback((doc:AuroraDocument)=>{docRef.current=doc;if(mounted.current)setDocument(doc);},[]);
 const report=useCallback((e:unknown)=>{if(mounted.current){setError(true);setConflict(e instanceof Error&&e.message.includes('CONFLICT'));}},[]);
 const persist=useCallback(async():Promise<boolean>=>{
  if(timer.current){clearTimeout(timer.current);timer.current=null;}
  if(saving.current)return saving.current;
  const operation=(async()=>{
   try{
    if(mounted.current){setStatus('saving');setError(false);}
    while(docRef.current){
     const input=docRef.current,result=await host.save(input);
     if(docRef.current===input){install(result);break;}
     install(await mergeAuroraDocuments(input,docRef.current,result));
    }
    if(mounted.current)setStatus(host.syncState()==='offline'?'offline':'saved');return true;
   }catch(e){report(e);return false;}
  })();saving.current=operation;
  try{return await operation;}finally{saving.current=null;}
 },[host,install,report]);
 const close=useCallback(async()=>{if(await persist())host.close();},[host,persist]);
 const dialog=useDialogAccessibility<HTMLElement>(()=>{void close();},!legacy);
 const load=useCallback(()=>{setError(false);setStatus('loading');setReload(value=>value+1);},[]);
 const legacyHost=useMemo<AuroraHost>(()=>({...host,
  // Returning from the retained editor must not expose the parent's old
  // pre-archive document while a refresh is in flight. Every child receipt is
  // already durable and becomes the parent's current save base before close.
  save:async input=>{const saved=await host.save(input);install(saved);return saved;},
  close:()=>{setLegacy(false);load();},
 }),[host,install,load]);
 useEffect(()=>{let live=true;mounted.current=true;void(async()=>{
  try{
   const [loaded,pack]=await Promise.all([host.load(),loadAuroraLocale(language)]);await validateDocument(loaded,host.ownerId);
   if(!live)return;setOldTranslate({language,t:createAuroraTranslator(language,pack)});
   let doc:AuroraDocument={...loaded,sessions:loaded.sessions.map(s=>s.gno&&!s.gno.modelVersion?{...s,gno:{...s.gno,modelVersion:CROSS_MODEL_VERSION,guided:initialIntake(),step:0 as const,selectedPlanId:null,answerHistory:[...s.gno.answerHistory,...Object.entries(s.gno.answers).map(([field,answer])=>({field,answer}))].slice(-200),answers:{}}}:s)};const candidates=doc.sessions.filter(s=>s.gno&&samePrimaryDraw(s.primary,primary));
   let selected=candidates.find(s=>s.id===doc.activeSessionId)??candidates.at(-1);
   if(!selected&&primary&&doc.sessions.length<100){selected={...newSession({id:crypto.randomUUID(),ownerId:host.ownerId,now:stamp(),primary,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}),gno:newGnoDraft(),triad:temporal};doc={...doc,sessions:[...doc.sessions,selected],activeSessionId:selected.id};}
   install(doc);setActive(selected?.id??'');setInspected(selected?.gno?.focus??'center');setStatus(host.syncState()==='offline'?'offline':'saved');setConflict(false);
  }catch(e){if(live)report(e);}
 })();return()=>{live=false;mounted.current=false;if(timer.current)clearTimeout(timer.current);};
 },[host,language,primary,temporal,install,report,reload]);
 useEffect(()=>{if(legacy)return;const overflow=window.document.body.style.overflow;window.document.body.style.overflow='hidden';return()=>{window.document.body.style.overflow=overflow;};},[legacy]);
 const step=d?.step;
 useEffect(()=>{if(step===undefined)return;body.current?.scrollTo({top:0});title.current?.focus();},[step,active]);
 function change(next:AuroraSession){
  if(!samePrimaryDraw(next.primary,currentPrimary.current))return;
  const doc=docRef.current;if(!doc)return;
  install({...doc,activeSessionId:next.id,sessions:doc.sessions.map(s=>s.id===next.id?{...next,updatedAt:stamp()}:s)});setStatus('saving');
  if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{void persist();},500);
 }
 function edit(patch:Partial<GnoDraft>){if(!session||!d)return;const next={...d,...patch};
  if((['domain','goal','episode','people','object','criterion','deadline','externalFocus','blocker'] as const).some(key=>Object.prototype.hasOwnProperty.call(patch,key)&&patch[key]!==d[key])){next.answerHistory=[...d.answerHistory,...Object.entries(d.answers).map(([field,answer])=>({field,answer}))].slice(-200);next.answers={};}
  if(patch.minutes!==undefined&&patch.minutes!==d.minutes&&next.answers.energy){next.answerHistory=[...next.answerHistory,{field:'energy',answer:next.answers.energy}].slice(-200);const {energy:previousEnergy,...answers}=next.answers;void previousEnergy;next.answers=answers;}
  if(draftBinding(next)!==draftBinding(d)){next.selectedPlanId=null;setTaskAdded(false);}change({...session,gno:next});}
 function answer(field:string,value:Answer){if(session&&d){change({...session,gno:answerDraft(d,field,value)});setEditingQuestion(null);}}
 async function add(){if(!primary||!document||document.sessions.length>=100)return;if(!await persist())return;const doc=docRef.current!;const next={...newSession({id:crypto.randomUUID(),ownerId:host.ownerId,now:stamp(),primary,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}),gno:newGnoDraft(),triad:temporal};install({...doc,sessions:[...doc.sessions,next],activeSessionId:next.id});setActive(next.id);setDetailOpen(false);await persist();}
 async function recover(){try{setBusy(true);const versions=await host.conflictVersions();if(!versions)return;const ids=Object.fromEntries(versions.sessionIds.map(id=>[id,crypto.randomUUID()]));const doc=await host.recoverConflict(ids,stamp());install(doc);setActive(ids[active]??active);setConflict(false);setError(false);setStatus('saved');}catch(e){report(e);}finally{setBusy(false);}}
 const values:Record<string,string|number>=d?{object:d.object,episode:d.episode,people:d.people||c.peopleFallback,criterion:d.criterion,minutes:d.minutes}:{};
 const question=d?(editingQuestion??nextQuestion(d)):null;
 const answerContext=d?JSON.stringify([active,d.domain,d.goal,d.episode,d.people,d.object,d.criterion,d.deadline,d.blocker,d.minutes,d.externalFocus]):active;
 const rated=JSON.stringify(document?document.sessions.flatMap(s=>s.gno?ratedDecisions([s.gno]):[]):[]);
 const ranking=useMemo(()=>personalRanking(JSON.parse(rated)),[rated]);
 const options=d?diverseActions(d,more?10:5,ranking):[];
 const selected=d?.plans.find(p=>p.id===d.selectedPlanId&&p.binding===draftBinding(d));
 function actionBody(row:Candidate){return fillGno(c.actionBodies[MECHANISMS.indexOf(row.mechanism)],{...values,minutes:row.minutes});}
 function routeLabel(row:Candidate){return row.routeMode==='staged'?g.routeStaged:row.routeMode==='supported'?g.routeSupported:g.routeDirect;}
 function choose(row:Candidate){
  if(!d||!session||row.missing.length||nextQuestion(d)||d.plans.length>=100)return;
  const index=MECHANISMS.indexOf(row.mechanism);
  const steps=[g.concrete[DOMAINS.indexOf(d.domain)],...(bridgeStrength(d)>0?[fillGno(c.supportApplied,{resource:restorationLocal(RESTORATION_LETTER_FOCI[session.primary.cards.find(card=>card.sourcePositionId===d.support)!.cardId].needs[d.blocker==='overload'?'excess':d.blocker==='conflict'?'conflict':'deficit'].action,language).replace(/[.!?]\s*$/u,''),application:d.object})]:[]),
   ...(row.routeMode==='staged'?[fillGno(c.actionBodies[0],values),g.prepare]:row.routeMode==='supported'?[fillGno(c.actionBodies[5],values)]:[]),actionBody(row),g.review];
  const plan:GnoPlan={id:crypto.randomUUID(),createdAt:stamp(),binding:draftBinding(d),mechanism:row.mechanism,minutes:row.minutes,title:c.actionTitles[index],steps,criterion:d.criterion,deadline:d.deadline,fallback:c.fallbackText,conditions:row.requirements.map(key=>fillGno(c[key as keyof GnoCopy] as string,values)+' '+c.yes+'. '+(d.answers[key]?.detail??'')),ranking:{version:PERSONAL_RANKING_VERSION,features:row.features},route:row.route,routeClass:row.routeClass,modelVersion:CROSS_MODEL_VERSION};
  change({...session,organon:null,sphragisLetter:null,completionDraft:{...session.completionDraft,ritualDone:false},gno:{...d,plans:[...d.plans,plan],selectedPlanId:plan.id,step:3}});setTaskAdded(false);setExecution('not_done');setOutcome('unknown');setNote('');
 }
 async function word(){if(!session||!d||historical)return;setBusy(true);setWordError(false);const curator=sourceCurator(d.support??d.focus),preferences={...session.organonPreferences,goalTags:[d.blocker==='overload'?'care':d.blocker==='conflict'?'boundary':'clarity'],qualityTags:[d.blocker],excludedCanonicalForms:session.organon?[...session.organonPreferences.excludedCanonicalForms,session.organon.entry.canonicalForm]:[]};
  const worker=new Worker(new URL('./organon.worker.ts',import.meta.url),{type:'module'}),requestId=crypto.randomUUID();
  try{const organon=await new Promise<OrganonSelection>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('word timeout')),20000);worker.onmessage=e=>{if(e.data.requestId!==requestId)return;clearTimeout(timeout);if(e.data.result)resolve(e.data.result);else reject(Error('no word'));};worker.onerror=()=>{clearTimeout(timeout);reject(Error('worker unavailable'));};worker.postMessage({requestId,curatorId:curator,preferences});});
   const current=docRef.current?.sessions.find(s=>s.id===session.id);if(current&&current.gno&&draftBinding(current.gno)===draftBinding(d))change({...current,curatorId:curator,organon,organonPreferences:preferences,sphragisLetter:chooseSphragis(organon.entry.canonicalForm,preferences.goalTags,'visual').letter,goalText:d.goal});
  }catch{setWordError(true);}finally{worker.terminate();setBusy(false);}
 }
 if(legacy)return <AuroraWizard host={legacyHost} primary={primary} temporal={temporal}/>;
 const card=session?.primary.cards.find(row=>row.sourcePositionId===inspected),insight=card?cardInsight(card,language):null,letter=card?getStoicheionLetters(language).find(row=>row.id===card.cardId):null;
 const source=d&&SOURCE_CIRCLE_REFERENCE.find(row=>row.id===d.focus),support=d?.support?SOURCE_CIRCLE_REFERENCE.find(row=>row.id===d.support):null;

 const seal=session?.organon?chooseSphragis(session.organon.entry.canonicalForm,session.organonPreferences.goalTags,'visual',session.sphragisLetter):null;
 const sourceName=(id:SectorId)=>catalogText(SOURCE_CIRCLE_REFERENCE.find(row=>row.id===id)!.patrons,language);
 const board=session&&d?<aside className="gno-map"><h3>{c.spread}</h3><p className="gno-muted">{g.introspective}</p><GnoCards primary={session.primary} language={language} focus={d.focus} support={d.support} onSelect={id=>{setInspected(id);if(pickingSupport){edit({support:id===d.focus?null:id});setPickingSupport(false);}else edit({focus:id,support:d.support===id?null:d.support});setDetailOpen(true);}}/>
  <div className="gno-map-tools"><button type="button" className="secondary-button" aria-pressed={pickingSupport} onClick={()=>{setPickingSupport(!pickingSupport);setDetailOpen(false);}}>{pickingSupport?c.chooseSupport:c.useSupport}</button><button type="button" className="secondary-button gno-mobile" onClick={()=>setDetailOpen(true)}>{g.reading}</button></div>
  <p className="gno-map-caption">{c.focus}: {sourceName(d.focus)}{d.support?` · ${c.support}: ${sourceName(d.support)}`:''}</p>
 </aside>:null;
 return <div className="modal-backdrop gno-backdrop"><section className="gno-dialog" role="dialog" aria-modal="true" aria-labelledby="gno-title" data-dialog-header="none" ref={dialog} tabIndex={-1} lang={language} data-no-translate>
  <header className="gno-header"><div><h2 id="gno-title">{c.title}</h2><p>{c.subtitle}</p></div><DialogCloseButton aria-label={c.close} data-dialog-save="false" disabled={busy} onClick={()=>void close()}/></header>
  {d?<nav className="gno-progress" aria-label={c.title}>{c.steps.map((label,index)=><button type="button" key={label} aria-current={d.step===index?'step':undefined} disabled={historical||index>0&&(!readiness(d)||d.step===0&&d.deadline<localDay())||index===3&&!selected} onClick={()=>{edit({step:index as GnoDraft['step']});setDetailOpen(false);}}><span>{index+1}</span><span>{label}</span></button>)}</nav>:null}
  <div className="gno-body" ref={body}>
   {error?<div className="gno-message" role="alert"><p>{conflict?c.conflict:c.error}</p><button type="button" className="secondary-button" disabled={busy} onClick={()=>void(conflict?recover():document?persist():load())}>{conflict?c.recover:c.retry}</button></div>:null}
   {!document&&!error?<p role="status">{c.loading}</p>:null}
   {document&&!d?<p>{primary?c.limit:c.noDraw}</p>:null}
   {historical?<p role="status" data-no-translate>{drawAccessCopy[language].historical}</p>:null}
   {session&&d?<fieldset className="gno-session" disabled={historical}>
    <h3 className="gno-step-title" ref={title} tabIndex={-1}>{c.steps[d.step]}</h3>
    {d.step===0?<GnoIntake draft={d} language={language} onChange={edit}/>:null}
    {d.step===1?<div className={`gno-workspace${detailOpen?' is-detail-open':''}`}>{board}<div className="gno-detail">
     <button type="button" className="secondary-button gno-mobile" onClick={()=>setDetailOpen(false)}>{c.spread}</button>
     {insight&&letter&&card?<><h3>{sourceName(inspected)} · {insight.name}</h3><p>{catalogText(SOURCE_CIRCLE_REFERENCE.find(row=>row.id===inspected)!.meaning,language)}</p><p className="gno-note">{insight.focus}</p>
      <h4>{c.letterApplication}</h4><p>{restorationLocal(RESTORATION_LETTER_FOCI[card.cardId].needs[d.blocker==='overload'?'excess':d.blocker==='conflict'?'conflict':'deficit'].action,language)}</p><details className="gno-reading"><summary>{g.reading}</summary><div className="gno-reading-art"><StoicheionCardFace letter={letter} reversed={insight.reversed} variant="dialog" language={language}/></div><h4>{insight.heading}</h4>{insight.lines.map((line,i)=><p key={i}>{line}</p>)}</details>
      <AnswerQuestion migrationOwner={migrationOwner} key={`reading:${inspected}:${answerContext}`} title={`${g.cardFit} ${insight.focus}`} answer={d.answers[`reading:${inspected}`]} onAnswer={a=>answer(`reading:${inspected}`,a)} c={c} g={g}/>
     </>:null}
     <h3>{c.bridge}</h3><p className="gno-muted">{c.chooseSupport}</p><div className="gno-bridge-suggestions">{suggestedBridges(session.primary,d).map(row=><button type="button" className="secondary-button" key={row.source} aria-pressed={d.support===row.source} onClick={()=>{edit({support:row.source});setInspected(row.source);}}>{sourceName(row.source)} → {sourceName(d.focus)}</button>)}</div>{support&&source?<><p className="gno-link-line">{catalogText(support.patrons,language)} → {d.object} → {catalogText(source.patrons,language)}</p>
      <AnswerQuestion migrationOwner={migrationOwner} key={`resource:2026:${d.support}:${answerContext}`} title={`${g.resource} ${restorationLocal(RESTORATION_LETTER_FOCI[session.primary.cards.find(row=>row.sourcePositionId===d.support)!.cardId].needs[d.blocker==='overload'?'excess':d.blocker==='conflict'?'conflict':'deficit'].action,language)}`} answer={d.answers[`resource:2026:${d.support}`]} onAnswer={a=>answer(`resource:2026:${d.support}`,a)} c={c} g={g}/>
      <AnswerQuestion migrationOwner={migrationOwner} key={bridgeKey(d)+answerContext} title={g.fit+' «'+d.object+'». '+d.criterion} answer={d.answers[bridgeKey(d)]} onAnswer={a=>answer(bridgeKey(d),a)} c={c} g={g}/>
      <AnswerQuestion migrationOwner={migrationOwner} key={limitKey(d)+answerContext} title={g.risk} answer={d.answers[limitKey(d)]} onAnswer={a=>answer(limitKey(d),a)} c={c} g={g}/>
      <p className="gno-note">{bridgeStrength(d)>0?c.confirmed:c.conditional}</p>
     </>:<p>{c.resourceUnknown}</p>}
     <GnoModelLinks draft={d} source={d.support??inspected} language={language} onTarget={externalFocus=>edit({externalFocus})}/>
     <details><summary>{c.math}</summary><p>{g.math}</p><p>{c.symbolicNote}</p></details>
    </div></div>:null}
    {d.step===2?<div className="gno-choice"><p className="gno-situation-line">{d.goal}</p><h3>{c.questions}</h3><p>{c.questionContext}: «{d.episode}»</p>
     {question?<AnswerQuestion migrationOwner={migrationOwner} key={`${question}:${answerContext}`} title={fillGno(c[question as keyof GnoCopy] as string,values)} answer={d.answers[question]} onAnswer={a=>answer(question,a)} c={c} g={g}/>:<p>{c.answered}</p>}
     <details><summary>{c.reviewAnswers}</summary>{CORE_QUESTIONS.filter(key=>d.answers[key]).map(key=><div className="gno-answer-review" key={key}><p>{fillGno(c[key],values)} <strong>{c[d.answers[key].value]}</strong></p><p>{d.answers[key].detail}</p><button type="button" className="secondary-button" onClick={()=>{setEditingQuestion(key);body.current?.scrollTo({top:0});}}>{c.reviewAnswers}</button></div>)}</details>
     <h3>{c.options}</h3><p>{c.optionsHelp}</p><p className="gno-note">{g.concrete[DOMAINS.indexOf(d.domain)]}</p>{options.length?<ol className="gno-options">{options.map(row=>{const i=MECHANISMS.indexOf(row.mechanism);return <li key={row.id}><div className="gno-option-heading"><h4>{c.actionTitles[i]}</h4><span>{row.minutes} {c.minuteUnit}</span></div><p className="gno-muted">{routeLabel(row)}</p><p>{actionBody(row)}</p>{row.routeMode==='staged'?<p>{g.prepare}</p>:row.routeMode==='supported'?<p>{fillGno(c.actionBodies[5],values)}</p>:null}<details><summary>{c.why}</summary><p>{row.quality>=0.55?c.fit:c.alternative}</p><p>{c.cost}: {row.minutes} {c.minuteUnit} · {c.blocker}: {c.blockers[BLOCKERS.indexOf(d.blocker)]}</p></details>{row.missing.length?<div className="gno-conditions"><strong>{c.conditions}</strong><ul>{row.missing.map(key=><li key={key}>{key==='people'?c.people:fillGno(c[key as keyof GnoCopy] as string,values)}</li>)}</ul></div>:null}<button type="button" className="secondary-button" disabled={Boolean(row.missing.length)||Boolean(nextQuestion(d))||d.plans.length>=100} onClick={()=>choose(row)}>{nextQuestion(d)?c.questions:row.missing.length?c.conditional:c.choose}</button></li>;})}</ol>:<p className="gno-note">{c.noOptions}</p>}
     <button type="button" className="secondary-button" onClick={()=>setMore(!more)}>{more?c.fewer:c.more}</button>
     {d.domain==='wellbeing'?<p className="gno-note">{c.healthNote}</p>:null}
    </div>:null}
    {d.step===3?<div className="gno-plan">{selected?<><h3>{selected.title}</h3><p className="gno-situation-line">{d.goal}</p>{selected.steps.map((step,i)=><p key={i}>{step}</p>)}<dl><dt>{c.cost}</dt><dd>{selected.minutes} {c.minuteUnit}</dd><dt>{c.criterion}</dt><dd>{selected.criterion}</dd><dt>{c.deadline}</dt><dd>{new Date(`${selected.deadline}T12:00:00`).toLocaleDateString(language)}</dd></dl>
     <details><summary>{c.start}</summary><p>{c.startText}</p>{selected.conditions.map((line,i)=><p key={i}>{line}</p>)}</details><details><summary>{c.fallback}</summary><p>{selected.fallback}</p></details>
     {host.canAddTask?<button type="button" className="secondary-button" disabled={taskAdded||busy} onClick={async()=>{setBusy(true);try{if(!await persist())return;host.addTask({title:`${selected.title}: ${d.object}`,description:[...selected.steps,`${c.criterion}: ${selected.criterion}`,selected.fallback].join('\n\n'),dueDate:selected.deadline,kind:'action',sourceId:selected.id,zoneId:session.context.timezone});setTaskAdded(true);}catch(e){report(e);}finally{setBusy(false);}}}>{taskAdded?c.taskAdded:c.addTask}</button>:null}
     <details><summary>{c.practice}</summary><p>{c.practiceHelp}</p><button type="button" className="secondary-button" disabled={busy} onClick={()=>void word()}>{busy?c.loading:c.createWord}</button>{wordError?<p role="status">{c.noWord}</p>:null}{session.organon&&seal?<><p className="gno-organon" lang="el">{session.organon.entry.displayForm} · {session.organon.entry.isopsephy}</p><p>{t(session.organon.entry.dictionaryMeaning??session.organon.entry.intentionTemplates[0]??'')}</p><button type="button" className="secondary-button" onClick={()=>host.speak(session.organon!.entry.pronunciation)}>{c.speak}</button><p lang="el">{seal.letter}</p><p>{t(seal.association)}</p><ol>{ritualInstructions(1,session.organon.entry.displayForm,'{{intention}}',seal,'visual').map((line,i)=><li key={i}>{t(line).split('{{intention}}').map((part,j)=><span key={j}>{j?d.goal:''}{part}</span>)}</li>)}</ol><label className="gno-checkbox"><input type="checkbox" checked={session.completionDraft.ritualDone} onChange={e=>change({...session,completionDraft:{...session.completionDraft,ritualDone:e.target.checked}})}/>{c.ritualDone}</label></>:null}</details>
     <h3>{c.review}</h3><div className="gno-fields-row"><Field label={c.execution}><select value={execution} onChange={e=>setExecution(e.target.value as typeof execution)}>{(['done','partial','not_done'] as const).map((id,i)=><option value={id} key={id}>{c.executionOptions[i]}</option>)}</select></Field><Field label={c.outcome}><select value={outcome} onChange={e=>setOutcome(e.target.value as typeof outcome)}>{(['met','not_met','unknown'] as const).map((id,i)=><option value={id} key={id}>{c.outcomeOptions[i]}</option>)}</select></Field></div><Field label={c.observation}><select value={note} onChange={e=>setNote(e.target.value)}><option value="">{g.select}</option>{g.notes.map(text=><option key={text} value={text}>{text}</option>)}</select></Field><button type="button" className="primary-button" disabled={!note.trim()||d.observations.length>=500} onClick={()=>{edit({observations:[...d.observations,{id:crypto.randomUUID(),at:stamp(),planId:selected.id,execution,outcome,note:note.trim(),comparable:note===g.notes[0]||note===g.notes[1],ritualDone:session.completionDraft.ritualDone,organon:session.organon?.entry.canonicalForm??null}]});setNote('');}}>{c.saveObservation}</button>
    </>:<p>{c.noPlan}</p>}{d.observations.length?<details open><summary>{c.observations}</summary>{d.observations.map(o=><article key={o.id}><time dateTime={o.at}>{new Date(o.at).toLocaleString(language)}</time><p>{c.executionOptions[['done','partial','not_done'].indexOf(o.execution)]} · {c.outcomeOptions[['met','not_met','unknown'].indexOf(o.outcome)]}</p><p>{o.note}</p></article>)}</details>:null}</div>:null}
   </fieldset>:null}
   {document?<details className="gno-history"><summary>{c.history}</summary><Field label={c.history}><select value={active} onChange={e=>{setActive(e.target.value);setInspected(visible.find(s=>s.id===e.target.value)?.gno?.focus??'center');setNote('');setExecution('not_done');setOutcome('unknown');setDetailOpen(false);setEditingQuestion(null);setTaskAdded(false);}}>{visible.map(s=><option key={s.id} value={s.id}>{s.gno?.goal||new Date(s.createdAt).toLocaleString(language)}</option>)}</select></Field><button type="button" className="secondary-button" disabled={!primary||document.sessions.length>=100||busy} onClick={()=>void add()}>{c.new}</button><details><summary>{c.plan} · {c.history}</summary>{d?.plans.map(plan=><article key={plan.id}><h4>{plan.title}</h4><time>{new Date(plan.createdAt).toLocaleString(language)}</time>{plan.steps.map((line,i)=><p key={i}>{line}</p>)}<p>{c.criterion}: {plan.criterion}</p><p>{c.deadline}: {plan.deadline}</p></article>)}</details><p>{c.archiveHelp}</p><button type="button" className="secondary-button" onClick={()=>void persist().then(ok=>{if(ok)setLegacy(true);})}>{c.archive}</button></details>:null}
  </div>
  <footer className="gno-footer"><span className="gno-save" role="status" aria-live="polite">{error?c.error:c[status]}</span><div>{d&&d.step>0?<button type="button" className="secondary-button" disabled={historical} onClick={()=>{edit({step:(d.step-1) as GnoDraft['step']});setDetailOpen(false);}}><ExperimentalIcon name="chevron-left"/>{c.back}</button>:null}{d&&d.step<2?<button type="button" className="primary-button" disabled={historical||!readiness(d)||d.step===0&&d.deadline<localDay()} onClick={()=>{edit({step:(d.step+1) as GnoDraft['step']});setDetailOpen(false);}}>{c.next}<ExperimentalIcon name="chevron"/></button>:<button type="button" className="primary-button" disabled={busy} onClick={()=>void close()}>{c.close}</button>}</div></footer>
 </section></div>;
}
