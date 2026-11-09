// Evaluate original pure TS modules; all test data is synthetic, never account data.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(resolve(root,'package.json'));
const ts=require('typescript');
const check=process.argv.includes('--check');
const domain=resolve(root,'android/app/src/main/java/ru/genesis/calendar/domain/habits');
const tests=resolve(root,'android/app/src/test/java/ru/genesis/calendar/domain/habits');
mkdirSync(domain,{recursive:true}); mkdirSync(tests,{recursive:true});
const read=(name)=>readFileSync(resolve(root,`app/${name}.ts`),'utf8');
const str=(s)=>JSON.stringify(s).replaceAll('$','\\$');
const header='// Generated from real web TS by android/tools/export-habit-vectors.mjs.\npackage ru.genesis.calendar.domain.habits\n\n';
function output(path,content) {
  if(check) { if(readFileSync(path,'utf8')!==content) throw Error(`Generated data drift: ${path}`); }
  else writeFileSync(path,content);
}
function load(text,globals={}) {
  const exports={};
  const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,Date,Math,Map,Set,Intl,...globals});
  return exports;
}
const math=load(read('tracker-math'));
const progress=load(read('habit-progress'));
const goals=load(read('daily-goal'));
const rewards=load(read('rewards'));
const templates=load(read('habit-templates'));
output(resolve(domain,'HabitTemplateCatalog.kt'),header+`data class HabitTemplate(val id: String, val icon: String, val title: String, val description: String, val schedulePreset: String, val suggestedTime: String, val color: String)\nobject HabitTemplateCatalog {\n    val templates = listOf(\n${templates.STARTER_HABIT_TEMPLATES.map((t)=>`        HabitTemplate(${str(t.id)},${str(t.icon)},${str(t.title)},${str(t.description)},${str(t.schedulePreset)},${str(t.suggestedTime)},${str(t.color)})`).join(',\n')}\n    )\n}\n`);
output(resolve(domain,'HeroRankCatalog.kt'),header+`object HeroRankCatalog {\n    val ranks = listOf(\n${progress.HEROIC_RANKS.map((r)=>`        HeroicRank(${str(r.id)},${str(r.title)},${str(r.titleEn)},${r.threshold},${str(r.color)},${str(r.path)})`).join(',\n')}\n    )\n    val checkpoints = listOf(\n${progress.HERO_PATH_CHECKPOINTS.map((r)=>`        HeroPathCheckpoint(${str(r.rankId)},${r.rewardLaurels},${str(r.title)},${str(r.titleEn)})`).join(',\n')}\n    )\n}\n`);
const scores=[];
for(const mode of ['none','binary','quality-ten','quality-bipolar']) for(const completed of [false,true]) for(const quality of [null,-8,-4.5,-0.5,0,4.5,7,20]) {
  scores.push([mode,completed,quality??'null',math.scoreHabitFormula(mode,completed,quality)].join('|'));
}
const xp=[];
for(const previous of [-1,0,7,20,100]) for(const score of [-2,0,8,20,21]) xp.push([previous,score,progress.completionXpAward(previous,score)].join('|'));
const ranks=[];
for(const score of [0,9,...progress.HEROIC_RANKS.flatMap((r)=>[r.threshold-1,r.threshold,r.threshold+1])]) {
  ranks.push([score,progress.highestRankForXp(score)?.id??'null',progress.nextHeroicRank(score)?.id??'null',progress.heroicRankForProgress({lifetimeXp:score,hiddenHeroicPathRevealedAt:null}).id].join('|'));
}
const daily=[];
for(const mode of ['easy','rhythm','perfect']) for(const scheduledCount of [0,1,2,5,7]) for(const completedCount of [0,1,3,7]) {
  const input={date:'2026-09-22',mode,timezone:'Europe/Moscow',scheduledCount,completedCount,today:'2026-09-23',updatedAt:'2026-09-23T10:00:00.000Z'};
  const result=goals.buildDailyGoalRecord(input);
  daily.push([mode,scheduledCount,completedCount,result.scheduledCount,result.completedCount,result.targetCount,result.status].join('|'));
}
const declarations=(name,values)=>`internal val ${name} = listOf(\n${values.map((v)=>`    ${str(v)}`).join(',\n')}\n)\n`;
output(resolve(tests,'WebHabitVectors.kt'),header+declarations('webScoreVectors',scores)+declarations('webXpVectors',xp)+declarations('webRankVectors',ranks)+declarations('webDailyGoalVectors',daily));

// Extract actual update functions from the large orchestration module. Only timestamp/ID
// providers are deterministic test adapters; score and guard functions are original TS.
const habitSource=ts.createSourceFile('habits.ts',read('habits'),ts.ScriptTarget.Latest,true);
const funcs=habitSource.statements.filter((n)=>ts.isFunctionDeclaration(n)&&['scoreHabitCompletion','updateHabitCompletion'].includes(n.name?.text)).map((n)=>n.getText(habitSource)).join('\n');
const integrity=load(read('habit-integrity'));
const updater=load(funcs,{scoreHabitFormula:math.scoreHabitFormula,canRecordHabitOnDate:integrity.canRecordHabitOnDate,
  completionXpAward:progress.completionXpAward,MAX_HABIT_XP_PER_COMPLETION:20,
  newTrackerEntity:()=>({id:'test-completion',createdAt:'2026-09-23T10:00:00.000Z',updatedAt:'2026-09-23T10:00:00.000Z',version:1,syncState:'local'}),
  markTrackerEntityChanged:(entity)=>({...entity,version:entity.version+1,syncState:'pending',updatedAt:'2026-09-23T10:00:00.000Z'})});
const updates=[];
for(const mode of ['none','binary','quality-ten','quality-bipolar']) {
  let workspace={habitCompletions:[]};
  const habit={id:'h1',createdDate:'2026-09-01',scoringMode:mode};
  for(const [completed,quality] of [[true,null],[true,7],[false,null],[true,-4.5],[true,4.5]]) {
    workspace=updater.updateHabitCompletion(workspace,habit,'2026-09-23',{completed,qualityValue:quality},'2026-09-23');
    const c=workspace.habitCompletions[0];
    updates.push([mode,completed,quality??'null',c.score,c.xpAwarded,c.version,c.syncState].join('|'));
  }
}
const history=['perfect','rest','qualified','protected','missed','timezone-shift','qualified','open'].map((status,i)=>({date:`2026-09-${String(15+i).padStart(2,'0')}`,mode:'rhythm',timezone:'Europe/Moscow',scheduledCount:5,completedCount:status==='perfect'?5:status==='qualified'?3:0,targetCount:3,status,updatedAt:`2026-09-${String(15+i).padStart(2,'0')}T10:00:00.000Z`}));
const streak=goals.calculateGlobalStreak(history,'2026-09-23');
let ledger=rewards.reconcileDailyGoalRewards(history,[],'2026-09-23');
const rewardStages=[ledger];
ledger=rewards.reconcileDailyGoalRewards(history,ledger,'2026-09-23'); rewardStages.push(ledger);
ledger=rewards.resetLaurelsBalance(ledger,'habit-missed-reset','h1','habit-missed-reset:self:h1:2026-09-23','2026-09-23T10:00:00.000Z'); rewardStages.push(ledger);
ledger=rewards.recordHabitMasteryRetention(ledger,'h1','2026-09-23T10:01:00.000Z'); rewardStages.push(ledger);
ledger=rewards.recordHabitMasteryRetention(ledger,'h1','2026-09-23T10:02:00.000Z'); rewardStages.push(ledger);
output(resolve(tests,'WebHabitHistoryVectors.kt'),header+declarations('webUpdateVectors',updates)+`internal val webHistoryStatuses = listOf(${history.map((r)=>str(r.status)).join(',')})\ninternal val webHistoryStreak = listOf(${streak.currentStreak},${streak.longestStreak},${str(streak.lastQualifiedDate)})\ninternal const val webHistoryRhythm = ${goals.calculateRhythmScore(history,'2026-09-23')}\n`+declarations('webRewardStages',rewardStages.map((stage)=>`${rewards.calculateLaurelsBalance(stage)}|${stage.map((t)=>`${t.idempotencyKey}=${t.amount}`).join(';')}`)));
console.log(JSON.stringify({scores:scores.length,xp:xp.length,ranks:ranks.length,daily:daily.length,updates:updates.length,rewardStages:rewardStages.length,sourceHashes:Object.fromEntries(['habits','tracker-core','tracker-math','habit-progress','daily-goal','rewards'].map((name)=>[name,createHash('sha256').update(read(name)).digest('hex')]))}));
