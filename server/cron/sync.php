<?php
declare(strict_types=1);

if (is_file(dirname(__DIR__) . '/var/relocation.json')) {
    echo '{"ok":true,"skipped":"retired-origin"}' . PHP_EOL;
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/shared-projects.php';
require dirname(__DIR__) . '/src/shared-google.php';
require dirname(__DIR__) . '/src/shared-maintenance.php';
require dirname(__DIR__) . '/src/backups.php';

$inactiveBefore = gmdate('Y-m-d\TH:i:s\Z', time() - 86400 * 365 * 2);
$statement = genesisDb()->prepare('DELETE FROM user_metrics WHERE user_id IN (SELECT id FROM users WHERE last_seen_at IS NOT NULL AND last_seen_at < :inactive_before)');
$statement->execute(['inactive_before' => $inactiveBefore]);
$maintenance = genesisSharedMaintenance();
$email = genesisAccountEmailRun();
$emailLifecycle = genesisEmailPurgeUnconfirmed();
$accountRetention = genesisRetentionRun();
$retentionEmail = genesisRetentionEmailRun();
$securityOutbox = genesisSecurityOutboxRun();
genesisBackupMaintenance();
$background = genesisBackgroundRun();
$sharedGoogle = genesisSharedSyncGoogleCron();

echo json_encode([
    'ok' => true,
    'maintenance' => $maintenance,
    'background' => $background,
    'email' => $email,
    'emailLifecycle' => $emailLifecycle,
    'accountRetention' => $accountRetention,
    'retentionEmail' => $retentionEmail,
    'securityOutbox' => $securityOutbox,
    'prunedMetrics' => $statement->rowCount(),
    'sharedGoogle' => $sharedGoogle,
    'time' => genesisNow(),
], JSON_UNESCAPED_SLASHES) . PHP_EOL;
