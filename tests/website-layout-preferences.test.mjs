import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DISPLAY_CALENDARS, displayCalendarOrder, moveDisplayCalendar} from '../app/display-calendar-order.ts';
import {TODAY_BLOCK_IDS, todayHalfBlocks, readTodayHalfBlocks, storeTodayHalfBlocks} from '../app/today-block-order.ts';
import {accountLayout, uiVisibility, visibleCalendarModes} from '../app/ui-visibility.ts';

test('desktop half widths retain hidden identities without allowing the fixed hero to shrink', () => {
  assert.deepEqual(todayHalfBlocks(['tasks','dream','tasks','hero','unknown']), ['dream','tasks']);
  assert.deepEqual(todayHalfBlocks({tasks:50}), []);
  assert.deepEqual(todayHalfBlocks(null), []);
  const saved = uiVisibility({todayHalfBlocks:['dream','tasks'],hiddenTodayBlocks:['dream']});
  assert.deepEqual(saved.todayHalfBlocks,['dream','tasks']); assert.deepEqual(saved.hiddenTodayBlocks,['dream']);
  assert.deepEqual(accountLayout().todayHalfBlocks,[]);
  assert.deepEqual(todayHalfBlocks(TODAY_BLOCK_IDS),[...TODAY_BLOCK_IDS]);
});
test('width fallback survives reload, keeps accounts apart and tolerates blocked storage', () => {
  const values=new Map(), storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  assert(storeTodayHalfBlocks(storage,'alice',['tasks','dream']));
  assert.deepEqual(readTodayHalfBlocks(storage,'alice'),['dream','tasks']);
  assert.deepEqual(readTodayHalfBlocks(storage,'bob'),[]); assert.deepEqual(readTodayHalfBlocks(storage,'guest'),[]);
  assert.equal(storeTodayHalfBlocks(null,'alice',['tasks']),false);
  assert.equal(storeTodayHalfBlocks({setItem(){throw Error('blocked');}},'alice',['tasks']),false);
  assert.deepEqual(readTodayHalfBlocks({getItem:()=>'{broken'},'alice'),[]);
});
test('display priority moves all three identities without rewriting enabled calendars or task calendar choice', () => {
  const reordered=moveDisplayCalendar(DISPLAY_CALENDARS,'lunar','profane');
  assert.deepEqual(reordered,['lunar','profane','sacred']); assert.deepEqual(DISPLAY_CALENDARS,['profane','sacred','lunar']);
  for(const invalid of [null,[],['lunar'],['sacred','sacred','lunar'],['profane','lunar','unknown'],['hero','profane','lunar']]) assert.deepEqual(displayCalendarOrder(invalid),[...DISPLAY_CALENDARS]);
  const state=uiVisibility({enabledCalendars:['profane','sacred'],displayCalendarOrder:reordered,sacredFeaturesEnabled:false});
  assert.deepEqual(state.enabledCalendars,['profane','sacred']); assert.deepEqual(visibleCalendarModes(state),['profane']); assert.deepEqual(state.displayCalendarOrder,reordered);
  assert.deepEqual(moveDisplayCalendar(reordered,'sacred','lunar'),['sacred','lunar','profane']);
});
test('calendar dragging and desktop widths provide complete copy in the fourteen supported languages', () => {
  const calendar=JSON.parse(readFileSync(new URL('../app/display-calendar-order-copy.json',import.meta.url),'utf8'));
  const blocks=JSON.parse(readFileSync(new URL('../app/today-block-order-copy.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(calendar).length,14);
  for(const [language,c] of Object.entries(calendar)) {
    for(const key of ['profane','sacred','lunar','help','first','changed']) assert(c[key]?.trim(),`${language}.${key}`);
    assert.equal((c.first.match(/\{calendar\}/g)||[]).length,1);
    for(const key of ['width','full','half','widthHint']) assert(blocks[language][key]?.trim(),`${language}.${key}`);
  }
});
