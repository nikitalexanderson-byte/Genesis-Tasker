import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gregorianMonthArt,gregorianMonthPanoramaArt} from '../app/gregorian-season-art.ts';

const locations=[{latitude:55.75,timeZone:'Europe/Moscow'},{latitude:62,timeZone:'Europe/Helsinki'},
 {latitude:41,timeZone:'Europe/Rome'},{latitude:24,timeZone:'Asia/Riyadh'},
 {latitude:1,timeZone:'Asia/Singapore'},{latitude:-34,timeZone:'Australia/Sydney'}];

function dimensions(data){
 assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');
 let size;
 for(let offset=12;offset+8<=data.length;){
  const kind=data.toString('ascii',offset,offset+4),length=data.readUInt32LE(offset+4),start=offset+8;
  assert.ok(start+length<=data.length,'Truncated WebP chunk');
  assert.ok(!['EXIF','XMP ','ICCP'].includes(kind),'Unexpected optional image metadata');
  if(kind==='VP8X')size={width:data.readUIntLE(start+4,3)+1,height:data.readUIntLE(start+7,3)+1};
  else if(kind==='VP8 ')size={width:data.readUInt16LE(start+6)&0x3fff,height:data.readUInt16LE(start+8)&0x3fff};
  else if(kind==='VP8L'){const bits=data.readUInt32LE(start+1);size={width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
  offset=start+length+(length%2);
 }
 assert.ok(size,'Image dimensions missing');return size;
}

test('Every regional month has a distinct lightweight panorama suited to a shallow header',()=>{
 const paths=new Set(),hashes=new Set();
 for(const location of locations)for(let month=0;month<12;month++){
  const file=gregorianMonthPanoramaArt(month,location),data=readFileSync(new URL('../public/'+file,import.meta.url));
  const {width,height}=dimensions(data);
  assert.ok(width>=1800&&height>=160&&width/height>=5.5&&width/height<=13,'Invalid panorama shape '+file);
  assert.ok(data.length<400000,'Panorama exceeds the transfer budget '+file);
  paths.add(file);hashes.add(createHash('sha256').update(data).digest('hex'));
 }
 assert.equal(paths.size,72);assert.equal(hashes.size,72);
});

test('Panoramas preserve all regional month choices, southern seasons and year wrapping',()=>{
 for(const location of [...locations,{latitude:-32,timeZone:'Australia/Perth'},{latitude:-24,timeZone:'America/Sao_Paulo'}]){
  for(let month=-1;month<=12;month++)assert.equal(gregorianMonthPanoramaArt(month,location),gregorianMonthArt(month,location).replace('gregorian-months-v1/','gregorian-panoramas-v2/'));
 }
 assert.throws(()=>gregorianMonthPanoramaArt(NaN,locations[0]),TypeError);
});
