import test from 'node:test';
import assert from 'node:assert/strict';
import { uiVisibility, visibleCalendarModes, visibleCalendarMode, viewIsVisible } from '../app/ui-visibility.ts';
import { projectViewOrder, moveProjectView, defaultProjectView, sameLayoutValue } from '../app/project-view-order.ts';
import { sharedCalendarWindow, sharedCalendarPeriod, calendarDateKey } from '../app/shared-calendar-period.ts';
import { sacredToCivilDate } from '../app/calendar-astronomy.ts';
import { civilDateCarrier } from '../app/calendar-context.ts';

test('the sacred layer hides its entry points without changing saved calendar or menu choices', () => {
  const original = uiVisibility({enabledCalendars:['sacred','lunar'],hiddenMenuItems:['tasks'],hiddenSubmenus:['calendar.year']});
  const hidden = uiVisibility({...original,sacredFeaturesEnabled:false});
  assert.equal(viewIsVisible('stoicheion',hidden),false);
  assert.equal(viewIsVisible('theokyklos',hidden),false);
  assert.equal(viewIsVisible('calendar',hidden),true);
  assert.equal(viewIsVisible('habits',hidden),true);
  assert.deepEqual(visibleCalendarModes(hidden),['profane']);
  assert.equal(visibleCalendarMode('sacred',hidden),'profane');
  assert.equal(visibleCalendarMode('lunar',hidden),'profane');
  assert.deepEqual(hidden.enabledCalendars,original.enabledCalendars);
  assert.deepEqual(hidden.hiddenMenuItems,original.hiddenMenuItems);
  assert.deepEqual(uiVisibility({...hidden,sacredFeaturesEnabled:true}),original);
});

test('the dream journal switch defaults on and changes no calendar or other visibility choices',()=>{
 const original=uiVisibility({enabledCalendars:['lunar','profane'],hiddenMenuItems:['tasks']});
 assert.equal(original.dreamJournalEnabled,true);
 const hidden=uiVisibility({...original,dreamJournalEnabled:false});
 assert.equal(hidden.dreamJournalEnabled,false);
 assert.deepEqual(visibleCalendarModes(hidden),visibleCalendarModes(original));
 assert.deepEqual(uiVisibility({...hidden,dreamJournalEnabled:true}),original);
});

test('disabling sacred features temporarily uses Gregorian for every saved calendar combination', () => {
  for (const enabledCalendars of [['profane','sacred','lunar'],['lunar'],['sacred','lunar'],['profane']]) {
    const saved = uiVisibility({enabledCalendars,sacredFeaturesEnabled:false});
    assert.deepEqual(visibleCalendarModes(saved),['profane']);
    for (const mode of ['profane','sacred','lunar']) assert.equal(visibleCalendarMode(mode,saved),'profane');
    assert.deepEqual(saved.enabledCalendars,enabledCalendars);
    assert.deepEqual(visibleCalendarModes({...saved,sacredFeaturesEnabled:true}),enabledCalendars);
  }
});

test('a sacred-only account gets a temporary civil display and recovers its original calendar', () => {
  const saved = uiVisibility({enabledCalendars:['sacred'],sacredFeaturesEnabled:false});
  assert.deepEqual(visibleCalendarModes(saved),['profane']);
  assert.equal(visibleCalendarMode('sacred',saved),'profane');
  assert.deepEqual(saved.enabledCalendars,['sacred']);
  assert.equal(visibleCalendarMode('sacred',{...saved,sacredFeaturesEnabled:true}),'sacred');
  assert.equal(uiVisibility().sacredFeaturesEnabled,true);
});

test('account project view order sets the default without changing legacy project layout',()=>{
  assert.equal(defaultProjectView(null,false,'board'),'board');
  assert.equal(defaultProjectView(null,true,'board'),'list');
  const saved=uiVisibility({sharedProjectViewOrder:['board','list','gantt','calendar']});
  assert.equal(defaultProjectView(saved.sharedProjectViewOrder,true,'list'),'board');
  assert.deepEqual(saved.sharedProjectViewOrder,['board','list','gantt','calendar']);
  const moved=moveProjectView(saved.sharedProjectViewOrder,'calendar','board');
  assert.deepEqual(moved,['calendar','board','list','gantt']);
  assert.equal(defaultProjectView(moved,false,'board'),'calendar');
  assert.equal(sameLayoutValue(moved,[...moved]),true);assert.equal(sameLayoutValue(moved,saved.sharedProjectViewOrder),false);
  assert.equal(saved.sharedProjectViewOrder[0],'board');
});

test('malformed project orders never hide views or change old account defaults',()=>{
  for(const value of [null,undefined,[],['board'],['board','board','calendar','gantt'],['board','list','calendar','unknown'],['board','list','calendar',false]]){
    assert.equal(projectViewOrder(value),null);assert.equal(uiVisibility({sharedProjectViewOrder:value}).sharedProjectViewOrder,null);
  }
});

test('calendar scale restores compatible defaults and accepts only the three numeric choices', () => {
  for (const scale of [1, 0.5, 0.25]) assert.equal(uiVisibility({sharedCalendarScale:scale}).sharedCalendarScale, scale);
  for (const scale of [undefined,null,0,-1,0.1,'0.25','0.5',true,{},Infinity,NaN]) {
    assert.equal(uiVisibility({sharedCalendarScale:scale}).sharedCalendarScale,1);
  }
});

test('quarter windows cover three adjacent full periods and the same date range as all task requests', () => {
  const anchors = [new Date(2026,11,17,12),new Date(2028,1,28,12),civilDateCarrier(sacredToCivilDate(2026,11,29)),civilDateCarrier(sacredToCivilDate(2026,12,1))];
  for (const zone of ['UTC','Europe/Berlin','America/Los_Angeles']) {
    const previous = process.env.TZ;
    try {
      process.env.TZ=zone;
      for (const mode of ['profane','sacred','lunar']) for (const anchor of anchors) {
        const window=sharedCalendarWindow(anchor,mode,0.25);
        assert.equal(window.periods.length,3);
        const dates=window.periods.flatMap(period=>period.dates), keys=dates.map(calendarDateKey);
        assert.equal(new Set(keys).size,keys.length,`${mode}/${zone}: duplicate civil date`);
        assert.equal(window.from,keys[0]);assert.equal(window.to,keys.at(-1));
        for(let i=1;i<dates.length;i++) {
          const next=new Date(dates[i-1]);next.setDate(next.getDate()+1);
          assert.equal(calendarDateKey(next),keys[i],`${mode}/${zone}: missing civil date`);
        }
        for(let i=1;i<3;i++) {
          const next=sharedCalendarPeriod(window.periods[i-1].next,mode);
          assert.deepEqual(window.periods[i].dates.map(calendarDateKey),next.dates.map(calendarDateKey));
        }
        for(const scale of [1,0.5]) {
          const normal=sharedCalendarWindow(anchor,mode,scale);
          assert.equal(normal.periods.length,1);assert.equal(normal.from,window.from);
          assert.equal(normal.to,calendarDateKey(window.periods[0].dates.at(-1)));
        }
      }
    } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
  }
});
