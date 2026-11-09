<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$fixture=sys_get_temp_dir().'/genesis-diary-test-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions','crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC'];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require dirname(__DIR__).'/src/bootstrap.php';require dirname(__DIR__).'/src/repository.php';require dirname(__DIR__).'/src/diary.php';
$db=genesisDb();$now=genesisNow();foreach(['a','b'] as $id)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now]);
$db->exec("UPDATE users SET subscription_plan='premium4life' WHERE id IN ('a','b')");
function diaryExpect(bool $yes,string $message):void{if(!$yes)throw new RuntimeException($message);}
$body=['schemaVersion'=>1,'expectedRevision'=>0,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(256))];
diaryExpect(genesisJsonBodyLimit('diary/note')===310_000,'Wrong route body limit.');
diaryExpect(genesisDiaryNotes('a')===[],'Fresh diary not empty.');
diaryExpect(genesisSaveDiaryNote('a','same-id',$body)['revision']===1,'First save failed.');
diaryExpect(genesisDiaryNotes('b')===[],'Owner isolation failed.');
diaryExpect(genesisSaveDiaryNote('b','same-id',$body)['revision']===1,'IDs must be owner-scoped.');
diaryExpect(genesisSaveDiaryNote('a','same-id',$body)['revision']===1,'Replay changed revision.');
try{genesisSaveDiaryNote('a','same-id',[...$body,'ciphertext'=>base64_encode(random_bytes(256))]);throw new RuntimeException('Stale write accepted.');}
catch(GenesisResourceLimitException $error){diaryExpect($error->getMessage()==='DIARY_REVISION_CONFLICT','Wrong conflict.');}
foreach([['expectedRevision'=>-1],['schemaVersion'=>2],['iv'=>'bad'],['ciphertext'=>'not base64!'],['ciphertext'=>str_repeat('A',300_001)],['body'=>'plaintext'],['title'=>'private title']] as $change){try{genesisSaveDiaryNote('a','note',[...$body,...$change]);throw new RuntimeException('Invalid input accepted.');}catch(InvalidArgumentException){}}
foreach(['../escape','x/y','',str_repeat('n',101)] as $id){try{genesisSaveDiaryNote('a',$id,$body);throw new RuntimeException('Invalid id accepted.');}catch(InvalidArgumentException){}}
$next=[...$body,'expectedRevision'=>1,'ciphertext'=>base64_encode(random_bytes(512))];genesisSaveDiaryNote('a','same-id',$next);
$fresh=new PDO('sqlite:'.$fixture.'/genesis.sqlite');diaryExpect($fresh->query("SELECT ciphertext FROM personal_diary_notes WHERE user_id='a'")->fetchColumn()===$next['ciphertext'],'Fresh connection lost note.');
$legacy=['ciphertext'=>base64_encode('opaque legacy workspace'),'iv'=>base64_encode(random_bytes(12)),'writerProtocol'=>7,'minimumWriterProtocol'=>1,'expectedVersion'=>0];genesisSaveWorkspaceEnvelope('a',$legacy);
diaryExpect(genesisDiaryNotes('a')[0]['ciphertext']===$next['ciphertext'],'Legacy writer changed diary.');
$db->exec('VACUUM INTO '.$db->quote($fixture.'/backup.sqlite'));$backup=new PDO('sqlite:'.$fixture.'/backup.sqlite');
diaryExpect($backup->query('SELECT COUNT(*) FROM personal_diary_notes')->fetchColumn()===2,'Runtime backup omitted notes.');
$columns=$db->query('PRAGMA table_info(personal_diary_notes)')->fetchAll(PDO::FETCH_COLUMN,1);
foreach(['title','body','advice_id','reaction','archived'] as $name)diaryExpect(!in_array($name,$columns,true),'Plaintext metadata column present.');
try{genesisDeleteDiaryNote('a','same-id',['expectedRevision'=>1]);throw new RuntimeException('Deleted a newer note.');}
catch(GenesisResourceLimitException $error){diaryExpect($error->getMessage()==='DIARY_REVISION_CONFLICT','Wrong delete conflict.');}
$deleted=genesisDeleteDiaryNote('a','same-id',['expectedRevision'=>2]);diaryExpect($deleted['deleted']&&$deleted['revision']===3,'Delete failed.');
diaryExpect(genesisDiaryNotes('a')===[]&&count(genesisDiaryNotes('b'))===1,'Deletion crossed owner boundary.');
diaryExpect(genesisDeleteDiaryNote('a','same-id',['expectedRevision'=>2])===$deleted,'Delete replay changed receipt.');
try{genesisSaveDiaryNote('a','same-id',$body);throw new RuntimeException('Resurrected a deleted note.');}
catch(GenesisResourceLimitException $error){diaryExpect($error->getMessage()==='DIARY_NOTE_DELETED','Wrong deleted error.');}
genesisSaveDiaryNote('a','local-copy',$body);
$snapshot=genesisDiarySnapshot('a');$mode=['syncEnabled'=>false,'expectedRevision'=>0,'expectedSnapshot'=>$snapshot];
$changed=[...$body,'expectedRevision'=>1,'ciphertext'=>base64_encode(random_bytes(88))];genesisSaveDiaryNote('a','local-copy',$changed);
try{genesisUpdateDiarySettings('a',$mode);throw new RuntimeException('Purged a newer snapshot.');}
catch(GenesisResourceLimitException $error){diaryExpect($error->getMessage()==='DIARY_SNAPSHOT_CHANGED','Wrong snapshot conflict.');}
diaryExpect(count(genesisDiaryNotes('a'))===1,'Failed privacy transition removed notes.');
$mode['expectedSnapshot']=genesisDiarySnapshot('a');$private=genesisUpdateDiarySettings('a',$mode);
diaryExpect(!$private['settings']['syncEnabled']&&$private['removed']===1&&genesisDiaryNotes('a')===[],'Local-only did not remove server copies.');
diaryExpect(genesisUpdateDiarySettings('a',$mode)===$private,'Privacy retry was not idempotent.');
try{genesisSaveDiaryNote('a','new-other-device',$body);throw new RuntimeException('Another device uploaded while disabled.');}
catch(GenesisResourceLimitException $error){diaryExpect($error->getMessage()==='DIARY_SYNC_DISABLED','Wrong disabled error.');}
try{$db->prepare('INSERT INTO personal_diary_notes VALUES(?,?,?,?,?,?,?,?)')->execute(['a','old-server',1,1,$body['iv'],$body['ciphertext'],'legacy',$now]);throw new RuntimeException('Legacy writer bypassed privacy.');}
catch(PDOException $error){diaryExpect(str_contains($error->getMessage(),'DIARY_SYNC_DISABLED'),'Wrong rollback guard.');}
diaryExpect(count(genesisDiaryNotes('b'))===1&&genesisDiarySettings('b')['syncEnabled'],'Privacy change crossed accounts.');
$public=genesisUpdateDiarySettings('a',['syncEnabled'=>true,'expectedRevision'=>1,'expectedSnapshot'=>genesisDiarySnapshot('a')]);
diaryExpect($public['settings']['syncEnabled'],'Could not enable synchronization.');genesisSaveDiaryNote('a','new-copy-id',$body);
try{genesisSaveDiaryNote('a','same-id',$body);throw new RuntimeException('Old note ID restored after enabling.');}
catch(GenesisResourceLimitException $error){diaryExpect($error->getMessage()==='DIARY_NOTE_DELETED','Wrong resurrection guard.');}
$db->exec("DELETE FROM users WHERE id='a'");diaryExpect(genesisDiaryNotes('a')===[]&&genesisDiaryDeletions('a')===[]&&count(genesisDiaryNotes('b'))===1,'Account cascade crossed owners.');
echo "Diary: opaque envelopes, owner isolation, CAS/replay, validation, legacy compatibility, backup and account cascade passed.\n";
