import { assignProgram, comparableKey, copyDay, copyMicro, copyMeso, estimatedOneRepMax, programDuration, sessionSummary, setVolume, type ProgramVersion, type TrainingExercise, type TrainingSession } from './training-domain.ts';
import type { PhysisRecord } from './types.ts';

export type PeriodizationModel = 'linear' | 'weekly-wave' | 'daily-wave' | 'block';
export type LoadStage = { name: string; percent: number; sets: number | null; reps: number | null; repeats: number; deload: boolean };

/** Editable GENESIS starting rules, not a reproduction of any author's cycle.
 * Percentages refer to the user's existing working load, never an inferred 1RM. */
export function suggestedLoadStages(model: PeriodizationModel, goal: 'strength' | 'hypertrophy', count: number): LoadStage[] {
  if (!Number.isInteger(count) || count < 2 || count > 12) throw new Error('Выберите от 2 до 12 этапов / Choose 2–12 stages');
  return Array.from({length:count},(_,index)=>{
    const deload=model!=='daily-wave'&&(index+1)%4===0;
    const phase=model==='daily-wave'?index%3:model==='weekly-wave'?index%3:model==='block'?Math.min(2,Math.floor(index*3/count)):index%4;
    const percent=deload?80:model==='linear'?90+phase*2.5:model==='block'?[90,95,100][phase]:[90,100,95][phase%3];
    const reps=deload?(goal==='strength'?3:6):goal==='strength'?[6,5,4,3][phase]:[12,10,8,8][phase];
    return {name:`${deload?'Разгрузка':'Этап'} ${index+1}`,percent,sets:null,reps,repeats:1,deload};
  });
}

export function percentLoad(maxKg: number, percent: number, roundingKg: number): number {
  if (![maxKg,percent,roundingKg].every(Number.isFinite) || maxKg <= 0 || maxKg > 10000 || percent <= 0 || percent > 100 || roundingKg <= 0 || roundingKg > 100) throw new Error('Проверьте максимум, процент и шаг округления / Check maximum, percentage and rounding');
  const result = Math.round(maxKg * percent / 100 / roundingKg) * roundingKg;
  if (result <= 0 || result > 10000) throw new Error('Проверьте шаг округления / Check rounding increment');
  return Number(result.toFixed(4));
}
export function periodizedVersion(version: ProgramVersion, model: PeriodizationModel, stages: LoadStage[]): ProgramVersion {
  if (!stages.length || stages.length > 12 || stages.some(stage => !stage.name.trim() || !Number.isFinite(stage.percent) || stage.percent < 10 || stage.percent > 200 || !Number.isInteger(stage.repeats) || stage.repeats < 1 || stage.repeats > 12 || stage.sets !== null && (!Number.isInteger(stage.sets) || stage.sets < 1 || stage.sets > 100) || stage.reps !== null && (!Number.isInteger(stage.reps) || stage.reps < 1 || stage.reps > 10000))) throw new Error('Проверьте этапы циклирования / Check load stages');
  const template = version.mesocycles[0]?.microcycles[0];
  if (!template?.days.some(day => day.kind === 'workout' && day.exercises.length)) throw new Error('Сначала составьте первый микроцикл с упражнениями / Build the first microcycle with exercises first');
  const transform = (day: typeof template.days[number], stage: LoadStage) => {
    const result = copyDay(day);
    if (day.kind === 'rest') return result;
    result.name = `${day.name || stage.name} · ${stage.name}`;
    result.exercises = result.exercises.map(ex => {
      const work = ex.sets.filter(set => set.kind === 'work');
      const source = work;
      if (!source.length) return ex;
      const sets = Array.from({length:stage.sets ?? (stage.deload ? Math.max(1,Math.ceil(source.length*.6)) : source.length)}, (_,index) => {
        const set = source[Math.min(index,source.length-1)];
        const scalable = ex.snapshot.metric === 'strength' && !['bodyweight','assisted'].includes(ex.snapshot.weightMode);
        return {...set,id:crypto.randomUUID(),completed:false,reps:ex.snapshot.metric === 'strength' ? stage.reps ?? set.reps : set.reps,repsMax:ex.snapshot.metric === 'strength' && stage.reps !== null ? null : set.repsMax,weightKg:scalable && set.weightKg !== null ? Number((set.weightKg*stage.percent/100).toFixed(4)) : set.weightKg};
      });
      return {...ex,sets:[...ex.sets.filter(set=>set.kind==='warmup'),...sets]};
    });
    return result;
  };
  let mesocycles: ProgramVersion['mesocycles'];
  if (model === 'daily-wave') {
    if (template.days.filter(day=>day.kind==='workout').length < stages.length) throw new Error('Добавьте в первый микроцикл по тренировочному дню для каждой волны / Add one workout day for each wave to the first microcycle');
    let index=0; const micro=copyMicro(template);
    micro.days=template.days.map(day=>day.kind==='rest' ? copyDay(day) : transform(day,stages[index++%stages.length]));
    const meso=copyMeso(version.mesocycles[0]);meso.microcycles=[micro];meso.repeats=1;mesocycles=[meso];
  } else if (model === 'block') {
    mesocycles=stages.map(stage=>{const meso=copyMeso(version.mesocycles[0]);meso.name=stage.name;meso.deload=stage.deload;meso.repeats=1;const micro=copyMicro(template);micro.days=template.days.map(day=>transform(day,stage));micro.repeats=stage.repeats;meso.microcycles=[micro];return meso;});
  } else {
    const meso=copyMeso(version.mesocycles[0]);meso.repeats=1;
    meso.microcycles=stages.map(stage=>{const micro=copyMicro(template);micro.name=stage.name;micro.repeats=stage.repeats;micro.days=template.days.map(day=>transform(day,stage));return micro;});mesocycles=[meso];
  }
  const next={...structuredClone(version),mesocycles,periodization:model};
  if(programDuration(next)>1098 || next.mesocycles.some(m=>m.microcycles.some(c=>c.days.some(d=>d.exercises.some(ex=>ex.sets.some(set=>(set.weightKg??0)>10000)))))) throw new Error('План превышает допустимые пределы / Plan exceeds supported limits');
  return next;
}
export type TrainingPoint = { day: string; value: number };
export function trainingPlanSeries(version: ProgramVersion): TrainingPoint[] {
  return assignProgram('preview',version,'2000-01-01','fixed').scheduled.filter(item=>item.snapshot.kind==='workout').map(item=>({day:item.day,value:item.snapshot.exercises.reduce((n,ex)=>n+ex.sets.reduce((sum,set)=>sum+setVolume(ex,{...set,completed:true}),0),0)}));
}
export type ProgressMetric = 'volume' | 'sets' | 'reps' | 'average-weight' | 'intensity' | 'minutes' | 'distance' | 'e1rm';
export function trainingProgressSeries(sessions: PhysisRecord<TrainingSession>[], metric: ProgressMetric, comparison = '', maximumKg?: number): TrainingPoint[] {
  const values=new Map<string,number>(), weights=new Map<string,{load:number;reps:number}>();
  for(const {data:session} of sessions){
    if(!session.endedAt) continue;
    if(metric==='minutes'){values.set(session.localDay,(values.get(session.localDay)??0)+sessionSummary(session).seconds/60);continue;}
    let value=0,known=false;
    for(const ex of session.exercises) for(const set of ex.sets){
      if(!set.completed || set.kind!=='work' || comparison && `${comparableKey(ex)}|${set.side}`!==comparison) continue;
      if(metric==='e1rm'){if(!comparison)continue;const estimate=estimatedOneRepMax(ex,set);if(estimate!==null){known=true;value=Math.max(value,estimate);}}
      else if(metric==='average-weight'||metric==='intensity') {
        if(!comparison || ex.snapshot.metric!=='strength' || ['bodyweight','assisted'].includes(ex.snapshot.weightMode) || set.weightKg===null || !set.reps) continue;
        const total=weights.get(session.localDay)??{load:0,reps:0};total.load+=set.weightKg*set.reps;total.reps+=set.reps;weights.set(session.localDay,total);
      }
      else if(metric==='sets'){known=true;value++;}
      else if(metric==='reps' && ex.snapshot.metric==='strength' && set.reps!==null){known=true;value+=set.reps;}
      else if(metric==='distance' && set.distanceKm!==null){known=true;value+=set.distanceKm;}
      else if(metric==='volume' && ex.snapshot.metric==='strength' && ex.snapshot.weightMode!=='assisted' && set.weightKg!==null && set.reps!==null){known=true;value+=setVolume(ex,set);}
    }
    if(known) values.set(session.localDay,metric==='e1rm'?Math.max(values.get(session.localDay)??0,value):(values.get(session.localDay)??0)+value);
  }
  for(const [day,total] of weights) if(total.reps && (metric!=='intensity'||maximumKg && Number.isFinite(maximumKg) && maximumKg>0)) values.set(day,total.load/total.reps/(metric==='intensity'?maximumKg!:1)*(metric==='intensity'?100:1));
  return [...values].sort(([a],[b])=>a.localeCompare(b)).map(([day,value])=>({day,value}));
}
export function exerciseAtPercent(exercise: TrainingExercise,maxKg:number,percent:number,roundingKg:number):TrainingExercise {
  if(exercise.snapshot.metric!=='strength' || ['bodyweight','assisted'].includes(exercise.snapshot.weightMode)) throw new Error('Расчёт доступен для внешнего отягощения / Use external-load exercises');
  const weightKg=percentLoad(maxKg,percent,roundingKg);
  return {...exercise,sets:exercise.sets.map(set=>set.kind==='work'?{...set,weightKg}:set)};
}
