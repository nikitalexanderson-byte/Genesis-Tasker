import type {GnoDraft, Mechanism} from './gno-engine';
import {DOMAINS, MECHANISMS} from './gno-domains';
import {gnoCopy, fillGno} from './gno-copy';
import {SECTOR_IDS} from './registry';
import packs from './gno-guided-copy.json';

export const GUIDED_VERSION='gno-guided-v2';
export type GuidedIntake={version:typeof GUIDED_VERSION;topic:number;facet:number;intent:Mechanism;people:number;criterion:number;horizon:number};
export type GuidedCopy=typeof packs.ru;
export const guidedCopy=(language:string):GuidedCopy=>packs[language as keyof typeof packs]??packs.en;
export const initialIntake=():GuidedIntake=>({version:GUIDED_VERSION,topic:-1,facet:-1,intent:'observe',people:-1,criterion:-1,horizon:-1});
export function validIntake(value:GuidedIntake){return value?.version===GUIDED_VERSION&&Number.isInteger(value.topic)&&value.topic>=-1&&value.topic<5&&Number.isInteger(value.facet)&&value.facet>=-1&&value.facet<54&&MECHANISMS.includes(value.intent)&&Number.isInteger(value.people)&&value.people>=-1&&value.people<6&&Number.isInteger(value.criterion)&&value.criterion>=-1&&value.criterion<4&&Number.isInteger(value.horizon)&&value.horizon>=-1&&value.horizon<4;}
export function intakeReady(value?:GuidedIntake){return Boolean(value&&validIntake(value)&&value.topic>=0&&(value.topic!==4||value.facet>=0)&&value.people>=0&&value.criterion>=0&&value.horizon>=0);}
export function guidedPatch(d:GnoDraft, guided:GuidedIntake, language:string, now=new Date()):Partial<GnoDraft>{
 const c=gnoCopy(language),g=guidedCopy(language),topic=guided.topic<0?'':guided.topic===4?(g.facetsList[Math.floor(guided.facet/6)]?.[guided.facet%6]??''):g.topics[DOMAINS.indexOf(d.domain)*4+guided.topic]??'';
 const object=guided.topic<0?'':guided.topic===4?topic:g.objects[DOMAINS.indexOf(d.domain)*4+guided.topic];
 const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()+([0,1,3,7][guided.horizon]??0),12);
 const deadline=guided.horizon<0?'':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 return {guided,...(guided.topic===4&&guided.facet>=0?{externalFocus:SECTOR_IDS[Math.floor(guided.facet/6)]}:{}),object,episode:guided.topic===4?`${topic} — ${c.blockers[(['uncertainty','dependency','resources','overload','conflict','starting'] as const).indexOf(d.blocker)]}`:topic,goal:topic?`${c.actionTitles[MECHANISMS.indexOf(guided.intent)]}: ${object}`:'',people:guided.people<0?'':g.people[guided.people],criterion:guided.criterion<0?'':fillGno(g.criteria[guided.criterion],{object}),deadline};
}
