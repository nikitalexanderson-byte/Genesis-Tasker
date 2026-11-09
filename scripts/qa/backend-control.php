<?php
declare(strict_types=1);
// Fixture controls are CLI-only and validate ownership before loading the test database.
if (PHP_SAPI !== 'cli') exit(1);
$options = getopt('', ['dir:', 'tier:', 'action:', 'count:', 'plan:', 'state:', 'id:', 'space:', 'expires-in:', 'language:', 'theme:', 'palette:']);
$directory = str_replace('\\', '/', (string)($options['dir'] ?? ''));
if (!is_file($directory . '/owner.json')) throw new RuntimeException('Owned fixture required');
$owner = json_decode((string)file_get_contents($directory . '/owner.json'), true, 16, JSON_THROW_ON_ERROR);
if (($owner['synthetic'] ?? false) !== true || $owner['directory'] !== $directory
    || !hash_equals($owner['configSha256'], (string)hash_file('sha256', $directory . '/config.php'))) throw new RuntimeException('Fixture ownership mismatch');
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
require dirname(__DIR__, 2) . '/server/src/bootstrap.php';
require dirname(__DIR__, 2) . '/server/src/repository.php';
require dirname(__DIR__, 2) . '/server/src/mindmaps.php';
require dirname(__DIR__, 2) . '/server/src/diary.php';
$users = json_decode((string)file_get_contents($directory . '/users.json'), true, 16, JSON_THROW_ON_ERROR)['users'];
$tier = (string)($options['tier'] ?? '');
if (!isset($users[$tier]) || genesisConfig()['db_path'] !== $directory . '/genesis.sqlite') throw new RuntimeException('Unknown fixture user');
$id = $users[$tier]['id']; $action = (string)($options['action'] ?? '');
$envelope = ['expectedRevision' => 0, 'schemaVersion' => 1, 'iv' => base64_encode(str_repeat('i', 12)), 'ciphertext' => base64_encode(str_repeat('synthetic-ciphertext', 3))];
if ($action === 'appearance') {
    $patch=[];
    if(isset($options['language'])) {
        $language=(string)$options['language'];
        if(!in_array($language,['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'],true))throw new RuntimeException('Invalid fixture language');
        $patch['language']=$language;
    }
    if(isset($options['theme'])) {$patch['theme']=(string)$options['theme'];$patch['expectedThemeRevision']=(int)(genesisFindUser($id)['theme_revision']??0);}
    if(isset($options['palette']))$patch['darkPalette']=(string)$options['palette'];
    $result=genesisUserForClient(genesisUpdateAccountPreferences($id,$patch));
    echo json_encode(['fixtureUpdated'=>true,'language'=>$result['language'],'theme'=>$result['theme'],'darkPalette'=>$result['darkPalette']],JSON_THROW_ON_ERROR);
} elseif ($action === 'seed-trial') {
    // This CLI-only operation may seed an unused SYNTHETIC identity with a full
    // historical 72-hour window. It cannot extend/update a real grant or run on
    // a production database: the owned-runtime checks above are mandatory.
    require_once dirname(__DIR__, 2) . '/server/src/subscription-trials.php';
    $plan=(string)($options['plan']??'');
    $remaining=filter_var($options['expires-in']??12,FILTER_VALIDATE_INT);
    if(!in_array($plan,['standart','premium','business'],true)||$remaining===false||$remaining< -60||$remaining>259200) throw new RuntimeException('Invalid synthetic trial window');
    $db=genesisDb();genesisBeginWriteTransaction($db);
    try {
        $q=$db->prepare('SELECT 1 FROM subscription_trials WHERE user_id=?');$q->execute([$id]);
        if($q->fetchColumn())throw new RuntimeException('Trial fixture requires unused user');
        $now=time();$ends=$now+$remaining;$starts=$ends-259200;$grant=genesisUuid();
        $identities=genesisTrialIdentityHashes($db,genesisFindUser($id));
        $db->prepare('INSERT INTO subscription_trials(user_id,grant_id,plan,starts_at,ends_at) VALUES(?,?,?,?,?)')->execute([$id,$grant,$plan,$starts,$ends]);
        foreach($identities as $identity) $db->prepare('INSERT INTO subscription_trial_claims(identity_hash,grant_id,used_at) VALUES(?,?,?)')->execute([$identity,$grant,$starts]);
        $db->commit();
        echo json_encode(['fixtureAssigned'=>true,'trial'=>genesisTrialStateForUser(genesisFindUser($id),time(),$db)],JSON_THROW_ON_ERROR);
    } catch(Throwable $failure) {if($db->inTransaction())$db->rollBack();throw $failure;}
} elseif ($action === 'subscription') {
    $plan = (string)($options['plan'] ?? '');
    if (!in_array($plan, ['free','standart','premium','business','premium4life'], true)) throw new RuntimeException('Invalid fixture plan');
    $expiry = in_array($plan, ['standart','premium','business'], true) ? (($options['state'] ?? '') === 'expired' ? '2000-01-01T00:00:00Z' : '2035-01-01T00:00:00Z') : null;
    genesisDb()->prepare('UPDATE users SET subscription_plan=?,subscription_valid_until=? WHERE id=?')->execute([$plan,$expiry,$id]);
    echo json_encode(['fixtureAssigned' => true, 'plan' => $plan, 'validUntil' => $expiry], JSON_THROW_ON_ERROR);
} elseif (in_array($action, ['seed-diary', 'seed-mindmaps'], true)) {
    $count = filter_var($options['count'] ?? null, FILTER_VALIDATE_INT);
    if ($count === false || $count < 0 || $count > 3000) throw new RuntimeException('Invalid fixture count');
    if ($action === 'seed-diary') {
        if (genesisDiaryNotes($id)) throw new RuntimeException('Seed requires empty diary');
        for ($i=0; $i<$count; $i++) genesisSaveDiaryNote($id, 'seed-note-' . $i, $envelope);
    } else {
        if (genesisMindmaps($id)) throw new RuntimeException('Seed requires empty maps');
        for ($i=0; $i<$count; $i++) genesisSaveMindmap($id, 'seed-map-' . $i, [...$envelope, 'operationId' => 'seed-op-' . $i]);
    }
    echo json_encode(['seeded' => $count, 'through' => 'real-domain-writer'], JSON_THROW_ON_ERROR);
} elseif ($action === 'save-mindmap') {
    try {
        $saved = genesisSaveMindmap($id, (string)($options['id'] ?? ''), [...$envelope, 'operationId' => 'race-op']);
        echo json_encode(['status' => 200, 'revision' => $saved['revision']], JSON_THROW_ON_ERROR);
    } catch (GenesisResourceLimitException $error) {
        echo json_encode(['status' => $error->status, 'error' => $error->getMessage()], JSON_THROW_ON_ERROR);
    }
} elseif (in_array($action, ['seed-shared-projects', 'seed-shared-mindmaps'], true)) {
    require dirname(__DIR__, 2) . '/server/src/google.php';
    require dirname(__DIR__, 2) . '/server/src/shared-projects.php';
    require dirname(__DIR__, 2) . '/server/src/shared-mindmaps.php';
    $spaceId = (string)($options['space'] ?? '');
    $space = genesisSharedSpaceAccess($spaceId, $id);
    if ($space['created_by'] !== $id) throw new RuntimeException('Fixture may seed only its owned space');
    $count = filter_var($options['count'] ?? null, FILTER_VALIDATE_INT);
    if ($count === false || $count < 0 || $count > 99) throw new RuntimeException('Invalid shared fixture count');
    for ($i=0; $i<$count; $i++) {
        if ($action === 'seed-shared-projects') genesisSharedCreateProject($id, $spaceId, ['title' => 'Synthetic quota project ' . $i]);
        else {
            $mapId = 'seed-shared-map-' . $i;
            genesisSaveSharedMindmap($id, $spaceId, $mapId, ['schemaVersion'=>1,'expectedRevision'=>0,'operationId'=>'seed-shared-op-'.$i,
                'document'=>['schemaVersion'=>1,'id'=>$mapId,'title'=>'Synthetic quota map','pinned'=>false,'archived'=>false,
                    'nodes'=>[['id'=>'root','parentId'=>null,'kind'=>'idea','text'=>'Synthetic root','note'=>'']],'links'=>[]]]);
        }
    }
    echo json_encode(['seeded' => $count, 'through' => 'real-shared-domain-writer'], JSON_THROW_ON_ERROR);
} else throw new RuntimeException('Unknown fixture action');
session_write_close();
