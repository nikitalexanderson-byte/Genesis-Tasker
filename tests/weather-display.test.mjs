import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {weatherTemperature,weatherPressure,weatherDisplay}=calendarModule('app/weather-display.ts');

test('Celsius and Fahrenheit agree at freezing, boiling and minus forty',()=>{
  for(const [c,f] of [[0,32],[100,212],[-40,-40],[6.2,43.16]]) {
    assert.equal(weatherTemperature(c,'celsius'),c);
    assert.ok(Math.abs(weatherTemperature(c,'fahrenheit')-f)<1e-9);
  }
});
test('standard sea-level pressure converts to 760 millimeters of mercury',()=>{
  assert.ok(Math.abs(weatherPressure(1013.25,'mmhg')-760)<0.001);
  assert.equal(weatherPressure(1013.25,'hpa'),1013.25);
  assert.equal(weatherPressure(0,'mmhg'),0);
});
test('unknown or non-finite readings are never converted into a plausible number',()=>{
  for(const value of [null,undefined,NaN,Infinity,-Infinity]) {
    assert.equal(weatherTemperature(value,'fahrenheit'),null);
    assert.equal(weatherPressure(value,'mmhg'),null);
  }
});
test('missing or corrupt device preferences recover independently to Celsius and hPa',()=>{
  assert.deepEqual(weatherDisplay(null),{temperature:'celsius',pressure:'hpa'});
  assert.deepEqual(weatherDisplay({temperature:'kelvin',pressure:'mmhg'}),{temperature:'celsius',pressure:'mmhg'});
  assert.deepEqual(weatherDisplay({temperature:'fahrenheit',pressure:'psi'}),{temperature:'fahrenheit',pressure:'hpa'});
});
test('every supported locale names both choices and both pressure symbols',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/weather-copy.json',import.meta.url),'utf8'));
  for(const [language,c] of Object.entries(copy)) for(const key of ['displayTitle','temperatureUnit','celsius','fahrenheit','hectopascals','millimetersMercury','mmHg','hPa'])
    assert.ok(typeof c[key]==='string'&&c[key].trim(),`${language}.${key}`);
});
