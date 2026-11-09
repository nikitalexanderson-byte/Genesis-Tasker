<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('GENESIS_MINDMAPS_TEST') !== 'isolated') exit(1);
require __DIR__ . '/../src/bootstrap.php';
$fixtureRoot = getenv('GENESIS_FULL_QA') === 'isolated' ? str_replace('\\', '/', (string)getenv('GENESIS_MINDMAPS_FIXTURE_ROOT')) : '';
$outputRoot = str_replace('\\', '/', dirname(__DIR__, 2) . '/output/');
if ($fixtureRoot !== '' && (!str_starts_with($fixtureRoot, $outputRoot) || !is_file($fixtureRoot . '/owner.json'))) throw new RuntimeException('Unowned fixture directory rejected.');
$fixtureDatabase = ($fixtureRoot !== '' ? $fixtureRoot : rtrim($outputRoot, '/')) . '/mindmaps-test.sqlite';
if (str_replace('\\','/', (string)genesisConfig()['db_path']) !== $fixtureDatabase) throw new RuntimeException('Non-fixture database rejected.');
require __DIR__ . '/../src/repository.php';
require __DIR__ . '/../src/google.php';
require __DIR__ . '/../src/mindmaps.php';
function nativeExpect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$db = genesisDb(); $owner = 'mindmaps-native-contract';
$db->prepare('INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES(?,?,?,?,?)')->execute([$owner,$owner,$owner.'@example.invalid',genesisNow(),genesisNow()]);
$account = ['id'=>$owner,'granted_scopes'=>GENESIS_GOOGLE_TASKS_SCOPE];
$task = ['title'=>'Без даты','description'=>'Личная заметка','dueDate'=>'','endDate'=>'','done'=>false,
    'googleTaskListId'=>'fixture-list','googleTaskListTitle'=>'Fixture','projectId'=>'fixture-project'];
$rows = []; $posts = 0; $lose = true; $reject = false;
$fetch = function(string $method, string $path, array $account, ?array $payload = null) use (&$rows,&$posts,&$lose,&$reject): array {
    if ($method === 'POST') {
        $posts++;
        if ($reject) throw new RuntimeException('network-before-commit');
        $id = 'native-'.$posts; $rows[$id] = [...$payload,'id'=>$id,'updated'=>'2026-10-12T00:00:00Z'];
        if ($lose) { $lose = false; throw new RuntimeException('network-after-commit'); }
        return $rows[$id];
    }
    nativeExpect($method === 'GET', 'Creation retry modified an existing task');
    if (str_contains($path,'?')) return ['items'=>array_values($rows)];
    return $rows[basename($path)] ?? ['id'=>basename($path),'deleted'=>true];
};
$seed = function(string $id) use ($db,$owner): void { $db->prepare('INSERT INTO personal_task_creations VALUES(?,?,?)')->execute([$owner,$id,'fixture-fingerprint']); };
try {
    genesisGoogleForgetSnapshot($account);
    $seed('native-once');
    try { genesisCreatePersonalNativeTaskOnce($account,$owner,'native-once',$task,$fetch); throw new LogicException('Missing fault injection'); }
    catch (RuntimeException $e) { nativeExpect($e->getMessage()==='network-after-commit','Unexpected transport error'); }
    $saved = genesisCreatePersonalNativeTaskOnce($account,$owner,'native-once',$task,$fetch);
    nativeExpect($posts===1 && $saved['id']==='native-once' && $saved['dueDate']==='' && $saved['endDate']==='', 'Recovery duplicated or dated the task');
    nativeExpect($saved['description']==='Личная заметка' && $saved['projectId']==='fixture-project','Visible marker or lost source metadata');
    nativeExpect(genesisPersonalNativeIdentity(['id'=>'other-account'],'fixture-list',$rows['native-1'])===null,'Recovery marker crossed accounts');
    nativeExpect(genesisPersonalNativeIdentity($account,'fixture-list',[...$rows['native-1'],'id'=>'copied-marker'])===null,'Copied marker became a second task alias');
    genesisGoogleSnapshotTaskSaved($account,[...$saved,'projectId'=>'edited-project','priority'=>2,'tags'=>['edited']]);
    $rows['native-1']['notes']='Edited by user'; $rows['native-1']['title']='Actual new title'; $rows['native-1']['status']='completed';
    $retried = genesisCreatePersonalNativeTaskOnce($account,$owner,'native-once',$task,$fetch);
    nativeExpect($posts===1 && $retried['title']==='Actual new title' && $retried['done'] && $retried['description']==='Edited by user','Retry overwrote an ordinary edit');
    nativeExpect($retried['projectId']==='edited-project' && $retried['priority']===2 && $retried['tags']===['edited'],'Retry restored stale GENESIS metadata');
    $listed = genesisListGoogleNativeTasks($account,[['id'=>'fixture-list','title'=>'Fixture']],[$retried],null,[],$fetch);
    nativeExpect(count($listed)===1 && $listed[0]['id']==='native-once' && $listed[0]['projectId']==='edited-project','Stable identity/metadata lost after marker removal');
    $dated=[...$listed[0],'dueDate'=>'2026-10-12','endDate'=>'2026-10-12','time'=>'14:00'];
    $rows['native-1']['due']='2026-10-20T00:00:00Z';
    $moved=genesisListGoogleNativeTasks($account,[['id'=>'fixture-list','title'=>'Fixture']],[$dated],null,[],$fetch)[0];
    nativeExpect($moved['dueDate']==='2026-10-20' && $moved['endDate']==='2026-10-20' && $moved['time']==='14:00','Native move left a stale single-day start');
    $range=genesisPersonalNativeMetadata($moved,[...$dated,'endDate'=>'2026-10-18']);
    nativeExpect($range['dueDate']==='2026-10-12' && $range['endDate']==='2026-10-20','GENESIS range start was lost');
    unset($rows['native-1']['due']);
    $undated=genesisListGoogleNativeTasks($account,[['id'=>'fixture-list','title'=>'Fixture']],[$moved],null,[],$fetch)[0];
    nativeExpect($undated['dueDate']==='' && $undated['endDate']==='' && $undated['time']==='','Removed date retained a range or time');
    $seed('native-uncertain'); $reject=true;
    try { genesisCreatePersonalNativeTaskOnce($account,$owner,'native-uncertain',$task,$fetch); throw new LogicException('Missing failure'); }
    catch (RuntimeException $e) { nativeExpect($e->getMessage()==='network-before-commit','Unexpected failure'); }
    $before=$posts;
    try { genesisCreatePersonalNativeTaskOnce($account,$owner,'native-uncertain',$task,$fetch); throw new LogicException('Unknown creation accepted'); }
    catch (GenesisResourceLimitException $e) { nativeExpect($e->getMessage()==='TASK_CREATION_UNCONFIRMED' && $posts===$before,'Unknown retry posted again'); }
    $removed = genesisGoogleNativeTaskPayload('native-once',$task);
    nativeExpect(array_key_exists('due',$removed) && $removed['due']===null,'PATCH does not clear due date');
    unset($rows['native-1']);
    try { genesisCreatePersonalNativeTaskOnce($account,$owner,'native-once',$task,$fetch); throw new LogicException('Deleted task recreated'); }
    catch (GenesisResourceLimitException $e) { nativeExpect($posts===$before,'Deleted task got a new POST'); }
    echo "PASS native provider CONTRACT simulation with real parser/SQLite: undated payload, lost-response recovery, one POST, source edit retained, stable identity after marker removal, account isolation, unknown result blocks POST, deleted source not recreated. Live Google NOT tested.\n";
} finally { genesisGoogleForgetSnapshot($account); $db->prepare('DELETE FROM users WHERE id=?')->execute([$owner]); }
