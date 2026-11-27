import { REGION_LANGUAGES } from "../app/region-language.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localizedModule} from './helpers/localized-modules.mjs';

test('all 366 sacred days have complete offline copy in every supported language',async()=>{
  const english=JSON.parse(await readFile(new URL('../app/calendar-days.en.json',import.meta.url),'utf8'));
  assert.equal(english.length,366);
  for(const lang of REGION_LANGUAGES.filter(code => code !== "en" && code !== "ru")){
    const rows=JSON.parse(await readFile(new URL(`../app/calendar-days.${lang}.json`,import.meta.url),'utf8'));
    assert.equal(rows.length,english.length,lang);
    for(const [i,row] of rows.entries()){
      assert.ok(row.name?.trim()&&row.description?.trim(),`${lang}/${i}`);
      assert.doesNotMatch(row.name+row.description,/ZXQ|〔\d+〕|⟦\d+⟧|�/,`${lang}/${i}: draft token`);
      assert.notEqual(row.description,english[i].description,`${lang}/${i}: English fallback`);
      const term=row.name.split(' (')[0];
      assert.match(term,lang==='el'?/^[\p{Script=Greek}\p{M} ]+$/u:['sr','uk'].includes(lang)?/^[\p{Script=Cyrillic} ]+$/u:/^[A-Za-z ]+$/,`${lang}/${i}: name script`);
      if(lang!=='el')assert.doesNotMatch(row.name+row.description,/[\u0370-\u03ff\u1f00-\u1fff]{2,}/,`${lang}/${i}: Greek word`);
    }
  }
});

test('weekday labels preserve the selected day and distinguish Sunday from the Sun icon', () => {
  const { translateText } = localizedModule('app/i18n.ts');
  const { mindmapIconLabel } = localizedModule('app/mindmap-icons.ts');
  const dates = {
    he: { monday: 'יום שני', sundayShort: 'א׳', sun: 'השמש' },
    ar: { monday: 'الاثنين', sundayShort: 'الأحد', sun: 'الشمس' },
    ko: { monday: '월요일', sundayShort: '일', sun: '태양' },
    nl: { monday: 'Maandag', sundayShort: 'zo', sun: 'Zon' },
  };
  for (const [language, expected] of Object.entries(dates)) {
    assert.equal(translateText('Понедельник', language), expected.monday);
    assert.equal(translateText('Вс', language), expected.sundayShort);
    assert.equal(mindmapIconLabel('sun', language), expected.sun);
    assert.notEqual(translateText('Будни', language), translateText('Дни недели', language));
  }
});
