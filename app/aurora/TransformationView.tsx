import RU from './texts.ru.json';
import {DEITIES} from './registry';
import {PSYCHOLOGICAL_LENSES,selectedTransformationSectors,transformationAtlas} from './transformation';
import type {AuroraSession} from './session';
import {getStoicheionLetters} from '../stoicheion-data';
import {text,caseContext} from './adaptive-content';
import A from './adaptive-copy.ru.json';
import {MethodSheet} from './MethodSheet';

export function TransformationView({session,onChange,readOnly=false}:{session:AuroraSession;onChange?:(session:AuroraSession)=>void;readOnly?:boolean}){
 const sectors=selectedTransformationSectors(session),spheres=session.transformation?.spheres??[];
 if(!sectors.length)return null;
 const atlas=transformationAtlas(session.primary,sectors,spheres,session.transformation?.answers);
 return <section className="aurora-transformation" aria-label={RU.transformationTitle}>
  {readOnly?<MethodSheet title={RU.transformationTitle}><p>{RU.transformationIntro}</p>
  <div className="aurora-transformation-links">{atlas.focal.map(row=><article key={row.card.sourcePositionId}>
   <h5>{row.target.title} · <span lang="el">{getStoicheionLetters('ru').find(letter=>letter.id===row.card.cardId)!.symbol}</span></h5>
   <dl><dt>{RU.sourceModelTitle}</dt><dd>{row.source.patrons.ru} · {row.focus.risk.ru}</dd>
    <dt>{RU.targetModelTitle}</dt><dd>{row.target.deities.map(id=>DEITIES[id].name).join(', ')} · {row.focus.quality.ru}</dd></dl>
   <p>{row.bridge.summary}</p><section><h5>{RU.text0221}</h5><p>{row.bridge.route.map(id=>DEITIES[id].name).join(' → ')}</p>
    {row.bridge.sources.map(source=><p key={source.passage}><a href={source.url} target="_blank" rel="noreferrer">{source.passage}</a></p>)}
   </section>
  </article>)}</div></MethodSheet>:null}
  {!readOnly?<><p>{A.spheresHelp}</p><fieldset className="aurora-goal-options" disabled={!onChange}><legend>{RU.spheresTitle}</legend>{PSYCHOLOGICAL_LENSES.map((lens,index)=><label className="aurora-choice" key={lens.id} data-selected={spheres.includes(lens.id)} aria-label={text(`lens_${lens.id}`)}>
   <input type="checkbox" checked={spheres.includes(lens.id)} onChange={event=>onChange?.({...session,transformation:{version:1,sectors,spheres:event.target.checked?[...spheres,lens.id]:spheres.filter(id=>id!==lens.id),answers:{}},goalText:'',goalTags:[],intake:{},forecastTest:undefined,answers:[],draftAnswer:{questionId:'',choiceId:'',detail:''},context:{...session.context,fields:{},originalQuestion:'',acceptedThemes:[],rejectedThemes:[]}})}/>
   <span><strong>{text(`lens_${lens.id}`)}</strong><small>{text(`lens_example_${lens.id}`)}</small><small>{caseContext(session.primary,sectors,session.intake.domain,index).example}</small></span></label>)}</fieldset></>:null}
 </section>;
}
