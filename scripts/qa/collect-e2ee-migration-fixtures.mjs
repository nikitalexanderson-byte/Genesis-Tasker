// Collect actual synthetic WebCrypto/JCA output. Never synthesize/re-sign a
// replacement packet when a platform emitter is missing or stale.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const actions={legacyRead:'legacy-workspace',auroraRead:'legacy-aurora',stoicheionRead:'legacy-stoicheion',adviceRead:'legacy-advice',tasksRead:'legacy-tasks',diaryRead:'legacy-diary',mindmapsRead:'legacy-mindmaps',mindmapsPageRead:'legacy-mindmaps',physisPageRead:'legacy-physis'};
const fixtures=['web','native'].map(platform=>{
 const value=JSON.parse(readFileSync(`output/release-3.3.6/runtime/${platform}-migration-transport.json`,'utf8'));
 if(value.protocol!==1||value.synthetic!==true||value.platform!==platform||value.bootstrap?.command?.action!=='bootstrap'||!Array.isArray(value.reads)||value.reads.length!==2)throw new Error('Incomplete synthetic platform output');
 const initial=value.bootstrap.command;
 if(initial.ownerId!=='owner'||initial.scopeId!=='personal:owner')throw new Error('Only the isolated synthetic fixture owner is permitted');
 const check=(packet,action)=>{
  const command=packet?.command;
  if(command?.action!==action||command.ownerId!==initial.ownerId||command.scopeId!==initial.scopeId||command.deviceId!==initial.deviceId||typeof packet.signature!=='string')throw new Error('Missing or misbound actual platform packet');
 };
 for(const packet of value.reads)check(packet,'read');
 for(const [name,action]of Object.entries(actions))check(value[name],action);
 for(const [name,table]of [['mindmapsPageRead','versions'],['physisPageRead','records']])if(value[name].command.payload.table!==table||value[name].command.payload.offset!==128)throw new Error('Missing actual signed page binding');
 return value;
});
const bytes=Buffer.from(JSON.stringify(fixtures,null,2)+'\n');
writeFileSync('tests/fixtures/e2ee/migration-transport-v1.json',bytes);
console.log(JSON.stringify({synthetic:true,platforms:fixtures.length,packets:(Object.keys(actions).length+2)*fixtures.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
