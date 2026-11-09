import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const outIndex=process.argv.indexOf('--out'),out=resolve(outIndex>=0?process.argv[outIndex+1]:join(root,'android/app/build/generated/auroraAssets'));
const expected=resolve(root,'android/app/build/generated');
if(!out.startsWith(expected+'\\')&&!out.startsWith(expected+'/'))throw new Error('Aurora output must stay under the Android generated build directory.');
await build({configFile:false,root,base:'./',publicDir:false,plugins:[react()],logLevel:'warn',
 define:{'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('')},
 build:{outDir:join(out,'aurora'),emptyOutDir:true,sourcemap:false,rolldownOptions:{input:[join(root,'app/aurora/native-shell.html'),join(root,'app/backup-native.html')]}}});
// Keep the generated HTML at a stable native entry, all chunks remain hashed.
const html=readFileSync(join(out,'aurora/app/aurora/native-shell.html'),'utf8').replaceAll('../../assets/','./assets/');
writeFileSync(join(out,'aurora/index.html'),html);
writeFileSync(join(out,'aurora/backup.html'),readFileSync(join(out,'aurora/app/backup-native.html'),'utf8').replaceAll('../assets/','./assets/'));
const files=readdirSync(join(out,'aurora/assets')).sort();
const hash=createHash('sha256');for(const file of files)hash.update(file).update(readFileSync(join(out,'aurora/assets',file)));
writeFileSync(join(out,'aurora/build-manifest.json'),JSON.stringify({engine:'aurora-two-circles-v2',content:'aurora-content-v1',sha256:hash.digest('hex'),files},null,2));
console.log(`Aurora Android assets: ${files.length} files, deterministic shared engine/catalog, no remote page.`);
