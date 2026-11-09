import test from 'node:test';
import assert from 'node:assert/strict';
import {sortAdminUsers} from '../app/admin-user-sort.ts';
const row=(email,patch={})=>({id:email,email,displayName:email,subscriptionPlan:'free',lastSeenAt:null,metricsUpdatedAt:'2026-11-04T00:00:00Z',
  loginCount:0,habitCount:0,projectCount:0,taskCount:0,calendarConnected:false,googleSyncedCount:0,androidDownloadCount:0,
  androidLastDownloadAt:null,androidReportedVersion:null,androidGoogleSyncStatus:null,androidServerSyncStatus:null,
  androidLastServerSyncAt:null,googleAuthConnected:false,...patch});
const emails=(rows,key,direction='asc')=>sortAdminUsers(rows,{key,direction},'ru',Date.parse('2026-11-05T00:00:00Z')).map(x=>x.email);
test('admin counts compare numerically and sort without changing the response',()=>{
  for(const [key,field] of Object.entries({logins:'loginCount',habits:'habitCount',projects:'projectCount',tasks:'taskCount',download:'androidDownloadCount'})){
    const rows=[row('ten',{[field]:10}),row('two',{[field]:2}),row('zero')];
    assert.deepEqual(emails(rows,key),['zero','two','ten']);assert.deepEqual(emails(rows,key,'desc'),['ten','two','zero']);
    assert.deepEqual(rows.map(x=>x.email),['ten','two','zero']);
  }
});
test('unreported metrics and dates remain last in either direction, distinct from a real zero',()=>{
  const rows=[row('unknown',{metricsUpdatedAt:null,lastSeenAt:null}),row('zero',{lastSeenAt:'2026-11-04T00:00:00Z'}),row('two',{taskCount:2,lastSeenAt:'2026-01-01T00:00:00Z'})];
  assert.deepEqual(emails(rows,'tasks'),['zero','two','unknown']);assert.deepEqual(emails(rows,'tasks','desc'),['two','zero','unknown']);
  assert.deepEqual(emails(rows,'activity','desc'),['zero','two','unknown']);assert.deepEqual(emails(rows,'activity'),['two','zero','unknown']);
});
test('plans use package order, versions use numeric components and user names follow the locale',()=>{
  const plans=['business','free','premium4life','standart','premium'].map(plan=>row(plan,{subscriptionPlan:plan}));
  assert.deepEqual(emails(plans,'plan'),['free','standart','premium','business','premium4life']);
  const versions=[row('new',{androidReportedVersion:'3.10.0'}),row('old',{androidReportedVersion:'3.9.0'}),row('missing')];
  assert.deepEqual(emails(versions,'version','desc'),['new','old','missing']);
  assert.deepEqual(emails([row('User10'),row('user2')],'user'),['user2','User10']);
});
test('connection and server columns distinguish authorization, warnings, stale reports and healthy sync',()=>{
  const rows=[row('none'),row('warning',{googleAuthConnected:true,calendarConnected:true,androidGoogleSyncStatus:'warning',androidServerSyncStatus:'warning'}),
    row('healthy',{googleAuthConnected:true,calendarConnected:true,googleSyncedCount:10,androidGoogleSyncStatus:'ok',androidServerSyncStatus:'ok',androidLastServerSyncAt:'2026-11-04T00:00:00Z'}),
    row('stale',{googleAuthConnected:true,androidGoogleSyncStatus:'ok',androidServerSyncStatus:'ok',androidLastServerSyncAt:'2026-01-01T00:00:00Z'})];
  assert.deepEqual(emails(rows,'google','desc'),['healthy','warning','none','stale']);
  assert.deepEqual(emails(rows,'googleServices','desc'),['healthy','warning','stale','none']);
  assert.deepEqual(emails(rows,'server','desc'),['healthy','warning','stale','none']);
});
test('whole-result sorting precedes pagination and equal values have a stable identity order',()=>{
  const rows=Array.from({length:25},(_,i)=>row(`user${25-i}`,{taskCount:25-i}));
  assert.deepEqual(sortAdminUsers(rows,{key:'tasks',direction:'asc'},'ru').slice(0,10).map(x=>x.taskCount),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(emails([row('b'),row('a')],'tasks','desc'),['a','b']);
  assert.deepEqual(sortAdminUsers(rows,null,'ru'),rows);
});
