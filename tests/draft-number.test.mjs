import test from 'node:test';
import assert from 'node:assert/strict';
import {draftNumberValue} from '../app/draft-number.ts';
test('partial signs, empty required values, overflow and nondecimal strings cannot send a previous number',()=>{
 for(const raw of ['','-','.','-.','1e2','0x10','Infinity','NaN',' 2','2 '])assert.equal(draftNumberValue(raw),undefined,raw);
 assert.equal(draftNumberValue('',{optional:true}),null);assert.equal(draftNumberValue('0'),0);assert.equal(draftNumberValue('-12.5'),-12.5);assert.equal(draftNumberValue('.25'),.25);
 assert.equal(draftNumberValue('9007199254740992',{integer:true}),undefined);assert.equal(draftNumberValue('2.5',{integer:true}),undefined);
 assert.equal(draftNumberValue('-201',{integer:true,min:-200,max:200}),undefined);assert.equal(draftNumberValue('-200',{integer:true,min:-200,max:200}),-200);
});
