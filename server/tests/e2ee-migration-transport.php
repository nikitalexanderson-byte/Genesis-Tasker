<?php
declare(strict_types=1);
if(getenv('GENESIS_IMPROVEMENTS_TEST')!=='isolated')throw new RuntimeException('Isolated synthetic environment required.');
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
require dirname(__DIR__).'/src/e2ee-store.php';
$db=genesisDb();$fixtures=json_decode((string)file_get_contents(dirname(__DIR__,2).'/tests/fixtures/e2ee/migration-transport-v1.json'),true,64,JSON_THROW_ON_ERROR);$checks=0;
foreach($fixtures as $fixture) {
    if($fixture['protocol']!==1||$fixture['synthetic']!==true||!in_array($fixture['platform'],['web','native'],true))throw new RuntimeException('Invalid synthetic transport fixture');
    $command=$fixture['bootstrap']['command'];$owner=$command['ownerId'];$scope=$command['scopeId'];$now=genesisNow();
    $db->prepare('INSERT OR IGNORE INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$owner,$owner,'transport@example.invalid','Synthetic',$now,$now]);
    genesisE2eeBootstrap($owner,$fixture['bootstrap']);
    foreach($fixture['reads'] as $packet) {
        if($packet['command']['action']!=='read')throw new RuntimeException('E2EE transport used a non-server pagination action');
        $response=genesisE2eeRead($owner,$packet,str_repeat('s',32));
        if($response['envelopes']!==[]||$response['checkpointHash']!==$packet['command']['checkpointHash']||$response['directoryRevision']!==$packet['command']['expectedRevision'])throw new RuntimeException('E2EE real transport response mismatch');
        $checks++;
    }
    // These static cross-platform signatures intentionally carry an old source
    // token, independent of this fresh database's HMAC key. They must reach the
    // lease/source checks, never succeed with that stale source or use a typoed action.
    $packet=$fixture['legacyRead'];$command=$packet['command'];$p=$command['payload'];
    if($command['action']!=='legacy-workspace')throw new RuntimeException('Invalid legacy workspace transport action');
    $db->prepare('INSERT INTO e2ee_migrations(scope_id,migration_id,device_id,source_hash,target_generation,fence,lease_until) VALUES(?,?,?,?,?,?,?)')
        ->execute([$scope,$p['migrationId'],$command['deviceId'],$p['sourceHash'],1,$p['fence'],time()+900]);
    $db->prepare("UPDATE e2ee_scopes SET state='uploading' WHERE scope_id=?")->execute([$scope]);
    try{genesisE2eeRead($owner,$packet,str_repeat('s',32));throw new RuntimeException('Stale cross-platform source accepted');}
    catch(DomainException $error){if($error->getMessage()!=='E2EE_SOURCE_CHANGED')throw$error;$checks++;}
    $packet=$fixture['auroraRead'];$command=$packet['command'];
    if($command['action']!=='legacy-aurora')throw new RuntimeException('Invalid legacy Aurora transport action');
    try{genesisE2eeRead($owner,$packet,str_repeat('s',32));throw new RuntimeException('Stale cross-platform Aurora source accepted');}
    catch(DomainException $error){if($error->getMessage()!=='E2EE_SOURCE_CHANGED')throw$error;$checks++;}
    $packet=$fixture['stoicheionRead'];$command=$packet['command'];
    if($command['action']!=='legacy-stoicheion')throw new RuntimeException('Invalid legacy Stoicheion transport action');
    try{genesisE2eeRead($owner,$packet,str_repeat('s',32));throw new RuntimeException('Stale cross-platform Stoicheion source accepted');}
    catch(DomainException $error){if($error->getMessage()!=='E2EE_SOURCE_CHANGED')throw$error;$checks++;}
    // Both independent platform fixtures use a fresh personal test identity.
    $packet=$fixture['adviceRead'];$command=$packet['command'];
    if($command['action']!=='legacy-advice')throw new RuntimeException('Invalid legacy Advice transport action');
    try{genesisE2eeRead($owner,$packet,str_repeat('s',32));throw new RuntimeException('Stale cross-platform Advice source accepted');}
    catch(DomainException $error){if($error->getMessage()!=='E2EE_SOURCE_CHANGED')throw$error;$checks++;}
    $packet=$fixture['tasksRead'];$command=$packet['command'];
    if($command['action']!=='legacy-tasks')throw new RuntimeException('Invalid legacy task transport action');
    try{genesisE2eeRead($owner,$packet,str_repeat('s',32));throw new RuntimeException('Stale cross-platform task source accepted');}
    catch(DomainException $error){if($error->getMessage()!=='E2EE_SOURCE_CHANGED')throw$error;$checks++;}
    $db->prepare("DELETE FROM e2ee_scopes WHERE scope_id=? AND state='uploading'")->execute([$scope]);
}
if($checks!==14)throw new RuntimeException('Missing web/native transport vectors');
echo 'PASS e2ee-migration-transport '.$checks.' real signed web/native packets; pagination accepted, stale legacy-source tokens rejected'.PHP_EOL;
