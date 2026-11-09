import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {calendarModule} from './helpers/calendar-modules.mjs';

const languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
const copy=JSON.parse(readFileSync(new URL('../app/account-retention-legal-copy.json',import.meta.url),'utf8'));
const policy=calendarModule('app/account-retention-legal.ts');
const fields=Object.keys(copy.ru).sort();
const numbers=value=>value.match(/\d+/gu)??[];
const deadlines=value=>[...new Set(numbers(value))].sort();
const placeholders=value=>[...value.matchAll(/\{([A-Za-z]\w*)\}/gu)].map(match=>match[1]).sort();

test('all fourteen public retention policies preserve complete sections, deadlines and placeholders',()=>{
  assert.deepEqual(Object.keys(copy).sort(),[...languages].sort());
  assert.equal(fields.length,14);
  for(const language of languages){
    assert.deepEqual(Object.keys(copy[language]).sort(),fields,language);
    for(const field of fields){
      const value=copy[language][field];
      assert.ok(typeof value==='string'&&value.trim(),`${language}:${field}`);
      assert.deepEqual(deadlines(value),deadlines(copy.ru[field]),`${language}:${field}: policy deadlines changed`);
      assert.deepEqual(placeholders(value),placeholders(copy.ru[field]),`${language}:${field}: placeholders changed`);
      if(!['ru','sr','uk'].includes(language))assert.doesNotMatch(value,/[А-Яа-яЁё]/u,`${language}:${field}: Russian source leaked`);
      if(language!=='ru')assert.notEqual(value,copy.ru[field],`${language}:${field}: untranslated source`);
      if(!['ru','en'].includes(language))assert.notEqual(value,copy.en[field],`${language}:${field}: English fallback`);
    }
    const titles=fields.filter(field=>field.endsWith('Title')).map(field=>copy[language][field]);
    assert.equal(new Set(titles).size,7,`${language}: section titles must remain distinct`);
  }
  assert.deepEqual(numbers(copy.ru.freeBody),['3','6','12']);
  assert.deepEqual(numbers(copy.ru.eliteBody),['3','365','365']);
  assert.deepEqual(numbers(copy.ru.warningBody),['1','365']);
});

test('public retention copy contains no exempt account identities, credentials or markup',()=>{
  for(const [language,value]of Object.entries(copy))for(const [field,text]of Object.entries(value)){
    assert.doesNotMatch(text,/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|mailto:/iu,`${language}:${field}: private exemption identity`);
    assert.doesNotMatch(text,/BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|client_secret|access_token|refresh_token|X-CSRF-Token/iu,`${language}:${field}: credential`);
    assert.doesNotMatch(text,/<\/?[A-Za-z][^>]*>/u,`${language}:${field}: embedded markup`);
  }
});

test('static Russian sections and localized lookup use the same seven public policies',()=>{
  const source=[...policy.accountRetentionTermsSections,policy.accountRetentionPrivacySection,policy.accountRetentionDeleteSection];
  assert.equal(policy.accountRetentionTermsSections.length,5);
  assert.equal(source.length,7);
  assert.equal(source[0][0],copy.ru.freeTitle);
  assert.deepEqual(source[5],[copy.ru.privacyTitle,copy.ru.privacyBody]);
  assert.deepEqual(source[6],[copy.ru.deleteAccountTitle,copy.ru.deleteAccountBody]);
  for(const language of languages){
    const localized=policy.localizedAccountRetentionSections(language);
    assert.equal(localized.size,7,language);
    for(const [index,prefix]of ['free','elite','donations','warning','data','privacy','deleteAccount'].entries()){
      assert.deepEqual(localized.get(source[index][0]),[copy[language][`${prefix}Title`],copy[language][`${prefix}Body`]],`${language}:${prefix}`);
    }
  }
  for(const language of ['unknown','__proto__','toString'])assert.deepEqual([...policy.localizedAccountRetentionSections(language)],[...policy.localizedAccountRetentionSections('en')]);
});

test('real legal pages render every retention section in the chosen language with DOM translation excluded',async()=>{
  const root=fileURLToPath(new URL('../app/',import.meta.url)).replaceAll('\\','/');
  const entry='virtual:account-retention-legal-contract';
  const bundle=await build({configFile:false,logLevel:'silent',plugins:[react(),{
    name:'account-retention-legal-contract',resolveId:id=>id===entry?entry:undefined,
    load:id=>id===entry?`export {LegalPage} from ${JSON.stringify(root+'LegalPage.tsx')};export {legalPages} from ${JSON.stringify(root+'legal-content.ts')};export {setRuntimeLanguage} from ${JSON.stringify(root+'i18n.ts')};`:undefined,
  }],build:{ssr:true,write:false,rolldownOptions:{input:entry,external:['react','react/jsx-runtime','react/jsx-dev-runtime'],output:{codeSplitting:false}}}});
  const directory=new URL('../node_modules/.cache/genesis-tests/',import.meta.url);
  await mkdir(directory,{recursive:true});
  const file=new URL(`account-retention-legal-${randomUUID()}.mjs`,directory);
  await writeFile(file,bundle.output.find(item=>item.isEntry).code);
  try{
    const {LegalPage,legalPages,setRuntimeLanguage}=await import(pathToFileURL(fileURLToPath(file)).href);
    const pages={terms:['free','elite','donations','warning','data'],privacy:['privacy'],'delete-account':['deleteAccount']};
    for(const language of languages){
      setRuntimeLanguage(language);
      for(const [page,prefixes]of Object.entries(pages)){
        const html=renderToStaticMarkup(createElement(LegalPage,{page}));
        for(const prefix of prefixes){
          assert.ok(legalPages[page].sections.some(([title,body])=>title===copy.ru[`${prefix}Title`]&&body===copy.ru[`${prefix}Body`]),`${page}:${prefix}: static source missing`);
          const expected=renderToStaticMarkup(createElement('section',{'data-no-translate':true},
            createElement('h2',null,copy[language][`${prefix}Title`]),createElement('p',null,copy[language][`${prefix}Body`])));
          assert.ok(html.includes(expected),`${language}:${page}:${prefix}: actual LegalPage did not use complete localized copy`);
          if(language!=='ru')assert.ok(!html.includes(copy.ru[`${prefix}Body`]),`${language}:${page}:${prefix}: Russian body leaked`);
        }
      }
    }
  }finally{await rm(file);}
});
