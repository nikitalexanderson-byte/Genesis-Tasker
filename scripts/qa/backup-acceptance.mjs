import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolveBackendPhp} from './backend-php.mjs';
const php=await resolveBackendPhp(),result=[];
mkdirSync('output/backup-qa',{recursive:true});
const openssl=path.join(path.dirname(php),'extras/ssl/openssl.cnf');if(existsSync(openssl))process.env.OPENSSL_CONF=openssl;
for(const name of ['backups','backup-concurrency','diary','native-auth','feature-access','subscription-trials','session-lifetime','mindmaps','mindmaps-migration','mindmaps-native-contract','mindmaps-google-contract','google-incremental','google-calendar-context','google-sync-cache','billing-deletion','account-layout-concurrency','modeling-service','modeling-price-migration','stoicheion-timeline','physis-security','account-notices','smoke','billing','billing-upgrades','subscription-profile']){
 const source=readFileSync(`server/tests/${name}.php`,'utf8');
 const mindmap=['mindmaps','mindmaps-native-contract'].includes(name);
 if(mindmap)mkdirSync('output/backup-qa/fixtures',{recursive:true});
 const dir=mindmap?mkdtempSync(path.resolve('output/backup-qa/fixtures/mindmaps-')):mkdtempSync(path.join(tmpdir(),'genesis-backup-regression-'));mkdirSync(path.join(dir,'sessions'));
 if(mindmap)writeFileSync(path.join(dir,'owner.json'),JSON.stringify({synthetic:true}));
 if(mindmap)writeFileSync(path.join(dir,'mindmaps-test.sqlite'),'');
 const config=path.join(dir,'config.php').replaceAll('\\','/');
 const setup=`$root=${JSON.stringify(dir.replaceAll('\\','/'))}; $config=['app_url'=>${JSON.stringify(name==='account-layout-concurrency'?'http://127.0.0.1:4338':'https://localhost.invalid')},'db_path'=>$root.'/${mindmap?'mindmaps-test.sqlite':name==='account-layout-concurrency'?'improvements-test.sqlite':'genesis.sqlite'}','session_path'=>$root.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'admin_email'=>'qa-admin@example.invalid','google_client_id'=>'','google_client_secret'=>'','cookie_secure'=>false,'timezone'=>'UTC'];file_put_contents(${JSON.stringify(config)},'<?php return '.var_export($config,true).';');`;
 const prepare=spawnSync(php,['-r',setup],{encoding:'utf8',windowsHide:true});if(prepare.status!==0)throw new Error('Fixture setup failed');
 const own=source.includes("define('GENESIS_LOCAL_TEST_CONFIG'")||source.includes('define("GENESIS_LOCAL_TEST_CONFIG"');
 const wrapper=`${own?'':`define('GENESIS_LOCAL_TEST_CONFIG',${JSON.stringify(config)});`} try {require $argv[1];} catch(Throwable $failure) {fwrite(STDERR,get_class($failure).': '.$failure->getMessage().' at '.$failure->getLine().PHP_EOL);exit(1);}`;
 mkdirSync(path.join(dir,'ini'));writeFileSync(path.join(dir,'prepend.php'),`<?php if(!defined('GENESIS_LOCAL_TEST_CONFIG'))define('GENESIS_LOCAL_TEST_CONFIG',${JSON.stringify(config)});`);writeFileSync(path.join(dir,'ini/backup-qa.ini'),`auto_prepend_file="${path.join(dir,'prepend.php').replaceAll('\\','/')}"\n`);
 // Leave the native scan directory unset for self-configuring suites. On Linux
 // an explicit empty value disables conf.d, including the PDO/SQLite modules.
 const run=spawnSync(php,['-d','disable_functions=curl_exec,mail','-r',wrapper,`server/tests/${name}.php`],{encoding:'utf8',windowsHide:true,env:{...process.env,...(!own?{PHP_INI_SCAN_DIR:(process.env.PHP_INI_SCAN_DIR??'')+path.delimiter+path.join(dir,'ini')}:{}),GENESIS_FULL_QA:'isolated',GENESIS_MINDMAPS_FIXTURE_ROOT:mindmap?dir.replaceAll('\\','/'):'',GENESIS_MINDMAPS_TEST:'isolated',GENESIS_IMPROVEMENTS_TEST:'isolated',GENESIS_SMOKE_ROOT:dir}});
 writeFileSync(`output/backup-qa/php-${name}.log`,run.stdout+'\n'+run.stderr);result.push({name,exitCode:run.status});console.log(name+': '+(run.status===0?'PASS':'FAIL '+run.stderr.slice(-500)));
}
writeFileSync('output/backup-qa/backend-results.json',JSON.stringify(result,null,2));process.exitCode=result.some(row=>row.exitCode!==0)?1:0;
