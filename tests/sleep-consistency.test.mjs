import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarModule } from './helpers/calendar-modules.mjs';
import { localizedModule } from './helpers/localized-modules.mjs';
const sleep=calendarModule('app/sleep-tracker.ts');
const { formatTranslatedText, LANGUAGES }=localizedModule('app/i18n.ts');
const plan=(zone='America/Los_Angeles',bed='01:00',wake='09:00')=>({
  ...sleep.defaultSleepPlan('2026-10-28','profane'),schedule:{timezone:zone},targetBedtime:bed,targetWakeTime:wake,
});
const observation=(bed,wake,date='2026-10-28')=>({date,fellAsleepAt:bed,wokeAt:wake});

test('An eight-hour plan and seven hours thirty minutes differ by thirty minutes',()=>{
  const p=plan(),entry=observation('01:30','09:00');
  assert.equal(sleep.sleepDurationMinutes(entry.date,p.targetBedtime,p.targetWakeTime,p.schedule.timezone),480);
  assert.equal(sleep.sleepDurationMinutes(entry.date,entry.fellAsleepAt,entry.wokeAt,p.schedule.timezone),450);
  assert.equal(sleep.sleepDeviationMinutes(p,entry),30);
  assert.equal(sleep.sleepDeviationMinutes(p,observation('00:30','09:00')),30);
  assert.equal(sleep.sleepDeviationMinutes(p,observation('02:00','10:00')),0);
  assert.equal(sleep.sleepDeviationMinutes(p,observation('','09:00')),0);
});

test('Overnight and DST observations compare elapsed durations using their own date and zone',()=>{
  const p=plan('Europe/Moscow','23:00','07:00');
  assert.equal(sleep.sleepDeviationMinutes(p,observation('00:10','07:30')),40);
  const dst=plan('America/New_York','23:00','07:00');
  assert.equal(sleep.sleepDeviationMinutes(dst,observation('00:00','08:00','2026-03-07')),60);
  assert.equal(sleep.sleepDeviationMinutes(dst,observation('23:30','07:00','2026-03-07')),30);
  assert.equal(sleep.sleepDeviationMinutes(dst,observation('23:30','07:00','2026-10-31')),30);
});

test('Old cached averages are corrected on load without rewriting user observations',()=>{
  const p=plan(),original={id:'old-observation',planId:p.id,...observation('01:30','09:00'),durationMinutes:1,deviationMinutes:15,
    createdAt:'2026-10-28T12:00:00.000Z',updatedAt:'2026-10-28T12:00:00.000Z',version:4,note:'A private literal {hours} note',quality:7};
  const normalized=sleep.normalizeSleepEntry(original,new Map([[p.id,p]]));
  assert.equal(normalized.durationMinutes,450);assert.equal(normalized.deviationMinutes,30);
  for(const key of ['id','createdAt','updatedAt','version','note','quality','fellAsleepAt','wokeAt'])assert.equal(normalized[key],original[key]);
  assert.equal(original.deviationMinutes,15);
});

test('Duration, difference and reminder templates retain all numbers in every shipped locale',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/ui-refinement-copy.json',import.meta.url),'utf8'));
  const keys=['{hours} ч {minutes} мин','☾ Длительность · {hours} ч {minutes} мин','Длительность: {hours} ч {minutes} мин',
    'Плановая длительность · {duration}','Разница с планом по длительности · {minutes} мин','За {minutes} мин до сна'];
  for(const language of LANGUAGES)for(const source of keys){
    const rendered=formatTranslatedText(source,language,{hours:7,minutes:30,duration:'8:00'});
    const expected=copy[language][source].replaceAll('{hours}','7').replaceAll('{minutes}','30').replaceAll('{duration}','8:00');
    assert.equal(rendered,expected,`${language}: ${source}`);
    assert.doesNotMatch(rendered,/\{\w+\}/);
    if(!['ru','sr','uk'].includes(language))assert.doesNotMatch(rendered,/[А-Яа-яЁё]/);
  }
  assert.equal(formatTranslatedText('☾ Длительность · {hours} ч {minutes} мин','en',{hours:7,minutes:30}),'☾ Duration · 7 hr 30 min');
  assert.equal(formatTranslatedText('За {minutes} мин до сна','en',{minutes:15}),'15 min before bedtime');
});
