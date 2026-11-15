import type {Language} from '../i18n';
import {DOMAINS,BLOCKERS,MECHANISMS,readiness,type GnoDraft} from './gno-engine';
import {gnoCopy} from './gno-copy';
import {guidedCopy,guidedPatch,initialIntake,type GuidedIntake} from './gno-guided';

export function GnoIntake({draft:d,language,onChange}:{draft:GnoDraft;language:Language;onChange:(patch:Partial<GnoDraft>)=>void}){
 const c=gnoCopy(language),g=guidedCopy(language),intake=d.guided??initialIntake();
 const field=(label:string,value:number|string,options:readonly string[],set:(index:number)=>void)=><label className="gno-field"><span>{label}</span><select aria-label={label} value={value} onChange={e=>set(Number(e.target.value))}><option value={-1} disabled>{g.select}</option>{options.map((text,i)=><option key={i} value={i}>{text}</option>)}</select></label>;
 const change=(patch:Partial<GuidedIntake>)=>onChange(guidedPatch(d,{...intake,...patch},language));
 return <div className="gno-intake"><p>{g.intro}</p>
  {field(c.domain,DOMAINS.indexOf(d.domain),c.domains,i=>{const domain=DOMAINS[i];onChange({domain,externalFocus:undefined,...guidedPatch({...d,domain},initialIntake(),language)});})}
  {field(c.episode,intake.topic,[...g.topics.slice(DOMAINS.indexOf(d.domain)*4,DOMAINS.indexOf(d.domain)*4+4),g.facets],topic=>{onChange({externalFocus:undefined,...guidedPatch(d,{...intake,topic,facet:-1},language)});})}
  {intake.topic===4?<label className="gno-field"><span>{g.facets}</span><select value={intake.facet} onChange={e=>change({facet:Number(e.target.value)})}><option value={-1} disabled>{g.select}</option>{g.facetsList.map((group,i)=><optgroup key={i} label={g.directions[i]}>{group.map((label,j)=><option key={j} value={i*6+j}>{label}</option>)}</optgroup>)}</select></label>:null}
  {intake.topic>=0?<>
   {field(c.goal,MECHANISMS.indexOf(intake.intent),c.actionTitles,i=>change({intent:MECHANISMS[i]}))}
   {field(c.people,intake.people,g.people,people=>change({people}))}
   {field(c.criterion,intake.criterion,g.criteria.map(text=>text.replace('{object}',d.object)),criterion=>change({criterion}))}
   <div className="gno-fields-row">{field(c.deadline,intake.horizon,g.horizons,horizon=>change({horizon}))}<label className="gno-field"><span>{c.minutes}</span><select value={d.minutes} onChange={e=>onChange({minutes:Number(e.target.value) as GnoDraft['minutes']})}>{[0,2,10,30].map(n=><option value={n} key={n}>{n} {c.minuteUnit}</option>)}</select></label></div>
   {field(c.blocker,BLOCKERS.indexOf(d.blocker),c.blockers,i=>{const blocker=BLOCKERS[i];onChange({blocker,...guidedPatch({...d,blocker},intake,language)});})}
  </>:null}
  {d.domain==='wellbeing'?<p className="gno-note">{c.healthNote}</p>:null}
  {!readiness(d)?<p className="gno-muted">{g.select}</p>:null}
 </div>;
}
