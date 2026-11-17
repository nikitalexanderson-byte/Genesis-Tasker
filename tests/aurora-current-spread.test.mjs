import assert from 'node:assert/strict';
import {test} from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {expectedSourceDraw,snapshotFromSavedDraw,samePrimaryDraw,verifySourceDraw}=calendarModule('app/aurora/draw-policy.ts');
const {newSession}=calendarModule('app/aurora/session.ts');

test('a modeling session keeps the exact nine cards and distinguishes individual redraw revisions',()=>{
  const source={id:'saved-spread',seed:123,day:'2026-11-17',createdAt:'2026-11-17T00:00:00Z',cards:expectedSourceDraw(123)};
  const original=snapshotFromSavedDraw(source), session=newSession({id:'session',ownerId:'owner',now:source.createdAt,primary:original,timezone:'Europe/Moscow'});
  const cards=structuredClone(source.cards);cards[4].reversed=!cards[4].reversed;
  const current=snapshotFromSavedDraw({...source,cards,cardRevision:1});
  verifySourceDraw(current);
  assert.equal(samePrimaryDraw(session.primary,current),false);
  assert.equal(samePrimaryDraw(session.primary,original),true);
  assert.deepEqual(session.primary,original);
  assert.equal(samePrimaryDraw(current,{...current,sourceCardRevision:2}),false);
  assert.throws(()=>snapshotFromSavedDraw({...source,cards}),/SOURCE_DRAW_MISMATCH/);
  assert.throws(()=>snapshotFromSavedDraw({...source,cards:[...cards.slice(0,8),cards[0]],cardRevision:1}),/SOURCE_DRAW_MISMATCH/);
  const forged=structuredClone(current);forged.sourceCards[0].reversed=!forged.sourceCards[0].reversed;
  assert.throws(()=>verifySourceDraw(forged),/SOURCE_DRAW_MISMATCH/);
});
