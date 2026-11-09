<?php
declare(strict_types=1);
// Standalone fixtures: never read server/config.php or open an application database.
if (PHP_SAPI !== 'cli') exit;
final class SubscriptionTestResponse extends RuntimeException {
    public function __construct(public readonly int $status, public readonly array $payload = []) { parent::__construct('Fixture HTTP ' . $status); }
}
function genesisConfig(): array { return ['admin_email' => 'admin@example.invalid','crypto_key'=>base64_encode(str_repeat('k',32))]; }
function genesisNow(): string { return gmdate('c'); }
function genesisCurrentUserId(): ?string { return $_SESSION['user_id'] ?? null; }
function genesisJson(array $payload, int $status = 200): never { throw new SubscriptionTestResponse($status, $payload); }
function genesisRequireUserId(): string {
    return genesisCurrentUserId() ?? throw new SubscriptionTestResponse(401);
}
function genesisRequireCsrf(): void {
    if (empty($GLOBALS['subscriptionFixtureCsrf'])) throw new SubscriptionTestResponse(403);
}
function genesisReadJson(): array { return $GLOBALS['subscriptionFixturePayload']; }
function genesisDb(): PDO { return $GLOBALS['subscriptionFixtureDb']; }
function checkSubscription(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
// Exercise the real primary-identity guard without loading configuration.
$bootstrap = file_get_contents(__DIR__ . '/../src/bootstrap.php');
if (!preg_match('/function genesisSessionIsPrimaryGoogleUser\(array \$user\): bool\s*\{.*?^\}/ms', $bootstrap, $match)) throw new RuntimeException('Primary identity guard missing');
eval($match[0]);
if (!preg_match('/function genesisIdentifierHash\(string \$namespace, string \$value\): string\s*\{.*?^\}/ms', $bootstrap, $match)) throw new RuntimeException('Identity hash missing');
eval($match[0]);
require_once __DIR__.'/../src/resource-limits.php';
if (!preg_match('/function genesisSessionOwnsGoogleAccount\(array \$user\): bool\s*\{.*?^\}/ms', $bootstrap, $match)) throw new RuntimeException('Account identity guard missing');
eval($match[0]);
require __DIR__ . '/../src/repository.php';
require __DIR__ . '/../src/subscriptions.php';

$old = new SQLite3(':memory:');
$old->exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, auth_provider TEXT, google_sub TEXT, updated_at TEXT); CREATE TABLE workspace_blobs (user_id TEXT PRIMARY KEY, ciphertext TEXT);');
$old->exec("INSERT INTO users VALUES ('existing','existing@example.invalid','Existing','google','existing-sub','old'); INSERT INTO workspace_blobs VALUES ('existing','opaque-workspace');");
$backup = new SQLite3(':memory:');
checkSubscription($old->backup($backup), 'Isolated backup failed');
$migration = file_get_contents(__DIR__ . '/../migrations/050_user_subscription_status.sql');
checkSubscription($old->exec($migration), 'Migration failed');
checkSubscription($old->querySingle("SELECT subscription_plan FROM users WHERE id='existing'") === 'free', 'Existing account default changed');
checkSubscription($old->querySingle('SELECT ciphertext FROM workspace_blobs') === 'opaque-workspace', 'Encrypted content changed');
$restored = new SQLite3(':memory:');
checkSubscription($backup->backup($restored), 'Isolated restore failed');
checkSubscription($restored->querySingle('SELECT ciphertext FROM workspace_blobs') === 'opaque-workspace', 'Restored content changed');
checkSubscription(!str_contains((string)$restored->querySingle("SELECT sql FROM sqlite_master WHERE name='users'"), 'subscription_plan'), 'Backup was not pre-migration');

$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$GLOBALS['subscriptionFixtureDb'] = $db;
$db->exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, auth_provider TEXT, google_sub TEXT, updated_at TEXT);');
$db->exec($migration);
$db->exec(file_get_contents(__DIR__.'/../migrations/090_subscription_valid_until.sql'));
$db->exec(file_get_contents(__DIR__.'/../migrations/093_billing_infrastructure.sql'));
$db->exec(file_get_contents(__DIR__.'/../migrations/104_subscription_trials.sql'));
$db->exec(file_get_contents(__DIR__.'/../migrations/111_forecast_elite_plus.sql'));
function genesisUuid():string { return bin2hex(random_bytes(16)); }
$db->exec('CREATE TABLE resource_quota_limits(name TEXT PRIMARY KEY,amount INTEGER); INSERT INTO resource_quota_limits VALUES(\'tasks_per_user\',100000); CREATE TABLE linked_google_accounts(id TEXT,owner_user_id TEXT,google_sub TEXT,email TEXT,position INTEGER,created_at TEXT)');
$db->exec("INSERT INTO users(id,email,display_name,auth_provider,google_sub,updated_at) VALUES ('admin','admin@example.invalid','Admin','google','admin-sub','old'), ('member','member@example.invalid','Member','google','member-sub','old'), ('yandex','admin@example.invalid','Other provider','yandex','other-sub','old');");
$_SESSION = ['user_id' => 'admin', 'auth_identity' => ['kind' => 'primary', 'sub' => 'admin-sub']];
$previous = 'free';
foreach (GENESIS_SUBSCRIPTION_PLANS as $plan) {
    $result = genesisAdminSetSubscription('admin', 'member', $plan, $previous,
        (int)genesisSubscriptionState($db,genesisFindUser('member'))['revision']);
    checkSubscription($result['subscriptionPlan'] === $plan && genesisSubscriptionPlanId(genesisFindUser('member')) === $plan, 'Plan did not persist');
    checkSubscription(!genesisIsAdminUser(genesisFindUser('member')), 'Plan granted administrator rights');
    $previous = $plan;
}
$plus=genesisFindUser('member');$access=genesisResolveFeatureAccess($plus,genesisFeatureAccessPolicy(),time()+365*86400);
checkSubscription(genesisSubscriptionPlanId($plus)==='elite_plus'&&$access['lifetimePremium']&&in_array('future-modeling',$access['allowedFeatures'],true),'Elite+ is not a permanent combined plan');
genesisAdminSetSubscription('admin','member','premium4life','elite_plus',(int)genesisSubscriptionState($db,$plus)['revision']);
checkSubscription(!genesisForecastElitePlus(genesisFindUser('member')),'Downgrade left a hidden modeling grant');
checkSubscription(genesisFindUser('member')['google_sub'] === 'member-sub', 'Identity changed');
$revision=(int)genesisSubscriptionState($db,genesisFindUser('member'))['revision'];
try { genesisAdminSetSubscription('admin','member','free','premium4life'); throw new RuntimeException('Legacy reset bypassed revision'); }
catch (InvalidArgumentException $error) { checkSubscription($error->getMessage()==='SUBSCRIPTION_REVISION_REQUIRED','Wrong missing revision error'); }
try { genesisAdminSetSubscription('admin','member','premium','premium4life',$revision-1); throw new RuntimeException('Stale paid assignment accepted'); }
catch (GenesisResourceLimitException $error) { checkSubscription($error->getMessage()==='SUBSCRIPTION_STATUS_CONFLICT','Wrong stale revision error'); }
$db->exec("CREATE TRIGGER synthetic_access_revision_failure BEFORE UPDATE ON subscription_access_state BEGIN SELECT RAISE(ABORT,'synthetic_revision_failure'); END");
try { genesisAdminSetSubscription('admin','member','premium','premium4life',$revision); throw new RuntimeException('Injected failure was ignored'); }
catch (PDOException) {}
$db->exec('DROP TRIGGER synthetic_access_revision_failure');
checkSubscription(genesisFindUser('member')['subscription_plan']==='premium4life'
    && (int)genesisSubscriptionState($db,genesisFindUser('member'))['revision']===$revision,'Non-atomic plan/revision change');
foreach (['invalid', 'Premium4Life', 'standard', ''] as $plan) {
    try { genesisAdminSetSubscription('admin', 'member', $plan, 'premium4life'); throw new RuntimeException('Invalid plan accepted'); }
    catch (InvalidArgumentException $error) { checkSubscription($error->getMessage() === 'INVALID_SUBSCRIPTION_PLAN', 'Wrong validation failure'); }
}
try { genesisAdminSetSubscription('admin', 'member', 'free', 'standart'); throw new RuntimeException('Stale write accepted'); }
catch (DomainException $error) { checkSubscription($error->getMessage() === 'SUBSCRIPTION_STATUS_CONFLICT', 'Wrong conflict'); }
checkSubscription(genesisFindUser('member')['subscription_plan'] === 'premium4life', 'Conflict overwrote status');
try { genesisAdminSetSubscription('admin', 'missing', 'free', 'free'); throw new RuntimeException('Missing target accepted'); }
catch (DomainException $error) { checkSubscription($error->getMessage() === 'SUBSCRIPTION_USER_NOT_FOUND', 'Wrong missing target'); }
foreach ([['member','primary','member-sub',null], ['admin','linked','admin-sub','linked-account'],
    ['admin','linked','linked-member-sub','linked-account'], ['admin','primary','wrong-sub',null],
    ['yandex','primary','other-sub',null]] as [$actor,$kind,$sub,$accountId]) {
    $_SESSION = ['user_id' => $actor, 'auth_identity' => ['kind' => $kind, 'sub' => $sub, 'account_id' => $accountId]];
    $beforePlan = genesisFindUser('member')['subscription_plan'];
    try { genesisAdminSetSubscription($actor, 'member', 'free', 'premium4life'); throw new RuntimeException('Forbidden identity accepted'); }
    catch (SubscriptionTestResponse $error) { checkSubscription($error->status === 403, 'Wrong access response'); }
    checkSubscription(genesisFindUser('member')['subscription_plan'] === $beforePlan, 'Forbidden identity changed the plan');
}
try { $db->exec("UPDATE users SET subscription_plan='unexpected' WHERE id='member'"); throw new RuntimeException('Database accepted invalid plan'); }
catch (PDOException) {}
checkSubscription(genesisFindUser('member')['subscription_plan'] === 'premium4life', 'Rejected write changed status');

// Execute the real HTTP handlers from a deployed public_html/api location. Calling
// only genesisAdminSetSubscription cannot detect a broken production require path.
$api = file_get_contents(__DIR__ . '/../public/api/index.php');
$routeStart = strpos($api, "    if (\$method === 'POST' && count(\$segments) === 4 && \$segments[0] === 'admin' && \$segments[1] === 'users' && \$segments[3] === 'reset-access')");
$routeEnd = strpos($api, "    if (\$method === 'GET' && \$path === 'admin/stats')", $routeStart ?: 0);
checkSubscription($routeStart !== false && $routeEnd !== false, 'Admin subscription route boundaries missing');
$fixtureRoot = sys_get_temp_dir() . '/genesis-subscription-route-' . bin2hex(random_bytes(8));
$entry = $fixtureRoot . '/public_html/api/index.php';
checkSubscription(mkdir(dirname($entry), 0700, true), 'Could not create isolated deployed route');
file_put_contents($entry, "<?php\n" . substr($api, $routeStart, $routeEnd - $routeStart));
$request = static function (string $method, string $action, array $payload, bool $csrf = true) use ($entry): SubscriptionTestResponse {
    $serverRoot = dirname(__DIR__);
    $segments = ['admin', 'users', 'member', $action];
    $GLOBALS['subscriptionFixturePayload'] = $payload;
    $GLOBALS['subscriptionFixtureCsrf'] = $csrf;
    try { require $entry; }
    catch (SubscriptionTestResponse $response) { return $response; }
    throw new RuntimeException('Subscription route did not respond');
};
try {
    $_SESSION = ['user_id' => 'admin', 'auth_identity' => ['kind' => 'primary', 'sub' => 'admin-sub']];
    $currentPlan = 'premium4life';
    $currentRevision = (int)genesisSubscriptionState($db, genesisFindUser('member'))['revision'];
    foreach (['free', 'standart', 'premium', 'business', 'premium4life'] as $plan) {
        $response = $request($plan === 'free' ? 'POST' : 'PUT', $plan === 'free' ? 'reset-access' : 'subscription',
            ['subscriptionPlan' => $plan, 'expectedPlan' => $currentPlan, 'expectedRevision' => $currentRevision]);
        checkSubscription($response->status === 200 && $response->payload['subscriptionPlan'] === $plan
            && $response->payload['subscriptionRevision'] === $currentRevision + 1, 'Deployed route failed to save plan/revision');
        checkSubscription(genesisFindUser('member')['subscription_plan'] === $plan, 'Deployed route did not persist plan');
        $currentPlan = $plan;
        $currentRevision = $response->payload['subscriptionRevision'];
    }
    // A stale revision must fail even when another admin kept the same plan label.
    try {
        $request('PUT', 'subscription', ['subscriptionPlan' => 'premium', 'expectedPlan' => $currentPlan, 'expectedRevision' => $currentRevision - 1]);
        throw new RuntimeException('Deployed route accepted stale revision');
    } catch (GenesisResourceLimitException $error) {
        checkSubscription($error->getMessage() === 'SUBSCRIPTION_STATUS_CONFLICT', 'Wrong routed conflict');
    }
    $denied = $request('PUT', 'subscription', ['subscriptionPlan' => 'premium', 'expectedPlan' => $currentPlan], false);
    checkSubscription($denied->status === 403, 'Deployed route skipped CSRF');
    checkSubscription(genesisFindUser('member')['subscription_plan'] === $currentPlan, 'Rejected routed write changed plan');
    unset($_SESSION['user_id']);
    checkSubscription($request('PUT', 'subscription', [])->status === 401, 'Deployed route skipped authentication');
} finally {
    unlink($entry);
    rmdir(dirname($entry));
    rmdir($fixtureRoot . '/public_html');
    rmdir($fixtureRoot);
}
echo "PASS deployed admin subscription routes: all plans, revision forwarding, conflicts, authentication and CSRF.\n";
echo "PASS subscription metadata: defaults, preservation, backup/restore, five plans, persistence, invalid values, conflicts, primary admin guard, provider isolation, no role escalation.\n";
