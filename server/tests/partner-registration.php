<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
$directory = getenv('GENESIS_QA_TEST_DIR') ?: sys_get_temp_dir() . '/genesis-partner-registration-' . bin2hex(random_bytes(8));
if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Cannot create isolated fixture');
if (!is_dir($directory . '/sessions')) mkdir($directory . '/sessions', 0700);
$path = $directory . '/partner-config.php';
if (file_exists($path) || file_exists($directory . '/partners.sqlite')) throw new RuntimeException('Fresh fixture required');
$config = ['app_url' => 'http://127.0.0.1:4399', 'google_only' => true, 'google_client_id' => '', 'google_client_secret' => '',
    'crypto_key' => base64_encode(random_bytes(32)), 'db_path' => $directory . '/partners.sqlite', 'session_path' => $directory . '/sessions',
    'cookie_secure' => false, 'timezone' => 'Europe/Moscow', 'admin_email' => 'owner@example.invalid',
    'notifications' => ['email' => ['transport' => 'disabled']], 'billing' => ['enabled' => false],
    'partners' => ['enabled' => true, 'allowed_emails' => ['partner@example.invalid']]];
file_put_contents($path, '<?php return ' . var_export($config, true) . ';');
define('GENESIS_LOCAL_TEST_CONFIG', $path);
foreach (['bootstrap', 'repository', 'billing'] as $module) require_once dirname(__DIR__) . '/src/' . $module . '.php';
$cases = 0;
function registrationCheck(bool $condition, string $message): void { $GLOBALS['cases']++; if (!$condition) throw new RuntimeException($message); }
function registrationProfile(string $id): array { return ['sub' => 'synthetic-' . $id, 'email' => $id . '@example.invalid', 'email_verified' => true, 'name' => 'Synthetic ' . $id]; }
function registrationRequest(array $input): array { return [...$input, 'requestId' => 'fixture_' . bin2hex(random_bytes(12))]; }
$db = genesisDb();
$ownerProfile = registrationProfile('owner'); $owner = genesisUpsertGoogleUser($ownerProfile, [], false, true);
$partner = genesisUpsertGoogleUser(registrationProfile('partner'), [], false, true);
$existing = genesisUpsertGoogleUser(registrationProfile('existing'), [], false, true);
genesisEstablishGoogleSession($owner, $ownerProfile['sub'], $ownerProfile, 'web');
genesisPartnerConfigure($owner['id'], registrationRequest(['expectedRevision' => 0, 'invitationDays' => 30, 'retentionDays' => null, 'confirmed' => true]));
$partnerId = genesisPartnerAssign($owner['id'], registrationRequest(['userId' => $partner['id'], 'email' => $partner['email'], 'label' => 'Synthetic partner']))['id'];
genesisPartnerUpdate($owner['id'], $partnerId, registrationRequest(['expectedRevision' => 1, 'acceptsInvitations' => true, 'panelEnabled' => true, 'reason' => 'Isolated registration acceptance']));
registrationCheck(genesisUserForClient($partner)['isAdmin'] === false && genesisUserForClient($partner)['partnerAccess']['panelEnabled'], 'Partner acquired admin rights or lost its limited panel');
registrationCheck(genesisUserForClient($existing)['partnerAccess'] === null, 'Ordinary account acquired partner rights');
$code = genesisPartnerRow($db, $partnerId)['code'];
$_SESSION = [];
$invite = genesisPartnerCapture($db, $code, null); $_COOKIE['genesis_referral'] = $invite['token'];
$hash = genesisPartnerOAuthInvitation('login');
registrationCheck($hash === genesisPartnerInviteHash($invite['token']), 'OAuth start did not select the session invitation');
foreach (['services', 'link', 'reauth', 'recovery'] as $purpose) registrationCheck(genesisPartnerOAuthInvitation($purpose) === null, 'Service/link/security authorization captured a referral');
$newProfile = registrationProfile('new-client');
$new = genesisUpsertGoogleUser($newProfile, [], false, true, $hash);
genesisPartnerFinishOAuth($hash);
$q = $db->prepare('SELECT * FROM partner_clients WHERE user_id=? AND ended_at IS NULL'); $q->execute([$new['id']]); $binding = $q->fetch(); $q->closeCursor();
registrationCheck($binding && $binding['partner_id'] === $partnerId && $binding['source'] === 'google-registration', 'Actual new Google user insertion did not bind atomically');
registrationCheck(!isset($_COOKIE['genesis_referral']), 'Successful OAuth left an invitation for a different login');
registrationCheck((int)$db->query('SELECT COUNT(*) FROM partner_clients')->fetchColumn() === 1, 'Unexpected attribution count');
$again = genesisUpsertGoogleUser($newProfile, [], false, true, $hash);
registrationCheck($again['id'] === $new['id'] && (int)$db->query('SELECT COUNT(*) FROM partner_clients')->fetchColumn() === 1, 'Repeated Google login created another binding');
$existingInvite = genesisPartnerCapture($db, $code, null);
$existingHash = genesisPartnerInviteHash($existingInvite['token']);
$existingAgain = genesisUpsertGoogleUser(registrationProfile('existing'), [], false, true, $existingHash);
genesisPartnerFinishOAuth($existingHash);
$q->execute([$existingAgain['id']]); registrationCheck($q->fetch() === false, 'Existing Google account was automatically attributed'); $q->closeCursor();
$newAttempt = genesisUpsertGoogleUser(registrationProfile('different-client'), [], false, true, $existingHash);
$q->execute([$newAttempt['id']]); registrationCheck($q->fetch() === false, 'An invitation consumed by another account leaked into a new registration'); $q->closeCursor();
$noInvite = genesisUpsertGoogleUser(registrationProfile('other-device'), [], false, true);
$q->execute([$noInvite['id']]); registrationCheck($q->fetch() === false, 'A different device was identified without a code'); $q->closeCursor();
$codeOnOtherDevice = genesisPartnerCapture($db, $code, null);
$manualDevice = genesisUpsertGoogleUser(registrationProfile('other-device-with-code'), [], false, true, genesisPartnerInviteHash($codeOnOtherDevice['token']));
$q->execute([$manualDevice['id']]); registrationCheck($q->fetch() !== false, 'Explicit code on another device did not bind the new registration'); $q->closeCursor();
$bad = registrationProfile('unverified'); $bad['email_verified'] = false;
try { genesisUpsertGoogleUser($bad, [], false, true, genesisPartnerInviteHash($codeOnOtherDevice['token'])); throw new RuntimeException('Unverified Google profile accepted'); }
catch (InvalidArgumentException) { registrationCheck(true, 'Verified identity guard kept'); }
genesisEstablishGoogleSession($partner, $partner['google_sub'], registrationProfile('partner'), 'web');
registrationCheck(genesisPartnerOAuthInvitation('login') === null, 'Signed-in account adopted an anonymous invitation');
$_SESSION = [];
$before = $db->query('SELECT COUNT(*) FROM partner_clients')->fetchColumn();
genesisDeleteAccountRows($new['id']);
$recreated = genesisUpsertGoogleUser($newProfile, [], false, true);
registrationCheck($recreated['id'] !== $new['id'], 'Account recreation reused a deleted internal identity');
$q->execute([$recreated['id']]); registrationCheck($q->fetch() === false, 'Deleted/recreated account was silently matched to a referral'); $q->closeCursor();
registrationCheck($db->query('SELECT COUNT(*) FROM partner_clients')->fetchColumn() === $before, 'Deletion destroyed pseudonymous referral history');
$q->execute([$new['id']]); registrationCheck($q->fetch() === false, 'Deleted referral retained a live user link'); $q->closeCursor();
$queued = (int)$db->query('SELECT COUNT(*) FROM account_email_outbox')->fetchColumn();
registrationCheck($queued > 0 && (genesisConfig()['notifications']['email']['transport'] ?? '') === 'disabled', 'Synthetic registration notification safety changed');
echo "PASS partner registration: $cases actual repository/OAuth-context/role/deletion checks; no Google or email network traffic.\n";
