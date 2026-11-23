import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateNativeUiPreferences} from '../app/e2ee/native-ui-preferences.ts';

const value=()=>({format:'genesis-native-ui-preferences-v1',ownerId:'ui-owner',values:{weatherTemperatureUnit:'fahrenheit'},pending:{time:'12h'}});
const reject=change=>{const input=value();change(input);assert.throws(()=>validateNativeUiPreferences(input,'ui-owner'),/E2EE_/);};
test('native UI history validates without aliasing the caller document',()=>{
 const input=value(),checked=validateNativeUiPreferences(input,'ui-owner');assert.deepEqual(JSON.parse(JSON.stringify(checked)),input);assert.notEqual(checked,input);
 input.values.weatherTemperatureUnit='celsius';assert.equal(checked.values.weatherTemperatureUnit,'fahrenheit');
});
test('native UI history refuses foreign owner, format and injected authority',()=>{
 reject(v=>v.ownerId='other-owner');reject(v=>v.format='other');reject(v=>v.entitlement=true);reject(v=>v.pending.membership='grant');
});
test('native UI history refuses old pending names and non-string values',()=>{
 reject(v=>v.values['pending:time']='12h');reject(v=>v.values.time=12);reject(v=>v.pending=[]);
});
test('native UI history bounds key, value, count and complete UTF-8 size',()=>{
 reject(v=>v.values['a'.repeat(129)]='x');reject(v=>v.values.time='x'.repeat(65537));
 reject(v=>v.values=Object.fromEntries(Array.from({length:1025},(_,n)=>['v'+n,''])));
 reject(v=>v.values=Object.fromEntries(Array.from({length:3},(_,n)=>['v'+n,'я'.repeat(65536)])));
});
