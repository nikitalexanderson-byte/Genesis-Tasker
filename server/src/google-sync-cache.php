<?php
declare(strict_types=1);
require_once __DIR__.'/e2ee-policy.php';

const GENESIS_GOOGLE_INCREMENTAL_SECONDS = 900;
const GENESIS_GOOGLE_FULL_SYNC_SECONDS = 86400;

function genesisGoogleCacheDirectory(): string
{
    $directory = dirname((string)genesisConfig()['db_path']) . '/google-sync';
    if(is_link($directory))throw new RuntimeException('Google sync storage is unavailable.');
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Google sync storage is unavailable.');
    }
    return $directory;
}

function genesisGoogleCacheKey(array $user): string
{
    return hash('sha256', (!empty($user['_linked_account']) ? 'linked:' : 'primary:') . (string)$user['id']);
}

function genesisGoogleCacheFingerprint(array $user): string
{
    return hash('sha256', implode("\0", [(string)$user['id'], (string)($user['google_sub'] ?? ''),
        (string)($user['refresh_token_enc'] ?? ''), (string)($user['granted_scopes'] ?? '')]));
}

/** Resolve the authoritative owner before borrowing a personal operation gate.
 * Detached linked metadata is accepted only by the non-reading cleanup path. */
function genesisGoogleCacheOwner(array $user,bool $cleanup=false): string
{
    $id=(string)($user['id']??'');$db=genesisDb();
    if($id==='')throw new DomainException('E2EE_ACCOUNT_CHANGED');
    if(!empty($user['_linked_account'])) {
        $q=$db->prepare('SELECT owner_user_id FROM linked_google_accounts WHERE id=?');$q->execute([$id]);$owner=$q->fetchColumn();$q->closeCursor();
        $hint=$user['_owner_user_id']??$user['owner_user_id']??null;
        if($owner===false&&$cleanup&&is_string($hint))$owner=$hint;
        if(!is_string($owner)||$owner===''||$hint!==null&&$hint!==$owner)throw new DomainException('E2EE_ACCOUNT_CHANGED');
        foreach(['_owner_user_id','owner_user_id']as $field)if(isset($user[$field])&&$user[$field]!==$owner)throw new DomainException('E2EE_ACCOUNT_CHANGED');
    }else $owner=$id;
    $q=$db->prepare('SELECT 1 FROM users WHERE id=?');$q->execute([$owner]);$exists=$q->fetchColumn();$q->closeCursor();
    if($exists===false)throw new DomainException('E2EE_ACCOUNT_CHANGED');
    return $owner;
}

/** Service IO is fenced even when called by jobs/CLI without the HTTP middleware.
 * Never fall back to credentials captured before unlink or account removal. */
function genesisGoogleWithLegacyOperation(array $user,callable $operation):mixed
{
    $owner=genesisGoogleCacheOwner($user);
    return genesisE2eeWithPersonalIo($owner,false,static function()use($owner,$user,$operation):mixed{
        if(genesisGoogleCacheOwner($user)!==$owner)throw new DomainException('E2EE_ACCOUNT_CHANGED');
        if(genesisE2eeLegacyScopeBlocked('personal',$owner))throw new DomainException('E2EE_MIGRATION_FENCED');
        $current=!empty($user['_linked_account'])?genesisFindLinkedGoogleAccount((string)$user['id']):genesisFindUser((string)$user['id']);
        if(!is_array($current)||genesisGoogleCacheOwner($current)!==$owner)throw new DomainException('E2EE_ACCOUNT_CHANGED');
        return $operation($current);
    });
}

/** Preserve a previous grant's exact ciphertext before resetting its working
 * cache. No plaintext/token is written here. Migration inventories these files;
 * uncertain provenance requires explicit review instead of a silent omission. */
function genesisGoogleCacheRetainOriginal(string $base,string $cipher):void
{
    $directory=dirname($base).'/retained';$identity=basename($base);
    if(!preg_match('/\A[a-f0-9]{64}\z/D',$identity))throw new LogicException('Invalid Google cache target.');
    foreach([$directory,$directory.'/'.$identity]as $path){
        if(is_link($path)||!is_dir($path)&&!@mkdir($path,0700)&&!is_dir($path))throw new RuntimeException('Google snapshot retention failed.');
    }
    $destination=$directory.'/'.$identity.'/'.hash('sha256',$cipher).'.enc';
    if(is_link($destination))throw new RuntimeException('Google snapshot retention failed.');
    if(file_exists($destination)){
        if(!is_file($destination)||file_get_contents($destination)!==$cipher)throw new RuntimeException('Google snapshot retention failed.');
        return;
    }
    $temporary=$destination.'.'.bin2hex(random_bytes(8)).'.tmp';
    try{
        if(file_put_contents($temporary,$cipher)!==strlen($cipher)||!chmod($temporary,0600)||!rename($temporary,$destination))throw new RuntimeException('Google snapshot retention failed.');
    }finally{if(is_file($temporary))unlink($temporary);}
}

/** Technical file mutex only. The caller already holds its owner operation.
 * Nonblocking acquisition also protects callers that already own SQLite. */
function genesisGoogleCacheFileOperation(array $user,callable $operation): mixed
{
    $key = genesisGoogleCacheKey($user);
    if (isset($GLOBALS['GENESIS_GOOGLE_CACHE_LOCKS'][$key])) {
        throw new LogicException('Nested Google snapshot operation.');
    }
    $path = genesisGoogleCacheDirectory() . '/' . $key;
    if(is_link($path.'.lock')||is_link($path.'.enc')||file_exists($path.'.lock')&&!is_file($path.'.lock')||file_exists($path.'.enc')&&!is_file($path.'.enc'))throw new RuntimeException('Google sync storage is unavailable.');
    $lock = fopen($path . '.lock', 'c+');
    if ($lock === false) throw new RuntimeException('Google sync lock is unavailable.');
    if (!flock($lock, LOCK_EX|LOCK_NB)) {fclose($lock);throw new DomainException('E2EE_OPERATION_BUSY');}
    chmod($path . '.lock', 0600);
    $GLOBALS['GENESIS_GOOGLE_CACHE_LOCKS'][$key] = true;
    try {
        return $operation($path);
    } finally {
        unset($GLOBALS['GENESIS_GOOGLE_CACHE_LOCKS'][$key]);
        flock($lock, LOCK_UN); fclose($lock);
    }
}

/** Runtime files contain authenticated ciphertext only, isolated by Google account and grant. */
function genesisGoogleCacheWithLock(array $user, callable $operation, bool $persist = true): mixed
{
    $owner=genesisGoogleCacheOwner($user);
    return genesisE2eeWithPersonalIo($owner,false,static function()use($owner,$user,$operation,$persist):mixed{
        if(genesisGoogleCacheOwner($user)!==$owner)throw new DomainException('E2EE_ACCOUNT_CHANGED');
        if(genesisE2eeLegacyScopeBlocked('personal',$owner))throw new DomainException('E2EE_MIGRATION_FENCED');
        return genesisGoogleCacheFileOperation($user,static function(string $path)use($user,$operation,$persist):mixed{
        // Unlink/reassignment can finish while this request obtains the file
        // mutex. A stale captured account must not open the former snapshot.
        genesisGoogleCacheOwner($user);
        $snapshot = [];$previousGrant=null;
        if (is_file($path . '.enc')) {
            if(filesize($path.'.enc')>32*1024*1024)throw new DomainException('E2EE_PROVIDER_CACHE_REVIEW_REQUIRED');
            $original=file_get_contents($path.'.enc');
            if(!is_string($original))throw new DomainException('E2EE_PROVIDER_CACHE_UNAVAILABLE');
            require_once __DIR__.'/e2ee-provider-cache.php';
            try{$plain=genesisDecrypt($original);if(is_string($plain))genesisE2eeProviderJson($plain);$decoded=is_string($plain)?json_decode($plain,true,40,JSON_THROW_ON_ERROR):null;}
            catch(Throwable){throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');}
            if(!is_array($decoded)||!is_string($decoded['fingerprint']??null)||!preg_match('/\A[a-f0-9]{64}\z/D',$decoded['fingerprint']))throw new DomainException('E2EE_PROVIDER_CACHE_CORRUPT');
            if(hash_equals($decoded['fingerprint'],genesisGoogleCacheFingerprint($user)))$snapshot=$decoded;
            else $previousGrant=$original;
        }
        $snapshot['fingerprint'] = genesisGoogleCacheFingerprint($user);
        $result = $operation($snapshot);
        if (!$persist) return $result;
        if($previousGrant!==null)genesisGoogleCacheRetainOriginal($path,$previousGrant);
        $encoded = genesisEncrypt(json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        $temporary = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
        try {
            if (file_put_contents($temporary, $encoded) === false) throw new RuntimeException('Google snapshot write failed.');
            chmod($temporary, 0600);
            if (!rename($temporary, $path . '.enc')) throw new RuntimeException('Google snapshot replacement failed.');
        } finally { if (is_file($temporary)) unlink($temporary); }
        return $result;
        });
    });
}

function genesisGoogleForgetSnapshot(array $user): void
{
    $owner=genesisGoogleCacheOwner($user,true);
    genesisE2eeWithPersonalIo($owner,false,static function()use($owner,$user):void{
        if(genesisE2eeLegacyScopeBlocked('personal',$owner))throw new DomainException('E2EE_MIGRATION_FENCED');
        genesisGoogleCacheFileOperation($user,static function(string $base):void{
            $targets=[$base.'.enc'];$retained=dirname($base).'/retained/'.basename($base);
            if(is_link(dirname($retained))||is_link($retained))throw new RuntimeException('Google snapshot removal failed.');
            if(file_exists($retained)){
                if(!is_dir($retained)||($entries=scandir($retained))===false)throw new RuntimeException('Google snapshot removal failed.');
                foreach($entries as $entry){
                    if($entry==='.'||$entry==='..')continue;
                    if(!preg_match('/\A[a-f0-9]{64}\.enc\z/D',$entry)||is_link($retained.'/'.$entry)||!is_file($retained.'/'.$entry))throw new RuntimeException('Google snapshot removal failed.');
                    $targets[]=$retained.'/'.$entry;
                }
            }
            foreach($targets as $path)if(is_file($path)&&!unlink($path))throw new RuntimeException('Google snapshot removal failed.');
            if(is_dir($retained)&&!rmdir($retained))throw new RuntimeException('Google snapshot removal failed.');
        });
    });
}

function genesisGoogleDailyQuotaError(Throwable $error): bool
{
    return $error instanceof GenesisGoogleHttpException && in_array($error->status, [403, 429], true)
        && (str_contains($error->googleError, 'DAILY_QUOTA')
            || preg_match('/per day|dailyLimitExceeded|daily quota|суточн/ui', $error->getMessage()) === 1);
}

function genesisGoogleDailyRetryAt(int $now): int
{
    // Google daily API quotas reset at midnight Pacific, including daylight saving time.
    $date = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone('America/Los_Angeles'));
    return $date->modify('tomorrow')->setTime(0, 5)->getTimestamp();
}

function genesisGoogleQuotaState(string $service): array
{
    $path = genesisGoogleCacheDirectory() . '/quota-' . $service . '.json';
    $state = is_file($path) ? json_decode((string)file_get_contents($path), true) : null;
    return is_array($state) ? $state : [];
}

function genesisGoogleQuotaWarning(string $service): string
{
    return 'Исчерпана суточная квота проекта GENESIS для Google ' . ($service === 'tasks' ? 'Tasks' : 'Calendar')
        . '. Вход в аккаунт работает. Сохранённые данные доступны; синхронизация возобновится после сброса лимита Google.';
}

function genesisGoogleQuotaCheck(string $service, ?int $now = null): void
{
    if ((int)(genesisGoogleQuotaState($service)['retryAt'] ?? 0) > ($now ?? time())) {
        throw new GenesisGoogleHttpException(429, 'GENESIS_GOOGLE_DAILY_QUOTA', genesisGoogleQuotaWarning($service));
    }
}

function genesisGoogleRecordQuotaError(string $service, Throwable $error, ?int $now = null): void
{
    if (!genesisGoogleDailyQuotaError($error)) return;
    $path = genesisGoogleCacheDirectory() . '/quota-' . $service . '.json';
    file_put_contents($path,
        json_encode(['retryAt' => genesisGoogleDailyRetryAt($now ?? time())], JSON_THROW_ON_ERROR), LOCK_EX);
    chmod($path, 0600);
}

function genesisGoogleSyncFailureMessage(Throwable $error, string $service): string
{
    if (genesisGoogleDailyQuotaError($error)) return genesisGoogleQuotaWarning($service);
    if ($error instanceof GenesisGoogleHttpException && in_array($error->status, [403, 429], true)) {
        return 'Google ' . ($service === 'tasks' ? 'Tasks' : 'Calendar') . ' временно ограничил запросы. Данные сохранены; GENESIS повторит синхронизацию позже.';
    }
    return 'Не удалось обновить Google ' . ($service === 'tasks' ? 'Tasks' : 'Calendar')
        . '. Показаны сохранённые данные. Проверьте доступ к сервису в настройках аккаунта.';
}

/** One full pull per day; bounded incremental pulls only while clients request account data. */
function genesisGoogleReadSnapshot(array $user, callable $calendarLoader, callable $tasksLoader, ?int $now = null): array
{
    $now ??= time();
    return genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($user, $calendarLoader, $tasksLoader, $now): array {
        foreach (['calendar' => GENESIS_GOOGLE_CALENDAR_SCOPE, 'tasks' => GENESIS_GOOGLE_TASKS_SCOPE] as $service => $scope) {
            if (!genesisGoogleScopeGranted($user, $scope)) { unset($snapshot[$service]); continue; }
            $state = $snapshot[$service] ?? [];
            if ((int)($state['nextAttempt'] ?? 0) <= $now) {
                try {
                    genesisGoogleQuotaCheck($service, $now);
                    $full = (int)($state['fullAt'] ?? 0) + GENESIS_GOOGLE_FULL_SYNC_SECONDS <= $now;
                    $fresh = ($service === 'calendar' ? $calendarLoader : $tasksLoader)($state, $full);
                    $full = $full || !empty($fresh['fullRead']);
                    unset($fresh['fullRead']);
                    $state = [...$state, ...$fresh, 'checkedAt' => $now,
                        'fullAt' => $full ? $now : ($state['fullAt'] ?? $now),
                        'nextAttempt' => $now + GENESIS_GOOGLE_INCREMENTAL_SECONDS, 'warning' => null];
                } catch (Throwable $error) {
                    genesisGoogleRecordQuotaError($service, $error, $now);
                    $state['warning'] = genesisGoogleSyncFailureMessage($error, $service);
                    $state['nextAttempt'] = genesisGoogleDailyQuotaError($error) ? genesisGoogleDailyRetryAt($now) : $now + GENESIS_GOOGLE_INCREMENTAL_SECONDS;
                    if (!genesisGoogleDailyQuotaError($error)) genesisLogError('[GoogleSync:' . $service . '] refresh failed', $error);
                }
            }
            if ((int)(genesisGoogleQuotaState($service)['retryAt'] ?? 0) > $now) $state['warning'] = genesisGoogleQuotaWarning($service);
            $snapshot[$service] = $state;
        }
        return $snapshot;
    });
}

/** Local writes update the snapshot immediately, without triggering another full Google read. */
function genesisGoogleSnapshotTaskSaved(array $user, array $task): void
{
    genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($task): void {
        $service = !empty($task['googleTaskId']) ? 'tasks' : 'calendar';
        $items = $snapshot[$service]['items'] ?? [];
        $items = array_values(array_filter($items, static fn(array $item): bool =>
            !($service === 'tasks'
                ? ($item['googleTaskId'] ?? null) === ($task['googleTaskId'] ?? null) && ($item['googleTaskListId'] ?? null) === ($task['googleTaskListId'] ?? null)
                : ($item['googleEventId'] ?? null) === ($task['googleEventId'] ?? null))));
        $items[] = $task;
        $snapshot[$service]['items'] = $items;
    });
}

function genesisGoogleSnapshotTaskDeleted(array $user, array $task, string $taskId): void
{
    genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($task, $taskId): void {
        foreach (['calendar', 'tasks'] as $service) {
            $snapshot[$service]['items'] = array_values(array_filter($snapshot[$service]['items'] ?? [], static fn(array $item): bool =>
                ($item['id'] ?? '') !== $taskId && !($service === 'tasks'
                    ? !empty($task['googleTaskId']) && ($item['googleTaskId'] ?? null) === $task['googleTaskId'] && ($item['googleTaskListId'] ?? null) === ($task['googleTaskListId'] ?? null)
                    : !empty($task['googleEventId']) && ($item['googleEventId'] ?? null) === $task['googleEventId'])));
        }
    });
}

function genesisGoogleSnapshotListSaved(array $user, array $list, bool $deleted = false): void
{
    genesisGoogleCacheWithLock($user, function (array &$snapshot) use ($list, $deleted): void {
        $lists = $snapshot['tasks']['lists'] ?? [];
        $old = array_values(array_filter($lists, static fn(array $row): bool => $row['id'] === $list['id']))[0] ?? [];
        $lists = array_values(array_filter($lists, static fn(array $row): bool => $row['id'] !== $list['id']));
        if (!$deleted) $lists[] = [...$old, ...$list];
        $snapshot['tasks']['lists'] = $lists;
        $items = [];
        foreach ($snapshot['tasks']['items'] ?? [] as $task) {
            if (($task['googleTaskListId'] ?? '') === $list['id']) {
                if ($deleted) continue;
                $task['googleTaskListTitle'] = $list['title'];
            }
            $items[] = $task;
        }
        $snapshot['tasks']['items'] = $items;
    });
}
