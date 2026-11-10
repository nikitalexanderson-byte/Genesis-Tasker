import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';

const {solarWaterState}=calendarModule('app/solar-water.ts');
const now=Date.parse('2027-01-15T12:00:00Z');
const weather=(temperatureC=5,windSpeedMps=3,windGustMps=0)=>({schemaVersion:1,status:'fresh',validAt:new Date(now-60000).toISOString(),validUntil:new Date(now+3600000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),current:{temperatureC,windSpeedMps,windGustMps}});

test('gentle water becomes waves with strong fresh wind or gusts',()=>{
  const calm=solarWaterState('temperate/07.webp',weather(20,1),now);
  const windy=solarWaterState('temperate/07.webp',weather(20,12),now);
  const gusty=solarWaterState('temperate/07.webp',weather(20,2,15),now);
  assert.equal(calm.phase,'ripple');assert.equal(windy.phase,'waves');assert.equal(gusty.phase,'waves');
  assert(windy.amplitude>calm.amplitude&&windy.speed>calm.speed);
  assert(gusty.amplitude>windy.amplitude);
});

test('winter lake freezes strictly below zero and stops all water motion',()=>{
  for(const month of ['12','01','02']){
    const ice=solarWaterState(`temperate/${month}.webp`,weather(-8,16,22),now);
    assert.equal(ice.phase,'ice');assert.equal(ice.amplitude,0);assert.equal(ice.speed,0);assert(ice.frost>.7);
  }
  assert.equal(solarWaterState('temperate/01.webp',weather(0,1),now).phase,'ripple');
  assert.equal(solarWaterState('temperate/01.webp',weather(5,1),now).phase,'ripple');
  assert.equal(solarWaterState('temperate/07.webp',weather(-2,1),now).phase,'ripple');
});

test('a sea or tropical scene does not gain a frozen lake from an unrelated negative forecast',()=>{
  for(const key of ['mediterranean/01.webp','southern/07.webp','tropical/01.webp'])assert.equal(solarWaterState(key,weather(-4,12),now).phase,'waves');
  assert.equal(solarWaterState('arid/01.webp',weather(-4,1),now).phase,'ice');
});

test('stale or unavailable weather never drives a storm or frozen surface',()=>{
  for(const snapshot of [null,{...weather(-10,25),status:'stale'},{...weather(-10,25),expiresAt:new Date(now-1).toISOString()}]){
    const water=solarWaterState('temperate/01.webp',snapshot,now);
    assert.equal(water.phase,'ripple');assert(water.amplitude<.5);
  }
});

test('every retained region/month has bounded water coordinates and horizon-aware snow alignment',()=>{
  for(const region of ['temperate','boreal','mediterranean','arid','tropical','southern'])for(let month=1;month<=12;month++){
    const key=`${region}/${String(month).padStart(2,'0')}.webp`,water=solarWaterState(key,null,now);
    assert(water.surface.points.length>=8);assert(water.surface.top<water.surface.bottom);
    for(const point of water.surface.points)assert(point.every(value=>Number.isFinite(value)&&value>0&&value<1),key);
  }
  const normal=solarWaterState('temperate/01.webp',weather(-5),now);
  const snowy=solarWaterState('temperate/01.webp',weather(-5),now,.8);
  assert(snowy.surface.top>normal.surface.top);assert.equal(snowy.phase,'ice');
  assert.equal(solarWaterState('../unrelated.webp',weather(),now),null);
});

test('rain impacts follow fresh liquid precipitation and stop on ice or expired weather',()=>{
  const sample=weather(6,4);
  Object.assign(sample.current,{precipitationKind:'rain',precipitationRateMmH:3,intensity:'moderate'});
  const rain=solarWaterState('temperate/01.webp',sample,now);
  assert.ok(rain.rain>0);
  assert.equal(solarWaterState('temperate/01.webp',{...sample,status:'stale'},now).rain,0);
  assert.equal(solarWaterState('temperate/01.webp',{...sample,current:{...sample.current,temperatureC:-8}},now).rain,0);
  assert.equal(solarWaterState('temperate/01.webp',{...sample,current:{...sample.current,precipitationKind:'snow'}},now).rain,0);
});
