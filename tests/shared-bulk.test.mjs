import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { bulkPreviewRequest, bulkRecoveryKey, readBulkRecovery } from "../app/shared-bulk-model.ts";
import { clearPrivateDeviceStorage } from "../app/local-sign-out.ts";

const selection={mode:"all",filter:{projectIds:["synthetic-project"]},sort:"dueDate",queryVersion:"synthetic-generation"};
test("lost preview retries keep the receipt and frozen selection, changed intent gets a new receipt",()=>{
 const first=bulkPreviewRequest(undefined,selection,{kind:"due",mode:"shift",days:2});
 const retried=bulkPreviewRequest(JSON.parse(JSON.stringify(first)),selection,{kind:"due",mode:"shift",days:2});
 assert.deepEqual(retried,first);
 assert.notEqual(bulkPreviewRequest(first,{...selection,queryVersion:"new-generation"},first.action).requestId,first.requestId);
 assert.notEqual(bulkPreviewRequest(first,selection,{...first.action,days:3}).requestId,first.requestId);
});
test("device recovery retains only operation identity and pending request, and logout removes them",()=>{
 const entries=new Map(),storage={get length(){return entries.size;},key:index=>[...entries.keys()][index]??null,
  getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
 const pending=bulkPreviewRequest(undefined,selection,{kind:"priority",priority:3}),operationId=crypto.randomUUID();
 storage.setItem(bulkRecoveryKey("a"),JSON.stringify({operationId,pending,report:{title:"synthetic-private"}}));
 assert.deepEqual(readBulkRecovery(storage,"a"),{operationId,pending});assert.deepEqual(readBulkRecovery(storage,"b"),{});
 clearPrivateDeviceStorage(storage);assert.deepEqual(readBulkRecovery(storage,"a"),{});
 for(const raw of ["malformed",JSON.stringify({operationId:"wrong",pending:{requestId:"wrong"}}),"x".repeat(1_100_001)]){
  storage.setItem(bulkRecoveryKey("a"),raw);assert.deepEqual(readBulkRecovery(storage,"a"),{});
 }
});
test("bulk action copy exists in every translated locale with matching placeholders",()=>{
 const files=["app/SharedBulkActions.tsx","app/shared-bulk-model.ts"],keys=new Set(files.flatMap(file=>[...fs.readFileSync(file,"utf8").matchAll(/"([^"\n]*[А-Яа-яЁё][^"\n]*)"/g)].map(match=>match[1])));
 for(const locale of ["en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"]){
  const paths=[`app/ui-translations/${locale}.json`,`app/shared-work-translations/${locale}.json`,`app/translations.${locale}.json`,`app/translations.${locale}.a.json`,`app/translations.${locale}.b.json`,`app/curated-translations.${locale}.json`].filter(fs.existsSync);
  const dictionary=Object.assign({},...paths.map(path=>JSON.parse(fs.readFileSync(path,"utf8"))));
  for(const key of keys){assert.ok(dictionary[key],`${locale}: ${key}`);assert.deepEqual([...dictionary[key].matchAll(/\{\w+\}/g)].map(match=>match[0]).sort(),[...key.matchAll(/\{\w+\}/g)].map(match=>match[0]).sort(),`${locale}: parameters in ${key}`);}
 }
});
