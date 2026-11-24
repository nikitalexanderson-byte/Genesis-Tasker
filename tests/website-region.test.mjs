import assert from 'node:assert/strict';
import test from 'node:test';
import {websiteRegionRussia,websiteDomesticRedirect,websiteDonationsAvailable} from '../app/website-region-policy.ts';

test('device location overrides a VPN IP in both directions',()=>{
  assert.equal(websiteRegionRussia({ip:'outside-RU',device:'RU'}),true);
  assert.equal(websiteRegionRussia({ip:'RU',device:'outside-RU'}),false);
  assert.equal(websiteDomesticRedirect({device:'RU'}),false);
  assert.equal(websiteDomesticRedirect({device:'outside-RU'}),false);
});

test('donations remain available without a website region restriction or geolocation lookup',()=>{
  for(const ip of ['RU','outside-RU','unknown']){
    const region={ip,device:null,loading:false};
    assert.equal(websiteDomesticRedirect(region),false);
    assert.equal(websiteDonationsAvailable(region),true);
    assert.equal(websiteDonationsAvailable({...region,loading:true}),true);
  }
  assert.equal(websiteDonationsAvailable({ip:'outside-RU',device:'RU',loading:true}),true);
  assert.equal(websiteDonationsAvailable({ip:'RU',device:'outside-RU',loading:false}),true);
});