<?php
declare(strict_types=1);
// Self-contained SQLite fixture. Production config and data are never read.
if (PHP_SAPI !== 'cli') exit(1);
$fixture=sys_get_temp_dir().'/genesis-stoicheion-test-'.bin2hex(random_bytes(8)); mkdir($fixture,0700); mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/genesis.sqlite','session_path'=>$fixture.'/sessions',
    'crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC'];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');
define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require dirname(__DIR__).'/src/bootstrap.php'; require dirname(__DIR__).'/src/repository.php'; require dirname(__DIR__).'/src/stoicheion-workspace.php';
$db=genesisDb();$now=genesisNow();
foreach(['a','b'] as $id)$db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',$now,$now]);
function restorationExpect(bool $condition,string $message):void { if(!$condition)throw new RuntimeException($message); }
$body=['expectedRevision'=>0,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(128))];
restorationExpect(genesisJsonBodyLimit('stoicheion-workspace')===4_010_000,'Route body limit does not fit the encrypted archive.');
restorationExpect(genesisStoicheionWorkspace('a')===null,'New document was not empty.');
$saved=genesisSaveStoicheionWorkspace('a',$body);restorationExpect($saved['revision']===1,'First revision failed.');
restorationExpect(genesisStoicheionWorkspace('b')===null,'Another owner read private data.');
restorationExpect(genesisSaveStoicheionWorkspace('a',$body)['revision']===1,'Lost-reply replay created another write.');
try { genesisSaveStoicheionWorkspace('a',[...$body,'ciphertext'=>base64_encode(random_bytes(128))]);throw new RuntimeException('Stale write accepted.'); }
catch(GenesisResourceLimitException $error){restorationExpect($error->getMessage()==='RESTORATION_REVISION_CONFLICT','Wrong conflict error.');}
foreach([['expectedRevision'=>-1],['iv'=>'invalid'],['ciphertext'=>'not base64!'],['ciphertext'=>str_repeat('A',4_000_001)],['plaintext'=>'must not be accepted']] as $change){
    try { genesisSaveStoicheionWorkspace('a',[...$body,...$change]);throw new RuntimeException('Invalid envelope accepted.'); } catch(InvalidArgumentException){}
}
$archive=[...$body,'expectedRevision'=>1,'ciphertext'=>base64_encode(random_bytes(256))];
restorationExpect(genesisSaveStoicheionWorkspace('a',$archive)['revision']===2,'Archive save failed.');
$fresh=new PDO('sqlite:'.$fixture.'/genesis.sqlite');
restorationExpect($fresh->query("SELECT ciphertext FROM stoicheion_workspaces WHERE user_id='a'")->fetchColumn()===$archive['ciphertext'],'Fresh DB connection lost archive.');
// Older clients still write the existing workspace; the new document is a separate namespace.
// Legacy writers in this compatibility scenario belong to existing lifetime members.
$db->exec("UPDATE users SET subscription_plan='premium4life' WHERE id IN ('a','b')");
$legacy=['ciphertext'=>base64_encode('legacy opaque workspace'),'iv'=>base64_encode(random_bytes(12)),'writerProtocol'=>7,'minimumWriterProtocol'=>1,'expectedVersion'=>0];
genesisSaveWorkspaceEnvelope('a',$legacy);
genesisSaveWorkspaceEnvelope('a',[...$legacy,'expectedVersion'=>1]);
restorationExpect(genesisStoicheionWorkspace('a')['ciphertext']===$archive['ciphertext'],'Legacy workspace writer erased archive.');
restorationExpect((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='a'")->fetchColumn()===1,'Archive forced an upgraded legacy writer.');
// Existing server-only SQLite backup/restore includes this additive table unchanged.
// The runtime helper opens its own connection; application cursors must not be reused for VACUUM.
$backupSource=new PDO('sqlite:'.$fixture.'/genesis.sqlite');
$backup=$fixture.'/backup.sqlite';$backupSource->exec('VACUUM INTO '.$backupSource->quote($backup));$backupDb=new PDO('sqlite:'.$backup);
restorationExpect($backupDb->query("SELECT ciphertext FROM stoicheion_workspaces WHERE user_id='a'")->fetchColumn()===$archive['ciphertext'],'SQLite backup omitted archive.');
echo "Stoicheion archive: owner isolation, strict envelopes/limits, CAS, idempotent retry, fresh connection, legacy writer compatibility and SQLite backup passed.\n";
