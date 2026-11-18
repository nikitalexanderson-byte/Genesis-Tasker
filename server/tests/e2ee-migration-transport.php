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
    // Both independent platform fixtures use a fresh personal test identity.
    $db->prepare("DELETE FROM e2ee_scopes WHERE scope_id=? AND state='preparing'")->execute([$scope]);
}
if($checks!==4)throw new RuntimeException('Missing web/native transport vectors');
echo 'PASS e2ee-migration-transport '.$checks.' real signed web/native pagination packets accepted by PHP SQLite'.PHP_EOL;
