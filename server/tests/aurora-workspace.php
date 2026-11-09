<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-aurora-test-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC'];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/aurora-workspace.php';require dirname(__DIR__).'/src/modeling-service.php';
function auroraExpect(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}
$db=genesisDb();$now=genesisNow();foreach(['a','b']as$id)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at,subscription_plan) VALUES(?,?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now,'premium4life']);
$body=['expectedRevision'=>0,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(128))];
auroraExpect(genesisJsonBodyLimit('aurora-workspace')===4_010_000,'Encrypted document body limit mismatch.');
auroraExpect(genesisAuroraWorkspace('a')===null,'New Aurora document must be empty.');
auroraExpect(genesisSaveAuroraWorkspace('a',$body)['revision']===1,'Initial save failed.');
auroraExpect(genesisSaveAuroraWorkspace('a',$body)['revision']===1,'Retry created a duplicate revision.');
auroraExpect(genesisAuroraWorkspace('b')===null,'Other account accessed the document.');
try{genesisSaveAuroraWorkspace('a',[...$body,'ciphertext'=>base64_encode(random_bytes(128))]);throw new RuntimeException('Stale write accepted.');}catch(GenesisResourceLimitException $e){auroraExpect($e->status===409,'Wrong stale status.');}
foreach([['iv'=>'invalid'],['expectedRevision'=>-1],['ciphertext'=>'invalid!'],['plaintext'=>'private'],['ciphertext'=>str_repeat('A',4_000_001)]]as$change){try{genesisSaveAuroraWorkspace('a',[...$body,...$change]);throw new RuntimeException('Invalid envelope accepted.');}catch(InvalidArgumentException){}}
$manifest=['id'=>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','methodVersion'=>'aurora-two-circles-v2','forecastHashes'=>[str_repeat('a',64)],'contextHash'=>str_repeat('b',64),'iv'=>$body['iv'],'ciphertext'=>$body['ciphertext']];
auroraExpect(genesisAuroraPrepareResult('a',$manifest)['ready']===true,'Encrypted completed result not bound.');
genesisAuroraPrepareResult('a',$manifest);
try{genesisAuroraPrepareResult('a',[...$manifest,'amountMinor'=>1]);throw new RuntimeException('Client price accepted.');}catch(InvalidArgumentException){}
try{genesisAuroraPrepareResult('a',[...$manifest,'ciphertext'=>base64_encode(random_bytes(128))]);throw new RuntimeException('Immutable result overwritten.');}catch(GenesisResourceLimitException $e){auroraExpect($e->status===409,'Wrong immutable status.');}
try{genesisModelingResult('a',$manifest['id']);throw new RuntimeException('Unpaid result opened.');}catch(GenesisResourceLimitException $e){auroraExpect($e->status===402,'Wrong payment status.');}
try{genesisModelingResult('b',$manifest['id']);throw new RuntimeException('Other owner result opened.');}catch(GenesisResourceLimitException $e){auroraExpect($e->status===404,'Wrong owner status.');}
$db->exec("UPDATE users SET forecast_elite_plus=1 WHERE id='a'");$opened=genesisModelingResult('a',$manifest['id']);auroraExpect($opened['solution']['kind']==='aurora-encrypted-solution-v1','Elite+ result mismatch.');
$source=new PDO('sqlite:'.$fixture.'/genesis.sqlite');$backup=$fixture.'/backup.sqlite';$source->exec('VACUUM INTO '.$source->quote($backup));$copy=new PDO('sqlite:'.$backup);
auroraExpect($copy->query("SELECT ciphertext FROM aurora_workspaces WHERE user_id='a'")->fetchColumn()===$body['ciphertext'],'Runtime backup omitted Aurora.');
auroraExpect(isset(genesisAccountDataCounts('a')['aurora_workspaces']),'Account data audit omitted Aurora.');
$db->exec("DELETE FROM users WHERE id='a'");auroraExpect(genesisAuroraWorkspace('a')===null,'Account deletion left Aurora data.');
echo "Aurora: strict E2EE envelopes, owner CAS/retry, immutable result, paid/Elite+ gating, additive migration, backup and deletion passed.\n";
