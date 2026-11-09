<?php
declare(strict_types=1);
// Isolated, synthetic fixtures. No server configuration or application database.
if (PHP_SAPI !== 'cli') exit(1);
require dirname(__DIR__) . '/src/feature-access.php';
function accessCheck(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$now = strtotime('2026-10-30T00:00:00Z');
$policy = genesisFeatureAccessPolicy();
accessCheck($policy['enforcementEnabled'] === true, 'Approved 3.1.4 packages must enforce their limits');
$free = genesisResolveFeatureAccess(['subscription_plan' => 'free'], $policy, $now);
accessCheck($free['limits'] === ['personal-projects'=>5,'habits'=>5,'mindmaps'=>1,'diary'=>100] && $free['adviceDailyLimit'] === 1, 'Wrong Free quotas');
accessCheck(in_array('calendar-sync',$free['allowedFeatures'],true)
    && in_array('calendar-sync',$free['freeFeatures'],true), 'Google Calendar/Tasks sync must be included in Free');
accessCheck(in_array('stoicheion',$free['allowedFeatures'],true) && !in_array('stoicheion-timeline',$free['allowedFeatures'],true)
    && !in_array('theokyklos-olympians',$free['allowedFeatures'],true) && !in_array('messenger',$free['allowedFeatures'],true), 'Wrong Free capability split');
foreach (['standart'=>[20,10,5,365], 'premium'=>[100,20,100,1000], 'business'=>[100,20,100,3000,100,100]] as $plan=>$limits) {
    $actual = genesisResolveFeatureAccess(['subscription_plan'=>$plan,'subscription_valid_until'=>'2027-01-01T00:00:00Z'],$policy,$now);
    accessCheck(array_values($actual['limits']) === $limits && $actual['adviceDailyLimit'] === null, 'Wrong paid quotas');
    accessCheck(in_array('stoicheion-timeline',$actual['allowedFeatures'],true) && in_array('theokyklos-olympians',$actual['allowedFeatures'],true), 'Standart+ must include timeline and Olympians');
    accessCheck(in_array('messenger',$actual['allowedFeatures'],true) === ($plan === 'business'), 'Messenger is Business only');
    accessCheck(!in_array('assistant',$actual['allowedFeatures'],true), 'Assistant must remain disabled for every package');
}
$full = genesisResolveFeatureAccess(['subscription_plan'=>'premium4life'],$policy,$now);
foreach (['free','standart','premium','business','premium4life'] as $plan) {
    $access=genesisResolveFeatureAccess(['subscription_plan'=>$plan,'subscription_valid_until'=>'2030-01-01T00:00:00Z'],$policy,$now);
    foreach (['stoicheion','stoicheion-letters','calendar-sync'] as $feature)
        accessCheck(in_array($feature,$access['allowedFeatures'],true),"$plan lost $feature");
    foreach (['habit-timer','theokyklos-olympians','stoicheion-timeline','data-export'] as $feature)
        accessCheck(in_array($feature,$access['allowedFeatures'],true)===($plan!=='free'),"$plan has wrong $feature");
    foreach (['stoicheion-spread','stoicheion-restoration','future-modeling'] as $feature)
        accessCheck(in_array($feature,$access['allowedFeatures'],true)===in_array($plan,['premium','business','premium4life'],true),"$plan has wrong $feature");
}
accessCheck(in_array('messenger',$full['allowedFeatures'],true) && !in_array('assistant',$full['allowedFeatures'],true), 'Lifetime must include Business and respect global AI disable');
$future = ['revision' => 'synthetic-future', 'enforcementEnabled' => true,
    'features' => ['tasks' => ['free', 'standart', 'premium', 'business'], 'diary' => ['premium', 'business'], 'teams' => ['business']]];
foreach ([null, '', 'invalid', '2026-10-29T00:00:00Z', '2026-10-30T00:00:00Z',
    '2030-02-30T00:00:00Z', '2030-11-31T00:00:00Z', '2100-02-29T00:00:00Z',
    '2030-01-01T24:00:00Z', '2030-01-01T12:60:00Z', '2030-01-01T12:00:60Z',
    '2030-01-01T00:00:00+18:01', '2030-01-01T00:00:00-18:01',
    '2030-01-01T00:00:00+19:00', '2030-01-01T00:00:00+01:60'] as $expiry) {
    $access = genesisResolveFeatureAccess(['subscription_plan' => 'premium', 'subscription_valid_until' => $expiry], $future, $now);
    accessCheck($access['effectivePlan'] === 'free' && $access['allowedFeatures'] === ['tasks'], 'Unpaid/expired account kept paid capabilities');
}
$paid = genesisResolveFeatureAccess(['subscription_plan' => 'premium', 'subscription_valid_until' => '2026-11-30T03:00:00+03:00'], $future, $now);
accessCheck($paid['effectivePlan'] === 'premium' && $paid['allowedFeatures'] === ['tasks', 'diary'], 'Active paid entitlement lost');
accessCheck($paid['validUntil'] === '2026-11-30T00:00:00Z', 'Expiry was not UTC normalized');
foreach (['2028-02-29T12:00:00+03:00' => '2028-02-29T09:00:00Z',
    '2028-02-29T23:45:59+18:00' => '2028-02-29T05:45:59Z',
    '2028-02-29T23:45:59-18:00' => '2028-03-01T17:45:59Z',
    '2400-02-29T00:00:00Z' => '2400-02-29T00:00:00Z'] as $expiry => $normalized) {
    $access = genesisResolveFeatureAccess(['subscription_plan' => 'premium', 'subscription_valid_until' => $expiry], $future, $now);
    accessCheck($access['effectivePlan'] === 'premium' && $access['validUntil'] === $normalized, 'Valid leap date/offset rejected');
}
$life = genesisResolveFeatureAccess(['subscription_plan' => 'premium4life', 'subscription_valid_until' => '2000-01-01T00:00:00Z'], $future, $now);
accessCheck($life['lifetimePremium'] && $life['effectivePlan'] === 'business' && $life['validUntil'] === null, 'Lifetime full-access grant expired');
accessCheck($life['allowedFeatures'] === ['tasks', 'diary', 'teams'], 'Premium4Life must include Business capabilities');
accessCheck(!isset($life['isAdmin']), 'Entitlement granted an account role');
$other = genesisResolveFeatureAccess(['subscription_plan' => 'free'], $future, $now);
accessCheck($other['allowedFeatures'] === ['tasks'], 'Entitlements leaked between accounts');

$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec("CREATE TABLE users(id TEXT PRIMARY KEY, subscription_plan TEXT); INSERT INTO users VALUES('legacy', 'premium4life'); CREATE TABLE blobs(body TEXT); INSERT INTO blobs VALUES('opaque-encrypted-data')");
$migration = file_get_contents(dirname(__DIR__) . '/migrations/090_subscription_valid_until.sql');
$db->beginTransaction(); $db->exec($migration); $db->rollBack();
accessCheck(count($db->query('PRAGMA table_info(users)')->fetchAll()) === 2, 'Failed migration was not atomic');
$db->exec($migration);
accessCheck($db->query("SELECT subscription_plan FROM users WHERE id='legacy'")->fetchColumn() === 'premium4life', 'Legacy lifetime status changed');
accessCheck($db->query('SELECT subscription_valid_until FROM users')->fetchColumn() === null, 'Legacy payment evidence invented');
accessCheck($db->query('SELECT body FROM blobs')->fetchColumn() === 'opaque-encrypted-data', 'User content changed');
echo "PASS prepared feature access: unrestricted 3.1.3, future free/paid/expiry boundary, lifetime Premium, role/account isolation, UTC expiry, additive atomic migration and preserved encrypted data.\n";
