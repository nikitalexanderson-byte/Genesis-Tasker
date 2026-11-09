<?php
declare(strict_types=1);

// Self-contained real SQLite + real HTTP checks. Never reads an existing config/DB.
if (PHP_SAPI !== 'cli') exit(1);
$fixture = sys_get_temp_dir() . '/genesis-physis-test-' . bin2hex(random_bytes(8));
mkdir($fixture, 0700); mkdir($fixture . '/sessions', 0700);
$config = ['app_url' => 'https://localhost.invalid', 'google_only' => true, 'physis_enabled' => true,
    'db_path' => $fixture . '/genesis.sqlite', 'session_path' => $fixture . '/sessions',
    'crypto_key' => base64_encode(random_bytes(32)), 'cookie_secure' => false, 'timezone' => 'UTC'];
file_put_contents($fixture . '/config.php', '<?php return ' . var_export($config, true) . ';');
define('GENESIS_LOCAL_TEST_CONFIG', $fixture . '/config.php');
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/physis.php';

$checks = 0;
function physisExpect(bool $condition, string $message): void
{
    global $checks;
    if (!$condition) throw new RuntimeException($message);
    $checks++;
}
function physisFailure(callable $operation, int $status, string $code): void
{
    try { $operation(); throw new RuntimeException('Expected failure: ' . $code); }
    catch (GenesisPhysisException $error) { physisExpect($error->status === $status && $error->getMessage() === $code, 'Unexpected rejection: ' . $error->getMessage()); }
}
function physisTestEnvelope(string $id, int $version = 1, string $secret = 'PRIVATE_PHYSIS_TRAINING_DRUG_METRIC_2026'): array
{
    $iv = random_bytes(12); $tag = '';
    $cipher = openssl_encrypt(json_encode(['id' => $id, 'kind' => 'intake', 'data' => ['note' => $secret, 'drugId' => 'private-drug']], JSON_THROW_ON_ERROR),
        'aes-256-gcm', str_repeat('k', 32), OPENSSL_RAW_DATA, $iv, $tag, 'genesis:physis:v1:owner-a:' . $id . ':1:' . $version);
    return ['version' => 1, 'schemaVersion' => 1, 'keyVersion' => $version, 'iv' => base64_encode($iv), 'ciphertext' => base64_encode($cipher . $tag)];
}
function physisTestVault(int $version = 1): array
{
    return ['version' => 1, 'keyVersion' => $version,
        'password' => ['salt' => base64_encode(random_bytes(16)), 'iterations' => 600000, 'iv' => base64_encode(random_bytes(12)), 'ciphertext' => base64_encode(random_bytes(48))],
        'recovery' => ['iv' => base64_encode(random_bytes(12)), 'ciphertext' => base64_encode(random_bytes(48))]];
}
function physisTestChange(string $id, string $operation, int $revision, int $version = 1): array
{
    return ['id' => $id, 'operation' => $operation, 'expectedRevision' => $revision]
        + ($operation === 'delete' ? [] : ['envelope' => physisTestEnvelope($id, $version)]);
}
function physisTestWrite(array $changes): array { return ['requestId' => genesisUuid(), 'changes' => $changes]; }

$process = null; $pipes = []; $workers = [];
try {
    $db = genesisDb();
    foreach (['owner-a' => GENESIS_PHYSIS_EMAILS[0], 'owner-b' => GENESIS_PHYSIS_EMAILS[1], 'owner-c' => GENESIS_PHYSIS_EMAILS[2], 'owner-d' => GENESIS_PHYSIS_EMAILS[3], 'owner-e' => GENESIS_PHYSIS_EMAILS[4], 'owner-f' => GENESIS_PHYSIS_EMAILS[5], 'other' => 'outsider@example.org'] as $id => $email) {
        $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(:id,:sub,:email,:name,:now,:now)')
            ->execute(['id' => $id, 'sub' => $id . '-sub', 'email' => $email, 'name' => 'Synthetic fixture', 'now' => genesisNow()]);
    }
    $db->exec("UPDATE users SET subscription_plan='premium4life' WHERE id<>'other'");
    $db->prepare('INSERT INTO linked_google_accounts(id,owner_user_id,google_sub,email,display_name,created_at,updated_at) VALUES(:id,:owner,:sub,:email,:name,:now,:now)')
        ->execute(['id' => 'linked-fixture', 'owner' => 'owner-a', 'sub' => 'linked-sub', 'email' => 'outsider@example.org', 'name' => 'Synthetic linked', 'now' => genesisNow()]);

    // The production session helper receives trusted provider claims, never owner email.
    $owner = genesisFindUser('owner-a');
    genesisEstablishGoogleSession($owner, 'owner-a-sub', ['sub' => 'owner-a-sub', 'email' => '  NIKITALEXANDERSON@GMAIL.COM ', 'email_verified' => true], 'web');
    physisExpect(genesisPhysisRequireOwner() === 'owner-a', 'Verified normalized primary web identity denied.');
    foreach (['invalid'] as $channel) {
        $saved = $_SESSION['auth_identity']; $_SESSION['auth_identity']['channel'] = $channel;
        physisFailure(static fn() => genesisPhysisRequireOwner(), 403, 'PHYSIS_UNAVAILABLE'); $_SESSION['auth_identity'] = $saved;
    }
    // Like admin access, the validated primary account is authoritative, not newer cookie fields.
    foreach (['nikitalexanderson+alias@gmail.com', 'nikita.lexanderson@gmail.com', 'picishina+alias@gmail.com', 'pici.shina@gmail.com', 'maybenextime86+alias@gmail.com', 'maybe.nextime86@gmail.com', 'outsider-two@example.org'] as $email) {
        $db->prepare('UPDATE users SET email=:email WHERE id=:id')->execute(['email' => $email, 'id' => 'owner-a']);
        physisExpect(genesisPhysisRequireOwner()==='owner-a','Lifetime access incorrectly depends on pilot email spelling');
    }
    $db->prepare('UPDATE users SET email=:email WHERE id=:id')->execute(['email' => GENESIS_PHYSIS_EMAILS[0], 'id' => 'owner-a']);
    genesisEstablishGoogleSession($owner, 'linked-sub', ['sub' => 'linked-sub', 'email' => GENESIS_PHYSIS_EMAILS[0], 'email_verified' => true], 'web');
    physisExpect(genesisPhysisRequireOwner() === 'owner-a', 'Verified linked web login lost the canonical Physis owner.');
    genesisEstablishGoogleSession($owner, 'owner-a-sub');
    physisExpect(genesisPhysisRequireOwner() === 'owner-a', 'Normal primary site session denied.');

    $makeCookie = static function (string $user, array $claims = [], string $channel = 'web', ?string $sub = null, bool $legacyClaims = false) use ($fixture): array {
        $profile = $claims + ['sub' => $sub ?? $user . '-sub', 'email' => genesisFindUser($user)['email'], 'email_verified' => true];
        genesisEstablishGoogleSession(genesisFindUser($user), $profile['sub'], $profile, $channel);
        if ($legacyClaims) unset($_SESSION['auth_identity']['channel'], $_SESSION['auth_identity']['email'], $_SESSION['auth_identity']['email_verified']);
        $sessionId = bin2hex(random_bytes(24)); $encoded = '';
        foreach ($_SESSION as $key => $value) $encoded .= $key . '|' . serialize($value);
        file_put_contents($fixture . '/sessions/sess_' . $sessionId, $encoded);
        return ['cookie' => 'GENESISSESSID=' . $sessionId, 'csrf' => $_SESSION['csrf']];
    };
    $a = $makeCookie('owner-a'); $b = $makeCookie('owner-b'); $c = $makeCookie('owner-c'); $d = $makeCookie('owner-d'); $other = $makeCookie('other');
    $e = $makeCookie('owner-e'); $f = $makeCookie('owner-f');
    $dNative = $makeCookie('owner-d', [], 'native');
    $cUnverified = $makeCookie('owner-c', ['email_verified' => false]);
    $native = $makeCookie('owner-a', [], 'native'); $unverified = $makeCookie('owner-a', ['email_verified' => false]);
    $linked = $makeCookie('owner-a', ['email' => GENESIS_PHYSIS_EMAILS[0]], 'web', 'linked-sub');
    $old = $makeCookie('owner-a', [], 'unknown');
    $otherOld = $makeCookie('other', [], 'unknown');
    $legacyNoClaims = $makeCookie('owner-a', [], 'web', null, true);
    session_write_close();

    $listener = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
    if (!$listener) throw new RuntimeException('Cannot reserve local HTTP port.');
    $address = stream_socket_get_name($listener, false); fclose($listener);
    $command = [PHP_BINARY]; if (($ini = php_ini_loaded_file()) !== false) array_push($command, '-c', $ini);
    // This fixture rewrites config between requests; OPcache must not serve stale flags.
    array_push($command, '-d', 'opcache.enable=0', '-d', 'opcache.enable_cli=0', '-S', $address, 'server/tests/physis-router.php');
    putenv('GENESIS_PHYSIS_TEST_DIR=' . $fixture);
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['file', $fixture . '/http.log', 'a'], 2 => ['file', $fixture . '/http.log', 'a']], $pipes, dirname(__DIR__, 2));
    if (!is_resource($process)) throw new RuntimeException('HTTP server did not start.');
    fclose($pipes[0]);
    for ($attempt = 0; $attempt < 50; $attempt++) {
        $socket = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
        if ($socket) { fclose($socket); break; } usleep(100000);
    }
    $request = static function (string $path, array $session, string $method = 'GET', ?string $body = null, string $contentType = 'application/json') use ($address): array {
        $context = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 15, 'method' => $method,
            'header' => 'Cookie: ' . ($session['cookie'] ?? '') . "\r\nX-CSRF-Token: " . ($session['csrf'] ?? '') . "\r\nContent-Type: $contentType\r\n", 'content' => $body ?? '']]);
        $bytes = file_get_contents('http://' . $address . '/?path=' . $path, false, $context);
        preg_match('/^HTTP\/\S+ (\d+)/', ($http_response_header ?? [])[0] ?? '', $status);
        return ['status' => (int)($status[1] ?? 0), 'data' => json_decode($bytes ?: '{}', true), 'headers' => $http_response_header ?? []];
    };
    foreach ([$other, $otherOld, []] as $denied) {
        foreach ([['GET', 'access'], ['GET', 'vault'], ['GET', 'records'], ['POST', 'records'], ['PUT', 'vault'], ['POST', 'rotate'], ['GET', 'export'], ['GET', 'records/foreign-id']] as [$method, $path]) {
            $reply = $request('physis/v1/' . $path, $denied, $method, $method === 'GET' ? null : '{}');
            // Mutating routes first pass the shared backup-generation authentication guard.
            $rejected = $denied === [] && $method !== 'GET'
                ? $reply['status'] === 401 && ($reply['data']['error'] ?? '') === 'AUTH_REQUIRED'
                : $reply['status'] === 403 && in_array($reply['data']['error'] ?? '', ['PHYSIS_UNAVAILABLE','PHYSIS_PREMIUM4LIFE_REQUIRED'], true);
            physisExpect($rejected, 'Denied identity reached ' . $path . ' (HTTP ' . $reply['status'] . '): ' . json_encode($reply['data']) . '\n' . substr((string)@file_get_contents($fixture . '/http.log'), -2500));
        }
    }
    physisExpect($request('physis/v1/access', $a)['data']['ownerId'] === 'owner-a', 'Access identity mismatch.');
    physisExpect($request('physis/v1/access', $b)['data']['ownerId'] === 'owner-b', 'Second allowed owner denied.');
    physisExpect($request('physis/v1/access', $c)['data']['ownerId'] === 'owner-c', 'Third allowed owner denied.');
    physisExpect($request('physis/v1/access', $d)['data']['ownerId'] === 'owner-d', 'Fourth allowed owner denied.');
    physisExpect($request('physis/v1/vault', $d)['status'] === 200, 'Fourth allowed owner cannot open the account vault.');
    foreach (['owner-e' => $e, 'owner-f' => $f] as $expectedOwner => $testerSession) {
        $testerAccess = $request('physis/v1/access', $testerSession);
        physisExpect($testerAccess['status'] === 200 && $testerAccess['data']['ownerId'] === $expectedOwner, 'New pilot tester denied.');
        physisExpect($request('physis/v1/vault', $testerSession)['status'] === 200, 'New pilot tester cannot open own vault.');
    }
    foreach ([$old, $legacyNoClaims, $unverified, $linked] as $normal) {
        $reply = $request('physis/v1/access', $normal);
        physisExpect($reply['status'] === 200 && $reply['data']['ownerId'] === 'owner-a', 'Normal site login required extra confirmation.');
        physisExpect($request('physis/v1/vault', $normal)['status'] === 200, 'Normal login cannot open vault.');
    }
    physisExpect($request('physis/v1/access', $cUnverified)['data']['ownerId'] === 'owner-c', 'Primary third account denied.');
    foreach ([$native, $linked, $other, $otherOld, []] as $deniedHint) {
        physisExpect(!isset($request('physis/v1/access', $deniedHint)['data']['reauthRequired']), 'Unexpected separate login flow.');
    }
    $deniedCsrf = ['csrf' => 'wrong'] + $a;
    physisExpect($request('physis/v1/records', $deniedCsrf, 'POST', '{}')['status'] === 403, 'CSRF bypass.');
    physisExpect($request('physis/v1/records', $a, 'POST', '{}', 'text/plain')['status'] === 415, 'JSON content-type missing.');
    physisExpect($request('physis/v1/records', $a, 'POST', str_repeat('x', 2 * 1024 * 1024 + 1))['status'] === 413, 'Body limit bypass.');

    // The shared catalog uses administrator authorization, not personal vault ownership.
    $catalogEntry = ['id'=>'custom-'.genesisUuid(),'kind'=>'supplement','nameRu'=>'Тестовая справочная карточка','nameEn'=>'Test entry','aliases'=>[],
        'family'=>'Тестовая категория','tags'=>['Категория А','Категория Б'],'description'=>'Описание для синтетического теста.',
        'uses'=>'','evidence'=>'','risks'=>'Ограничения сохранены.','sources'=>['https://ods.od.nih.gov/'],
        'reviewedAt'=>'2026-11-02','verification'=>'Проверка','restricted'=>true,'hidden'=>false,'scopeNote'=>'','legacyId'=>''];
    $catalogWrite = ['id'=>$catalogEntry['id'],'expectedRevision'=>0,'entry'=>$catalogEntry];
    $catalogJson = genesisPhysisEncode($catalogWrite);
    physisExpect($request('physis/v1/catalog',$a)['data']['canEdit']===true,'Administrator catalog access missing.');
    physisExpect($request('physis/v1/catalog',$b)['data']['canEdit']===false,'Reader gained catalog edit rights.');
    foreach ([$other,[]] as $denied) physisExpect($request('physis/v1/catalog',$denied)['status']===403,'Unauthenticated catalog API read accepted.');
    physisExpect($request('physis/v1/catalog',$b,'PUT',$catalogJson)['status']===403,'Reader changed shared catalog.');
    physisExpect($request('physis/v1/catalog',$deniedCsrf,'PUT',$catalogJson)['status']===403,'Catalog CSRF bypass.');
    physisExpect($request('physis/v1/catalog',$a,'PUT',$catalogJson,'text/plain')['status']===415,'Catalog accepted non-JSON.');
    $catalogCreated=$request('physis/v1/catalog',$a,'PUT',$catalogJson);
    physisExpect($catalogCreated['status']===200&&$catalogCreated['data']['revision']===1,'Catalog create failed: '.json_encode($catalogCreated['data']));
    physisExpect($request('physis/v1/catalog',$a,'PUT',$catalogJson)['data']===$catalogCreated['data'],'Catalog retry created a second revision.');
    $readerCatalog=$request('physis/v1/catalog',$b)['data'];
    physisExpect($readerCatalog['overrides'][0]['entry']['tags']===['Категория А','Категория Б'],'Catalog is not shared across accounts.');
    physisExpect(!isset($readerCatalog['overrides'][0]['updated_by']),'Catalog leaked editor account ID.');
    $catalogWrite['entry']['nameRu']='Новая редакция';
    physisExpect($request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($catalogWrite))['status']===409,'Stale catalog edit overwrote newer revision.');
    $catalogWrite['expectedRevision']=1;
    $catalogWrite['entry']['hidden']=true;$catalogWrite['entry']['kind']='food';
    $catalogChanged=$request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($catalogWrite));
    physisExpect($catalogChanged['status']===200&&$catalogChanged['data']['revision']===2,'Catalog move/hide failed.');
    physisExpect($catalogChanged['data']['entry']['restricted']===true,'Catalog lost safety flag.');
    foreach ([['kind','pharmacology'],['sources',['javascript:alert(1)']],['sources',['https://user:pass@example.org/']],['reviewedAt','2026-02-30'],['restricted','false'],['tags',array_fill(0,33,'x')],['family',str_repeat('я',81)],['tags',[str_repeat('я',81)]],['description','']] as [$key,$bad]) {
        $invalid=$catalogWrite;$invalid['expectedRevision']=2;$invalid['entry'][$key]=$bad;
        physisExpect($request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($invalid))['status']===400,'Catalog accepted invalid '.$key);
    }
    physisExpect($request('physis/v1/catalog',$a)['data']['overrides'][0]['revision']===2,'Rejected catalog writes modified data.');
    physisExpect(genesisPhysisVault('owner-a')['vault']===null,'Catalog edits created or modified the personal vault.');

    $nutritionEntry=$catalogEntry;
    $nutritionEntry['kind']='food';
    $nutritionEntry['composition']=['state'=>'dry','basis'=>'100g','densityGPerMl'=>null,'descriptionRu'=>'Сухой тестовый продукт','descriptionEn'=>'Dry test food',
        'source'=>'https://fdc.nal.usda.gov/','version'=>'Test 2026','license'=>'CC0','provider'=>'USDA','values'=>['protein'=>0,'energy'=>100.5],'estimated'=>['energy'],'trace'=>['fat']];
    $nutritionWrite=['id'=>$catalogEntry['id'],'expectedRevision'=>2,'entry'=>$nutritionEntry];
    $nutritionSaved=$request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($nutritionWrite));
    physisExpect($nutritionSaved['status']===200&&genesisPhysisCanonical($nutritionSaved['data']['entry']['composition'])===genesisPhysisCanonical($nutritionEntry['composition']),'Nutrition composition roundtrip failed.');
    foreach ([['values',['energy'=>-1]],['values',['energy'=>'100']],['values',['unrecognized'=>1]],['estimated',['fat']],['trace',['protein']],['densityGPerMl',0],['state','fried']] as [$key,$bad]) {
        $invalid=$nutritionWrite;$invalid['expectedRevision']=3;$invalid['entry']['composition'][$key]=$bad;
        physisExpect($request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($invalid))['status']===400,'Invalid nutrition composition accepted: '.$key);
    }
    $medicineWrite=['id'=>$catalogEntry['id'],'expectedRevision'=>3,'entry'=>array_merge($catalogEntry,['kind'=>'medicine','status'=>'Исследуемое вещество','mechanism'=>'Тест','contraindications'=>'Тест','interactions'=>'Тест'])];
    $medicineSaved=$request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($medicineWrite));
    physisExpect($medicineSaved['status']===200&&$medicineSaved['data']['entry']['kind']==='medicine','Medicine catalog save failed.');
    $medicineWrite['expectedRevision']=4;$medicineWrite['entry']['interactions']=['unexpected'];
    physisExpect($request('physis/v1/catalog',$a,'PUT',genesisPhysisEncode($medicineWrite))['status']===400,'Invalid research text accepted.');

    $vault = ['requestId' => genesisUuid(), 'expectedRevision' => 0, 'vault' => physisTestVault()];
    $reply = $request('physis/v1/vault', $a, 'PUT', genesisPhysisEncode($vault));
    physisExpect($reply['status'] === 200 && $reply['data']['revision'] === 1, 'Vault creation failed: ' . json_encode($reply['data']));
    physisExpect($request('physis/v1/vault', $a, 'PUT', genesisPhysisEncode($vault))['data'] === $reply['data'], 'Vault retry changed response.');
    physisExpect($request('physis/v1/vault', $b)['data']['vault'] === null, 'Foreign vault leaked.');
    physisExpect($request('physis/v1/vault', $c)['data']['vault'] === null, 'Foreign vault leaked to third tester.');
    foreach ([$e, $f] as $newTester) {
        physisExpect($request('physis/v1/vault', $newTester)['data']['vault'] === null, 'Foreign vault leaked to a new tester.');
    }
    $vaultTamper = ['owner_id' => 'owner-a'] + $vault;
    physisExpect($request('physis/v1/vault', $b, 'PUT', genesisPhysisEncode($vaultTamper))['status'] === 400, 'Owner tamper accepted.');
    $vault['requestId'] = genesisUuid(); genesisPhysisSaveVault('owner-b', $vault);

    $id = genesisUuid(); $create = physisTestWrite([physisTestChange($id, 'create', 0)]);
    $reply = $request('physis/v1/records', $a, 'POST', genesisPhysisEncode($create));
    physisExpect($reply['status'] === 200 && $reply['data']['records'][0]['revision'] === 1, 'Create failed.');
    physisExpect(!array_key_exists('envelope', $reply['data']['records'][0]), 'Mutation receipt duplicates encrypted autosave content.');
    physisExpect($request('physis/v1/records', $a, 'POST', genesisPhysisEncode($create))['data'] === $reply['data'], 'Repeated request duplicated/revised write.');
    $tampered = $create; $tampered['changes'][0]['envelope'] = physisTestEnvelope($id);
    physisExpect($request('physis/v1/records', $a, 'POST', genesisPhysisEncode($tampered))['status'] === 409, 'Changed idempotency body accepted.');
    physisExpect($request('physis/v1/records', $b)['data']['records'] === [], 'Foreign list leaked.');
    physisExpect($request('physis/v1/records', $c)['data']['records'] === [], 'Foreign list leaked to third tester.');
    $foreignUpdate = physisTestWrite([physisTestChange($id, 'update', 1)]);
    physisExpect($request('physis/v1/records', $b, 'POST', genesisPhysisEncode($foreignUpdate))['status'] === 409, 'Foreign write accepted.');
    physisExpect($request('physis/v1/records&owner_id=owner-a', $b)['status'] === 400, 'Foreign list filter accepted.');
    physisExpect($request('physis/v1/records', $b, 'POST', genesisPhysisEncode(physisTestWrite([physisTestChange($id, 'delete', 1)])))['status'] === 409, 'Foreign delete accepted.');
    physisExpect($request('physis/v1/records&limit=101', $a)['status'] === 400, 'Unbounded pagination accepted.');
    physisExpect(str_contains(strtolower(implode("\n", $request('physis/v1/records', $a)['headers'])), 'no-store'), 'Ciphertext cacheable.');

    // Late batch failure must roll back earlier accepted changes, sequence and receipt.
    $failed = physisTestWrite([physisTestChange($id, 'update', 1), physisTestChange(genesisUuid(), 'update', 1)]);
    physisFailure(static fn() => genesisPhysisSaveRecords('owner-a', $failed), 409, 'PHYSIS_CONFLICT');
    physisExpect(genesisPhysisRecords('owner-a', [])['records'][0]['revision'] === 1, 'Partial batch committed.');

    // Two independent PHP processes race on the same SQLite record, not session locks.
    foreach ([1, 2] as $number) {
        file_put_contents($fixture . '/race-' . $number . '.json', genesisPhysisEncode(physisTestWrite([physisTestChange($id, 'update', 1)])));
        $workerCommand = [PHP_BINARY]; if ($ini !== false) array_push($workerCommand, '-c', $ini);
        array_push($workerCommand, 'server/tests/physis-worker.php', 'race-' . $number . '.json');
        $worker = proc_open($workerCommand, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', $fixture . '/worker.log', 'a']], $workerPipes, dirname(__DIR__, 2));
        if (!is_resource($worker)) throw new RuntimeException('Worker did not start.');
        fclose($workerPipes[0]); $workers[] = [$worker, $workerPipes[1]];
    }
    $statuses = [];
    foreach ($workers as [$worker, $output]) { $data = json_decode(stream_get_contents($output), true); fclose($output); proc_close($worker); $statuses[] = $data['status'] ?? 0; }
    $workers = []; sort($statuses);
    physisExpect($statuses === [200, 409], 'Concurrent CAS failed: ' . json_encode($statuses));
    physisExpect(genesisPhysisRecords('owner-a', [])['records'][0]['revision'] === 2, 'Concurrent revision invalid.');

    $secondId = genesisUuid(); genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($secondId, 'create', 0)]));
    $page = genesisPhysisRecords('owner-a', ['limit' => '1']);
    physisExpect($page['hasMore'] && count($page['records']) === 1, 'Bounded page failed.');
    $page2 = genesisPhysisRecords('owner-a', ['limit' => '1', 'page' => (string)$page['cursor'], 'snapshot' => (string)$page['snapshot']]);
    physisExpect(!$page2['hasMore'] && count($page2['records']) === 1, 'Page continuation failed.');
    genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($secondId, 'update', 1)]));
    physisFailure(static fn() => genesisPhysisRecords('owner-a', ['page' => (string)$page['cursor'], 'snapshot' => (string)$page['snapshot']]), 409, 'PHYSIS_RESYNC_REQUIRED');
    $beforeDelete = genesisPhysisRecords('owner-a', [])['cursor'];
    genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($id, 'delete', 2)]));
    $delta = genesisPhysisRecords('owner-a', ['after' => (string)$beforeDelete]);
    physisExpect(count($delta['records']) === 1 && $delta['records'][0]['deletedAt'] !== null && $delta['records'][0]['envelope'] === null, 'Delete delta invalid.');
    physisFailure(static fn() => genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($id, 'update', 2)])), 409, 'PHYSIS_CONFLICT');
    physisFailure(static fn() => genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($id, 'create', 0)])), 409, 'PHYSIS_CONFLICT');
    $db->prepare('UPDATE physis_records SET deleted_at=:old WHERE owner_id=:owner AND id=:id')->execute(['old' => '2000-01-01T00:00:00Z', 'owner' => 'owner-a', 'id' => $id]);
    genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($secondId, 'update', 2)]));
    physisFailure(static fn() => genesisPhysisRecords('owner-a', ['after' => (string)$beforeDelete]), 409, 'PHYSIS_RESYNC_REQUIRED');
    physisFailure(static fn() => genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($id, 'create', 0)])), 409, 'PHYSIS_CONFLICT');
    physisFailure(static fn() => genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($id, 'update', 3)])), 409, 'PHYSIS_CONFLICT');
    physisExpect(count(genesisPhysisRecords('owner-a', [])['records']) === 1, 'Expired tombstone remained in full snapshot.');

    $current = genesisPhysisRecords('owner-a', []);
    $rotation = ['requestId' => genesisUuid(), 'expectedRevision' => 1, 'expectedCursor' => $current['cursor'], 'vault' => physisTestVault(2),
        'records' => [['id' => $secondId, 'expectedRevision' => 3, 'envelope' => physisTestEnvelope($secondId, 2)]]];
    $badRotation = $rotation; $badRotation['records'] = [];
    physisFailure(static fn() => genesisPhysisRotate('owner-a', $badRotation), 409, 'PHYSIS_CONFLICT');
    physisExpect(genesisPhysisVault('owner-a')['vault']['keyVersion'] === 1, 'Failed rotation changed vault.');
    $rotated = genesisPhysisRotate('owner-a', $rotation);
    physisExpect($rotated['keyVersion'] === 2 && genesisPhysisVault('owner-a')['revision'] === 2, 'Rotation failed.');
    physisExpect(genesisPhysisRotate('owner-a', $rotation) === $rotated, 'Rotation retry failed.');
    physisExpect(genesisPhysisRecords('owner-a', [])['records'][0]['envelope']['keyVersion'] === 2, 'Rotation left mixed key versions.');
    physisFailure(static fn() => genesisPhysisSaveRecords('owner-a', physisTestWrite([physisTestChange($secondId, 'update', 4)])), 409, 'PHYSIS_KEY_VERSION_CONFLICT');
    $rewrap = ['requestId' => genesisUuid(), 'expectedRevision' => 2, 'vault' => physisTestVault(2)];
    physisExpect(genesisPhysisSaveVault('owner-a', $rewrap)['revision'] === 3, 'Password/recovery rewrap failed.');
    physisFailure(static fn() => genesisPhysisSaveVault('owner-a', ['requestId' => genesisUuid(), 'expectedRevision' => 3, 'vault' => physisTestVault(3)]), 409, 'PHYSIS_KEY_VERSION_CONFLICT');

    // Account wrappers need no schema migration and preserve legacy records byte for byte.
    $beforeAccountMigration = genesisPhysisRecords('owner-a', []);
    $accountVault = ['version' => 2, 'keyVersion' => 2, 'account' => ['iv' => base64_encode(random_bytes(12)), 'ciphertext' => base64_encode(random_bytes(62))]];
    $accountWrite = ['requestId' => genesisUuid(), 'expectedRevision' => 3, 'vault' => $accountVault];
    physisExpect(genesisPhysisSaveVault('owner-a', $accountWrite)['revision'] === 4, 'Account migration failed.');
    physisExpect(genesisPhysisRecords('owner-a', []) === $beforeAccountMigration, 'Account migration changed records.');
    physisExpect(genesisPhysisVault('owner-a')['vault'] === $accountVault, 'Account wrapper did not round trip.');
    physisExpect(genesisPhysisSaveVault('owner-a', $accountWrite)['revision'] === 4, 'Account retry changed revision.');
    $invalidAccount = $accountVault; $invalidAccount['account']['ciphertext'] = base64_encode(random_bytes(32));
    physisFailure(static fn() => genesisPhysisValidateVault($invalidAccount, 2), 400, 'PHYSIS_INVALID_ENVELOPE');
    physisExpect(genesisPhysisVault('owner-b')['vault']['version'] === 1, 'Migration changed another account.');

    foreach (['physis_owners', 'physis_records', 'physis_receipts', 'physis_used_ids'] as $table) {
        $dump = json_encode($db->query('SELECT * FROM ' . $table)->fetchAll(), JSON_THROW_ON_ERROR);
        physisExpect(!str_contains($dump, 'PRIVATE_PHYSIS_TRAINING_DRUG_METRIC_2026') && !str_contains($dump, 'private-drug') && !str_contains($dump, '"kind"'), 'Plaintext leaked into ' . $table);
    }
    $receiptDump = json_encode($db->query('SELECT response_json FROM physis_receipts')->fetchAll(), JSON_THROW_ON_ERROR);
    physisExpect(!str_contains($receiptDump, 'ciphertext') && !str_contains($receiptDump, 'envelope'), 'Receipt storage duplicates encrypted records.');

    // Config is loaded anew for each real HTTP request; revoke flag without deletion.
    $config['physis_enabled'] = false;
    file_put_contents($fixture . '/config.php', '<?php return ' . var_export($config, true) . ';');
    physisExpect($request('physis/v1/records', $a)['status'] === 403, 'Feature flag did not revoke reads.');
    physisExpect($request('physis/v1/records', $a, 'POST', '{}')['status'] === 403, 'Feature flag did not revoke writes.');
    physisExpect(!isset($request('physis/v1/access', $old)['data']['reauthRequired']), 'Disabled pilot still exposed a reauthentication entry.');
    unset($config['physis_enabled']); file_put_contents($fixture . '/config.php', '<?php return ' . var_export($config, true) . ';');
    foreach ([$a, $b, $c, $d, $linked,$native,$dNative] as $allowedBrowser) {
        physisExpect($request('physis/v1/access', $allowedBrowser)['status'] === 200, 'Released browser pilot denied an allowed verified account.');
    }
    // The Git-controlled rollout must never enable the same account's native session.
    foreach ([$other, []] as $denied) {
        foreach ([['GET', 'access'], ['GET', 'vault'], ['GET', 'records'], ['POST', 'records'], ['PUT', 'vault'], ['POST', 'rotate']] as [$method, $path]) {
            $reply = $request('physis/v1/' . $path, $denied, $method, $method === 'GET' ? null : '{}');
            physisExpect($reply['status'] === ($denied === [] && $method !== 'GET' ? 401 : 403), 'Default browser rollout bypassed identity/channel guard.');
        }
    }
    foreach (['true', null, 1] as $invalidFlag) {
        $config['physis_enabled'] = $invalidFlag;
        file_put_contents($fixture . '/config.php', '<?php return ' . var_export($config, true) . ';');
        physisExpect($request('physis/v1/access', $a)['status'] === 403, 'A non-boolean flag enabled the pilot.');
    }
    physisExpect(count(genesisPhysisRecords('owner-a', [])['records']) === 1, 'Disabling erased encrypted data.');
    echo "Physis security: $checks checks passed (real SQLite, HTTP, independent-process CAS).\n";
} finally {
    foreach ($workers as [$worker, $output]) { fclose($output); proc_terminate($worker); proc_close($worker); }
    if (is_resource($process)) { proc_terminate($process); proc_close($process); }
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    // Only generated files below the exact freshly created fixture directory.
    foreach (glob($fixture . '/sessions/*') ?: [] as $file) if (is_file($file)) unlink($file);
    @rmdir($fixture . '/sessions');
    foreach (glob($fixture . '/*') ?: [] as $file) if (is_file($file)) @unlink($file);
    @rmdir($fixture);
}
