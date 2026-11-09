import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {effectiveDarkPalette} from "../app/dark-palettes.ts";
import {validDreamDay,validateDiaryNote,newDiaryNote} from "../app/diary-model.ts";
const read=name=>JSON.parse(readFileSync(new URL(`../app/${name}.json`,import.meta.url),"utf8"));
const languages=["ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"];
test("3.1.8 copy is complete in all 14 locales with matching placeholders and exact identities",()=>{
 for(const name of ["dream-journal-copy","dark-palette-copy","release-318-legal-copy","messenger-copy","billing-feature-copy"]){
  const copy=read(name),keys=Object.keys(copy.ru).sort();assert.deepEqual(Object.keys(copy).sort(),[...languages].sort());
  for(const lang of languages){assert.deepEqual(Object.keys(copy[lang]).sort(),keys,`${name}: ${lang}`);
   for(const key of keys){const text=copy[lang][key];assert.equal(typeof text,"string");assert(text.trim(),`${lang}.${key}`);
    assert(!/[�]|undefined|\[object Object\]/.test(text),`${name}: ${lang}.${key}`);
    assert.deepEqual([...text.matchAll(/\{[a-zA-Z][a-zA-Z0-9]*\}/g)].map(v=>v[0]).sort(),[...copy.ru[key].matchAll(/\{[a-zA-Z][a-zA-Z0-9]*\}/g)].map(v=>v[0]).sort());
   }
  }
 }
 const legal=read("release-318-legal-copy");for(const lang of languages){assert(legal[lang].identity.includes("Ляпин Никита Александрович"));assert(legal[lang].performer.includes("772495179010"));}
});
const access=(plan,allowed)=>({schemaVersion:1,enforcementEnabled:true,declaredPlan:plan,effectivePlan:plan,lifetimePremium:false,
 validUntil:plan==="free"?null:"2099-01-01T00:00:00Z",evaluatedAt:"2026-11-04T00:00:00Z",allowedFeatures:allowed,freeFeatures:[]});
test("green is the default and downgrade never applies a saved paid palette",()=>{
 for(const plan of ["free","standart"])for(const palette of [undefined,"green","burgundy","blue","violet","unknown"])
   assert.equal(effectiveDarkPalette(palette,access(plan,[])),"green");
 for(const palette of ["burgundy","blue","violet"]){assert.equal(effectiveDarkPalette(palette,access("premium",["dark-palettes"])),palette);
  assert.equal(effectiveDarkPalette(palette,{...access("premium",["dark-palettes"]),validUntil:"2000-01-01T00:00:00Z"}),"green");}
 assert.equal(effectiveDarkPalette("violet"),"green");
});
test("dream date metadata preserves old notes while rejecting nonexistent dates",()=>{
 for(const day of ["2024-02-29","2026-11-04","2026-10-01"])assert(validDreamDay(day));
 for(const day of ["2026-02-29","2026-04-31","2026-13-01","2026-11-4","0000-01-01",undefined])assert(!validDreamDay(day));
 const old=newDiaryNote("An existing private note");assert.deepEqual(validateDiaryNote(old),old);
 const dream={...old,dream:{day:"2026-11-04",timeZone:"Europe/Moscow"}};assert.deepEqual(validateDiaryNote(dream).dream,dream.dream);
 assert.throws(()=>validateDiaryNote({...dream,dream:{...dream.dream,day:"2026-02-30"}}));
});
