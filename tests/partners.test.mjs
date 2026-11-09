import assert from 'node:assert/strict';
import {test} from 'node:test';
import {partnerMinor,partnerDecimal} from '../app/partner-money.ts';
import {PARTNER_LANGUAGES,partnerCopyRows,partnerText} from '../app/partner-copy.ts';

test('partner amounts accept exact cents and reject precision loss, signs, exponents and overflow',()=>{
  for(const [text,value] of [['0',0],['0.01',1],['1,23',123],[' 1000.50 ',100050],['10000000000.00',1000000000000]])assert.equal(partnerMinor(text),value);
  for(const text of ['', '1.001','1e3','Infinity','NaN','-1','+1','1 000','10000000000.01','0x10','12,34.50'])assert.equal(partnerMinor(text),null,text);
  assert.equal(partnerMinor('-0.01',true),-1);assert.equal(partnerMinor('-10000000000',true),-1000000000000);
});
test('integer amount editing round trips without changing a financial correction',()=>{
  for(const value of [0,1,-1,46500,-1500,1000000000000,-1000000000000])assert.equal(partnerMinor(partnerDecimal(value),true),value);
  assert.equal(partnerDecimal(null),'');
});
test('all fourteen partner locales contain complete financial, privacy and access copy',()=>{
  assert.equal(new Set(PARTNER_LANGUAGES).size,14);
  for(const [key,values] of Object.entries(partnerCopyRows)){
    assert.equal(values.length,14,key);
    for(const [index,language] of PARTNER_LANGUAGES.entries()){
      assert.equal(typeof values[index],'string',key+':'+language);assert.ok(values[index].trim(),key+':'+language);
      assert.equal(partnerText(key,language),values[index]);
    }
  }
  assert.match(partnerText('taxHelp','en'),/tax base/i);
  assert.match(partnerText('indefinite','en'),/indefinite/i);
});
