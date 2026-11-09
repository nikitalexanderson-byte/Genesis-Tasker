import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';

function preparationInstructions(packet) {
  const texts=typeof packet==='string'?[packet]:['utf-8','utf-16le','utf-16be'].map(encoding=>new TextDecoder(encoding).decode(packet));
  return texts.some(text=>/<(?:[\w.-]+:)?prompt\b[^>]*>/i.test(text)
    || (/Use case\s*:/i.test(text)&&/Asset type\s*:/i.test(text)));
}

test('metadata policy distinguishes preparation instructions from descriptive and rights text',()=>{
  assert(preparationInstructions('<asset:prompt>composition instructions</asset:prompt>'));
  assert(preparationInstructions('<description>Use case: test. Asset type: illustration.</description>'));
  assert(!preparationInstructions('<description>A landscape.</description><rights>Owner attribution</rights>'));
  const encoded=Buffer.from('<asset:prompt>composition instructions</asset:prompt>','utf16le');
  assert(preparationInstructions(encoded));assert(preparationInstructions(Buffer.from(encoded).swap16()));
});

test('public advice images contain no embedded preparation instructions',()=>{
  let checked=0;
  function inspect(directory) {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const file=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
      if(entry.isDirectory()){inspect(file);continue;}
      if(entry.name.endsWith('.webp.json')) {
        const metadata=JSON.parse(readFileSync(file,'utf8'));
        for(const key of Object.keys(metadata))assert(!/prompt|generator/i.test(key),'Unexpected preparation field in '+file.pathname);
      }
      if(!entry.name.endsWith('.webp'))continue;
      const bytes=readFileSync(file);checked++;
      assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
      assert.equal(bytes.readUInt32LE(4),bytes.length-8,'WebP container size must be valid');
      let hasMetadata=false,declaresMetadata=false,offset=12;
      for(;offset+8<=bytes.length;){
        const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),end=offset+8+size+(size%2);
        assert(end<=bytes.length,'WebP chunk must be complete');
        if(type==='VP8X')declaresMetadata=Boolean(bytes[offset+8]&4);
        if(type==='XMP '){hasMetadata=true;assert(!preparationInstructions(bytes.subarray(offset+8,offset+8+size)),file.pathname);}
        offset=end;
      }
      assert.equal(offset,bytes.length);assert.equal(declaresMetadata,hasMetadata,'Metadata presence flag must match its chunks');
    }
  }
  inspect(new URL('../public/advice-art/',import.meta.url));
  assert(checked>3000,'The check must inspect the shipped artwork corpus');
});
