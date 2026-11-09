import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { gregorianSeasonArt, gregorianMonthArt } from "../app/gregorian-season-art.ts";
import { createHash } from "node:crypto";

test("Gregorian seasons follow both hemispheres, including year boundaries", () => {
  const north={latitude:55.75,timeZone:"Europe/Moscow"};
  const south={latitude:-33.87,timeZone:"Australia/Sydney"};
  assert.deepEqual([0,2,5,8,11].map(month=>gregorianSeasonArt(month,north)),
    ["winter","spring","summer","autumn","winter"].map(season=>`gregorian-seasons/${season}.jpg`));
  assert.deepEqual([0,2,5,8,11].map(month=>gregorianSeasonArt(month,south)),
    ["summer","autumn","winter","spring","summer"].map(season=>`gregorian-seasons/southern/${season}.jpg`));
});

test("Regional landscapes match the native climate families", () => {
  const locations=[
    [60.17,"Europe/Helsinki","boreal/winter"],
    [41.90,"Europe/Rome","mediterranean/winter"],
    [24.71,"Asia/Riyadh","arid/winter"],
    [1.35,"Asia/Singapore","tropical/winter"],
    [-23.55,"America/Sao_Paulo","tropical/summer"],
    [-33.93,"Africa/Johannesburg","southern/summer"],
    [-31.95,"Australia/Perth","mediterranean/summer"],
  ];
  for (const [latitude,timeZone,expected] of locations)
    assert.equal(gregorianSeasonArt(0,{latitude,timeZone}),`gregorian-seasons/${expected}.jpg`);
});

test("Every selected image exists and preserves the native original", () => {
  for (const location of [{latitude:55.75},{latitude:62},{latitude:41,timeZone:"Europe/Rome"},
    {latitude:24,timeZone:"Asia/Riyadh"},{latitude:1,timeZone:"Asia/Singapore"},{latitude:-34}]) {
    for(let month=0;month<12;month++) {
      const file=gregorianSeasonArt(month,location);
      const publicFile=new URL(`../public/${file}`,import.meta.url);
      assert.ok(existsSync(publicFile));
      assert.deepEqual(readFileSync(publicFile),readFileSync(new URL(`../android/app/src/main/assets/originals/${file}`,import.meta.url)));
    }
  }
});

test("Web Gregorian months use 72 distinct generated assets while preserving native seasons", () => {
  const hashes=new Set(),paths=new Set();
  for(const location of [{latitude:55.75},{latitude:62},{latitude:41,timeZone:"Europe/Rome"},
    {latitude:24,timeZone:"Asia/Riyadh"},{latitude:1,timeZone:"Asia/Singapore"},{latitude:-34}]){
    const months=Array.from({length:12},(_,month)=>gregorianMonthArt(month,location));
    assert.equal(new Set(months).size,12);
    for(const file of months){
      const data=readFileSync(new URL(`../public/${file}`,import.meta.url));
      assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');
      assert.ok(data.length<750_000,'Monthly art exceeds delivery budget');
      hashes.add(createHash('sha256').update(data).digest('hex'));paths.add(file);
    }
  }
  assert.equal(paths.size,72);assert.equal(hashes.size,72);
});

test("Monthly art follows southern seasons and wraps Gregorian year boundaries",()=>{
  assert.equal(gregorianMonthArt(0,{latitude:-34,timeZone:"Australia/Sydney"}),"gregorian-months-v1/southern/01.webp");
  assert.equal(gregorianMonthArt(0,{latitude:-32,timeZone:"Australia/Perth"}),"gregorian-months-v1/mediterranean/07.webp");
  assert.equal(gregorianMonthArt(0,{latitude:-24,timeZone:"America/Sao_Paulo"}),"gregorian-months-v1/tropical/07.webp");
  assert.equal(gregorianMonthArt(-1,{latitude:56}),gregorianMonthArt(11,{latitude:56}));
  assert.equal(gregorianMonthArt(12,{latitude:56}),gregorianMonthArt(0,{latitude:56}));
  assert.throws(()=>gregorianMonthArt(NaN,{latitude:56}),TypeError);
});
