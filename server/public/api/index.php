<?php
declare(strict_types=1);

$serverRoot = '';
$cursor = __DIR__;
for ($depth = 0; $depth < 7; $depth++) {
    foreach ([$cursor . '/server', $cursor . '/genesis-app/server'] as $candidate) {
        if (is_file($candidate . '/src/bootstrap.php')) {
            $serverRoot = $candidate;
            break 2;
        }
    }
    $parent = dirname($cursor);
    if ($parent === $cursor) {
        break;
    }
    $cursor = $parent;
}
if ($serverRoot === '') {
    http_response_code(503);
    exit('GENESIS server files are unavailable.');
}
require $serverRoot . '/src/relocation.php';
genesisHandleRelocation($serverRoot);
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = trim((string)($_GET['path'] ?? $_SERVER['PATH_INFO'] ?? ''), '/');
$segments = $path === '' ? [] : explode('/', $path);
// Parallel public discovery must not replace the cookie of a new login session.
define('GENESIS_STATELESS_REQUEST', $method === 'OPTIONS'
    || $path === 'email/confirm'
    || ($method === 'POST' && $path === 'donations/cloudtips/webhook')
    || ($method === 'POST' && str_starts_with($path, 'billing/webhooks/'))
    || ($method === 'GET' && in_array($path, ['health', 'auth/providers'], true)));
require $serverRoot . '/src/bootstrap.php';
require $serverRoot . '/src/repository.php';
require $serverRoot . '/src/mindmaps.php';
require $serverRoot . '/src/stoicheion-workspace.php';
require $serverRoot . '/src/aurora-workspace.php';
require $serverRoot . '/src/diary.php';
require $serverRoot . '/src/shared-mindmaps.php';
require $serverRoot . '/src/ads.php';
require $serverRoot . '/src/google.php';
require $serverRoot . '/src/yandex.php';
require $serverRoot . '/src/yandex-calendar.php';
require $serverRoot . '/src/local-accounts.php';
require $serverRoot . '/src/native-auth.php';
require $serverRoot . '/src/gemini.php';
require $serverRoot . '/src/shared-projects.php';
require $serverRoot . '/src/shared-google.php';
require $serverRoot . '/src/physis.php';
require $serverRoot . '/src/backups.php';
require $serverRoot . '/src/weather.php';
require $serverRoot . '/src/partner-api.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(self), geolocation=()');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if($path==='email/confirm'&&in_array($method,['GET','POST'],true)){
    header('Content-Type: text/html; charset=UTF-8');header('Cache-Control: no-store');header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    $token=$method==='POST'?($_POST['token']??''):($_GET['token']??'');$token=is_string($token)?$token:'';$language='ru';
    try{$valid=genesisEmailConfirmRegistration($token,$method==='POST');$language=genesisEmailRegistrationLanguage($token);}catch(Throwable){$valid=false;}
    $escape=static fn(string $value):string=>htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
    $copy=static fn(string $key):string=>$escape(genesisNotificationCopy($key,$language));
    http_response_code($valid?200:410);
    $heading=$copy(!$valid?'Ссылка недействительна или срок её действия истёк':($method==='POST'?'Регистрация подтверждена':'Подтверждение регистрации'));
    echo '<!doctype html><html lang="'.$escape($language).'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GENESIS — '.$heading.'</title><style>body{margin:0;background:#eee9dc;color:#132426;font:16px/1.6 sans-serif}main{max-width:540px;margin:8vh auto;padding:28px;background:#fffdf8;border-radius:12px}button{font:inherit;cursor:pointer;padding:12px 20px;background:#255b59;color:#fff;border:0;border-radius:8px}a{color:inherit}h1{line-height:1.3;overflow-wrap:anywhere}@media(prefers-color-scheme:dark){body{background:#132426;color:#eee9dc}main{background:#203537}button{background:#b8d6cf;color:#132426}}@media(max-width:600px){main{margin:24px 12px}}</style></head><body><main><p>GENESIS</p><h1>'.$heading.'</h1>';
    if($valid&&$method==='GET')echo '<p>'.$copy('Ваш аккаунт создан через Google. Подтвердите регистрацию. Ссылка действует 48 часов.').'</p><form method="post" action="/api/email/confirm"><input type="hidden" name="token" value="'.$escape($token).'"><button type="submit">'.$copy('Подтвердить регистрацию').'</button></form>';
    else echo '<p><a href="/">'.$copy('Открыть GENESIS').'</a></p>';
    echo '</main></body></html>';exit;
}

function genesisFinishSession(array $payload = ['ok' => true]): never
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool)$params['secure'], (bool)$params['httponly']);
    }
    session_destroy();
    genesisJson($payload);
}

function genesisSafeReturnTo(string $value): string
{
    $returnTo = trim($value);
    if (
        $returnTo === ''
        || !str_starts_with($returnTo, '/')
        || str_starts_with($returnTo, '//')
        || str_contains($returnTo, '\\')
        || preg_match('/[\x00-\x1F\x7F]/', $returnTo)
    ) {
        return '/';
    }
    return mb_substr($returnTo, 0, 2000);
}

function genesisOAuthRedirect(string $returnTo, ?string $error = null): never
{
    $safeReturnTo = genesisSafeReturnTo($returnTo);
    if ($error !== null && $error !== '') {
        $fragmentPosition = strpos($safeReturnTo, '#');
        $fragment = $fragmentPosition === false ? '' : substr($safeReturnTo, $fragmentPosition);
        $base = $fragmentPosition === false ? $safeReturnTo : substr($safeReturnTo, 0, $fragmentPosition);
        $separator = str_contains($base, '?') ? '&' : '?';
        $safeReturnTo = $base . $separator . 'auth_error=' . rawurlencode($error) . $fragment;
    }
    header('Cache-Control: no-store');
    header('Location: ' . genesisRelocationWebOrigin(genesisConfig(), $_SERVER) . $safeReturnTo, true, 302);
    exit;
}

function genesisObserveAndroid(callable $record): void
{
    try {
        $record();
    } catch (Throwable $error) {
        genesisLogError('Android activity observation failed.', $error);
    }
}

function genesisRequireGoogleUser(string $userId): array
{
    $user = genesisFindUser($userId);
    if ($user === null || genesisUserProvider($user) !== 'google') {
        genesisJson(['error' => 'GOOGLE_ACCOUNT_REQUIRED'], 403);
    }
    return $user;
}

function genesisRequireYandexUser(string $userId): array
{
    $user = genesisFindUser($userId);
    if ($user === null || genesisUserProvider($user) !== 'yandex') {
        genesisJson(['error' => 'YANDEX_ACCOUNT_REQUIRED'], 403);
    }
    return $user;
}

try {
    if ($path === 'donations/cloudtips/webhook') {
        if ($method !== 'POST') genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);
        $raw=file_get_contents('php://input',false,null,0,16385);
        if ($raw===false) genesisJson(['error'=>'CLOUDTIPS_INVALID_PAYLOAD'],400);
        genesisJson(genesisCloudTipsWebhook($raw,(string)($_SERVER['HTTP_X_CONTENT_HMAC']??''),(string)($_SERVER['CONTENT_TYPE']??'')));
    }
    if ($path === 'donations/cloudtips/checkout') {
        $owner=genesisRequireUserId();genesisRequireCsrf();
        if ($method !== 'POST') genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);
        if (genesisReadJson()!==[]) throw new InvalidArgumentException('DONATION_REQUEST_INVALID');
        genesisConsumeApiBudget($owner,'donation-checkout',30,4096,(int)($_SERVER['CONTENT_LENGTH']??0));
        genesisJson(genesisCloudTipsCheckout($owner));
    }
    if($path==='account/google-identities' || str_starts_with($path,'account/google-identities/')){
        $owner=genesisRequireUserId();genesisRequireGoogleUser($owner);header('Cache-Control: no-store');
        if($method==='GET' && count($segments)===2)genesisJson(['enabled'=>genesisGoogleIdentityManagementEnabled(),'identities'=>genesisGoogleLoginIdentities($owner),'fresh'=>isset($_SESSION['google_step_up'])&&($_SESSION['google_step_up']['expiresAt']??0)>time()]);
        if(!genesisGoogleIdentityManagementEnabled())throw new GenesisResourceLimitException(503,'GOOGLE_IDENTITY_MANAGEMENT_DISABLED');
        genesisRequireCsrf();$body=genesisReadJson();
        genesisConsumeApiBudget($owner,'google-identity-security',15,65536,(int)($_SERVER['CONTENT_LENGTH']??0));
        if($method==='POST'&&$path==='account/google-identities/primary'&&array_keys($body)===['identityId']){genesisGoogleSetPrimary($owner,(string)$body['identityId']);genesisJson(['ok'=>true]);}
        if($method==='POST'&&$path==='account/google-identities/disable'&&array_keys($body)===['identityId','replacementId']){genesisGoogleDisableLogin($owner,(string)$body['identityId'],(string)$body['replacementId']);genesisJson(['ok'=>true,'signInRequired'=>true]);}
        if($method==='POST'&&$path==='account/google-identities/recovery-code'&&$body===[])genesisJson(['code'=>genesisGoogleCreateRecoveryCode($owner)]);
        genesisJson(['error'=>'INVALID_IDENTITY_OPERATION'],400);
    }
    if($path==='account-recovery/status'||$path==='account-recovery/request'||$path==='account-recovery/complete'){
        header('Cache-Control: no-store');
        if($method==='GET'&&$path==='account-recovery/status')genesisJson(['enabled'=>(genesisConfig()['account_recovery_enabled']??false)===true,'csrf'=>(string)$_SESSION['csrf'],'candidate'=>($_SESSION['recovery_candidate']['expiresAt']??0)>time()?($_SESSION['recovery_candidate']['profile']['email']??null):null]);
        genesisRequireCsrf();
        genesisConsumeApiBudget(hash('sha256',(string)($_SERVER['REMOTE_ADDR']??'unknown')),'account-recovery',8,16384,(int)($_SERVER['CONTENT_LENGTH']??0));
        if($method!=='POST'||($_SESSION['recovery_candidate']['expiresAt']??0)<time())throw new GenesisResourceLimitException(403,'RECOVERY_GOOGLE_REQUIRED');
        $body=genesisReadJson();$candidate=$_SESSION['recovery_candidate']['profile'];
        if($path==='account-recovery/request'&&array_keys($body)===['sourceUserId','code']){
            genesisConsumeApiBudget(hash('sha256',(string)$body['sourceUserId']),'recovery-owner',5,16384);
            genesisJson(genesisGoogleCreateRecoveryRequest((string)$body['sourceUserId'],$candidate,(string)$body['code']));
        }
        if($path==='account-recovery/complete'&&array_keys($body)===['requestId']){
            $user=genesisGoogleCompleteRecovery((string)$body['requestId'],$candidate);unset($_SESSION['recovery_candidate']);
            genesisEstablishGoogleSession($user,$candidate['sub'],$candidate,'web');session_regenerate_id(true);genesisJson(['ok'=>true]);
        }
        genesisJson(['error'=>'RECOVERY_REQUEST_INVALID'],400);
    }
    if($path==='admin/account-recovery'||$path==='admin/account-recovery/review'){
        $reviewer=genesisRequireUserId();$user=genesisFindUser($reviewer);genesisRequireAdmin($user);header('Cache-Control: no-store');
        if(!in_array($reviewer,genesisConfig()['account_recovery_reviewers']??[],true))throw new GenesisResourceLimitException(403,'RECOVERY_REVIEW_FORBIDDEN');
        if($method==='GET'){
            $q=genesisDb()->query("SELECT id,user_id AS sourceUserId,candidate_email AS candidateEmail,proof_kind AS proofKind,state,reason,expires_at AS expiresAt,created_at AS createdAt FROM account_recovery_requests ORDER BY created_at DESC LIMIT 100");genesisJson(['requests'=>$q->fetchAll()]);
        }
        genesisRequireCsrf();$body=genesisReadJson();
        if($method==='POST'&&array_keys($body)===['requestId','approve','reason']&&is_bool($body['approve'])){genesisGoogleReviewRecovery($reviewer,(string)$body['requestId'],$body['approve'],(string)$body['reason']);genesisJson(['ok'=>true]);}
        genesisJson(['error'=>'RECOVERY_REQUEST_INVALID'],400);
    }
    if (str_starts_with($path, 'backup/v1/')) {
        $owner = genesisRequireUserId();
        header('Cache-Control: no-store');
        genesisConsumeApiBudget($owner, 'backup-v1', 30, 64 * 1024 * 1024, (int)($_SERVER['CONTENT_LENGTH'] ?? 0));
        if ($method === 'GET' && $path === 'backup/v1/status') genesisJson(genesisBackupStatus($owner));
        if ($method !== 'POST') genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);
        genesisRequireCsrf(); $body = genesisReadJson();
        if ($path === 'backup/v1/authorize') genesisJson(genesisBackupAuthorize($owner,$body));
        if ($path === 'backup/v1/server-snapshot') genesisJson(genesisBackupServerSnapshot($owner,$body));
        if ($path === 'backup/v1/preview') genesisJson(genesisBackupPreview($owner,$body));
        if ($path === 'backup/v1/commit') genesisJson(genesisBackupCommit($owner,$body));
        genesisJson(['error'=>'NOT_FOUND'],404);
    }
    if ($method !== 'GET' && preg_match('~^(?:workspace(?:/|$)|tasks(?:/|$)|mindmaps(?:/|$)|diary(?:/|$)|stoicheion-workspace$|aurora-workspace$|physis/v1/(?:records|rotate|vault)$|recovered-tasks(?:/|$))~D',$path)) {
        $owner=genesisRequireUserId();
        genesisBackupRequireGeneration($owner,$_SERVER['HTTP_X_GENESIS_DATA_GENERATION']??null);
    }
    if ($path==='recovered-tasks' || str_starts_with($path,'recovered-tasks/')) {
        $owner=genesisRequireUserId();header('Cache-Control: no-store');
        if($method==='GET' && $path==='recovered-tasks')genesisJson(['tasks'=>genesisRecoveredTasks($owner)]);
        genesisRequireCsrf();$id=$segments[1]??'';
        if($method==='PUT' && count($segments)===2)genesisJson(genesisSaveRecoveredTask($owner,$id,genesisReadJson()));
        if($method==='DELETE' && count($segments)===2){
            $body=genesisReadJson();
            if(array_keys($body)!==['expectedRevision']||!is_int($body['expectedRevision']))throw new InvalidArgumentException('RECOVERED_TASK_INVALID');
            genesisDeleteRecoveredTask($owner,$id,$body['expectedRevision']);genesisJson(['ok'=>true]);
        }
        genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);
    }
    if (($segments[0]??'')==='billing') {
        genesisEnforceApiBudget($method, $path, genesisCurrentUserId());
        require_once $serverRoot.'/src/billing-api.php'; genesisBillingRoute($method,$segments);
    }
    // Existing data remains readable after downgrade. Ordinary import/export requires
    // an active paid plan; shared mutations additionally require Business.
    $sharedDataExport = $method === 'POST' && count($segments) === 4
        && $segments[0] === 'shared' && $segments[1] === 'spaces' && $segments[3] === 'data-export';
    if ($sharedDataExport || $method === 'POST' && (
        $path === 'shared/data/preview' || $path === 'shared/data/apply'
        || count($segments) === 4 && $segments[0] === 'shared' && $segments[1] === 'spaces' && $segments[3] === 'import-project'))
        genesisRequireFeature(genesisRequireUserId(),'data-export');
    if (str_starts_with($path,'shared/') && in_array($method,['POST','PUT','PATCH'],true) && !$sharedDataExport)
        genesisRequireFeature(genesisRequireUserId(),str_starts_with($path,'shared/messenger') ? 'messenger' : 'shared-projects');
    if (str_starts_with($path,'assistant/')) genesisRequireFeature(genesisRequireUserId(),'assistant');
    if ($path==='tasks' || str_starts_with($path,'tasks/') || $path==='task-lists' || str_starts_with($path,'task-lists/'))
        genesisRequireFeature(genesisRequireUserId(),'calendar-sync');
    // Guard the whole namespace, including unknown/future nested/export routes, before
    // examining record IDs, parsing bodies, or accessing any Physis table.
    if ($path === 'physis' || str_starts_with($path, 'physis/')) {
        genesisPhysisRoute($method, $path);
    }
    $googleOnly = (bool)(genesisConfig()['google_only'] ?? false);
    if ($googleOnly && str_contains($path, 'yandex')) {
        genesisJson(['error' => 'NOT_FOUND'], 404);
    }
    $sessionUserId = genesisCurrentUserId();
    if ($sessionUserId !== null) {
        $sessionUser = genesisFindUser($sessionUserId);
        if ($sessionUser !== null && (genesisUserProvider($sessionUser) === 'unsupported'
            || ($googleOnly && genesisUserProvider($sessionUser) !== 'google'))) {
            unset($_SESSION['user_id'], $_SESSION['csrf'], $_SESSION['pending_local_link']);
        }
    }
    genesisEnforceApiBudget($method, $path, genesisCurrentUserId());
    if (($segments[0] ?? '') === 'partners' || (($segments[0] ?? '') === 'admin' && ($segments[1] ?? '') === 'partners')) {
        genesisPartnerRoute($method, $segments);
    }
    if ($path === 'weather/v1/current') {
        if ($method !== 'POST') genesisJson(['error'=>'METHOD_NOT_ALLOWED'],405);
        $owner=genesisSharedRequestUserId($method);
        $input=genesisReadJson();
        genesisConsumeApiBudget('user:'.$owner,'weather',60,65536,(int)($_SERVER['CONTENT_LENGTH']??0));
        genesisJson(['weather'=>genesisWeatherCurrent($input)]);
    }

    if ($method === 'GET' && $path === 'health') {
        $worker=genesisDb()->query('SELECT started_at AS startedAt,completed_at AS completedAt FROM background_worker_state WHERE id=1')->fetch();
        $channels=array_map(static fn($channel)=>array_intersect_key($channel,array_flip(['available','blocker'])),genesisNotificationCapabilities());
        genesisJson(['ok' => true, 'service' => 'GENESIS', 'privacyModel' => 2, 'time' => genesisNow(), 'backgroundWorker'=>$worker,'notificationChannels'=>$channels]);
    }

    if ($method === 'GET' && $path === 'auth/providers') {
        genesisJson(['google' => true, 'yandex' => genesisYandexConfigured()]);
    }

    if ($method === 'GET' && $path === 'ads/today') {
        genesisRequireUserId();
        $language = substr((string)($_GET['language'] ?? 'ru'), 0, 2);
        $country = strtoupper(substr((string)($_GET['country'] ?? ''), 0, 2));
        $platform = (string)($_GET['platform'] ?? 'web');
        $ads = genesisTodayAds($language, $country, $platform);
        if ($platform === 'android') {
            $publicRoot = dirname(__DIR__);
            $rawRelease = @file_get_contents($publicRoot . '/android-update.json');
            $release = $rawRelease === false ? null : json_decode($rawRelease, true);
            $notice = genesisAndroidUpdateNotice($language,
                (string)($_SERVER['HTTP_X_GENESIS_APP_VERSION'] ?? ''), is_array($release) ? $release : null);
            if ($notice !== null && is_file($publicRoot . '/downloads/GENESIS-Android-Native-' . $release['versionName'] . '.apk'))
                array_unshift($ads, $notice);
        }
        genesisJson(['ads' => $ads]);
    }

    if ($method === 'GET' && $path === 'android/download') {
        $publicRoot = dirname(__DIR__);
        $manifest = @file_get_contents($publicRoot . '/android-update.json');
        $release = $manifest === false ? null : json_decode($manifest, true);
        $version = is_array($release) ? ($release['versionName'] ?? null) : null;
        if (!is_string($version) || !preg_match('/\A[0-9]+(?:\.[0-9]+){1,3}\z/', $version)) {
            genesisJson(['error' => 'ANDROID_RELEASE_UNAVAILABLE'], 503);
        }
        $apkUrl = '/downloads/GENESIS-Android-Native-' . $version . '.apk';
        if (!is_file($publicRoot . $apkUrl)) {
            genesisJson(['error' => 'ANDROID_RELEASE_UNAVAILABLE'], 503);
        }
        $userId = genesisCurrentUserId();
        if ($userId !== null && genesisFindUser($userId) !== null) {
            genesisObserveAndroid(static fn() => genesisRecordAndroidDownload($userId, $version));
        }
        header('Cache-Control: no-store');
        header('Location: ' . $apkUrl, true, 302);
        exit;
    }

    if ($method === 'GET' && $path === 'session') {
        $userId = genesisCurrentUserId();
        $user = $userId ? genesisFindUser($userId) : null;
        if ($userId && $user === null) {
            unset($_SESSION['user_id']);
        }
        if ($user !== null) {
            genesisRenewSessionCookie();
            genesisObserveAndroid(static fn() => genesisReportAndroidClient((string)$user['id']));
            genesisObserveClientActivity((string)$user['id']);
        }
        genesisJson([
            'user' => $user ? genesisUserForClient($user) : null,
            'csrf' => (string)$_SESSION['csrf'],
            'loginId' => $user ? (string)($_SESSION['auth_login_id'] ?? '') : '',
        ]);
    }

    if ($method === 'GET' && $path === 'bootstrap') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null) {
            unset($_SESSION['user_id']);
            genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        }
        // Long Google enumeration must not lock sign-in/settings requests from
        // this device. Authentication and CSRF are already in this request's memory.
        session_write_close();
        $tasks = [];
        $syncWarning = null;
        try {
            if (genesisUserProvider($user) !== 'google') {
                $tasks = genesisLocalTasksForClient($user);
            } else {
                $tasks = genesisListAllGoogleTasks($user);
                $syncWarning = genesisGoogleTasksSyncWarning();
            }
        } catch (Throwable $googleError) {
            $syncWarning = $googleError->getMessage();
        }
        // A failed Google refresh can revoke the stored authorization. Always
        // return the post-sync connection state so clients can offer reconnect.
        $user = genesisFindUser($userId) ?? $user;
        $clientUser = genesisUserForClient($user);
        $response = [
            'user' => $clientUser,
            'csrf' => (string)$_SESSION['csrf'],
            'tasks' => $tasks,
            'deletedTaskIds' => genesisDeletedTaskIds($userId),
            'tasksDeferred' => genesisUserProvider($user) === 'yandex'
                && !array_reduce(genesisLocalAccountMembers($user),
                    static fn(bool $found, array $account): bool => $found || !empty($account['tasksConnected']), false),
            'taskLists' => genesisGoogleTaskListsForClient(),
            'workspace' => genesisWorkspaceForClient($user),
            'syncWarning' => $syncWarning,
        ];
        genesisObserveAndroid(static fn() => genesisReportAndroidClient($userId, 'ok', $syncWarning !== null ? 'warning'
            : (!empty($clientUser['googleTasksImportReady']) || !empty($clientUser['calendarConnected'])
                ? 'ok' : 'disconnected')));
        genesisJson($response);
    }

    if ($method === 'GET' && $path === 'assistant/status') {
        genesisRequireUserId();
        genesisJson([
            'available' => genesisAssistantAvailable(),
            'provider' => genesisAssistantProvider(),
            'model' => genesisAssistantModel(),
            'audioAvailable' => genesisAssistantAvailable(),
        ]);
    }

    if ($method === 'POST' && $path === 'assistant/plan') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        $user = genesisFindUser($userId);
        if ($user === null) {
            genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        }
        genesisJson(genesisCreateAssistantPlan(genesisReadJson()));
    }

    if ($method === 'GET' && $path === 'sync/tasks') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null) {
            genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        }
        session_write_close();
        $provider = genesisUserProvider($user);
        $local = $provider !== 'google';
        $tasks = $local ? genesisLocalTasksForClient($user) : genesisListAllGoogleTasks($user);
        genesisJson([
            'tasks' => $tasks,
            'deletedTaskIds' => genesisDeletedTaskIds($userId),
            'taskLists' => $local ? [] : genesisGoogleTaskListsForClient(),
            'syncedAt' => genesisNow(),
            'syncWarning' => $local ? null : genesisGoogleTasksSyncWarning(),
        ]);
    }

    if ($method === 'POST' && $path === 'auth/google/native/challenge') {
        genesisRequireCsrf();
        $clientId = trim((string)(genesisConfig()['google_client_id'] ?? ''));
        if ($clientId === '') {
            throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_NOT_CONFIGURED');
        }
        header('Cache-Control: no-store');
        genesisJson([
            'nonce' => genesisNativeChallenge($_SESSION, time()),
            'expiresIn' => 300,
            'serverClientId' => $clientId,
        ]);
    }

    if ($method === 'POST' && $path === 'auth/google/native') {
        genesisRequireCsrf();
        header('Cache-Control: no-store');
        $now = time();
        $challenge = genesisNativeConsumeChallenge($_SESSION, $now);
        $raw = file_get_contents('php://input', false, null, 0, 20001);
        if (!is_string($raw) || strlen($raw) > 20000) {
            throw new GenesisNativeAuthException(400, 'NATIVE_AUTH_INVALID_REQUEST');
        }
        try {
            $payload = json_decode($raw, true, 4, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new GenesisNativeAuthException(400, 'NATIVE_AUTH_INVALID_REQUEST');
        }
        if (!is_array($payload) || !is_string($payload['idToken'] ?? null)) {
            throw new GenesisNativeAuthException(400, 'NATIVE_AUTH_INVALID_REQUEST');
        }
        $profile = genesisVerifyNativeGoogleToken(
            $payload['idToken'],
            trim((string)(genesisConfig()['google_client_id'] ?? '')),
            $challenge,
            $now,
            static function () use ($now): array { return genesisNativeGoogleCertificates($_SESSION, $now); },
        );
        $linkAction = genesisFindUserByGoogleSub((string)$profile['sub']) !== null
            || genesisFindLinkedGoogleAccountBySub((string)$profile['sub']) !== null
            ? 'found'
            : 'created';
        $user = genesisUpsertGoogleUser($profile, [], false);
        if (!session_regenerate_id(true)) {
            throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_TEMPORARILY_UNAVAILABLE');
        }
        genesisEstablishGoogleSession($user, (string)$profile['sub'], $profile, 'native');
        unset($_SESSION['oauth_request']);
        genesisObserveAndroid(static fn() => genesisReportAndroidClient((string)$user['id']));
        genesisLogError('[AuthFlow] ' . ($linkAction === 'created' ? 'GOOGLE_LINK_CREATED' : 'GOOGLE_LINK_FOUND'));
        genesisJson([
            'user' => genesisUserForClient($user),
            'csrf' => (string)$_SESSION['csrf'],
            'googleLinkAction' => $linkAction,
        ]);
    }

    if ($method === 'POST' && $path === 'auth/google/native/services/config') {
        genesisRequireCsrf();
        genesisRequireGoogleUser(genesisRequireUserId());
        $clientId = trim((string)(genesisConfig()['google_client_id'] ?? ''));
        if ($clientId === '') throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_NOT_CONFIGURED');
        genesisJson(['serverClientId' => $clientId]);
    }

    if ($method === 'POST' && $path === 'auth/google/native/services') {
        genesisRequireCsrf();
        $userId = genesisRequireUserId();
        genesisRequireGoogleUser($userId);
        $payload = genesisReadJson();
        $code = is_string($payload['serverAuthCode'] ?? null) ? trim($payload['serverAuthCode']) : '';
        if ($code === '' || strlen($code) > 8192) {
            throw new InvalidArgumentException('Некорректный код авторизации Google.');
        }
        $tokens = genesisExchangeNativeGoogleCode($code);
        if (empty($tokens['access_token'])) throw new RuntimeException('Google не вернул токен доступа.');
        $profile = genesisGoogleUserInfo((string)$tokens['access_token']);
        $user = genesisPersistPrimaryGoogleAuthorization($userId, $profile, $tokens);
        $calendarWarning = null;
        if (genesisGoogleScopeGranted($user, GENESIS_GOOGLE_CALENDAR_SCOPE)) {
            try {
                $user = genesisEnsureGoogleCalendar($user);
                genesisLogError('[AuthFlow] CALENDAR_SCOPE_GRANTED');
            } catch (Throwable $calendarError) {
                $calendarWarning = 'Разрешение Calendar сохранено, но создание календаря пока не завершилось.';
                genesisLogError('[AuthFlow] CALENDAR_SCOPE_GRANTED; calendar initialization pending', $calendarError);
            }
        }
        if (genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
            genesisLogError('[AuthFlow] TASKS_SCOPE_GRANTED');
        }
        $user = genesisFindUser($userId) ?? $user;
        genesisJson([
            'user' => genesisUserForClient($user),
            'csrf' => (string)$_SESSION['csrf'],
            'syncWarning' => $calendarWarning,
        ]);
    }

    if ($method === 'GET' && $path === 'auth/yandex/start') {
        if (!genesisYandexConfigured()) genesisJson(['error' => 'YANDEX_NOT_CONFIGURED'], 503);
        $purpose = (string)($_GET['purpose'] ?? 'login') === 'link' ? 'link' : 'login';
        $linkOwner = null;
        if ($purpose === 'link') {
            $linkOwner = genesisRequireUserId();
            $owner = genesisFindUser($linkOwner);
            if ($owner === null || genesisUserProvider($owner) !== 'yandex') {
                genesisJson(['error' => 'LOCAL_ACCOUNT_REQUIRED'], 403);
            }
        }
        $returnTo = genesisSafeReturnTo((string)($_GET['return_to'] ?? '/'));
        $state = genesisBase64Url(random_bytes(32));
        $verifier = genesisBase64Url(random_bytes(64));
        $_SESSION['yandex_oauth_request'] = [
            'state' => $state,
            'verifier' => $verifier,
            'return_to' => $returnTo,
            'purpose' => $purpose,
            'owner_id' => $linkOwner,
            'issued_at' => time(),
        ];
        header('Cache-Control: no-store');
        header('Location: ' . genesisYandexAuthUrl(
            $state, genesisBase64Url(hash('sha256', $verifier, true)),
        ), true, 302);
        exit;
    }

    if ($method === 'GET' && $path === 'auth/yandex/calendar/start') {
        if (!genesisYandexConfigured()) genesisJson(['error' => 'YANDEX_NOT_CONFIGURED'], 503);
        $ownerId = genesisRequireUserId();
        $accountId = trim((string)($_GET['account_id'] ?? $ownerId));
        $member = genesisLocalMemberForOwner($ownerId, $accountId);
        if ($member === null || $member['provider'] !== 'yandex') genesisJson(['error' => 'YANDEX_ACCOUNT_REQUIRED'], 403);
        $state = genesisBase64Url(random_bytes(32));
        $verifier = genesisBase64Url(random_bytes(64));
        $_SESSION['yandex_oauth_request'] = [
            'state' => $state, 'verifier' => $verifier,
            'return_to' => genesisSafeReturnTo((string)($_GET['return_to'] ?? '/')),
            'purpose' => 'calendar', 'owner_id' => $ownerId, 'account_id' => $accountId,
            'issued_at' => time(),
        ];
        header('Cache-Control: no-store');
        header('Location: ' . genesisYandexAuthUrl(
            $state, genesisBase64Url(hash('sha256', $verifier, true)), true,
        ), true, 302);
        exit;
    }

    if ($method === 'POST' && $path === 'auth/yandex/native') {
        genesisRequireCsrf();
        if (!genesisYandexConfigured()) genesisJson(['error' => 'YANDEX_NOT_CONFIGURED'], 503);
        $payload = genesisReadJson();
        $token = is_string($payload['accessToken'] ?? null) ? trim($payload['accessToken']) : '';
        if ($token === '' || strlen($token) > 16384) genesisJson(['error' => 'INVALID_TOKEN'], 400);
        try {
            $profile = genesisYandexUserInfo($token);
            $newAccount = genesisFindUserByYandexUid((string)$profile['id']) === null;
            $user = genesisUpsertYandexUser($profile);
        } catch (DomainException $error) {
            genesisJson(['error' => 'ACCOUNT_CONFLICT'], 409);
        }
        if (!session_regenerate_id(true)) genesisJson(['error' => 'SESSION_UNAVAILABLE'], 503);
        $_SESSION['user_id'] = (string)$user['id'];
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
        unset($_SESSION['auth_identity'], $_SESSION['authenticated_at']);
        $_SESSION['auth_login_id'] = bin2hex(random_bytes(16));
        genesisObserveAndroid(static fn() => genesisReportAndroidClient((string)$user['id']));
        genesisJson(['user' => genesisUserForClient($user), 'csrf' => (string)$_SESSION['csrf'],
            'newAccount' => $newAccount]);
    }

    if ($method === 'GET' && $path === 'auth/yandex/callback') {
        $request = $_SESSION['yandex_oauth_request'] ?? null;
        unset($_SESSION['yandex_oauth_request']);
        $state = (string)($_GET['state'] ?? '');
        if (!is_array($request) || $state === '' || !hash_equals((string)($request['state'] ?? ''), $state)
            || (int)($request['issued_at'] ?? 0) < time() - 600) {
            genesisOAuthRedirect('/', 'yandex_invalid_state');
        }
        $returnTo = genesisSafeReturnTo((string)($request['return_to'] ?? '/'));
        if (trim((string)($_GET['error'] ?? '')) !== '') {
            genesisOAuthRedirect($returnTo, ($_GET['error'] ?? '') === 'access_denied' ? 'yandex_access_denied' : 'yandex_oauth_failed');
        }
        $code = trim((string)($_GET['code'] ?? ''));
        if ($code === '' || strlen($code) > 8192) genesisOAuthRedirect($returnTo, 'yandex_oauth_failed');
        try {
            $tokens = genesisExchangeYandexCode($code, (string)($request['verifier'] ?? ''));
            $profile = genesisYandexUserInfo((string)($tokens['access_token'] ?? ''));
            if (($request['purpose'] ?? 'login') === 'calendar') {
                $ownerId = (string)($request['owner_id'] ?? '');
                $accountId = (string)($request['account_id'] ?? '');
                if ($ownerId === '' || genesisCurrentUserId() !== $ownerId
                    || genesisLocalMemberForOwner($ownerId, $accountId) === null) {
                    genesisOAuthRedirect($returnTo, 'session_expired');
                }
                genesisYandexCalendarConnectOauth($accountId, $tokens);
                genesisOAuthRedirect($returnTo);
            }
            if (($request['purpose'] ?? 'login') === 'link') {
                $ownerId = (string)($request['owner_id'] ?? '');
                if ($ownerId === '' || genesisCurrentUserId() !== $ownerId) {
                    genesisOAuthRedirect($returnTo, 'session_expired');
                }
                genesisBeginLocalLink($ownerId, 'yandex', $profile);
                genesisOAuthRedirect($returnTo);
            }
            $user = genesisUpsertYandexUser($profile);
            if (!session_regenerate_id(true)) throw new RuntimeException('Session could not be renewed.');
            $_SESSION['user_id'] = (string)$user['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(24));
            unset($_SESSION['auth_identity'], $_SESSION['authenticated_at']);
            $_SESSION['auth_login_id'] = bin2hex(random_bytes(16));
        } catch (DomainException $error) {
            genesisLogError('Yandex account conflict.', $error);
            genesisOAuthRedirect($returnTo, ($request['purpose'] ?? '') === 'calendar'
                ? 'yandex_calendar_failed' : 'account_conflict');
        } catch (Throwable $error) {
            genesisLogError('Yandex OAuth callback failed.', $error);
            genesisOAuthRedirect($returnTo, ($request['purpose'] ?? '') === 'calendar'
                ? 'yandex_calendar_failed' : 'yandex_oauth_failed');
        }
        genesisOAuthRedirect($returnTo);
    }

    if ($method === 'GET' && $path === 'auth/google/start') {
        $requestedPurpose = (string)($_GET['purpose'] ?? 'login');
        $purpose = in_array($requestedPurpose, ['services', 'link', 'reauth', 'recovery'], true) ? $requestedPurpose : 'login';
        if(in_array($purpose,['reauth','recovery'],true)&&!genesisGoogleIdentityManagementEnabled())throw new GenesisResourceLimitException(503,'GOOGLE_IDENTITY_MANAGEMENT_DISABLED');
        $returnTo = genesisSafeReturnTo((string)($_GET['return_to'] ?? '/'));
        $loginHint = null;
        $requestUserId = null;
        if (in_array($purpose, ['services', 'link', 'reauth'], true)) {
            $requestUserId = genesisRequireUserId();
            $requestUser = genesisFindUser($requestUserId);
            if ($requestUser === null) {
                unset($_SESSION['user_id']);
                genesisOAuthRedirect($returnTo, 'session_expired');
            }
            if (genesisUserProvider($requestUser) !== 'google') genesisOAuthRedirect($returnTo, 'account_mismatch');
            if($purpose==='link'){
                genesisBackupRequirePaid($requestUserId);
                if(genesisGoogleIdentityManagementEnabled())genesisGoogleRequireFresh($requestUserId);
            }
            if ($purpose === 'services') {
                genesisRequireFeature($requestUserId,'calendar-sync');
                $loginHint = (string)$requestUser['email'];
            }
        }
        $state = genesisBase64Url(random_bytes(32));
        $verifier = genesisBase64Url(random_bytes(64));
        $nonce = genesisBase64Url(random_bytes(32));
        $_SESSION['oauth_request'] = [
            'state' => $state,
            'verifier' => $verifier,
            'return_to' => $returnTo,
            'purpose' => $purpose,
            'user_id' => $requestUserId,
            'issued_at' => time(),
            'nonce' => $nonce,
            'security_epoch' => isset($requestUser)?(int)$requestUser['security_epoch']:null,
            'partner_invitation' => genesisPartnerOAuthInvitation($purpose),
        ];
        header('Cache-Control: no-store');
        header('Location: ' . genesisGoogleAuthUrl(
            $state,
            genesisBase64Url(hash('sha256', $verifier, true)),
            $purpose,
            $loginHint,
            $nonce,
        ), true, 302);
        exit;
    }

    if ($method === 'GET' && $path === 'auth/google/callback') {
        $request = $_SESSION['oauth_request'] ?? null;
        $state = (string)($_GET['state'] ?? '');
        $requestState = is_array($request) ? (string)($request['state'] ?? '') : '';
        $issuedAt = is_array($request) ? (int)($request['issued_at'] ?? 0) : 0;
        if ($state === '' || $requestState === '' || !hash_equals($requestState, $state) || $issuedAt < time() - 600) {
            unset($_SESSION['oauth_request']);
            genesisOAuthRedirect('/', 'invalid_state');
        }
        unset($_SESSION['oauth_request']);

        $returnTo = genesisSafeReturnTo((string)($request['return_to'] ?? '/'));
        $googleError = trim((string)($_GET['error'] ?? ''));
        if ($googleError !== '') {
            genesisPartnerFinishOAuth($request['partner_invitation'] ?? null);
            genesisOAuthRedirect($returnTo, $googleError === 'access_denied' ? 'access_denied' : 'oauth_failed');
        }
        $code = (string)($_GET['code'] ?? '');
        if ($code === '') {
            genesisPartnerFinishOAuth($request['partner_invitation'] ?? null);
            genesisOAuthRedirect($returnTo, 'oauth_failed');
        }

        try {
            $tokens = genesisExchangeGoogleCode($code, (string)($request['verifier'] ?? ''));
            if (empty($tokens['access_token'])) {
                throw new RuntimeException('Google did not return an access token.');
            }
            $profile = genesisGoogleUserInfo((string)$tokens['access_token']);
            if (empty($profile['sub']) || empty($profile['email'])) {
                throw new RuntimeException('Google profile is incomplete.');
            }

            $purpose = (string)($request['purpose'] ?? 'login');
            if($purpose==='reauth'){
                $owner=genesisRequireUserId();
                if(($request['user_id']??null)!==$owner||(int)genesisFindUser($owner)['security_epoch']!==($request['security_epoch']??null))throw new GenesisResourceLimitException(409,'GOOGLE_AUTH_STALE');
                genesisGoogleAcceptStepUp($owner,(string)($tokens['id_token']??''),['hash'=>hash('sha256',$request['nonce']),'issuedAt'=>$request['issued_at']]);
                genesisOAuthRedirect($returnTo);
            }
            if($purpose==='recovery'){
                if((genesisConfig()['account_recovery_enabled']??false)!==true)throw new GenesisResourceLimitException(503,'ACCOUNT_RECOVERY_DISABLED');
                $candidate=genesisVerifyNativeGoogleToken((string)($tokens['id_token']??''),(string)genesisConfig()['google_client_id'],['hash'=>hash('sha256',$request['nonce']),'issuedAt'=>$request['issued_at']],time(),static fn():array=>genesisNativeGoogleCertificates($_SESSION,time()));
                $claims=json_decode(genesisNativeDecodeSegment(explode('.',$tokens['id_token'])[1]),true,16,JSON_THROW_ON_ERROR);
                if(!is_int($claims['auth_time']??null)||$claims['auth_time']<$request['issued_at']-60||$claims['auth_time']>time()+60)throw new GenesisResourceLimitException(403,'GOOGLE_FRESH_AUTH_NOT_PROVEN');
                $_SESSION['recovery_candidate']=['profile'=>$candidate,'expiresAt'=>time()+300];
                genesisOAuthRedirect('/?recovery=1');
            }
            if($purpose==='link'&&genesisGoogleIdentityManagementEnabled()){
                $owner=genesisRequireUserId();
                if(($request['user_id']??null)!==$owner||(int)genesisFindUser($owner)['security_epoch']!==($request['security_epoch']??null))throw new GenesisResourceLimitException(409,'GOOGLE_AUTH_STALE');
                $profile=genesisVerifyNativeGoogleToken((string)($tokens['id_token']??''),(string)genesisConfig()['google_client_id'],['hash'=>hash('sha256',$request['nonce']),'issuedAt'=>$request['issued_at']],time(),static fn():array=>genesisNativeGoogleCertificates($_SESSION,time()));
                genesisLinkGoogleAccount($owner,$profile,[]);
                $_SESSION['security_epoch']=(int)genesisFindUser($owner)['security_epoch'];unset($_SESSION['google_step_up']);
                genesisOAuthRedirect($returnTo);
            }
            if (in_array($purpose, ['services', 'link'], true)) {
                $requestUserId = (string)($request['user_id'] ?? '');
                $currentUserId = genesisCurrentUserId();
                $currentUser = $currentUserId ? genesisFindUser($currentUserId) : null;
                if ($requestUserId === '' || $currentUserId !== $requestUserId || $currentUser === null) {
                    genesisOAuthRedirect($returnTo, 'session_expired');
                }
                if ($purpose === 'services' && !hash_equals((string)$currentUser['google_sub'], (string)$profile['sub'])) {
                    genesisOAuthRedirect($returnTo, 'account_mismatch');
                }
                if (!genesisGoogleTokenHasScopes($tokens, GENESIS_GOOGLE_SERVICE_SCOPES)) {
                    genesisOAuthRedirect($returnTo, 'missing_permissions');
                }
                if ($purpose === 'services' && empty($tokens['refresh_token']) && empty($currentUser['refresh_token_enc'])) {
                    throw new RuntimeException('Google did not return a refresh token for offline synchronization.');
                }
                if ($purpose === 'link') {
                    genesisLinkGoogleAccount($requestUserId, $profile, $tokens);
                    $_SESSION['user_id'] = $requestUserId;
                    session_regenerate_id(true);
                } else {
                    $user = genesisUpsertGoogleUser($profile, $tokens, true, true);
                    genesisEstablishGoogleSession($user, (string)$profile['sub'], $profile, 'web');
                    session_regenerate_id(true);
                    try {
                        genesisEnsureGoogleCalendar($user);
                    } catch (Throwable $calendarError) {
                        $_SESSION['calendar_error'] = $calendarError->getMessage();
                    }
                }
            } else {
                $user = genesisUpsertGoogleUser($profile, $tokens, false, true, $request['partner_invitation'] ?? null);
                genesisEstablishGoogleSession($user, (string)$profile['sub'], $profile, 'web');
                session_regenerate_id(true);
            }
        } catch (Throwable $oauthError) {
            genesisPartnerFinishOAuth($request['partner_invitation'] ?? null);
            genesisLogError('Google OAuth callback failed.', $oauthError);
            genesisOAuthRedirect($returnTo, 'oauth_failed');
        }
        genesisPartnerFinishOAuth($request['partner_invitation'] ?? null);
        genesisOAuthRedirect($returnTo);
    }

    if ($method === 'POST' && $path === 'auth/password/login') {
        genesisJson(['error' => 'Вход по паролю отключён. Используйте безопасную авторизацию Google OAuth.'], 410);
    }

    if ($method === 'POST' && $path === 'auth/password/set') {
        genesisJson(['error' => 'Пароли GENESIS отключены. Авторизация выполняется только через Google OAuth.'], 410);
    }

    if ($method === 'POST' && $path === 'auth/logout') {
        genesisRequireCsrf();
        $body=genesisReadJson();
        if (is_string($body['habitReminderDeviceKey']??null) && isset($_SESSION['user_id'])) {
            $status=genesisHabitReminderStatus((string)$_SESSION['user_id'],$body['habitReminderDeviceKey']);
            if($status['device'])genesisHabitReminderDelete((string)$_SESSION['user_id'],$status['device']['id']);
        }
        if(is_string($body['adviceNotificationDeviceId']??null)&&isset($_SESSION['user_id']))
            genesisAdviceNotificationDelete((string)$_SESSION['user_id'],$body['adviceNotificationDeviceId']);
        genesisFinishSession();
    }

    if (($segments[0] ?? null) === 'habit-reminders') {
        $userId=genesisRequireUserId();
        if($method!=='GET')genesisRequireCsrf();
        if($method==='GET'&&$path==='habit-reminders/status')genesisJson(genesisHabitReminderStatus($userId,isset($_GET['deviceKey'])?(string)$_GET['deviceKey']:null));
        if($method==='POST'&&$path==='habit-reminders/devices')genesisJson(genesisHabitReminderRegister($userId,genesisReadJson()),201);
        if($method==='DELETE'&&count($segments)===3&&$segments[1]==='devices'){
            $body=genesisReadJson();
            if(!is_int($body['expectedRevision']??null))throw new InvalidArgumentException('INVALID_HABIT_REMINDER_REVISION');
            genesisHabitReminderDelete($userId,$segments[2],$body['expectedRevision']);genesisJson(['ok'=>true]);
        }
        if($method==='PUT'&&$path==='habit-reminders/plan')genesisJson(genesisHabitReminderRefresh($userId,genesisReadJson()));
        if($method==='GET'&&count($segments)===3&&$segments[1]==='deliveries')genesisJson(genesisHabitReminderAccess($userId,$segments[2]));
        if($method==='POST'&&count($segments)===4&&$segments[1]==='deliveries'&&$segments[3]==='snooze')genesisJson(genesisHabitReminderSnooze($userId,$segments[2]));
    }

    if (($segments[0] ?? null) === 'shared') {
        // Shared routes do not write the session. Release its file lock before
        // Google I/O, downloads or queries so parallel reads are not queued behind them.
        $userId = genesisSharedRequestUserId($method);
        if (($segments[1] ?? '') === 'messenger') {
            $resource=$segments[2]??'';$id=$segments[3]??'';
            if ($resource==='contacts' && count($segments)===3 && in_array($method,['GET','POST','DELETE'],true)) genesisJson(genesisMessengerContacts($userId,$method==='GET'?null:genesisReadJson(),$method));
            if ($resource==='blocks' && count($segments)===3 && $method==='POST') genesisJson(genesisMessengerBlock($userId,genesisReadJson()));
            if ($resource==='devices' && count($segments)===3 && in_array($method,['GET','POST'],true)) genesisJson(genesisMessengerDevices($userId,$method==='GET'?null:genesisReadJson()));
            if ($resource==='devices' && count($segments)===4 && $method==='DELETE') genesisJson(genesisMessengerRevokeDevice($userId,$id));
            if ($resource==='projects' && count($segments)===3 && $method==='GET') genesisJson(genesisMessengerProjects($userId));
            if ($resource==='conversations') {
                if (count($segments)===3 && $method==='GET') genesisJson(genesisMessengerInbox($userId));
                if (count($segments)===3 && $method==='POST') genesisJson(genesisMessengerCreate($userId,genesisReadJson()),201);
                if (count($segments)===4 && $method==='GET') genesisJson(genesisMessengerChat($userId,$id));
                if (count($segments)===5) {
                    if ($segments[4]==='visibility' && $method==='POST') genesisJson(genesisMessengerVisibility($userId,$id,genesisReadJson()));
                    if ($segments[4]==='membership' && $method==='POST') genesisJson(genesisMessengerMembership($userId,$id,genesisReadJson()));
                    if ($segments[4]==='read' && $method==='POST') genesisJson(genesisMessengerRead($userId,$id,genesisReadJson()));
                    if ($segments[4]==='messages' && $method==='GET') genesisJson(genesisMessengerMessages($userId,$id,(int)($_GET['before']??0),isset($_GET['deviceId'])?(string)$_GET['deviceId']:null));
                    if ($segments[4]==='messages' && $method==='POST') genesisJson(genesisMessengerSave($userId,$id,genesisReadJson()),201);
                }
                if (count($segments)===6 && $segments[4]==='messages' && in_array($method,['PATCH','DELETE'],true)) genesisJson(genesisMessengerSave($userId,$id,genesisReadJson(),$method,$segments[5]));
            }
        }
        if ($path === 'shared/messaging/key') {
            if ($method === 'GET') genesisJson(genesisSharedMessagingKey($userId));
            if ($method === 'POST') genesisJson(genesisSharedMessagingKey($userId,genesisReadJson()));
        }
        if ($method === 'GET' && $path === 'shared/messaging/inbox') genesisJson(genesisSharedPrivateInbox($userId));
        if ($method === 'GET' && $path === 'shared/messaging/contacts') genesisJson(genesisSharedPrivateContacts($userId,$_GET['q'] ?? '',$_GET['cursor'] ?? null));
        if (count($segments) === 3 && $segments[1] === 'private-conversations' && $method === 'GET') genesisJson(genesisSharedPrivateDestination($userId,$segments[2]));
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'private-conversations' && $method === 'POST') {
            genesisJson(genesisSharedPrivateConversation($userId,$segments[2],genesisReadJson()));
        }
        if (count($segments) >= 4 && $segments[1] === 'private-conversations') {
            $conversationId = $segments[2];
            if (count($segments) === 4 && $segments[3] === 'invitation' && $method === 'POST') {
                genesisJson(genesisSharedRespondPrivateInvitation($userId,$conversationId,genesisReadJson()));
            }
            if (count($segments) === 4 && $segments[3] === 'messages') {
                if ($method === 'GET') genesisJson(genesisSharedPrivateMessages($userId,$conversationId,(int)($_GET['before'] ?? 0)));
                if ($method === 'POST') genesisJson(genesisSharedPrivateSave($userId,$conversationId,genesisReadJson()),201);
                if ($method === 'DELETE') { genesisSharedPrivateClear($userId,$conversationId); genesisJson(['ok'=>true]); }
            }
            if (count($segments) === 5 && $segments[3] === 'messages' && in_array($method,['PATCH','DELETE'],true)) {
                genesisJson(genesisSharedPrivateSave($userId,$conversationId,genesisReadJson(),$method,$segments[4]));
            }
            if (count($segments) === 4 && $segments[3] === 'read' && $method === 'POST') {
                genesisSharedPrivateRead($userId,$conversationId,genesisReadJson()); genesisJson(['ok'=>true]);
            }
            if ($segments[3] === 'files' && count($segments) === 6 && ctype_digit($segments[5])) {
                if ($method === 'GET') genesisJson(genesisSharedPrivateFileChunk($userId,$conversationId,$segments[4],(int)$segments[5]));
                if ($method === 'PUT') genesisJson(genesisSharedPrivateFileChunk($userId,$conversationId,$segments[4],(int)$segments[5],genesisReadJson()));
            }
            if ($segments[3] === 'files' && count($segments) === 5 && $method === 'DELETE') { genesisSharedPrivateDiscardFile($userId,$conversationId,$segments[4]); genesisJson(['ok'=>true]); }
        }
        if ($method === 'GET' && $path === 'shared/overview') genesisJson(['overview' => genesisSharedOverview($userId, isset($_GET['spaceId']) ? (string)$_GET['spaceId'] : null)]);
        if ($path === 'shared/notification-settings') {
            if ($method === 'GET') genesisJson(genesisNotificationSettings($userId));
            if ($method === 'PUT') genesisJson(genesisNotificationSavePreferences($userId,genesisReadJson()));
        }
        if ($method === 'PUT' && $path === 'shared/notification-context') genesisJson(genesisNotificationDeviceContext($userId,genesisReadJson()));
        if ($method === 'POST' && $path === 'shared/notification-settings/retry') genesisJson(genesisNotificationRetry($userId));
        if ($method === 'POST' && $path === 'shared/push-subscriptions') genesisJson(genesisNotificationPushRegister($userId,genesisReadJson()),201);
        if (count($segments) === 3 && $segments[1] === 'push-subscriptions' && $method === 'DELETE') { genesisNotificationPushDelete($userId,$segments[2]); genesisJson(['ok'=>true]); }
        if (count($segments) === 3 && $segments[1] === 'push-deliveries' && $method === 'GET') genesisJson(genesisNotificationDeliveryAccess($userId,$segments[2]));
        if (count($segments) === 4 && $segments[1] === 'notifications' && $segments[3] === 'destination' && $method === 'GET') genesisJson(genesisNotificationDestination($userId,$segments[2]));
        if (count($segments) === 6 && $segments[1] === 'projects' && $segments[3] === 'tasks' && $segments[5] === 'watch') {
            if ($method === 'GET') genesisJson(genesisSharedTaskWatch($userId,$segments[2],$segments[4]));
            if ($method === 'PUT') genesisJson(genesisSharedTaskWatch($userId,$segments[2],$segments[4],genesisReadJson()));
        }
        if (count($segments)===4 && $segments[1]==='projects' && $segments[3]==='comments') {
            if ($method==='GET') genesisJson(['comments'=>genesisSharedProjectComments($userId,$segments[2],null,isset($_GET['board'])?(string)$_GET['board']:null)]);
            if ($method==='POST') genesisJson(['comments'=>genesisSharedProjectComments($userId,$segments[2],genesisReadJson())],201);
        }
        if ($method === 'GET' && $path === 'shared/inbox') {
            genesisJson(genesisSharedInbox($userId, (string)($_GET['before'] ?? ''), ($_GET['unread'] ?? '') === '1'));
        }
        if ($method === 'POST' && $path === 'shared/inbox/read') {
            genesisSharedReadInbox($userId, genesisReadJson()); genesisJson(['ok' => true]);
        }
        if ($method === 'POST' && count($segments) === 6 && $segments[1] === 'projects' && $segments[3] === 'tasks' && $segments[5] === 'read') {
            genesisJson(genesisSharedReadTaskUpdates($userId, $segments[2], $segments[4], genesisReadJson()));
        }
        if ($method === 'GET' && count($segments) === 4 && $segments[1] === 'tasks' && $segments[3] === 'image') {
            $image = genesisSharedReadTaskImage($userId, $segments[2]);
            header('Content-Type: ' . $image['type']); header('Cache-Control: private, no-store');
            header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
            header('Content-Length: ' . strlen($image['bytes'])); echo $image['bytes']; exit;
        }
        if ($method === 'GET' && count($segments) === 5 && $segments[1] === 'tasks' && $segments[3] === 'attachments') {
            $file = genesisSharedReadTaskAttachment($userId, $segments[2], $segments[4]);
            header('Content-Type: ' . $file['type']); header('Cache-Control: private, no-store');
            header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
            header("Content-Disposition: attachment; filename=\"download\"; filename*=UTF-8''" . rawurlencode($file['name']));
            header('Content-Length: ' . strlen($file['bytes'])); echo $file['bytes']; exit;
        }
        if ($method === 'GET' && count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'cover') {
            $cover = genesisSharedReadCover($userId, $segments[2]);
            header('Content-Type: ' . $cover['type']); header('Cache-Control: private, no-store');
            header('Content-Length: ' . strlen($cover['bytes'])); echo $cover['bytes']; exit;
        }
        if ($method === 'GET' && $path === 'shared/spaces') {
            genesisJson(['spaces' => genesisSharedSpaces($userId),
                'ownedProjectQuota'=>genesisSharedProjectQuota(genesisSharedUserResourceUsage($userId,'shared-projects'))]);
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'participants') {
            if ($method === 'GET') genesisJson(genesisSharedSpaceParticipants($userId, $segments[2]));
            if ($method === 'POST') {
                $input = genesisReadJson();
                if (!isset($input['active']) || !is_bool($input['active'])) throw new InvalidArgumentException('INVALID_PRESENCE');
                if (!is_string($input['clientId'] ?? null)) throw new InvalidArgumentException('INVALID_PRESENCE');
                genesisJson(genesisSharedSpaceParticipants($userId, $segments[2], $input['active'], $input['clientId']));
            }
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'labels') {
            if ($method === 'GET') genesisJson(['labels' => genesisSharedLabels($userId, $segments[2])]);
            if ($method === 'POST') genesisJson(['label' => genesisSharedSaveLabel($userId, $segments[2], null, genesisReadJson())], 201);
        }
        if (count($segments) === 5 && $segments[1] === 'spaces' && $segments[3] === 'labels') {
            if ($method === 'PATCH') genesisJson(['label' => genesisSharedSaveLabel($userId, $segments[2], $segments[4], genesisReadJson())]);
            if ($method === 'DELETE') { genesisSharedDeleteLabel($userId, $segments[2], $segments[4], genesisReadJson()); genesisJson(['ok' => true]); }
        }
        if ($method === 'GET' && count($segments) === 4 && $segments[1] === 'projects' && $segments[3] === 'activity') {
            genesisJson(genesisSharedActivity($userId, $segments[2], isset($_GET['taskId']) ? (string)$_GET['taskId'] : null,
                isset($_GET['boardId']) ? (string)$_GET['boardId'] : null, (string)($_GET['before'] ?? '')));
        }
        if ($method === 'GET' && $path === 'shared/task-lists') {
            genesisJson(['lists' => genesisSharedTaskLists($userId)]);
        }
        if (count($segments) === 3 && $segments[0] === 'shared' && $segments[1] === 'spaces') {
            if ($method === 'GET') genesisJson(genesisSharedSpaceSettings($userId, $segments[2]));
            if ($method === 'PATCH') genesisJson(['space' => genesisSharedUpdateSpace($userId, $segments[2], genesisReadJson())]);
            if ($method === 'DELETE') {
                genesisSharedDeleteSpace($userId, $segments[2], genesisReadJson()); genesisJson(['ok' => true]);
            }
        }
        if ($method === 'DELETE' && count($segments) === 5 && $segments[1] === 'spaces' && $segments[3] === 'invitations') {
            genesisSharedRevokeSpaceInvitation($userId, $segments[2], $segments[4]); genesisJson(['ok' => true]);
        }
        if ($method === 'POST' && $path === 'shared/spaces') {
            genesisJson(['space' => genesisSharedCreateSpace($userId, genesisReadJson())], 201);
        }
        if (count($segments) === 4 && $segments[0] === 'shared' && $segments[1] === 'spaces' && $segments[3] === 'ui') {
            if ($method === 'GET') genesisJson(genesisSharedUiState($userId, $segments[2]));
            if ($method === 'PATCH') genesisJson(genesisSharedUiState($userId, $segments[2], genesisReadJson()));
        }
        if ($method === 'POST' && count($segments) === 4 && $segments[0] === 'shared'
            && $segments[1] === 'spaces' && $segments[3] === 'invitations') {
            genesisJson(['invitation' => genesisSharedSpaceInvite($userId, $segments[2], genesisReadJson())], 201);
        }
        if ($method === 'GET' && $path === 'shared/invitations') {
            genesisJson(['invitations' => array_merge(genesisSharedInvitations($userId), genesisSharedSpaceInvitations($userId))]);
        }
        if ($method === 'GET' && $path === 'shared/notifications') {
            genesisJson(['notifications' => genesisSharedNotifications($userId)]);
        }
        if ($method === 'POST' && $path === 'shared/notifications/read') {
            genesisSharedReadNotifications($userId, genesisReadJson());
            genesisJson(['ok' => true]);
        }
        if ($method === 'GET' && $path === 'shared/calendar/previews') {
            $from=genesisSharedTaskDate($_GET['from']??null);$to=genesisSharedTaskDate($_GET['to']??null);
            if (!$from || !$to) throw new InvalidArgumentException('INVALID_SHARED_CALENDAR_RANGE');
            genesisJson(genesisSharedCalendarPreviews($userId,$from,$to,genesisSharedReadTaskFilter($_GET['filter']??null)));
        }
        if ($method === 'GET' && $path === 'shared/calendar/tasks') {
            $from=genesisSharedTaskDate($_GET['from']??null);$to=genesisSharedTaskDate($_GET['to']??null);
            if (!$from || !$to || $from>$to) throw new InvalidArgumentException('INVALID_SHARED_CALENDAR_RANGE');
            genesisJson(genesisSharedQueryTasks($userId,['dueFrom'=>$from,'dueTo'=>$to,'completion'=>'open'],$_GET['cursor']??null,100,'dueDate'));
        }
        if ($method === 'POST' && count($segments)===6 && $segments[1]==='projects' && $segments[3]==='tasks' && $segments[5]==='archive') {
            genesisRequireCsrf();genesisJson(genesisSharedArchiveTask($userId,$segments[2],$segments[4],genesisReadJson()));
        }
        if ($method === 'POST' && count($segments)===7 && $segments[1]==='spaces' && $segments[3]==='trash' && $segments[4]==='task' && $segments[6]==='purge') {
            genesisRequireCsrf();genesisJson(genesisSharedPurgeTask($userId,$segments[2],$segments[5],genesisReadJson()));
        }
        if ($method === 'GET' && $path === 'shared/tasks') {
            genesisJson(genesisSharedQueryTasks($userId,genesisSharedReadTaskFilter($_GET['filter']??null),$_GET['cursor']??null,(int)($_GET['limit']??100),(string)($_GET['sort']??'position')));
        }
        if ($method === 'GET' && count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'tasks') {
            genesisJson(['task'=>genesisSharedGetTask($userId,$segments[2],$segments[4],($_GET['archived']??'')==='true')]);
        }
        if ($method === 'POST' && count($segments) === 6 && $segments[1] === 'projects' && $segments[3] === 'tasks' && $segments[5] === 'convert-checklist') {
            genesisJson(genesisSharedConvertChecklistItem($userId,$segments[2],$segments[4],genesisReadJson()));
        }
        if($path==='shared/bulk'&&$method==='GET')genesisJson(genesisSharedBulkOperations($userId,$_GET['cursor']??null));
        if($path==='shared/bulk/scope'&&$method==='POST'){
            genesisRequireCsrf();$input=genesisReadJson();
            if(!is_array($input['selection']??null)||isset($input['cursor'])&&!is_string($input['cursor']))throw new InvalidArgumentException('BULK_INVALID');
            genesisJson(genesisSharedBulkScope($userId,$input['selection'],$input['cursor']??null));
        }
        if($path==='shared/bulk/preview'&&$method==='POST'){
            genesisRequireCsrf();genesisJson(genesisSharedBulkPreview($userId,genesisReadJson()),201);
        }
        if(count($segments)===3&&$segments[1]==='bulk'&&$method==='GET'){
            $after=$_GET['after']??'0';
            if(!is_string($after)||!ctype_digit($after)||strlen($after)>16)throw new InvalidArgumentException('BULK_PAGE_INVALID');
            genesisJson(genesisSharedBulkReport($userId,$segments[2],(int)$after));
        }
        if(count($segments)===4&&$segments[1]==='bulk'&&$method==='POST'){
            genesisRequireCsrf();
            $input=genesisReadJson();$after=$input['after']??0;
            if(!is_int($after)||$after<0)throw new InvalidArgumentException('BULK_PAGE_INVALID');
            $report=match($segments[3]){
                'confirm'=>genesisSharedBulkConfirm($userId,$segments[2]),'cancel'=>genesisSharedBulkCancel($userId,$segments[2]),
                'advance'=>genesisSharedBulkAdvance($userId,$segments[2]),'resume'=>genesisSharedBulkResume($userId,$segments[2]),
                default=>throw new InvalidArgumentException('BULK_INVALID'),
            };
            genesisJson($after>0?genesisSharedBulkReport($userId,$segments[2],$after):$report);
        }
        if ($path === 'shared/views') {
            if($method==='GET')genesisJson(genesisSharedViews($userId,isset($_GET['spaceId'])&&$_GET['spaceId']!==''?(string)$_GET['spaceId']:null,$_GET['cursor']??null));
            if($method==='POST')genesisJson(['view'=>genesisSharedViewSave($userId,genesisReadJson())],201);
        }
        if($path==='shared/views/options' && $method==='GET')genesisJson(genesisSharedViewOptions($userId,(string)($_GET['kind']??''),genesisSharedReadTaskFilter($_GET['filter']??null),$_GET['cursor']??null));
        if(count($segments)===3 && $segments[1]==='views' && $segments[2]!=='options') {
            if($method==='GET')genesisJson(['view'=>genesisSharedViewRead(genesisSharedViewAccess($userId,$segments[2]),$userId)]);
            if($method==='PATCH')genesisJson(['view'=>genesisSharedViewSave($userId,genesisReadJson(),$segments[2])]);
            if($method==='DELETE')genesisJson(genesisSharedViewDelete($userId,$segments[2],genesisReadJson()));
        }
        if (count($segments)===6 && $segments[1]==='projects' && $segments[3]==='tasks' && $segments[5]==='series') {
            if($method==='GET')genesisJson(['series'=>genesisSharedSeriesForTask($userId,$segments[2],$segments[4])]);
            if($method==='POST'){
                genesisRequireCsrf();$input=genesisReadJson();
                if(($input['preview']??false)===true)genesisJson(['preview'=>genesisSharedSeriesPreview($userId,$segments[2],$segments[4],$input)]);
                if(($input['skipInstance']??false)===true)genesisJson(['series'=>genesisSharedSeriesSkip($userId,$segments[2],$segments[4],$input)]);
                genesisJson(['series'=>genesisSharedSeriesSave($userId,$segments[2],$segments[4],$input,isset($input['seriesId'])?(string)$input['seriesId']:null)]);
            }
        }
        if ($method === 'POST' && $path === 'shared/invitations/accept') {
            $invitationInput = genesisReadJson();
            genesisJson(genesisSharedRespondSpaceInvitation($userId, (string)($invitationInput['id'] ?? ''), true)
                ?? genesisSharedAcceptInvite($userId, $invitationInput));
        }
        if ($method === 'POST' && count($segments) === 3 && $segments[1] === 'invitations'
            && $segments[2] !== 'accept') {
            if (genesisSharedRespondSpaceInvitation($userId, $segments[2], false) === null) genesisSharedRejectInvite($userId, $segments[2]);
            genesisJson(['ok' => true]);
        }
        if ($method === 'GET' && count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'search') {
            genesisJson(genesisSharedSearch($userId, $segments[2], (string)($_GET['q'] ?? ''), $_GET['cursor']??null));
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'projects') {
            if ($method === 'GET') genesisJson(['projects' => genesisSharedProjects($userId, $segments[2])]);
            if ($method === 'POST') genesisJson(['project' => genesisSharedCreateProject($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'member-categories') {
            if ($method === 'GET') genesisJson(['categories' => genesisSharedMemberCategories($userId, $segments[2])]);
            if ($method === 'POST') genesisJson(['category' => genesisSharedMemberCategory($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 5 && $segments[1] === 'spaces' && $segments[3] === 'member-categories' && $method === 'PATCH') {
            genesisJson(['category' => genesisSharedMemberCategory($userId, $segments[2], genesisReadJson(), $segments[4])]);
        }
        if(count($segments)===2&&$segments[1]==='reports'&&$method==='POST')genesisJson(genesisSharedReport($userId,genesisReadJson()));
        if(count($segments)===3&&$segments[1]==='reports'&&$method==='POST'){
            if($segments[2]==='tasks')genesisJson(genesisSharedReportTasks($userId,genesisReadJson()));
            if($segments[2]==='check'){$input=genesisReadJson();if(!is_string($input['token']??null))throw new InvalidArgumentException('REPORT_INVALID');genesisJson(genesisSharedReportCheck($userId,$input['token']));}
        }
        if(count($segments)===3&&$segments[1]==='data'&&$method==='POST'){
            $nativeView=genesisDataNativeView($_GET['view']??null);
            if($segments[2]==='preview'){$preview=genesisSharedDataPreview($userId,genesisReadJson());genesisJson($nativeView?genesisDataNativePreview($preview):$preview);}
            if($segments[2]==='apply'){$receipt=genesisSharedDataApply($userId,genesisReadJson());genesisJson($nativeView?genesisDataNativeReceipt($receipt):$receipt);}
        }
        if(count($segments)===4&&$segments[1]==='spaces'&&$segments[3]==='data-export'&&$method==='POST')genesisJson(genesisSharedDataExport($userId,$segments[2],genesisReadJson()));
        if(count($segments)===4&&$segments[1]==='spaces'&&$segments[3]==='data-imports'&&$method==='GET'){
            $nativeView=genesisDataNativeView($_GET['view']??null);$imports=genesisSharedDataImports($userId,$segments[2],$_GET['cursor']??null);
            if($nativeView)$imports['imports']=array_map('genesisDataNativeReceipt',$imports['imports']);genesisJson($imports);
        }
        if(count($segments)===4&&$segments[1]==='data-imports'&&$segments[3]==='undo'&&$method==='POST')genesisJson(genesisSharedDataUndo($userId,$segments[2]));
        if(count($segments)===4&&$segments[1]==='projects'&&$segments[3]==='data-history'&&$method==='GET')genesisJson(genesisSharedDataHistory($userId,$segments[2],isset($_GET['taskId'])?(string)$_GET['taskId']:null,$_GET['cursor']??null));
        if(count($segments)===4&&$segments[1]==='projects'&&$segments[3]==='automations'){
            if($method==='GET')genesisJson(genesisSharedAutomations($userId,$segments[2],($_GET['deleted']??'')==='true',$_GET['cursor']??null));
            if($method==='POST')genesisJson(['rule'=>genesisSharedSaveAutomation($userId,$segments[2],genesisReadJson())],201);
        }
        if(count($segments)===5&&$segments[1]==='projects'&&$segments[3]==='automations'){
            if($segments[4]==='preview'&&$method==='POST')genesisJson(genesisSharedAutomationPreview($userId,$segments[2],genesisReadJson()));
            if($method==='GET')genesisJson(['rule'=>genesisAutomationRecord(genesisAutomationRule($userId,$segments[2],$segments[4]))]);
            if($method==='PATCH')genesisJson(['rule'=>genesisSharedSaveAutomation($userId,$segments[2],genesisReadJson(),$segments[4])]);
        }
        if(count($segments)===6&&$segments[1]==='projects'&&$segments[3]==='automations'&&$segments[5]==='runs'&&$method==='GET')genesisJson(genesisSharedAutomationRuns($userId,$segments[2],$segments[4],$_GET['cursor']??null));
        if(count($segments)===8&&$segments[1]==='projects'&&$segments[3]==='automations'&&$segments[5]==='runs'&&$segments[7]==='retry'&&$method==='POST')genesisJson(genesisSharedRetryAutomation($userId,$segments[2],$segments[4],$segments[6],genesisReadJson()));
        if(($segments[1]??'')==='templates'&&isset($segments[2]))$segments[2]=rawurldecode($segments[2]);
        if(count($segments)===4&&$segments[1]==='spaces'&&$segments[3]==='templates'){
            if($method==='GET')genesisJson(genesisSharedTemplates($userId,$segments[2],isset($_GET['projectId'])?(string)$_GET['projectId']:null,($_GET['deleted']??'')==='true',$_GET['cursor']??null)
                +['systemTemplates'=>empty($_GET['cursor'])&&($_GET['deleted']??'')!=='true'?array_map(static function($record){unset($record['manifest'],$record['notices']);return $record;},genesisSharedStarterTemplates(genesisTemplateLanguage($_GET['language']??'ru'))):[]]);
            if($method==='POST'){$input=genesisReadJson();$libraryProject=$input['projectId']??null;unset($input['projectId']);if(!is_string($libraryProject))throw new InvalidArgumentException('TEMPLATE_INVALID');genesisJson(genesisSharedSaveTemplate($userId,$segments[2],$libraryProject,$input),201);}
        }
        if(count($segments)===5&&$segments[1]==='spaces'&&$segments[3]==='templates'&&$method==='PATCH'){
            $input=genesisReadJson();$libraryProject=$input['projectId']??null;unset($input['projectId']);if(!is_string($libraryProject))throw new InvalidArgumentException('TEMPLATE_INVALID');
            genesisJson(genesisSharedSaveTemplate($userId,$segments[2],$libraryProject,$input,$segments[4]));
        }
        if(count($segments)===3&&$segments[1]==='templates'&&$method==='GET')genesisJson(['template'=>genesisSharedTemplateSource($userId,$segments[2],genesisTemplateLanguage($_GET['language']??'ru'),($_GET['deleted']??'')==='true')]);
        if(count($segments)===4&&$segments[1]==='templates'&&$method==='POST'){
            if($segments[3]==='preview')genesisJson(genesisSharedPreviewTemplate($userId,$segments[2],genesisReadJson()));
            if($segments[3]==='apply')genesisJson(genesisSharedApplyTemplate($userId,$segments[2],genesisReadJson()));
        }
        if(count($segments)===4&&$segments[1]==='projects'&&$segments[3]==='planning'){
            if($method==='GET')genesisJson(genesisSharedPlanning($userId,$segments[2]));
            if($method==='PUT')genesisJson(genesisSharedSavePlanning($userId,$segments[2],genesisReadJson()));
        }
        if(count($segments)===4&&$segments[1]==='projects'&&$segments[3]==='workflow'){
            if($method==='GET')genesisJson(genesisSharedWorkflow($userId,$segments[2]));
            if($method==='PUT')genesisJson(genesisSharedSaveWorkflow($userId,$segments[2],genesisReadJson()));
        }
        if(count($segments)===5&&$segments[1]==='projects'&&$segments[3]==='workflow'&&$segments[4]==='history'&&$method==='GET'){
            $cursor=isset($_GET['before'])?filter_var($_GET['before'],FILTER_VALIDATE_INT):null;
            if($cursor===false)throw new InvalidArgumentException('WORKFLOW_INVALID');
            genesisJson(genesisSharedWorkflowHistory($userId,$segments[2],$cursor));
        }
        if(count($segments)===5&&$segments[1]==='projects'&&$segments[3]==='planning'&&$segments[4]==='sprints'&&$method==='POST')genesisJson(genesisSharedSaveSprint($userId,$segments[2],genesisReadJson()),201);
        if(count($segments)===6&&$segments[1]==='projects'&&$segments[3]==='planning'&&$segments[4]==='sprints'&&$method==='PATCH')genesisJson(genesisSharedSaveSprint($userId,$segments[2],genesisReadJson(),$segments[5]));
        if(count($segments)===7&&$segments[1]==='projects'&&$segments[3]==='planning'&&$segments[4]==='sprints'&&$segments[6]==='transition'&&$method==='POST')genesisJson(genesisSharedTransitionSprint($userId,$segments[2],$segments[5],genesisReadJson()));
        if(count($segments)===7&&$segments[1]==='projects'&&$segments[3]==='planning'&&$segments[4]==='sprints'&&$segments[6]==='report'&&$method==='POST')genesisJson(genesisSharedSprintReport($userId,$segments[2],$segments[5],genesisReadJson()));
        if(count($segments)===8&&$segments[1]==='projects'&&$segments[3]==='planning'&&$segments[4]==='sprints'&&$segments[6]==='report'&&$method==='POST'){
            if($segments[7]==='check')genesisJson(genesisSharedSprintReportCheck($userId,$segments[2],$segments[5],genesisReadJson()));
            if($segments[7]==='sources')genesisJson(genesisSharedSprintReportSources($userId,$segments[2],$segments[5],genesisReadJson()));
        }
        if(count($segments)===4&&$segments[1]==='spaces'&&$segments[3]==='custom-fields'&&$method==='GET')genesisJson(['fields'=>genesisSharedCustomFields($userId,$segments[2],isset($_GET['projectId'])?(string)$_GET['projectId']:null,($_GET['archived']??'')==='true')]);
        if(count($segments)===5&&$segments[1]==='spaces'&&$segments[3]==='custom-fields'&&$segments[4]==='preview'&&$method==='POST')genesisJson(genesisSharedPreviewCustomField($userId,$segments[2],genesisReadJson()));
        if(count($segments)===4&&$segments[1]==='spaces'&&$segments[3]==='custom-fields'&&$method==='PUT')genesisJson(genesisSharedSaveCustomField($userId,$segments[2],genesisReadJson()));
        if(count($segments)===4&&$segments[1]==='custom-fields'&&$segments[3]==='history'&&$method==='GET')genesisJson(['versions'=>genesisSharedCustomFieldHistory($userId,$segments[2])]);
        if (count($segments) === 6 && $segments[1] === 'spaces' && $segments[3] === 'members' && $segments[5] === 'project-access') {
            if($method==='GET')genesisJson(genesisSharedProjectAccessState($userId,$segments[2],$segments[4]));
            if($method==='POST')genesisJson(genesisSharedPreviewProjectAccess($userId,$segments[2],$segments[4],genesisReadJson()));
            if($method==='PATCH')genesisJson(genesisSharedSaveProjectAccess($userId,$segments[2],$segments[4],genesisReadJson()));
        }
        if (count($segments) === 6 && $segments[1] === 'spaces' && $segments[3] === 'members' && $segments[5] === 'permissions' && $method === 'PATCH') {
            genesisSharedAssignMemberPermissions($userId, $segments[2], $segments[4], genesisReadJson());
            genesisJson(['ok' => true]);
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'project-categories') {
            if ($method === 'GET') genesisJson(['categories' => genesisSharedProjectCategories($userId, $segments[2])]);
            if ($method === 'POST') genesisJson(['category' => genesisSharedSaveProjectCategory($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 5 && $segments[1] === 'spaces' && $segments[3] === 'project-categories') {
            if ($method === 'PATCH') genesisJson(['category' => genesisSharedSaveProjectCategory($userId, $segments[2], genesisReadJson(), $segments[4])]);
            if ($method === 'DELETE') {
                genesisSharedDeleteProjectCategory($userId, $segments[2], $segments[4], genesisReadJson());
                genesisJson(['ok' => true]);
            }
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'import-project'
            && $method === 'POST') {
            genesisJson(['receipt' => genesisSharedImportProjectTree($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 4 && $segments[1] === 'spaces' && $segments[3] === 'archived-projects'
            && $method === 'GET') {
            genesisJson(['projects' => genesisSharedArchivedProjects($userId, $segments[2])]);
        }
        if (count($segments) === 5 && $segments[1] === 'spaces' && $segments[3] === 'members'
            && in_array($method, ['PATCH', 'POST'], true)) {
            genesisSharedSetSpaceRole($userId, $segments[2], $segments[4], genesisReadJson());
            genesisJson(['ok' => true]);
        }
        if (count($segments) === 3 && $segments[1] === 'projects' && $method === 'GET') {
            genesisJson(genesisSharedProjectSnapshot($userId, $segments[2], genesisSharedReadTaskFilter($_GET['filter']??null), $_GET['cursor']??null, (string)($_GET['sort']??'position')));
        }
        if (count($segments) === 4 && $segments[1] === 'projects' && $segments[3] === 'google') {
            if ($method === 'GET') genesisJson(['settings' => genesisSharedGoogleSettings($userId, $segments[2])]);
            if (in_array($method, ['PATCH', 'POST'], true)) genesisJson(['settings' => genesisSharedSetGoogleSettings($userId, $segments[2], genesisReadJson())]);
        }
        if (count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'google'
            && $segments[4] === 'sync' && $method === 'POST') {
            genesisJson(genesisSharedSyncGoogle($userId, $segments[2], 3));
        }
        if (count($segments) === 3 && $segments[1] === 'projects' && in_array($method, ['PATCH', 'POST'], true)) {
            genesisJson(['project' => genesisSharedUpdateProject($userId, $segments[2], genesisReadJson())]);
        }
        if (count($segments) === 4 && $segments[1] === 'projects'
            && in_array($segments[3], ['archive', 'restore'], true) && $method === 'POST') {
            genesisSharedSetArchived($userId, $segments[2], $segments[3] === 'archive');
            genesisJson(['ok' => true]);
        }
        if (count($segments) === 4 && $segments[1] === 'projects' && $segments[3] === 'statuses'
            && $method === 'POST') {
            genesisJson(['status' => genesisSharedCreateStatus($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'statuses') {
            if (in_array($method, ['PATCH', 'POST'], true)) {
                genesisJson(['status' => genesisSharedUpdateStatus($userId, $segments[2], $segments[4], genesisReadJson())]);
            }
            if ($method === 'DELETE') {
                genesisSharedDeleteStatus($userId, $segments[2], $segments[4], genesisReadJson());
                genesisJson(['ok' => true]);
            }
        }
        if (count($segments) === 4 && $segments[1] === 'projects' && $segments[3] === 'categories'
            && $method === 'POST') {
            genesisJson(['category' => genesisSharedCreateCategory($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'categories') {
            if (in_array($method, ['PATCH', 'POST'], true)) {
                genesisJson(['category' => genesisSharedUpdateCategory($userId, $segments[2], $segments[4], genesisReadJson())]);
            }
            if ($method === 'DELETE') {
                genesisSharedDeleteCategory($userId, $segments[2], $segments[4], genesisReadJson());
                genesisJson(['ok' => true]);
            }
        }
        if (count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'members') {
            if (in_array($method, ['PATCH', 'POST'], true)) {
                genesisSharedSetMemberRole($userId, $segments[2], $segments[4], genesisReadJson());
                genesisJson(['ok' => true]);
            }
            if ($method === 'DELETE') {
                genesisSharedRemoveMember($userId, $segments[2], $segments[4]);
                genesisJson(['ok' => true]);
            }
        }
        if (count($segments) === 4 && $segments[1] === 'projects' && $segments[3] === 'invitations'
            && $method === 'POST') {
            genesisJson(['invitation' => genesisSharedInvite($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 4 && $segments[1] === 'projects' && $segments[3] === 'tasks'
            && $method === 'POST') {
            genesisJson(['task' => genesisSharedTask($userId, $segments[2], genesisReadJson())], 201);
        }
        if (count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'tasks'
            && in_array($method, ['PATCH', 'POST'], true)) {
            genesisJson(['task' => genesisSharedTask($userId, $segments[2], genesisReadJson(), $segments[4])]);
        }
        if (count($segments) === 5 && $segments[1] === 'projects' && $segments[3] === 'tasks' && $method === 'DELETE') {
            $result = genesisSharedTrashTask($userId, $segments[2], $segments[4], genesisReadJson());
            genesisSharedCleanGoogleCopies($userId, 10);
            genesisJson($result);
        }
        if (count($segments) === 6 && $segments[1] === 'projects' && $segments[3] === 'tasks' && $segments[5] === 'approve' && $method === 'POST') {
            genesisJson(['task' => genesisSharedApproveTask($userId, $segments[2], $segments[4])]);
        }
        if (count($segments) === 6 && $segments[1] === 'projects' && $segments[3] === 'tasks'
            && $segments[5] === 'move' && $method === 'POST') {
            genesisJson(['task' => genesisSharedMoveTask($userId, $segments[2], $segments[4], genesisReadJson())]);
        }
        if (count($segments) === 6 && $segments[1] === 'projects' && $segments[3] === 'tasks'
            && $segments[5] === 'comments') {
            if ($method === 'GET') genesisJson(genesisSharedCommentPage($userId, $segments[2], $segments[4], $_GET['before'] ?? null));
            if ($method === 'POST') genesisJson(['comment' => genesisSharedAddComment($userId, $segments[2], $segments[4], genesisReadJson())], 201);
        }
    }

    if (count($segments) >= 4 && $segments[0] === 'shared' && $segments[1] === 'spaces' && $segments[3] === 'mindmaps') {
        $userId = genesisRequireUserId(); header('Cache-Control: no-store');
        if ($method === 'GET' && count($segments) === 4) genesisJson(['maps'=>genesisSharedMindmaps($userId,$segments[2])]);
        if ($method === 'GET' && count($segments) === 6 && $segments[5] === 'history') genesisJson(['versions'=>genesisSharedMindmaps($userId,$segments[2],$segments[4])]);
        if ($method === 'PUT' && count($segments) === 5) { genesisRequireCsrf(); genesisJson(genesisSaveSharedMindmap($userId,$segments[2],$segments[4],genesisReadJson())); }
        if ($method === 'DELETE' && count($segments) === 5) { genesisRequireCsrf(); genesisJson(genesisDeleteSharedMindmap($userId,$segments[2],$segments[4],genesisReadJson())); }
    }

    if (count($segments) === 4 && $segments[0] === 'shared' && $segments[1] === 'projects' && $segments[3] === 'review-settings') {
        $userId=genesisRequireUserId(); header('Cache-Control: no-store');
        if ($method==='GET') genesisJson(genesisSharedReviewSettings($userId,$segments[2]));
        if ($method==='PATCH') { genesisRequireCsrf(); genesisJson(genesisSharedReviewSettings($userId,$segments[2],genesisReadJson())); }
    }
    if (count($segments) === 6 && $segments[0] === 'shared' && $segments[1] === 'projects' && $segments[3] === 'tasks' && $segments[5] === 'reviews' && $method==='PATCH') {
        $userId=genesisRequireUserId(); genesisRequireCsrf(); genesisJson(genesisSharedReviewTask($userId,$segments[2],$segments[4],genesisReadJson()));
    }

    if (count($segments)===4 && $segments[0]==='shared' && $segments[1]==='projects' && $segments[3]==='trash' && $method==='POST') { $userId=genesisRequireUserId();genesisRequireCsrf();genesisJson(genesisSharedTrashProject($userId,$segments[2],genesisReadJson())); }
    if (count($segments)>=4 && $segments[0]==='shared' && $segments[1]==='spaces' && $segments[3]==='trash') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');
        if(count($segments)===4 && $method==='GET')genesisJson(['items'=>genesisSharedTrashList($userId,$segments[2])]);
        if(count($segments)===6 && $method==='PATCH'){genesisRequireCsrf();genesisJson(genesisSharedRestoreTrash($userId,$segments[2],$segments[4],$segments[5],genesisReadJson()));}
    }

    if ($segments && $segments[0] === 'diary') {
        $userId=genesisRequireUserId(); header('Cache-Control: no-store');
        if ($method==='GET' && count($segments)===2 && $segments[1]==='dream-clock') genesisJson(genesisDreamClock((string)($_GET['timeZone']??'UTC')));
        if ($method==='GET' && count($segments)===2 && $segments[1]==='dream-voice') { genesisRequireFeature($userId,'dream-voice'); genesisJson(['allowed'=>true]); }
        if (count($segments)===2 && $segments[1]==='dream-settings') {
            if ($method==='GET')genesisJson(['dreamSettings'=>genesisDreamSettings($userId)]);
            if ($method==='PUT'){genesisRequireCsrf();genesisJson(genesisUpdateDreamSettings($userId,genesisReadJson()));}
        }
        if ($method==='GET' && count($segments)===1) genesisJson(['notes'=>genesisDiaryNotes($userId),'deleted'=>genesisDiaryDeletions($userId),'settings'=>genesisDiarySettings($userId),'snapshot'=>genesisDiarySnapshot($userId),'dreamSettings'=>genesisDreamSettings($userId)]);
        if (count($segments)===2 && $segments[1]==='settings') {
            if ($method==='GET')genesisJson(['settings'=>genesisDiarySettings($userId),'snapshot'=>genesisDiarySnapshot($userId),'deleted'=>genesisDiaryDeletions($userId),'dreamSettings'=>genesisDreamSettings($userId)]);
            if ($method==='PUT'){genesisRequireCsrf();genesisJson(genesisUpdateDiarySettings($userId,genesisReadJson()));}
        }
        if ($method==='PUT' && count($segments)===2) { genesisRequireCsrf(); genesisJson(genesisSaveDiaryNote($userId,$segments[1],genesisReadJson())); }
        if ($method==='DELETE' && count($segments)===2) { genesisRequireCsrf(); genesisJson(genesisDeleteDiaryNote($userId,$segments[1],genesisReadJson())); }
    }
    if ($path === 'aurora-workspace') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');
        if($method==='GET')genesisJson(['document'=>genesisAuroraWorkspace($userId)]);
        if($method==='PUT'){genesisRequireCsrf();genesisJson(genesisSaveAuroraWorkspace($userId,genesisReadJson()));}
    }
    if ($path === 'aurora-results' && $method==='POST') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');genesisRequireCsrf();
        genesisJson(genesisAuroraPrepareResult($userId,genesisReadJson()),201);
    }
    if ($path === 'stoicheion-workspace') {
        $userId = genesisRequireUserId(); header('Cache-Control: no-store');
        if ($method === 'GET') genesisJson(['document'=>genesisStoicheionWorkspace($userId)]);
        if ($method === 'PUT') { genesisRequireCsrf(); genesisJson(genesisSaveStoicheionWorkspace($userId,genesisReadJson())); }
    }
    if ($segments && $segments[0] === 'mindmaps') {
        $userId = genesisRequireUserId();
        header('Cache-Control: no-store');
        if ($method === 'GET' && count($segments) === 1) genesisJson(['maps' => genesisMindmaps($userId)]);
        if ($method === 'GET' && count($segments) === 3 && $segments[2] === 'history') {
            genesisJson(['versions' => genesisMindmapHistory($userId, $segments[1])]);
        }
        if ($method === 'PUT' && count($segments) === 2) {
            genesisRequireCsrf();
            genesisJson(genesisSaveMindmap($userId, $segments[1], genesisReadJson()));
        }
        if ($method === 'DELETE' && count($segments) === 2) {
            genesisRequireCsrf();
            genesisJson(genesisDeleteMindmap($userId, $segments[1], genesisReadJson()));
        }
    }

    if ($method === 'GET' && $path === 'workspace') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null) {
            genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        }
        genesisJson(['workspace' => genesisWorkspaceForClient($user)]);
    }

    if ($method === 'PUT' && $path === 'workspace') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        $payload = genesisReadJson();
        $saved = genesisSaveWorkspaceEnvelope($userId, $payload);
        // Encrypted-only native writes omit aggregate metrics. Keep the last
        // complete web census instead of accidentally resetting it to zero.
        if (array_key_exists('metrics', $payload)) {
            genesisSaveMetrics($userId, $payload);
        }
        genesisJson(['ok' => true, 'workspace' => $saved]);
    }

    if ($method === 'PUT' && $path === 'workspace/key') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        genesisJson(['ok' => true, 'workspace' => genesisSaveClientWorkspaceKey($userId, genesisReadJson())]);
    }

    if ($method === 'POST' && $path === 'metrics') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        genesisSaveMetrics($userId, genesisReadJson());
        genesisJson(['ok' => true]);
    }

    if ($method === 'POST' && $path === 'feature-usage') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        genesisRecordFeatureUsage($userId, genesisReadJson());
        genesisJson(['ok' => true]);
    }

    if ($method === 'POST' && $path === 'task-lists') {
        $userId = genesisRequireUserId();
        genesisRequireGoogleUser($userId);
        genesisRequireCsrf();
        $payload = genesisReadJson();
        genesisJson(['taskList' => genesisCreateGoogleTaskList($userId, (string)($payload['title'] ?? ''), isset($payload['accountId']) ? (string)$payload['accountId'] : null)]);
    }

    if (count($segments) === 2 && $segments[0] === 'task-lists') {
        $userId = genesisRequireUserId();
        genesisRequireGoogleUser($userId);
        genesisRequireCsrf();
        $id = mb_substr(trim((string)$segments[1]), 0, 500);
        if ($id === '') {
            throw new InvalidArgumentException('Идентификатор списка обязателен.');
        }
        if ($method === 'PATCH') {
            $payload = genesisReadJson();
            genesisJson(['taskList' => genesisUpdateGoogleTaskList($userId, $id, (string)($payload['title'] ?? ''), isset($payload['accountId']) ? (string)$payload['accountId'] : null)]);
        }
        if ($method === 'DELETE') {
            $payload = genesisReadJson();
            genesisDeleteGoogleTaskList($userId, $id, isset($payload['accountId']) ? (string)$payload['accountId'] : null);
            genesisJson(['ok' => true]);
        }
    }

    if ($method === 'POST' && count($segments) === 4 && $segments[0] === 'admin' && $segments[1] === 'users' && $segments[3] === 'reset-access') {
        $userId = genesisRequireUserId(); genesisRequireCsrf();
        require_once $serverRoot . '/src/subscriptions.php'; $payload = genesisReadJson();
        if (!is_int($payload['expectedRevision'] ?? null)) throw new InvalidArgumentException('SUBSCRIPTION_REVISION_REQUIRED');
        genesisJson(genesisAdminResetSubscription($userId,$segments[2],(string)($payload['expectedPlan'] ?? ''),$payload['expectedRevision']));
    }

    if ($method === 'PUT' && count($segments) === 4 && $segments[0] === 'admin'
        && $segments[1] === 'users' && $segments[3] === 'subscription') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        require_once $serverRoot . '/src/subscriptions.php';
        $payload = genesisReadJson();
        if (array_key_exists('expectedRevision',$payload) && !is_int($payload['expectedRevision']))
            throw new InvalidArgumentException('SUBSCRIPTION_REVISION_REQUIRED');
        genesisJson(genesisAdminSetSubscription($userId, (string)$segments[2],
            (string)($payload['subscriptionPlan'] ?? ''), (string)($payload['expectedPlan'] ?? ''), $payload['expectedRevision'] ?? null));
    }

    if ($method === 'PUT' && count($segments) === 4 && $segments[0] === 'admin' && $segments[1] === 'users' && $segments[3] === 'forecast-privilege') {
        $userId = genesisRequireUserId(); genesisRequireCsrf();
        require_once $serverRoot . '/src/forecast-privileges.php';
        genesisJson(genesisAdminSetForecastPrivilege($userId, (string)$segments[2], genesisReadJson()));
    }

    if ($method === 'GET' && $path === 'admin/stats') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null) {
            genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        }
        genesisRequireAdmin($user);
        genesisJson(genesisAdminStats());
    }

    if ($path === 'admin/ads' || (count($segments) === 3 && $segments[0] === 'admin'
        && $segments[1] === 'ads')) {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null) genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        genesisRequireAdmin($user);
        if ($method === 'GET' && $path === 'admin/ads') genesisJson(['ads' => genesisAdList()]);
        genesisRequireCsrf();
        if ($method === 'POST' && $path === 'admin/ads') genesisJson(['ad' => genesisSaveAd(genesisReadJson())], 201);
        if (count($segments) === 3 && preg_match('/^[a-f0-9-]{36}$/', $segments[2])) {
            if ($method === 'PUT') genesisJson(['ad' => genesisSaveAd(genesisReadJson(), $segments[2])]);
            if ($method === 'DELETE') {
                genesisDeleteAd($segments[2]);
                genesisJson(['deleted' => true]);
            }
        }
        genesisJson(['error' => 'NOT_FOUND'], 404);
    }

    if ($method === 'DELETE' && count($segments) === 3 && $segments[0] === 'admin' && $segments[1] === 'users') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        $user = genesisFindUser($userId);
        if ($user === null) {
            genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        }
        genesisRequireAdmin($user);
        $targetUserId = mb_substr(trim((string)$segments[2]), 0, 100);
        if ($targetUserId === '') {
            throw new InvalidArgumentException('Не указан пользователь для удаления.');
        }
        $payload = genesisReadJson();
        genesisJson(genesisAdminDeleteUser($userId, $targetUserId, ($payload['blacklist'] ?? false) === true));
    }

    if ($method === 'DELETE' && $path === 'account') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        genesisDeleteAccount($userId);
        genesisFinishSession(['ok' => true, 'deleted' => true]);
    }

    if ($method === 'GET' && $path === 'account/local-link/pending') {
        $userId = genesisRequireUserId();
        header('Cache-Control: no-store');
        genesisJson(['pending' => genesisPendingLocalLink($userId)]);
    }

    if ($method === 'POST' && $path === 'account/local-link/commit') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        genesisJson(['user' => genesisUserForClient(genesisCommitLocalLink($userId, genesisReadJson()))]);
    }

    if ($method === 'POST' && $path === 'account/local-link/cancel') {
        genesisRequireUserId();
        genesisRequireCsrf();
        unset($_SESSION['pending_local_link']);
        genesisJson(['ok' => true]);
    }

    if ($method === 'POST' && $path === 'account/google-services/disconnect') {
        $userId = genesisRequireUserId();
        genesisRequireGoogleUser($userId);
        genesisRequireCsrf();
        $user = genesisDisconnectGoogleServices($userId);
        genesisJson(['user' => genesisUserForClient($user)]);
    }

    if ($method === 'POST' && $path === 'account/yandex-calendar/connect') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null || genesisUserProvider($user) !== 'yandex') genesisJson(['error' => 'LOCAL_ACCOUNT_REQUIRED'], 403);
        genesisRequireCsrf();
        $payload = genesisReadJson();
        $accountId = trim((string)($payload['accountId'] ?? $userId));
        $member = genesisLocalMemberForOwner($userId, $accountId);
        if ($member === null || $member['provider'] !== 'yandex') genesisJson(['error' => 'YANDEX_ACCOUNT_REQUIRED'], 403);
        genesisYandexCalendarConnectOauth($accountId, [
            'access_token' => is_string($payload['accessToken'] ?? null) ? $payload['accessToken'] : '',
            'expires_in' => max(0, min(31536000, (int)($payload['expiresIn'] ?? 0))),
        ]);
        genesisJson(['user' => genesisUserForClient($user)]);
    }

    if ($method === 'POST' && $path === 'account/yandex-calendar/disconnect') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null || genesisUserProvider($user) !== 'yandex') genesisJson(['error' => 'LOCAL_ACCOUNT_REQUIRED'], 403);
        genesisRequireCsrf();
        $payload = genesisReadJson();
        $accountId = trim((string)($payload['accountId'] ?? $userId));
        $member = genesisLocalMemberForOwner($userId, $accountId);
        if ($member === null || $member['provider'] !== 'yandex') genesisJson(['error' => 'YANDEX_ACCOUNT_REQUIRED'], 403);
        genesisYandexCalendarDisconnect($accountId);
        genesisJson(['user' => genesisUserForClient($user)]);
    }

    if ($method === 'DELETE' && count($segments) === 3 && $segments[0] === 'account' && $segments[1] === 'google-accounts') {
        $userId = genesisRequireUserId();
        genesisRequireGoogleUser($userId);
        genesisRequireCsrf();
        genesisRemoveLinkedGoogleAccount($userId, mb_substr(trim((string)$segments[2]), 0, 100));
        $user = genesisFindUser($userId);
        if ($user === null) genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        genesisJson(['user' => genesisUserForClient($user)]);
    }

    if ($path==='account/plan-guidance' && $method==='GET') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');
        genesisJson(genesisPlanGuidanceLatest($userId));
    }
    if ($method==='POST' && in_array($path,['account/plan-guidance/claim','account/plan-guidance/shown','account/plan-guidance/read','account/plan-guidance/release'],true)) {
        $userId=genesisRequireUserId();genesisRequireCsrf();header('Cache-Control: no-store');$payload=genesisReadJson();
        if($path!=='account/plan-guidance/release'&&($_SERVER['HTTP_X_GENESIS_FOREGROUND']??'')!=='1')genesisJson(['error'=>'PLAN_GUIDANCE_FOREGROUND_REQUIRED'],409);
        if($path==='account/plan-guidance/claim')genesisJson(genesisPlanGuidanceClaim($userId,$payload));
        $field=$path==='account/plan-guidance/read'?'id':'token';
        if(array_keys($payload)!==[$field]||!is_string($payload[$field]))throw new InvalidArgumentException('PLAN_GUIDANCE_REQUEST_INVALID');
        if($path==='account/plan-guidance/release')genesisJson(genesisPlanGuidanceRelease($userId,$payload[$field]));
        genesisJson($field==='token'?genesisPlanGuidanceAcknowledge($userId,$payload[$field]):genesisPlanGuidanceRead($userId,$payload[$field]));
    }
    if ($method==='POST' && $path==='account/support-notice') {
        $userId=genesisRequireUserId();genesisRequireCsrf();header('Cache-Control: no-store');$payload=genesisReadJson();
        if(array_keys($payload)!==['surface']||!is_string($payload['surface']))throw new InvalidArgumentException('SUPPORT_NOTICE_REQUEST_INVALID');
        genesisJson(genesisSupportNoticeClaim($userId,$payload['surface']));
    }
    if ($method==='POST' && $path==='account/email/verification/dismiss') {
        $userId=genesisRequireUserId();genesisRequireCsrf();header('Cache-Control: no-store');
        if(genesisReadJson()!==[])throw new InvalidArgumentException('INVALID_ACCOUNT_EMAIL_REQUEST');
        genesisJson(genesisEmailDismissRegistration($userId));
    }
    if (in_array($method,['GET','POST'],true) && $path === 'account/email/verification') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');
        if($method==='POST'){
            genesisRequireCsrf();if(genesisReadJson()!==[])throw new InvalidArgumentException('INVALID_ACCOUNT_EMAIL_REQUEST');
            genesisJson(genesisEmailRequestRegistration($userId));
        }
        genesisJson(['verification'=>genesisEmailRegistrationStatus(genesisFindUser($userId))]);
    }

    if ($method === 'PUT' && $path === 'account/preferences') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        $user = genesisUpdateAccountPreferences($userId, genesisReadJson());
        genesisJson(['user' => genesisUserForClient($user)]);
    }

    if (($segments[0]??null)==='advice'&&($segments[1]??null)==='notifications') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');
        if($method!=='GET')genesisRequireCsrf();
        if($method==='GET'&&$path==='advice/notifications')genesisJson(genesisAdviceNotificationStatus($userId));
        if($method==='POST'&&$path==='advice/notifications/devices')genesisJson(genesisAdviceNotificationRegister($userId,genesisReadJson()),201);
        if($method==='DELETE'&&count($segments)===4&&$segments[2]==='devices'){genesisAdviceNotificationDelete($userId,$segments[3]);genesisJson(['ok'=>true]);}
        if($method==='GET'&&count($segments)===4&&$segments[2]==='deliveries')genesisJson(genesisAdviceNotificationAccess($userId,$segments[3]));
    }
    if($method==='GET'&&$path==='advice/saved') {
        $userId=genesisRequireUserId();header('Cache-Control: no-store');
        $target=$_GET;$capacity=genesisAdviceClientCapacity($target['maxDailyCards']??null);unset($target['maxDailyCards']);
        genesisJson(genesisSavedAdvice($userId,$target,$capacity));
    }
    if ($method === 'POST' && in_array($path, ['advice/today', 'advice/next', 'advice/view', 'advice/dismiss'], true)) {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        $payload = genesisReadJson();
        genesisJson(in_array($path, ['advice/today', 'advice/next'], true) ? genesisDailyAdvice($userId, $payload, null, $path === 'advice/next')
            : genesisRecordAdvice($userId, $payload, $path === 'advice/dismiss'));
    }

    if ($path === 'stoicheion/timeline/cards' && in_array($method, ['GET', 'POST'], true)) {
        $userId = genesisRequireUserId();
        header('Cache-Control: no-store');
        genesisRequireFeature($userId, 'stoicheion-timeline');
        if ($method === 'GET') genesisJson(genesisLoadTimelineCards($userId));
        genesisRequireCsrf();
        genesisJson(genesisChangeTimelineCard($userId, genesisReadJson()));
    }

    if ($method === 'GET' && $path === 'stoicheion/draws') {
        genesisJson(genesisStoicheionDraws(genesisRequireUserId()));
    }

    if ($method === 'POST' && $path === 'stoicheion/draws') {
        $userId = genesisRequireUserId();
        genesisRequireCsrf();
        $payload = genesisReadJson();
        $kind = trim((string)($payload['kind'] ?? ''));
        if ($kind === 'timeline') {
            genesisRequireFeature($userId,'stoicheion-timeline');
            // Web clients must use server-owned per-card windows even before the
            // first reveal. The established native channel retains its old reader.
            if (($_SESSION['auth_identity']['channel'] ?? 'unknown') !== 'native') {
                throw new DomainException('TIMELINE_CARD_PROTOCOL_REQUIRED');
            }
        }
        if ($kind === 'spread') genesisRequireFeature($userId,'stoicheion-spread');
        $seed = filter_var($payload['seed'] ?? null, FILTER_VALIDATE_INT);
        if ($seed === false) {
            throw new InvalidArgumentException('Зерно расклада указано неверно.');
        }
        genesisJson(['draw' => genesisSaveStoicheionDraw($userId, $kind, (int)$seed)]);
    }

    if (count($segments) === 2 && $segments[0] === 'tasks') {
        $userId = genesisRequireUserId();
        $user = genesisFindUser($userId);
        if ($user === null) genesisJson(['error' => 'AUTH_REQUIRED'], 401);
        genesisRequireCsrf();
        $id = mb_substr((string)$segments[1], 0, 100);
        if ($id === '') {
            throw new InvalidArgumentException('Task identifier is required.');
        }
        if ($method === 'PUT') {
            $task = genesisReadJson();
            if (($task['createOnly'] ?? false) === true) {
                unset($task['createOnly']);
                genesisJson(['task' => genesisCreatePersonalTaskOnce($user, $id, $task)]);
            }
            genesisJson(['task' => genesisUserProvider($user) === 'google'
                ? genesisSyncTaskToGoogle($userId, $id, $task)
                : genesisSyncTaskToLocalGroup($user, $id, $task)]);
        }
        if ($method === 'DELETE') {
            if (genesisUserProvider($user) === 'google') genesisDeleteGoogleTaskEvent($userId, $id, genesisReadJson());
            else genesisDeleteTaskFromLocalGroup($user, $id);
            genesisJson(['ok' => true]);
        }
    }

    genesisJson(['error' => 'NOT_FOUND'], 404);
} catch (GenesisPhysisException $error) {
    genesisJson(['error' => $error->getMessage()], $error->status);
} catch (GenesisSharedAccessException $error) {
    genesisJson(['error' => $error->getMessage()]+($error->details?['details'=>$error->details]:[]), $error->status);
} catch (GenesisResourceLimitException $error) {
    if ($error->status === 429) header('Retry-After: ' . (600 - time() % 600));
    genesisJson(['error' => $error->getMessage()], $error->status);
} catch (PDOException $error) {
    if(str_contains($error->getMessage(),'BILLING_SETTLEMENT_REQUIRED'))genesisJson(['error'=>'BILLING_SETTLEMENT_REQUIRED'],409);
    if (str_contains($error->getMessage(), 'GENESIS_QUOTA_EXCEEDED')) {
        genesisJson(['error' => 'STORAGE_QUOTA_EXCEEDED'], 409);
    }
    genesisLogError('Database request failed.', $error);
    genesisJson(['error' => 'Server error. Please try again.'], 500);
} catch (GenesisNativeAuthException $error) {
    header('Cache-Control: no-store');
    if ($error->status === 429) {
        header('Retry-After: 60');
    }
    genesisJson(['error' => $error->getMessage()], $error->status);
} catch (GenesisWorkspaceConflictException $error) {
    genesisJson(['error' => $error->getMessage(), 'currentVersion' => $error->currentVersion], 409);
} catch (DomainException $error) {
    genesisJson(['error' => $error->getMessage()], 409);
} catch (JsonException | InvalidArgumentException $error) {
    genesisJson(['error' => $error->getMessage()], 400);
} catch (Throwable $error) {
    genesisLogError($error->getMessage(), $error);
    genesisJson(['error' => 'Server error. Please try again.'], 500);
}
