<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
function lifetime314Check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec("PRAGMA foreign_keys = ON;
CREATE TABLE users(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, subscription_plan TEXT NOT NULL DEFAULT 'free', subscription_valid_until TEXT);
CREATE TABLE blobs(user_id TEXT PRIMARY KEY REFERENCES users(id), ciphertext TEXT);
INSERT INTO users VALUES ('old-free','2026-10-01T00:00:00Z','free',NULL),
('old-business','2026-10-31T22:23:44Z','business','2027-01-01T00:00:00Z'),
('boundary','2026-10-31T22:23:45Z','free',NULL),
('future','2026-10-31T22:23:46Z','free',NULL);
INSERT INTO blobs VALUES ('old-free','opaque-encrypted-data');");
$before = $db->query('SELECT * FROM users ORDER BY id')->fetchAll();
$migration = file_get_contents(dirname(__DIR__) . '/migrations/092_lifetime_314_existing_accounts.sql');
$db->beginTransaction(); $db->exec($migration); $db->rollBack();
lifetime314Check($db->query('SELECT * FROM users ORDER BY id')->fetchAll() === $before, 'Migration rollback changed account metadata');
lifetime314Check($db->query("SELECT count(*) FROM sqlite_master WHERE name='subscription_lifetime_grants'")->fetchColumn() == 0, 'Rollback left a grant table');
$db->exec($migration);
foreach (['old-free', 'old-business', 'boundary'] as $id) {
    $query = $db->prepare('SELECT * FROM users WHERE id=?'); $query->execute([$id]); $user = $query->fetch();
    lifetime314Check($user['subscription_plan'] === 'premium4life' && $user['subscription_valid_until'] === null, 'Existing account did not get permanent full access');
}
lifetime314Check($db->query("SELECT subscription_plan FROM users WHERE id='future'")->fetchColumn() === 'free', 'Fixed cutoff granted a future registration');
$db->exec("INSERT INTO users(id,created_at) VALUES ('new-default','2027-01-01T00:00:00Z')");
lifetime314Check($db->query("SELECT subscription_plan FROM users WHERE id='new-default'")->fetchColumn() === 'free', 'New registration default is not Free');
$previous = $db->query("SELECT * FROM subscription_lifetime_grants WHERE user_id='old-business'")->fetch();
lifetime314Check($previous['previous_plan'] === 'business' && $previous['previous_valid_until'] === '2027-01-01T00:00:00Z', 'Previous plan evidence was not preserved');
lifetime314Check($db->query('SELECT ciphertext FROM blobs')->fetchColumn() === 'opaque-encrypted-data', 'Migration touched encrypted user content');
lifetime314Check(count($db->query('SELECT * FROM subscription_lifetime_grants')->fetchAll()) === 3, 'Wrong cohort grant count');
require dirname(__DIR__) . '/src/feature-access.php';
$access = genesisResolveFeatureAccess(['subscription_plan' => 'premium4life'], ['revision' => 'test', 'enforcementEnabled' => true,
    'features' => ['tasks' => ['free','premium','business'], 'team' => ['business'], 'automation' => ['business']]], strtotime('2050-01-01T00:00:00Z'));
lifetime314Check($access['lifetimePremium'] && $access['allowedFeatures'] === ['tasks','team','automation'], 'Lifetime access lost Business or expired');
lifetime314Check(!array_key_exists('isAdmin', $access) && !array_key_exists('role', $access), 'A product plan created an administrative role');
echo "PASS 3.1.4 lifetime cohort: exact cutoff, Free defaults, previous plan audit, atomic rollback, opaque data preservation and full Business capabilities.\n";
