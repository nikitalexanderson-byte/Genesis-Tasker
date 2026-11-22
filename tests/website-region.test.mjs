import assert from 'node:assert/strict';
import test from 'node:test';
import {websiteRegionRussia,websiteDomesticRedirect,websiteDonationsAvailable} from '../app/website-region-policy.ts';

test('device location overrides a VPN IP in both directions',()=>{
  assert.equal(websiteRegionRussia({ip:'outside-RU',device:'RU'}),true);
  assert.equal(websiteRegionRussia({ip:'RU',device:'outside-RU'}),false);
  assert.equal(websiteDomesticRedirect({device:'RU'}),true);
  assert.equal(websiteDomesticRedirect({device:'outside-RU'}),false);
});

test('IP only can enable Russian donations after lookup but never forces the Russian edition',()=>{
  for(const ip of ['RU','outside-RU','unknown']){
    const region={ip,device:null,loading:false};
    assert.equal(websiteDomesticRedirect(region),false);
    assert.equal(websiteDonationsAvailable(region),ip==='RU');
    assert.equal(websiteDonationsAvailable({...region,loading:true}),false);
  }
  assert.equal(websiteDonationsAvailable({ip:'outside-RU',device:'RU',loading:true}),true);
  assert.equal(websiteDonationsAvailable({ip:'RU',device:'outside-RU',loading:false}),false);
});