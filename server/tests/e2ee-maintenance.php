<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Isolated synthetic environment required.');
$fixture=sys_get_temp_dir().'/genesis-e2ee-maintenance-'.bin2hex(random_bytes(8));mkdir($fixture,0700);mkdir($fixture.'/sessions',0700);
$config=['app_url'=>'https://localhost.invalid','db_path'=>$fixture.'/db.sqlite','session_path'=>$fixture.'/sessions',
    'crypto_key'=>base64_encode(random_bytes(32)),'cookie_secure'=>false,'timezone'=>'UTC','backup_v1_enabled'=>true];
file_put_contents($fixture.'/config.php','<?php return '.var_export($config,true).';');define('GENESIS_LOCAL_TEST_CONFIG',$fixture.'/config.php');
require __DIR__.'/e2ee-private-copies.php';
require_once dirname(__DIR__).'/src/backups.php';
require_once dirname(__DIR__).'/src/diary.php';
require_once dirname(__DIR__).'/src/shared-google.php';
require_once dirname(__DIR__).'/src/shared-maintenance.php';

// Both scopes are currently legacy/preparing after the preceding cancellation.
// Prepare retained private copies and ordinary expired rows before taking leases.
foreach([$owner,$outsider] as $id) {
    $db->prepare("UPDATE users SET subscription_plan='premium4life',last_seen_at='2000-01-01T00:00:00Z' WHERE id=?")->execute([$id]);
    $db->prepare('INSERT INTO backup_stages VALUES(?,?,?,?,?,?,?,?)')->execute(['expired-stage-'.$id,$id,'hash',0,'revision',genesisEncrypt('[]'),$now,time()-1]);
    foreach(['2000-01-01T00:00:00Z','2001-01-01T00:00:00Z'] as $index=>$date)$db->prepare('INSERT INTO backup_safety_snapshots VALUES(?,?,?,?,?)')
        ->execute(['expired-safety-'.$index.'-'.$id,$id,genesisEncrypt('historical copy'),$date,time()-1]);
    $db->prepare('INSERT INTO user_metrics(user_id,project_count,task_count,open_task_count,completed_task_count,google_synced_count,updated_at) VALUES(?,0,0,0,0,0,?)')->execute([$id,$now]);
}
$db->exec("UPDATE shared_mutation_receipts SET created_at='2000-01-01T00:00:00Z' WHERE request_id IN ('former-view','copy-mutation')");
$db->prepare('INSERT INTO shared_mutation_receipts(user_id,request_id,action,resource_id,response_json,created_at,payload_hash) VALUES(?,?,?,?,?,?,?)')
    ->execute([$outsider,'expired-legacy-view','view.delete','legacy-view','{"ok":true}','2000-01-01T00:00:00Z',hash('sha256','legacy')]);
foreach(['copy-source'=>'copy-space-a','copy-target'=>'copy-space-b'] as $id=>$parent) {
    $db->prepare("UPDATE shared_projects SET archived_at='2000-01-01T00:00:00Z' WHERE id=?")->execute([$id]);
    $db->prepare("INSERT INTO shared_trash VALUES('project',?,?,?,?,?,?,1,NULL)")->execute([$id,$parent,$id,$id,'2000-01-01T00:00:00Z','2000-01-02T00:00:00Z']);
}
// A historical view is protected by explicit spaceId even for a former member.
$scopeId='space:copy-space-b';$scope=genesisE2eeScope($owner,$scopeId);
genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'maintenance-space','sourceHash'=>genesisE2eeSourceHash($db,$scope)]),$session);
$scopeId='personal:'.$owner;$command['scopeId']=$scopeId;$command['operationId']='maintenance-personal-bootstrap';
$command['payload']['kind']='personal';$command['payload']['resourceId']=$owner;unset($command['payload']['selfProof']);
$command['payload']['selfProof']=storeSign(genesisE2eeCommandBytes($command),$device['private']);
genesisE2eeBootstrap($owner,['command'=>$command,'signature'=>storeSign(genesisE2eeCommandBytes($command),$authority['private'])]);
$scope=genesisE2eeScope($owner,$scopeId);
genesisE2eeExecute($owner,storeCommand('migration-start',['migrationId'=>'maintenance-personal','sourceHash'=>genesisE2eeSourceHash($db,$scope)]),$session);
$protected=genesisE2eeSourceHash($db,$scope);

// This is the actual paid preview entrypoint, whose former global cleanup failed
// on another owner's protected staging row. The dry run must remain reversible.
$preview=genesisBackupPreview($outsider,['noticeVersion'=>GENESIS_BACKUP_NOTICE,'operations'=>[
    ['section'=>'diary','id'=>'maintenance-note','input'=>['expectedRevision'=>0,'schemaVersion'=>1,'iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(128))]],
]]);
storeCheck(is_string($preview['stageId'])&&genesisDiaryNotes($outsider)===[]);
genesisBackupMaintenance();
$count=static function(string $table,string $id)use($db):int{$q=$db->prepare('SELECT COUNT(*) FROM '.$table.' WHERE user_id=?');$q->execute([$id]);$n=(int)$q->fetchColumn();$q->closeCursor();return $n;};
storeCheck($count('backup_stages',$owner)===1&&$count('backup_stages',$outsider)===1);
storeCheck($count('backup_safety_snapshots',$owner)===2&&$count('backup_safety_snapshots',$outsider)===1);
storeCheck(genesisSharedPruneInactiveMetrics('2002-01-01T00:00:00Z')===1);
storeCheck($count('user_metrics',$owner)===1&&$count('user_metrics',$outsider)===0);
$counts=genesisSharedMaintenance($now);
storeCheck($counts['expiredProjects']===1);
storeCheck(genesisE2eeRow($db,'SELECT id FROM shared_projects WHERE id=?',['copy-source'])===false);
storeCheck(genesisE2eeRow($db,'SELECT id FROM shared_projects WHERE id=?',['copy-target'])!==false);
storeCheck(genesisE2eeSourceHash($db,$scope)===$protected);

// Simulate a corrupt receipt that predates the new fences. The global sweep
// retains it without losing valid legacy cleanup or protected historical rows.
$db->exec('DROP TRIGGER e2ee_fence_shared_mutation_receipts_insert');
$db->prepare('INSERT INTO shared_mutation_receipts(user_id,request_id,action,resource_id,response_json,created_at,payload_hash) VALUES(?,?,?,?,?,?,?)')
    ->execute([$outsider,'corrupt-historical-view','view.update','legacy-view','{broken','2000-01-01T00:00:00Z',hash('sha256','corrupt')]);
$db->exec("DELETE FROM schema_migrations WHERE name='e2ee-fence-v3'");genesisE2eeInitializeGuards($db);
$result=genesisSharedSyncGoogleCron();
storeCheck($result['projectsChecked']===0);
foreach(['former-view','copy-mutation','corrupt-historical-view'] as $id)storeCheck(genesisE2eeRow($db,'SELECT request_id FROM shared_mutation_receipts WHERE request_id=?',[$id])!==false);
storeCheck(genesisE2eeRow($db,'SELECT request_id FROM shared_mutation_receipts WHERE request_id=?',['expired-legacy-view'])===false);
echo 'PASS e2ee-maintenance '.$checks.' cumulative assertions; mixed-scope backup preview, stage/safety/receipt cleanup, metrics and project retention; corrupt historical receipt preserved. No external messages sent.'.PHP_EOL;
