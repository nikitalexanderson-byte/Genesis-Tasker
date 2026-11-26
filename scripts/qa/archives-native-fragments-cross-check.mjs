import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeNativeArchiveRows} from '../../app/e2ee/archive-fragments.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...value]=arg.replace(/^--/,'').split('=');return[key,value.join('=')];}));
function owned(path){const absolute=resolve(root,path),child=relative(resolve(root,'output/release-3.3.6/runtime'),absolute);
 assert(child&&!isAbsolute(child)&&!child.startsWith('..'),'Cross-platform fixture/report must stay in the owned runtime output');return absolute;}
const input=owned(options.input??'output/release-3.3.6/runtime/archives-native-fragments-vector.json');
const output=owned(options.output??'output/release-3.3.6/runtime/archives-native-fragments-cross-01.json');
const bytes=readFileSync(input),fixture=JSON.parse(bytes.toString('utf8'));
assert.equal(fixture.protocol,1);assert.equal(fixture.synthetic,true);
const normalized=normalizeNativeArchiveRows(fixture.transport,fixture.context,()=>{});
let total=0;
for(const table of ['stages','safety','receipts']){
 assert.deepEqual(normalized[table],fixture.transport[table].map(text=>JSON.parse(text)));total+=normalized[table].length;
}
assert.equal(normalized.stages[0].note,'личное 🌙');
assert.equal(normalized.stages[0].payload_json,'[1,2]');
assert.equal(normalized.safety[0].snapshot_json,'{ "exact": true }');
assert.equal(normalized.receipts[0].operation_id,'exact-uncertain-operation');
assert.deepEqual(normalized.legacyKey,{keyMode:'account',key:null});
assert.throws(()=>normalizeNativeArchiveRows(fixture.duplicate,fixture.context,()=>{}),/E2EE_ARCHIVE_TRANSPORT_INVALID/);
const leaked=structuredClone(fixture.transport);leaked.legacyKey.key=Buffer.alloc(32,7).toString('base64');
assert.throws(()=>normalizeNativeArchiveRows(leaked,fixture.context,()=>{}),/E2EE_KEY_BRIDGE_FORBIDDEN/);
const report={protocol:1,synthetic:true,status:'PASS',collector:'native/JCA',parser:'shared TypeScript strict duplicate-name parser',
 sourceSha256:createHash('sha256').update(bytes).digest('hex'),rows:total,oldKeyCrossed:false,
 checks:['exact rows and nested JSON','Unicode byte splits','uncertain operation retained','opaque key only','native duplicate names refused','raw key bridge refused']};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
