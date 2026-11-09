import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/weather-v1.json',import.meta.url),'utf8'));
const visuals=calendarModule('app/weather-visuals.ts');
const {isWeatherSnapshotV1}=calendarModule('app/weather-contract.ts');
const {createWeatherStore}=calendarModule('app/weather-store.ts');
const landscape=calendarModule('app/solar-landscape.ts');
const instant=Date.parse(fixture.fetchedAt),clone=()=>structuredClone(fixture);

test('the provider-independent fixture retains forecast identity and exact validity bounds',()=>{
  assert.ok(isWeatherSnapshotV1(fixture));
  assert.equal(fixture.provider.dataKind,'forecast');assert.equal(fixture.observedAt,null);
  assert.equal(visuals.isWeatherFresh(fixture,Date.parse(fixture.validAt)),true);
  assert.equal(visuals.isWeatherFresh(fixture,Date.parse(fixture.validUntil)),false);
  assert.equal(visuals.isWeatherFresh(fixture,Date.parse(fixture.validAt)-1),false);
  const shorter=clone();shorter.expiresAt='2026-11-06T12:45:00Z';
  assert.equal(visuals.isWeatherFresh(shorter,Date.parse(shorter.expiresAt)),false);
});

test('zero, missing, unknown and stale precipitation never produces particles',()=>{
  for(const status of ['stale','disabled','unavailable','requires-location']) {
    const sample=clone();sample.status=status;const state=visuals.weatherVisualState(sample,instant);
    assert.equal(state.precipitation,'none');assert.equal(state.particles,0);assert.equal(state.windVisible,false);assert.equal(state.cloudCover,0);assert.equal(state.snowCover,false);
  }
  for(const rate of [0,null,NaN]) {
    const sample=clone();sample.current.precipitationRateMmH=rate;sample.current.precipitation1hMm=rate;
    assert.equal(visuals.weatherVisualState(sample,instant).particles,0);
  }
  for(const precipitationKind of ['none','unknown','tornado']) {
    const sample=clone();sample.current.precipitationKind=precipitationKind;
    assert.equal(visuals.weatherVisualState(sample,instant).particles,0);
  }
  for(const field of ['validAt','validUntil','expiresAt']) {
    const sample=clone();sample[field]=null;assert.equal(visuals.weatherVisualState(sample,instant).particles,0);
  }
  assert.equal(visuals.weatherVisualState(null,instant).particles,0);
});

test('confirmed precipitation types retain separate effects and explicit heavy/light intensity',()=>{
  for(const precipitationKind of ['drizzle','rain','snow','sleet','freezing-rain','hail']) {
    const sample=clone();sample.current.precipitationKind=precipitationKind;sample.current.intensity='heavy';
    const state=visuals.weatherVisualState(sample,instant);
    assert.equal(state.precipitation,precipitationKind);assert.equal(state.intensity,'heavy');assert.equal(state.particles,60);
    sample.current.intensity='light';assert.equal(visuals.weatherVisualState(sample,instant).particles,18);
    sample.current.intensity='none';assert.equal(visuals.weatherVisualState(sample,instant).particles,0);
  }
});

test('snowfall and freezing temperatures never invent ground snow cover',()=>{
  const sample=clone();sample.current.temperatureC=-15;sample.current.condition='snow';sample.current.precipitationKind='snow';sample.current.snowDepthCm=null;
  assert.equal(visuals.weatherVisualState(sample,instant).snowCover,false);
  const scene=landscape.solarLandscapeState(new Date(instant),{latitude:55.7558,longitude:37.6173,timeZone:'Europe/Moscow'},'Europe/Moscow','selected-city',sample);
  assert.equal(scene.snowCover,false);assert.ok(!scene.artPath.includes('/snow-cover/'));
  sample.current.snowDepthCm=0;assert.equal(visuals.weatherVisualState(sample,instant).snowCover,false);
  sample.current.snowDepthCm=0.1;assert.equal(visuals.weatherVisualState(sample,instant).snowCover,true);
  sample.status='stale';assert.equal(visuals.weatherVisualState(sample,instant).snowCover,false);
});

test('clouds attenuate the geometric sun and terrain; wind direction mirrors the observer view',()=>{
  const sample=clone();sample.current.cloudCoverPercent=100;sample.current.windDirectionDeg=90;
  const north=visuals.weatherVisualState(sample,instant);assert.equal(north.sunTransmission,0);assert.equal(north.groundDimming,0.24);assert.ok(north.drift>0);
  sample.location.latitude=-33;const south=visuals.weatherVisualState(sample,instant);assert.equal(north.drift,-south.drift);
  sample.current.windSpeedMps=0;sample.current.windGustMps=0;assert.equal(visuals.weatherVisualState(sample,instant).windVisible,false);
  const place={latitude:55.7558,longitude:37.6173,timeZone:'Europe/Moscow'};
  const clear=landscape.solarLandscapeState(new Date(instant),place,'Europe/Moscow','selected-city');
  const cloudy=landscape.solarLandscapeState(new Date(instant),place,'Europe/Moscow','selected-city',sample);
  assert.equal(cloudy.position.sunVisible,clear.position.sunVisible);assert.equal(cloudy.lightOpacity,0);assert.ok(cloudy.terrainBrightness<clear.terrainBrightness);
});

test('fog, storm and blizzard require their own confirmed fields',()=>{
  const sample=clone();assert.equal(visuals.weatherVisualState(sample,instant).fogOpacity,0);assert.equal(visuals.weatherVisualState(sample,instant).storm,false);
  sample.current.visibilityM=200;assert.ok(visuals.weatherVisualState(sample,instant).fogOpacity>0);
  sample.current.thunderstorm=true;assert.equal(visuals.weatherVisualState(sample,instant).storm,true);
  sample.current.blizzard=true;assert.equal(visuals.weatherVisualState(sample,instant).blizzard,false);
  sample.current.precipitationKind='snow';assert.equal(visuals.weatherVisualState(sample,instant).blizzard,true);
  sample.current.precipitationRateMmH=0;assert.equal(visuals.weatherVisualState(sample,instant).blizzard,false);
});

test('malformed responses cannot enter the scene cache',()=>{
  for(const mutate of [s=>{s.provider=null;},s=>{s.provider.dataKind='live';},s=>{s.current.cloudCoverPercent=NaN;},s=>{s.current.precipitationKind='tornado';},s=>{s.location.latitude=91;},s=>{s.validAt='bad';}]) {
    const sample=clone();mutate(sample);assert.equal(isWeatherSnapshotV1(sample),false);
  }
  assert.equal(isWeatherSnapshotV1(null),false);
});

function clockHarness() {
  let now=instant,visible=true,next=0;const timers=new Map();
  const runtime={now:()=>now,visible:()=>visible,setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id)};
  return {runtime,hide:()=>{visible=false;},show:()=>{visible=true;},advance:ms=>{now+=ms;let budget=20;for(;;){const entry=[...timers].filter(([,t])=>t.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;if(!budget--)throw Error('Busy timer loop');timers.delete(entry[0]);entry[1].fn();}},timers};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const request={latitude:55.7558,longitude:37.6173,locationSource:'selected-city'};

test('two scene subscribers share one request and fresh remounts use memory cache',async()=>{
  const h=clockHarness();let calls=0;const store=createWeatherStore(request,async()=>{calls++;return clone();},h.runtime);
  const first=store.subscribe(()=>{}),second=store.subscribe(()=>{});await flush();assert.equal(calls,1);assert.equal(store.getSnapshot().status,'ready');
  first();assert.equal(store.hasListeners(),true);second();assert.equal(h.timers.size,0);
  h.advance(120_000);const third=store.subscribe(()=>{});await flush();assert.equal(calls,1);third();
});

test('last unsubscribe aborts the request; a late account/location result is ignored',async()=>{
  const h=clockHarness(),pending=[];const store=createWeatherStore(request,(_,signal)=>new Promise(resolve=>pending.push({signal,resolve})),h.runtime);
  const first=store.subscribe(()=>{}),second=store.subscribe(()=>{});first();assert.equal(pending[0].signal.aborted,false);second();assert.equal(pending[0].signal.aborted,true);
  pending[0].resolve(clone());await flush();assert.equal(store.getSnapshot().weather,null);
  const next=store.subscribe(()=>{});assert.equal(pending.length,2);next();assert.equal(h.timers.size,0);
});

test('expiry stops precipitation while hidden, with no background reads or focus polling',async()=>{
  const h=clockHarness();let calls=0;const store=createWeatherStore(request,async()=>{calls++;if(calls===1)return clone();return new Promise(()=>{});},h.runtime);
  const stop=store.subscribe(()=>{});await flush();h.hide();store.resume();h.advance(31*60_000);
  assert.equal(calls,1);assert.equal(store.getSnapshot().weather.status,'stale');assert.equal(visuals.weatherVisualState(store.getSnapshot().weather,h.runtime.now()).particles,0);
  h.show();store.resume();assert.equal(calls,2);store.resume();store.resume();assert.equal(calls,2);stop();
});

test('short validity stops effects on time and failed requests back off for five minutes',async()=>{
  const h=clockHarness();let calls=0;const short=clone();short.validUntil=short.expiresAt=short.retryAt=new Date(instant+10_000).toISOString();
  const store=createWeatherStore(request,async()=>{calls++;if(calls===1)return short;throw Error('offline');},h.runtime);
  const stop=store.subscribe(()=>{});await flush();h.advance(10_001);assert.equal(calls,1);assert.equal(store.getSnapshot().weather.status,'stale');
  store.resume();assert.equal(calls,1);h.advance(300_000);await flush();assert.equal(calls,2);store.resume();store.resume();assert.equal(calls,2);stop();
});

test('approximate timezone locations never request provider weather',async()=>{
  const h=clockHarness();let calls=0;const store=createWeatherStore(null,async()=>{calls++;return clone();},h.runtime);
  const stop=store.subscribe(()=>{});await flush();store.resume();h.advance(10_000_000);assert.equal(calls,0);assert.equal(store.getSnapshot().status,'requires-location');stop();
});

test('all fourteen locale copies contain the same weather states, conditions and attribution labels',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/weather-copy.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(copy).length,14);const keys=Object.keys(copy.en).sort(),conditions=Object.keys(copy.en.conditions).sort();
  for(const [language,entry] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(entry).sort(),keys,language);assert.deepEqual(Object.keys(entry.conditions).sort(),conditions,language);
    assert.ok(Object.values(entry.conditions).every(value=>typeof value==='string'&&value.trim()));
    assert.ok(entry.forecast&&entry.observation&&entry.stale&&entry.source&&entry.license);
  }
});
