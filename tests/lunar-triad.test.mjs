import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const triad=calendarModule('app/lunar-triad.ts');
const calendar=calendarModule('app/calendar-data.ts');
test('patron changes at decade boundaries and never truncates a hollow month',()=>{
  for(let day=1;day<=30;day++)assert.equal(triad.lunarPatronForDay(day),day<=10?'artemis':day<=20?'selene':'hecate');
  for(const day of [0,31,-1,1.5,NaN,Infinity])assert.throws(()=>triad.lunarPatronForDay(day),RangeError);
  let seen29=false,seen30=false;
  for(let month=-1;month<=12;month++)for(let day=1;day<=31;day++){
    const date=new Date(2026,month,day,12),lunar=calendar.getLunarDate(date),moon=calendar.getMoon(date);
    assert.equal(moon.epithet,triad.lunarPatronNameRu(lunar.day));
    if(lunar.day===lunar.monthLength){seen29||=lunar.monthLength===29;seen30||=lunar.monthLength===30;}
  }
  assert.ok(seen29&&seen30);
});
test('all fourteen languages explain the source limits and have three individually packaged artworks',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/lunar-triad-copy.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(copy).length,14);
  for(const row of Object.values(copy)){
    for(const key of ['title','more','note'])assert.ok(row[key].length>3);
    for(const id of triad.LUNAR_PATRONS)assert.ok(row[id].name.length>1&&row[id].meaning.length>40);
    assert.match(row.note,/1–10/);assert.match(row.note,/11–20/);assert.match(row.note,/GENESIS/);
  }
  for(const day of [1,11,21])assert.ok(readFileSync(new URL('../public/'+triad.lunarPatronArt(day),import.meta.url)).length>10000);
});
