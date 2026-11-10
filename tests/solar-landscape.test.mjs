import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Body,Equator,Horizon,Observer} from 'astronomy-engine';
import {calendarModule} from './helpers/calendar-modules.mjs';

const solar=calendarModule('app/solar-times.ts');
const landscape=calendarModule('app/solar-landscape.ts');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/solar-landscape-v1.json',import.meta.url),'utf8'));
const close=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const circularDistance=(a,b)=>Math.abs(((a-b+540)%360)-180);

test('web and native share geometric positions, light phases and hemisphere projection fixtures',()=>{
  assert.equal(fixture.version,1);
  assert.deepEqual(new Set(fixture.cases.map(entry=>entry.expected.phase)),new Set(['day','civil-twilight','nautical-twilight','astronomical-twilight','night']));
  for(const entry of fixture.cases) {
    const position=solar.getSolarPosition(new Date(entry.instant),entry);
    for(const [key,value] of Object.entries(position)) {
      if(typeof value==='number')close(value,entry.expected[key]);
      else assert.equal(value,entry.expected[key],`${entry.id}: ${key}`);
    }
    const point=landscape.projectSolarPosition(position,entry.latitude,fixture.horizonY);
    close(point.x,entry.expected.sunX);
    close(point.y,entry.expected.sunY);
  }
});

test('decorative solar ephemeris agrees with an independent geometric astronomy oracle through the year',()=>{
  const sites=[[55.7558,37.6173],[-33.8688,151.2093],[69.6492,18.9553],[1.3521,103.8198],[-0.1807,-78.4678],[90,0],[-90,0]];
  for(let month=0;month<12;month++)for(const [latitude,longitude] of sites)for(const hour of [0,6,12,18]) {
    const now=new Date(Date.UTC(2026,month,15,hour)),observer=new Observer(latitude,longitude,0);
    const equatorial=Equator(Body.Sun,now,observer,true,true);
    // Refraction is intentionally absent: both clients render the geometric disk.
    const oracle=Horizon(now,observer,equatorial.ra,equatorial.dec);
    const position=solar.getSolarPosition(now,{latitude,longitude});
    close(position.altitudeDeg,oracle.altitude,0.3);
    // Azimuth becomes singular near the zenith/nadir; altitude remains checked there.
    if(Math.abs(oracle.altitude)<85)assert.ok(circularDistance(position.azimuthDeg,oracle.azimuth)<1.5);
  }
});

test('twilight thresholds are explicit and the sun disappears below the geometric horizon',()=>{
  for(const [altitude,phase] of [[80,'day'],[0,'day'],[-0.001,'civil-twilight'],[-6,'civil-twilight'],[-6.001,'nautical-twilight'],[-12,'nautical-twilight'],[-12.001,'astronomical-twilight'],[-18,'astronomical-twilight'],[-18.001,'night']]) {
    assert.equal(solar.solarLightPhase(altitude),phase);
  }
  for(const entry of fixture.cases) {
    const position=solar.getSolarPosition(new Date(entry.instant),entry);
    assert.equal(position.sunVisible,position.altitudeDeg>0);
    assert.ok(position.minAltitudeDeg<=position.altitudeDeg+1e-8);
    assert.ok(position.maxAltitudeDeg>=position.altitudeDeg-1e-8);
    if(position.polarState==='polar-day')assert.ok(position.minAltitudeDeg>0);
    if(position.polarState==='polar-night')assert.ok(position.maxAltitudeDeg<0);
  }
});

test('projection mirrors the southern view, remains finite at the poles and crosses midnight continuously',()=>{
  const horizon=fixture.horizonY;
  const north=landscape.projectSolarPosition({azimuthDeg:90,altitudeDeg:30},55,horizon);
  const south=landscape.projectSolarPosition({azimuthDeg:90,altitudeDeg:30},-55,horizon);
  close(north.x+south.x,1);
  close(north.y,south.y);
  close(landscape.projectSolarPosition({azimuthDeg:180,altitudeDeg:90},90,horizon).y,0.08);
  for(const azimuthDeg of [0,90,180,270])close(landscape.projectSolarPosition({azimuthDeg,altitudeDeg:90},0,horizon).x,0.5);
  close(landscape.projectSolarPosition({azimuthDeg:180,altitudeDeg:-20},-90,horizon).y,horizon);
  const a=landscape.projectSolarPosition({azimuthDeg:359.9999,altitudeDeg:4},69,horizon);
  const b=landscape.projectSolarPosition({azimuthDeg:0.0001,altitudeDeg:4},69,horizon);
  assert.ok(Math.abs(a.x-b.x)<0.00001);
  for(const entry of fixture.cases) {
    const point=landscape.projectSolarPosition(entry.expected,entry.latitude,horizon);
    assert.ok(point.x>=0.06-1e-9&&point.x<=0.94+1e-9);
    assert.ok(point.y>=0.08-1e-9&&point.y<=horizon+1e-9);
  }
});

test('an almost overhead sun crosses the equator view without an azimuth singularity jump',()=>{
  const observer={latitude:0,longitude:0},points=[];
  for(let minute=2;minute<=14;minute++) {
    const position=solar.getSolarPosition(new Date(Date.UTC(2026,2,20,12,minute)),observer);
    points.push(landscape.projectSolarPosition(position,0,fixture.horizonY));
  }
  assert.ok(points.every(point=>point.x>0.48&&point.x<0.52));
  for(let i=1;i<points.length;i++)assert.ok(Math.abs(points[i].x-points[i-1].x)<0.003);
  assert.ok(points.at(-1).x>points[0].x);
});

test('cover crop keeps the authored horizon aligned with the projected sun on all acceptance widths',()=>{
  for(const width of [360,390,768,1440])for(const height of [300,420])for(const horizonY of [0.56,0.6445,0.72]) {
    const plate={width:1536,height:1024,horizonY};
    const crop=landscape.solarLandscapeCrop(plate,width,height);
    assert.ok(crop.width>=width&&crop.height>=height);
    close(crop.x,(width-crop.width)/2);
    close(crop.y+plate.height*horizonY*crop.scale,height*horizonY,1e-6);
    assert.ok(crop.y<=0&&crop.y+crop.height>=height-1e-7);
  }
});

test('wide desktop crop shows more ground while keeping the horizon and every edge covered',()=>{
  for(const width of [360,390,768,1440,2420])for(const height of [300,420])for(const horizonY of [0.4,0.511,0.72]) {
    const plate={width:2172,height:724,horizonY};
    const target=Math.min(horizonY,0.4),crop=landscape.solarLandscapeCrop(plate,width,height,target);
    close(crop.y+plate.height*horizonY*crop.scale,height*target,1e-6);
    close(crop.width/crop.height,plate.width/plate.height);
    assert.ok(crop.x<=0&&crop.x+crop.width>=width-1e-7);
    assert.ok(crop.y<=0&&crop.y+crop.height>=height-1e-7);
  }
  assert.throws(()=>landscape.solarLandscapeCrop({width:2172,height:724,horizonY:0.5},2420,420,NaN),RangeError);
});

test('actual device civil month and existing regional families choose the landscape',()=>{
  for(const entry of fixture.artCases)assert.equal(landscape.solarLandscapeArtKey(entry.monthIndex,entry),entry.expectedArtKey,entry.id);
  const observer={latitude:-21.1394,longitude:-175.2049,timeZone:'Pacific/Tongatapu'};
  const instant=new Date('2026-11-30T12:01:00Z');
  assert.equal(landscape.solarLandscapeState(instant,observer,'Pacific/Tongatapu','selected-city').monthIndex,11);
  assert.equal(landscape.solarLandscapeState(instant,observer,'Pacific/Honolulu','selected-city').monthIndex,10);
  assert.equal(landscape.solarLandscapeState(new Date('2026-12-01T00:01:00Z'),observer,'Pacific/Honolulu','selected-city').monthIndex,10);
});

test('missing or invalid coordinates use the existing approximate timezone fallback without requesting location',()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('A decorative scene must not request location');};
  try {
    const now=new Date('2026-11-06T09:00:00Z');
    const fallback=landscape.solarLandscapeState(now,null,'Europe/Moscow');
    assert.equal(fallback.approximate,true);
    assert.equal(fallback.locationSource,'timezone-fallback');
    assert.deepEqual(fallback.position,solar.getSolarPosition(now,solar.getTimezoneFallbackLocation('Europe/Moscow')));
    assert.deepEqual(landscape.solarLandscapeState(now,{latitude:NaN,longitude:37},'Europe/Moscow').position,fallback.position);
    assert.deepEqual(landscape.solarLandscapeState(now,{latitude:91,longitude:37},'Europe/Moscow').position,fallback.position);
    assert.equal(landscape.solarLandscapeState(now,{latitude:55,longitude:37},'Europe/Moscow','selected-city').approximate,false);
    assert.equal(landscape.solarLandscapeState(now,null,'Invalid/Zone').monthIndex,10);
  } finally {globalThis.fetch=originalFetch;}
});

test('terrain and sky change with astronomical light while nighttime never produces direct sunlight',()=>{
  const observer={latitude:55.7558,longitude:37.6173,timeZone:'Europe/Moscow'};
  const night=landscape.solarLandscapeState(new Date('2026-11-06T00:00:00Z'),observer,'Europe/Moscow','selected-city');
  const dawn=landscape.solarLandscapeState(new Date('2026-11-06T04:20:00Z'),observer,'Europe/Moscow','selected-city');
  const morning=landscape.solarLandscapeState(new Date('2026-11-06T06:00:00Z'),observer,'Europe/Moscow','selected-city');
  const evening=landscape.solarLandscapeState(new Date('2026-11-06T12:00:00Z'),observer,'Europe/Moscow','selected-city');
  assert.equal(night.directLight,0);
  assert.equal(night.lightOpacity,0);
  assert.equal(night.night,1);
  assert.ok(dawn.terrainBrightness>night.terrainBrightness);
  assert.ok(morning.terrainBrightness>dawn.terrainBrightness);
  assert.notDeepEqual(night.sky,morning.sky);
  assert.ok(morning.sun.x<evening.sun.x);
  assert.ok(morning.shadeRight>0&&morning.shadeLeft===0);
  assert.ok(evening.shadeLeft>0&&evening.shadeRight===0);
  for(const scene of [night,dawn,morning,evening]) {
    assert.ok(scene.terrainBrightness>=0.22&&scene.terrainBrightness<=1.04);
    assert.ok(scene.warmth>=0&&scene.warmth<=1);
    assert.match(scene.sky.top,/^#[\da-f]{6}$/u);
    assert.match(scene.sky.bottom,/^#[\da-f]{6}$/u);
  }
});

test('invalid astronomy, crop and projection inputs fail before creating non-finite CSS coordinates',()=>{
  assert.throws(()=>solar.getSolarPosition(new Date('invalid'),{latitude:0,longitude:0}),RangeError);
  for(const location of [{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:Infinity,longitude:0}]) {
    assert.throws(()=>solar.getSolarPosition(new Date(),location),RangeError);
  }
  assert.throws(()=>solar.solarLightPhase(NaN),RangeError);
  assert.throws(()=>landscape.projectSolarPosition({altitudeDeg:0,azimuthDeg:NaN},0,0.64),RangeError);
  assert.throws(()=>landscape.projectSolarPosition({altitudeDeg:0,azimuthDeg:0},0,0.08),RangeError);
  assert.throws(()=>landscape.solarLandscapeCrop({width:1536,height:1024,horizonY:0.64},0,300),RangeError);
  assert.throws(()=>landscape.solarLandscapeCrop({width:1536,height:1024,horizonY:Infinity},390,300),RangeError);
});

test('the visible sun follows the displayed local rise/set interval, including a remote city and polar days',()=>{
  for(const [observer,zone] of [
    [{latitude:55.7558,longitude:37.6173},'Europe/Moscow'],
    [{latitude:-33.8688,longitude:151.2093},'Australia/Sydney'],
    [{latitude:21.3069,longitude:-157.8583},'Europe/Moscow'],
  ]) {
    const now=new Date('2026-11-10T11:19:00Z');
    const events=solar.getDeviceDaySolarTimes(now,observer,zone);
    assert.ok(events.sunrise&&events.sunset);
    for(const [instant,visible] of [[events.sunrise.valueOf()-1,false],[events.sunrise.valueOf(),true],[events.sunset.valueOf()-1,true],[events.sunset.valueOf(),false]]) {
      const scene=landscape.solarLandscapeState(new Date(instant),observer,zone,'selected-city');
      assert.equal(scene.sunVisible,visible,`${zone} ${new Date(instant).toISOString()}`);
      assert.equal(scene.sunOpacity>0,visible);
    }
  }
  const polar={latitude:69.6492,longitude:18.9553};
  assert.equal(landscape.solarLandscapeState(new Date('2026-06-21T23:00:00Z'),polar,'Europe/Oslo','selected-city').sunVisible,true);
  assert.equal(landscape.solarLandscapeState(new Date('2026-12-21T11:00:00Z'),polar,'Europe/Oslo','selected-city').sunVisible,false);
});

test('refreshing or expiring overcast weather cannot hide or move the daytime solar disk',()=>{
  const now=new Date('2026-11-10T11:19:00Z'),observer={latitude:55.7558,longitude:37.6173};
  const sample=JSON.parse(readFileSync(new URL('./fixtures/weather-v1.json',import.meta.url),'utf8'));
  Object.assign(sample,{validAt:'2026-11-10T11:00:00Z',validUntil:'2026-11-10T12:00:00Z',expiresAt:'2026-11-10T12:00:00Z'});
  Object.assign(sample.current,{condition:'cloudy',cloudCoverPercent:100,precipitationKind:'none',intensity:'none'});
  const cloudy=landscape.solarLandscapeState(now,observer,'Europe/Moscow','selected-city',sample);
  const expired=landscape.solarLandscapeState(now,observer,'Europe/Moscow','selected-city',{...sample,status:'stale'});
  assert.equal(cloudy.sunVisible,true);
  assert.ok(cloudy.sunOpacity>=0.4);
  assert.equal(cloudy.lightOpacity,0);
  assert.ok(expired.sunOpacity>cloudy.sunOpacity);
  assert.deepEqual(cloudy.sun,expired.sun);
  assert.deepEqual(cloudy.position,expired.position);
});
