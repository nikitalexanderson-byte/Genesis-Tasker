<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-backup-322-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$pair=sodium_crypto_sign_keypair();
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/db.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC',
 'backup_v1_enabled'=>true,'google_identity_management_enabled'=>true,'account_recovery_enabled'=>true,'account_recovery_reviewers'=>['admin'],'google_client_id'=>'synthetic.apps.googleusercontent.com',
 'backup_signing_active_kid'=>'test','backup_signing_secret_keys'=>['test'=>base64_encode(sodium_crypto_sign_secretkey($pair))],
 'backup_signing_public_keys'=>['test'=>base64_encode(sodium_crypto_sign_publickey($pair))]];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/mindmaps.php';require dirname(__DIR__).'/src/diary.php';require dirname(__DIR__).'/src/stoicheion-workspace.php';require dirname(__DIR__).'/src/aurora-workspace.php';require dirname(__DIR__).'/src/backups.php';require dirname(__DIR__).'/src/google.php';require dirname(__DIR__).'/src/native-auth.php';
$db=genesisDb();$now=genesisNow();
foreach(['a','b','free','admin']as$id)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at,subscription_plan) VALUES(?,?,?,?,?,?,?)')->execute([$id,'sub-'.$id,$id==='admin'?GENESIS_ADMIN_EMAIL:$id.'@example.invalid','Synthetic',$now,$now,$id==='free'?'free':'premium4life']);
function backupExpect(bool $yes,string $message):void{if(!$yes)throw new RuntimeException($message);}
function backupReject(callable $run,string $label):void{try{$run();}catch(GenesisResourceLimitException|DomainException|InvalidArgumentException|PDOException){echo "PASS $label\n";return;}throw new RuntimeException('Unexpected acceptance: '.$label);}
function backupProof(string $owner,string $sub):void{$_SESSION['google_step_up']=['owner'=>$owner,'sub'=>$sub,'epoch'=>(int)genesisFindUser($owner)['security_epoch'],'expiresAt'=>time()+300];}
function backupEnvelope(int $revision=0):array{return ['expectedRevision'=>$revision,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(128))];}
$notice=['noticeVersion'=>GENESIS_BACKUP_NOTICE];
backupReject(fn()=>genesisBackupAuthorize('free',$notice),'Free direct API denied');
$operation=['section'=>'diary','id'=>'note-1','input'=>[...backupEnvelope(),'schemaVersion'=>1]];
$preview=genesisBackupPreview('a',[...$notice,'operations'=>[$operation]]);
backupExpect(genesisDiaryNotes('a')===[],'Dry run must roll back ordinary CRUD');
$request=[...$notice,'stageId'=>$preview['stageId'],'digest'=>$preview['digest'],'operationId'=>genesisUuid(),'confirmed'=>true];
backupReject(fn()=>genesisBackupCommit('b',$request),'Cross-owner staging denied');
$receipt=genesisBackupCommit('a',$request);backupExpect($receipt['generation']===1&&count(genesisDiaryNotes('a'))===1,'Atomic commit');
backupExpect(genesisBackupCommit('a',$request)['duplicate']===true&&count(genesisDiaryNotes('a'))===1,'Lost acknowledgement replay must not duplicate');
backupExpect(genesisFindUser('a')['subscription_plan']==='premium4life','Import changed plan');
backupReject(fn()=>genesisBackupRequireGeneration('a',null),'Legacy writer fenced after restore');
backupReject(fn()=>genesisBackupRequireGeneration('a','0'),'Stale generation fenced');genesisBackupRequireGeneration('a','1');
$next=['section'=>'diary','id'=>'note-2','input'=>[...backupEnvelope(),'schemaVersion'=>1]];
backupReject(fn()=>genesisBackupPreview('a',[...$notice,'operations'=>[$next,[...$operation,'input'=>[...backupEnvelope(),'schemaVersion'=>1]]]]),'Failure in later operation rolls back earlier operation');
backupExpect(count(genesisDiaryNotes('a'))===1,'Partial dry run escaped transaction');
$preview=genesisBackupPreview('a',[...$notice,'operations'=>[$next]]);
genesisSaveDiaryNote('a','concurrent',[...backupEnvelope(),'schemaVersion'=>1]);
backupReject(fn()=>genesisBackupCommit('a',[...$request,'stageId'=>$preview['stageId'],'digest'=>$preview['digest'],'operationId'=>genesisUuid()]),'Concurrent change invalidates preview');
$evidence=genesisBackupServerSnapshot('a',$notice);genesisBackupVerifyServerSnapshot('a',$evidence);
backupReject(fn()=>genesisBackupVerifyServerSnapshot('b',$evidence),'Trusted signature is bound to source owner');
backupReject(fn()=>genesisBackupVerifyServerSnapshot('a',[...$evidence,'kid'=>'untrusted']),'File cannot nominate verification key');
backupReject(fn()=>genesisBackupVerifyServerSnapshot('a',[...$evidence,'payload'=>str_replace('server_snapshot','device_snapshot',$evidence['payload'])]),'Manifest tampering denied');
$preview=genesisBackupPreview('b',[...$notice,'operations'=>[$next]]);$db->exec("UPDATE users SET subscription_plan='free' WHERE id='b'");
backupReject(fn()=>genesisBackupCommit('b',[...$request,'stageId'=>$preview['stageId'],'digest'=>$preview['digest'],'operationId'=>genesisUuid()]),'Downgrade checked again at commit');backupExpect(genesisDiaryNotes('b')===[],'Downgrade destroyed data');
$db->exec("UPDATE users SET subscription_plan='premium4life' WHERE id='b'");
backupProof('b','sub-b');$link=genesisLinkGoogleAccount('b',['sub'=>'linked-b','email'=>'linked-b@example.invalid','email_verified'=>true],[]);
backupExpect(count(genesisGoogleLoginIdentities('b'))===2,'Existing link model not reused');
$db->exec("UPDATE users SET subscription_plan='free' WHERE id='b'");
backupExpect(genesisUpsertGoogleUser(['sub'=>'linked-b','email'=>'linked-b@example.invalid','email_verified'=>true],[],false)['id']==='b','Downgraded linked login lost owner');
backupProof('b','linked-b');genesisGoogleSetPrimary('b',$link['id']);
backupExpect(genesisFindUser('b')['google_sub']==='sub-b','Primary selection migrated integration credentials');
backupProof('b','linked-b');genesisGoogleDisableLogin('b','b',$link['id']);
backupReject(fn()=>genesisUpsertGoogleUser(['sub'=>'sub-b','email'=>'b@example.invalid','email_verified'=>true],[],false),'Revoked original Google cannot create fresh profile');
backupProof('b','linked-b');backupReject(fn()=>genesisGoogleDisableLogin('b',$link['id'],$link['id']),'Last accessible login cannot be removed');
backupReject(fn()=>genesisLinkGoogleAccount('b',['sub'=>'third','email'=>'third@example.invalid','email_verified'=>true],[]),'Free cannot link even with a fresh identity proof');
backupProof('a','sub-a');$recoveryCode=genesisGoogleCreateRecoveryCode('a');$candidate=['sub'=>'replacement-a','email'=>'replacement@example.invalid','email_verified'=>true];
backupReject(fn()=>genesisGoogleCreateRecoveryRequest('a',$candidate,'stolen-file-is-not-proof'),'Archive is not ownership proof');
$recovery=genesisGoogleCreateRecoveryRequest('a',$candidate,$recoveryCode);backupProof('admin','sub-admin');
genesisGoogleReviewRecovery('admin',$recovery['requestId'],true,'Synthetic independent ownership review');
backupExpect(genesisGoogleCompleteRecovery($recovery['requestId'],$candidate)['id']==='a','Recovery changed permanent user ID');
backupExpect(count(genesisDiaryNotes('a'))===2&&genesisFindUser('a')['subscription_plan']==='premium4life','Access recovery imported/deleted data or changed billing');
backupReject(fn()=>genesisGoogleCompleteRecovery($recovery['requestId'],$candidate),'Recovery approval is single-use');
backupExpect(genesisUpsertGoogleUser($candidate,[],false)['id']==='a','Replacement login lost original account');
echo "PASS snapshots, CRUD dry run, atomicity, ownership, replay, downgrade, generation, Google primary/unlink, admin recovery\n";
// Fresh database connection confirms durable state without trusting the in-process cache.
$fresh=new PDO('sqlite:'.$fixture.'/db.sqlite');backupExpect((int)$fresh->query("SELECT COUNT(*) FROM personal_diary_notes WHERE user_id='a'")->fetchColumn()===2,'Durable recovery mismatch');
