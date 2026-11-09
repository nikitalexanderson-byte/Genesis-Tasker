<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
require_once __DIR__ . '/resource-limits.php';

function genesisRoot(): string
{
    return dirname(__DIR__);
}

function genesisConfig(): array
{
    static $config;
    if (is_array($config)) {
        return $config;
    }

    $path = genesisRoot() . '/config.php';
    // Explicit local harness only. HTTP input and production SAPIs cannot select a config.
    if (in_array(PHP_SAPI, ['cli', 'cli-server'], true) && defined('GENESIS_LOCAL_TEST_CONFIG')) {
        $path = (string)GENESIS_LOCAL_TEST_CONFIG;
    }
    if (!is_file($path)) {
        throw new RuntimeException('GENESIS server is not configured.');
    }
    $config = require $path;
    if (!is_array($config)) {
        throw new RuntimeException('Invalid GENESIS configuration.');
    }
    date_default_timezone_set((string)($config['timezone'] ?? 'Europe/Moscow'));
    return $config;
}

function genesisEnsureDirectory(string $path, int $mode = 0700): void
{
    if (!is_dir($path) && !mkdir($path, $mode, true) && !is_dir($path)) {
        throw new RuntimeException('Cannot create server data directory.');
    }
    @chmod($path, $mode);
}

function genesisStartSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $config = genesisConfig();
    $sessionPath = (string)$config['session_path'];
    genesisEnsureDirectory($sessionPath);
    session_save_path($sessionPath);
    session_name('GENESISSESSID');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => (bool)($config['cookie_secure'] ?? true),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
    }
}

/** Renew from the session heartbeat; identity lookups and binary downloads stay read-only. */
function genesisRenewSessionCookie(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE || headers_sent()) return;
    $now=time();$last=(int)($_SESSION['cookie_renewed_at']??0);
    if($last>0&&$last<=$now&&$now-$last<43200)return;
    if(genesisCurrentUserId()===null)return;
    $params=session_get_cookie_params();
    if(setcookie(session_name(),session_id(),[
        'expires'=>$now+60*60*24*30,'path'=>$params['path'],'domain'=>$params['domain'],
        'secure'=>$params['secure'],'httponly'=>$params['httponly'],'samesite'=>$params['samesite']??'Lax',
    ]))$_SESSION['cookie_renewed_at']=$now;
}

function genesisDb(): PDO
{
    static $db;
    if ($db instanceof PDO) {
        return $db;
    }
    $config = genesisConfig();
    $path = (string)$config['db_path'];
    genesisEnsureDirectory(dirname($path));
    $db = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $db->exec('PRAGMA foreign_keys = ON');
    $db->exec('PRAGMA journal_mode = WAL');
    $db->exec('PRAGMA busy_timeout = 5000');
    require_once __DIR__ . '/shared-content-storage.php';
    genesisRegisterSharedContentFunctions($db);

    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    $migrationFiles = glob(genesisRoot() . '/migrations/*.sql') ?: [];
    sort($migrationFiles, SORT_STRING);
    $alreadyApplied = $db->prepare('SELECT 1 FROM schema_migrations WHERE name = :name LIMIT 1');
    $markApplied = $db->prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (:name, :applied_at)');
    foreach ($migrationFiles as $migrationFile) {
        $name = basename($migrationFile);
        $alreadyApplied->execute(['name' => $name]);
        if ($alreadyApplied->fetchColumn() !== false) {
            continue;
        }
        $migration = file_get_contents($migrationFile);
        if ($migration === false) {
            throw new RuntimeException('Database migration is unreadable: ' . $name);
        }
        $db->beginTransaction();
        try {
            $db->exec($migration);
            $markApplied->execute(['name' => $name, 'applied_at' => genesisNow()]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
    }
    genesisInitializeSharedContentStorage($db);
    genesisInitializeSharedTrashReadView($db);
    genesisInitializeSharedMapProjectIndex($db);
    genesisInitializeSharedTaskDetails($db);
    return $db;
}

function genesisJson(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function genesisReadJson(): array
{
    $path = trim((string)($_GET['path'] ?? $_SERVER['PATH_INFO'] ?? ''), '/');
    $stream = fopen('php://input', 'rb');
    if ($stream === false) throw new InvalidArgumentException('REQUEST_UNREADABLE');
    try {
        $length = filter_var($_SERVER['CONTENT_LENGTH'] ?? null, FILTER_VALIDATE_INT);
        $raw = genesisBoundedBody($stream, genesisJsonBodyLimit($path), $length === false ? null : $length);
    } finally { fclose($stream); }
    $userId = genesisCurrentUserId();
    genesisConsumeApiBudget($userId === null ? 'ip:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') : 'user:' . $userId,
        'body', 3000, $userId === null ? 16 * 1024 * 1024 : 256 * 1024 * 1024, strlen($raw));
    if (trim($raw) === '') {
        return [];
    }
    $value = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($value)) {
        throw new InvalidArgumentException('JSON object expected.');
    }
    return $value;
}

function genesisUuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function genesisNow(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function genesisLogError(string $message, ?Throwable $error = null): void
{
    $cleanMessage = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $message) ?: 'Application error';
    $cleanMessage = mb_substr(trim($cleanMessage), 0, 1000);
    $logLine = sprintf(
        "[%s] %s%s\n",
        gmdate('Y-m-d\TH:i:s\Z'),
        $cleanMessage,
        $error !== null ? sprintf(' [%s] %s:%d', get_class($error), basename($error->getFile()), $error->getLine()) : '',
    );
    $logPath = dirname((string)genesisConfig()['db_path']) . '/app-error.log';
    @file_put_contents($logPath, $logLine, FILE_APPEND | LOCK_EX);
}

function genesisClientTimeZone(): DateTimeZone
{
    $fallback = (string)(genesisConfig()['timezone'] ?? 'Europe/Moscow');
    $requested = trim((string)($_SERVER['HTTP_X_GENESIS_TIME_ZONE'] ?? ''));
    try {
        return new DateTimeZone($requested !== '' ? $requested : $fallback);
    } catch (Throwable) {
        return new DateTimeZone($fallback);
    }
}

function genesisClientDayKey(): string
{
    return (new DateTimeImmutable('now', genesisClientTimeZone()))->format('Y-m-d');
}

function genesisCurrentUserId(): ?string
{
    $id = $_SESSION['user_id'] ?? null;
    if (!is_string($id) || $id === '') return null;
    $user = genesisFindUser($id);
    $valid = $user !== null;
    if ($valid && (int)($_SESSION['security_epoch'] ?? 0) !== (int)($user['security_epoch'] ?? 0)) $valid=false;
    if ($valid && genesisUserProvider($user) === 'google') {
        $identity = $_SESSION['auth_identity'] ?? null;
        // Old cookies cannot prove whether primary or linked Google identity signed in.
        // Require a new verified login rather than assigning primary privileges to them.
        $valid = is_array($identity) && is_string($identity['sub'] ?? null);
        if ($valid && ($identity['kind'] ?? '') === 'primary') {
            $valid = (bool)$user['google_login_active'] && hash_equals((string)$user['google_sub'], $identity['sub']);
        } elseif ($valid && ($identity['kind'] ?? '') === 'linked') {
            $query = genesisDb()->prepare('SELECT 1 FROM linked_google_accounts
                WHERE id = :account AND owner_user_id = :owner AND google_sub = :sub AND login_active=1');
            $query->execute(['account' => $identity['account_id'] ?? '', 'owner' => $id, 'sub' => $identity['sub']]);
            $valid = $query->fetchColumn() !== false;
        } else {
            $valid = false;
        }
    }
    if (!$valid) {
        unset($_SESSION['user_id'], $_SESSION['auth_identity'], $_SESSION['authenticated_at'], $_SESSION['pending_local_link']);
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
        return null;
    }
    return $id;
}

/** Called only with a profile verified by the Google code/token exchange. */
function genesisEstablishGoogleSession(array $user, string $verifiedSub, array $verifiedProfile = [], string $channel = 'unknown'): void
{
    if ($verifiedSub === '' || genesisUserProvider($user) !== 'google') throw new RuntimeException('Invalid authentication identity.');
    $identity = ['kind' => 'primary', 'sub' => $verifiedSub];
    if (!hash_equals((string)$user['google_sub'], $verifiedSub)) {
        $query = genesisDb()->prepare('SELECT id FROM linked_google_accounts
            WHERE owner_user_id = :owner AND google_sub = :sub');
        $query->execute(['owner' => $user['id'], 'sub' => $verifiedSub]);
        $accountId = $query->fetchColumn();
        if (!is_string($accountId)) throw new RuntimeException('Authentication identity is no longer linked.');
        $identity = ['kind' => 'linked', 'sub' => $verifiedSub, 'account_id' => $accountId];
    }
    $_SESSION['user_id'] = (string)$user['id'];
    $_SESSION['security_epoch'] = (int)($user['security_epoch'] ?? 0);
    $_SESSION['auth_identity'] = $identity;
    // Only server-side provider exchanges supply these claims. Never infer verified email
    // from the workspace owner: a linked identity can have a different email.
    $_SESSION['auth_identity']['email'] = is_string($verifiedProfile['email'] ?? null)
        ? strtolower(trim($verifiedProfile['email'])) : '';
    $_SESSION['auth_identity']['email_verified'] = ($verifiedProfile['email_verified'] ?? null) === true
        && ($verifiedProfile['sub'] ?? null) === $verifiedSub;
    $_SESSION['auth_identity']['channel'] = in_array($channel, ['web', 'native'], true) ? $channel : 'unknown';
    $_SESSION['authenticated_at'] = time();
    $_SESSION['auth_login_id'] = bin2hex(random_bytes(16));
    $_SESSION['csrf'] = bin2hex(random_bytes(24));
    genesisObserveClientActivity((string)$user['id'], true);
}

function genesisSessionIsPrimaryGoogleUser(array $user): bool
{
    return genesisCurrentUserId() === (string)$user['id']
        && ($_SESSION['auth_identity']['kind'] ?? '') === 'primary'
        && hash_equals((string)$user['google_sub'], (string)($_SESSION['auth_identity']['sub'] ?? ''));
}

/** A verified, still-linked Google identity opens the canonical owner's account. */
function genesisSessionOwnsGoogleAccount(array $user): bool
{
    // genesisCurrentUserId rechecks primary sub or the exact live link ID on every call.
    if (genesisUserProvider($user) !== 'google' || genesisCurrentUserId() !== (string)$user['id']) return false;
    if (($_SESSION['auth_identity']['kind'] ?? '') === 'primary') return genesisSessionIsPrimaryGoogleUser($user);
    return ($_SESSION['auth_identity']['kind'] ?? '') === 'linked'
        && is_string($_SESSION['auth_identity']['account_id'] ?? null) && $_SESSION['auth_identity']['account_id'] !== ''
        && is_string($_SESSION['auth_identity']['sub'] ?? null) && $_SESSION['auth_identity']['sub'] !== '';
}

function genesisRequireUserId(): string
{
    $id = genesisCurrentUserId();
    if ($id === null) {
        genesisJson(['error' => 'AUTH_REQUIRED'], 401);
    }
    genesisObserveClientActivity($id);
    return $id;
}

function genesisRequireCsrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $known = $_SESSION['csrf'] ?? '';
    if (!is_string($sent) || !is_string($known) || $known === '' || !hash_equals($known, $sent)) {
        genesisJson(['error' => 'CSRF token mismatch.'], 403);
    }
}

/** The authenticated shared API never writes session state after this boundary. */
function genesisSharedRequestUserId(string $method): string
{
    $userId = genesisRequireUserId();
    if ($method !== 'GET') genesisRequireCsrf();
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    return $userId;
}

function genesisEncrypt(?string $plain): ?string
{
    if ($plain === null || $plain === '') {
        return null;
    }
    $key = base64_decode((string)genesisConfig()['crypto_key'], true);
    if (!is_string($key) || strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
        throw new RuntimeException('Invalid encryption key.');
    }
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
}

function genesisDecrypt(?string $encoded): ?string
{
    if ($encoded === null || $encoded === '') {
        return null;
    }
    $key = base64_decode((string)genesisConfig()['crypto_key'], true);
    $blob = base64_decode($encoded, true);
    if (!is_string($key) || strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES || !is_string($blob)) {
        return null;
    }
    $nonce = substr($blob, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $cipher = substr($blob, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
    return is_string($plain) ? $plain : null;
}

function genesisIdentifierHash(string $namespace, string $value): string
{
    $key = base64_decode((string)genesisConfig()['crypto_key'], true);
    if (!is_string($key) || strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
        throw new RuntimeException('Invalid encryption key.');
    }
    $normalized = mb_strtolower(trim($value));
    return hash_hmac('sha256', $namespace . "\0" . $normalized, $key);
}

function genesisClampInt(mixed $value, int $min, int $max, int $fallback): int
{
    if (!is_numeric($value)) {
        return $fallback;
    }
    return max($min, min($max, (int)$value));
}

if (!defined('GENESIS_STATELESS_REQUEST') || !GENESIS_STATELESS_REQUEST) {
    genesisStartSession();
}
