import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarModule } from './helpers/calendar-modules.mjs';
const { dreamMorningWindow, uniqueDreams, dreamMatches, parseDreamSettings }=calendarModule('app/dream-journal-model.ts');
const { defaultSleepPlan }=calendarModule('app/sleep-tracker.ts');
const { newDiaryNote, validateDiaryNote }=calendarModule('app/diary-model.ts');
const plan=()=>({...defaultSleepPlan('2026-01-01','profane'),id:'sleep',schedule:{...defaultSleepPlan('2026-01-01','profane').schedule,timezone:'Europe/Moscow'}});
const at=t=>Date.parse(`2026-11-05T${t}:00+03:00`);
test('morning window lasts exactly three hours and uses overnight actual waking before plan',()=>{
 const p=plan(),entry={planId:p.id,date:'2026-11-04',fellAsleepAt:'23:30',wokeAt:'09:00'};
 assert.deepEqual(dreamMorningWindow([p],[],at('06:59')),{visible:false,source:'planned'});
 assert.equal(dreamMorningWindow([p],[],at('07:00')).visible,true);
 assert.equal(dreamMorningWindow([p],[],at('09:59')).visible,true);
 assert.equal(dreamMorningWindow([p],[],at('10:00')).visible,false);
 assert.equal(dreamMorningWindow([p],[entry],at('07:30')).visible,false);
 assert.deepEqual(dreamMorningWindow([p],[entry],at('11:59')),{visible:true,source:'actual'});
 assert.equal(dreamMorningWindow([p],[entry],at('12:00')).visible,false);
 assert.deepEqual(dreamMorningWindow([],[],at('08:00')),{visible:false,source:null});
});
test('waking can cross civil midnight, respects schedules and rejects DST gaps',()=>{
 const p=plan();p.targetBedtime='18:00';p.targetWakeTime='23:00';
 const e={planId:p.id,date:'2026-11-04',fellAsleepAt:'18:00',wokeAt:'23:30'};
 assert.equal(dreamMorningWindow([p],[e],at('01:00')).visible,true);
 p.schedule.startDate='2027-01-01';assert.equal(dreamMorningWindow([p],[],at('23:10')).visible,false);
 p.schedule.startDate='2026-01-01';p.schedule.timezone='America/New_York';p.targetBedtime='23:00';p.targetWakeTime='02:30';
 assert.deepEqual(dreamMorningWindow([p],[],Date.parse('2026-03-08T08:00:00Z')),{visible:false,source:null});
 p.targetWakeTime='01:30';
 assert.equal(dreamMorningWindow([p],[],Date.parse('2026-11-01T05:45:00Z')).visible,true);
 assert.equal(dreamMorningWindow([p],[],Date.parse('2026-11-01T08:30:00Z')).visible,false);
});
test('search requires all words and stats count a saved dream and drafts once without other notes',()=>{
 const dream={...newDiaryNote('A silver river and a clear sky','River'),dream:{day:'2026-11-05',timeZone:'UTC',lucid:true},reaction:'favorite'};
 validateDiaryNote(dream);assert.equal(dreamMatches(dream,'SKY river'),true);assert.equal(dreamMatches(dream,'river forest'),false);
 const saved={note:dream,revision:1},draft={...saved,draftKey:'draft',note:{...dream,title:'Updated',updatedAt:'2099-01-01T00:00:00Z'}};
 assert.deepEqual(uniqueDreams([saved,draft,{note:newDiaryNote('Ordinary note'),revision:1}]),[draft]);
 assert.throws(()=>validateDiaryNote({...dream,dream:{...dream.dream,lucid:'yes'}}),/DREAM_INVALID/);
 assert.throws(()=>parseDreamSettings({todayMode:'always',revision:1}),/DREAM_INVALID_SETTINGS/);
});
test('the same dream identity drives search, date and favorite/lucid filters after editing',()=>{
 const note={...newDiaryNote('Old river'),dream:{day:'2026-11-04',timeZone:'UTC',lucid:true},reaction:'favorite'};
 const saved={note,revision:1},draft={note:{...note,body:'New forest',dream:{...note.dream,day:'2026-11-05',lucid:false},reaction:null},revision:1,draftKey:'draft:writer'};
 const dreams=uniqueDreams([saved,draft]);
 assert.equal(dreams.length,1);
 assert.equal(dreams.filter(row=>row.note.reaction==='favorite'||row.note.dream.lucid).length,0);
 assert.equal(dreams.filter(row=>row.note.dream.day==='2026-11-04').length,0);
 assert.equal(dreams.filter(row=>dreamMatches(row.note,'forest')).length,1);
 assert.equal(dreams.filter(row=>dreamMatches(row.note,'river')).length,0);
});
