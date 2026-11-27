import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const copy=JSON.parse(readFileSync(path.join(root,'app/public-gallery-copy.json'),'utf8'));
const manifest=JSON.parse(readFileSync(path.join(root,'public/product-preview/free/manifest.json'),'utf8'));
assert.equal(manifest.plan,'free');
assert.equal(manifest.syntheticData,true);
assert.equal(Object.keys(copy).length,18);
assert.equal(manifest.images.length,Object.keys(copy).length * 20);
const hashes=new Set(),paths=new Set();
function dimensions(data){
  assert.equal(data.readUInt16BE(0),0xffd8,'JPEG signature');
  for(let offset=2;offset<data.length;){
    assert.equal(data[offset++],0xff,'JPEG marker');
    while(data[offset]===0xff)offset++;
    const marker=data[offset++];
    if(marker===0xd9||marker===0xda)break;
    const length=data.readUInt16BE(offset);
    if([0xc0,0xc1,0xc2].includes(marker))return [data.readUInt16BE(offset+5),data.readUInt16BE(offset+3)];
    assert.ok(length>=2);offset+=length;
  }
  throw Error('JPEG dimensions missing');
}
for(const language of Object.keys(copy)){
  const images=manifest.images.filter(item=>item.language===language);
  assert.equal(images.length,20,language);
  assert.equal(new Set(images.map(item=>item.id)).size,20,language);
  assert.equal(copy[language].items.length,20,language);
  assert.equal(readdirSync(path.join(root,'public/product-preview/free',language)).filter(file=>file.endsWith('.jpg')).length,20,language);
  for(const item of images){
    assert.match(item.id,/^[a-z-]+$/);
    const relative=`product-preview/free/${language}/${item.id}.jpg`;
    assert.ok(!paths.has(relative));paths.add(relative);
    const data=readFileSync(path.join(root,'public',relative));
    const hash=createHash('sha256').update(data).digest('hex');
    assert.equal(hash,item.sha256,relative);
    assert.ok(!hashes.has(hash),`Duplicate screenshot: ${relative}`);hashes.add(hash);
    const pixels=dimensions(data);
    assert.deepEqual(pixels,item.pixels,relative);
    // The browser omits its scrollbar in some captures; the CSS fixes the displayed height.
    assert.ok(['1440x1000','1425x990'].includes(pixels.join('x')),relative);
    assert.deepEqual(item.viewport,[1440,1000],relative);
    assert.equal(item.images,true,relative);
  }
}
console.log('Public gallery: '+manifest.images.length+' distinct JPEG screenshots, 20 per language, 1440×1000 capture viewport, pixel sizes, hashes and provenance verified.');
