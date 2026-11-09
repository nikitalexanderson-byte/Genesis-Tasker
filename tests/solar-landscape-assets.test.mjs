import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../public/solar-landscapes-v1/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));

test('terrain cache revision identifies every base and snow plate byte',()=>{
  const revision=createHash('sha256');
  const paths=[...Object.keys(manifest.entries),...Object.values(manifest.snowCoverEntries??{}).map(plate=>plate.path)].sort();
  for(const path of paths)revision.update(path).update(readFileSync(new URL(path,root)));
  assert.equal(manifest.assetRevision,revision.digest('hex'));
});

function hasAlpha(buffer) {
  for(let offset=12;offset+8<=buffer.length;) {
    const kind=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),data=offset+8;
    assert.ok(data+size<=buffer.length,'Truncated WebP chunk');
    if(kind==='ALPH')return true;
    if(kind==='VP8X'&&size>=10&&(buffer[data]&0x10))return true;
    if(kind==='VP8L'&&size>=5&&buffer[data]===0x2f&&(buffer.readUInt32LE(data+1)&0x10000000))return true;
    offset=data+size+(size%2);
  }
  return false;
}

function plateDimensions(buffer) {
  assert.equal(buffer.toString('ascii',12,16),'VP8X','Alpha panoramas require the extended WebP header');
  return {width:buffer.readUIntLE(24,3)+1,height:buffer.readUIntLE(27,3)+1};
}

function assertDesktopPanorama(plate,buffer,key) {
  assert.deepEqual(plateDimensions(buffer),{width:plate.width,height:plate.height},key);
  assert.ok(plate.width>=2048,`${key} must retain native desktop detail`);
  assert.ok(plate.width/plate.height>=2.7&&plate.width/plate.height<=3.1,`${key} must remain panoramic`);
  assert.ok(buffer.length<2_000_000,`${key} must stay suitable for the mobile bundle`);
}

test('every climate has twelve complete alpha terrain plates and a finite authored horizon',()=>{
  const keys=['temperate','boreal','mediterranean','arid','tropical','southern'].flatMap(region=>Array.from({length:12},(_,month)=>`${region}/${String(month+1).padStart(2,'0')}.webp`));
  assert.equal(manifest.version,1);
  assert.deepEqual(Object.keys(manifest.entries).sort(),keys.sort());
  for(const key of keys) {
    const plate=manifest.entries[key],buffer=readFileSync(new URL(key,root));
    assertDesktopPanorama(plate,buffer,key);
    assert.ok(Number.isFinite(plate.horizonY)&&plate.horizonY>0.08&&plate.horizonY<1,key);
    assert.equal(buffer.toString('ascii',0,4),'RIFF',key);
    assert.equal(buffer.toString('ascii',8,12),'WEBP',key);
    assert.ok(hasAlpha(buffer),`${key} must leave the sky transparent for the moving sun`);
  }
});

test('optional ground snow variants match an existing base and keep a transparent sky',()=>{
  for(const [key,plate] of Object.entries(manifest.snowCoverEntries??{})) {
    assert.ok(manifest.entries[key],`${key} requires a snow-free base`);
    assert.equal(plate.path,`snow-cover/${key}`,key);
    assert.ok(Number.isFinite(plate.horizonY)&&plate.horizonY>0.08&&plate.horizonY<1,key);
    const buffer=readFileSync(new URL(plate.path,root));
    assertDesktopPanorama(plate,buffer,key);
    assert.equal(buffer.toString('ascii',0,4),'RIFF',key);
    assert.equal(buffer.toString('ascii',8,12),'WEBP',key);
    assert.ok(hasAlpha(buffer),`${key} snow cover must leave the dynamic sky transparent`);
  }
});
