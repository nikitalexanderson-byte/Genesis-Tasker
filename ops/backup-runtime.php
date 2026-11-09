<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only.\n");
    exit(1);
}

$options = getopt('', ['server-root:', 'backup-root:', 'retain::']);
$serverRoot = rtrim((string)($options['server-root'] ?? ''), '/');
$backupRoot = rtrim((string)($options['backup-root'] ?? ''), '/');
$retain = max(1, min(100, (int)($options['retain'] ?? 20)));

if (!in_array($serverRoot, [
    '/home/u531952483/domains/genesiscalendar.com/server',
], true)) {
    fwrite(STDERR, "Unsafe server root.\n");
    exit(1);
}

$projectRoot = dirname($serverRoot);
if ($backupRoot !== $projectRoot . '/backups') {
    fwrite(STDERR, "Unsafe backup root.\n");
    exit(1);
}

$configPath = $serverRoot . '/config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "Runtime config is missing.\n");
    exit(1);
}

$config = require $configPath;
if (!is_array($config)) {
    fwrite(STDERR, "Runtime config is invalid.\n");
    exit(1);
}

$databasePath = (string)($config['db_path'] ?? '');
$runtimeRoot = realpath($serverRoot . '/var');
$databaseRealPath = realpath($databasePath);
if (
    $runtimeRoot === false
    || $databaseRealPath === false
    || !str_starts_with($databaseRealPath, $runtimeRoot . DIRECTORY_SEPARATOR)
) {
    fwrite(STDERR, "Runtime database is missing or outside server/var.\n");
    exit(1);
}

if (!is_dir($backupRoot) && !mkdir($backupRoot, 0700, true) && !is_dir($backupRoot)) {
    fwrite(STDERR, "Could not create backup root.\n");
    exit(1);
}
chmod($backupRoot, 0700);

$name = 'runtime-' . gmdate('Ymd\THis\Z') . '-' . getmypid();
$temporaryPath = $backupRoot . '/.' . $name;
$finalPath = $backupRoot . '/' . $name;

function removeIncompleteBackup(string $directory): void
{
    if (!is_dir($directory)) {
        return;
    }
    foreach (glob($directory . '/*') ?: [] as $file) {
        if (is_file($file)) {
            @unlink($file);
        }
    }
    @rmdir($directory);
}

try {
    if (!mkdir($temporaryPath, 0700, false)) {
        throw new RuntimeException('Could not create temporary backup directory.');
    }

    $configBackup = $temporaryPath . '/config.php';
    if (!copy($configPath, $configBackup)) {
        throw new RuntimeException('Could not copy runtime config.');
    }
    chmod($configBackup, 0600);

    $databaseBackup = $temporaryPath . '/genesis.sqlite';
    $database = new PDO('sqlite:' . $databaseRealPath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $database->exec('PRAGMA busy_timeout = 10000');
    $database->exec('PRAGMA wal_checkpoint(FULL)');
    $quotedDestination = str_replace("'", "''", $databaseBackup);
    $database->exec("VACUUM INTO '{$quotedDestination}'");
    chmod($databaseBackup, 0600);

    $backupDatabase = new PDO('sqlite:' . $databaseBackup, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $integrity = $backupDatabase->query('PRAGMA integrity_check')->fetchColumn();
    if ($integrity !== 'ok') {
        throw new RuntimeException('Runtime database backup failed its integrity check.');
    }
    unset($backupDatabase);

    $metadata = [
        'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
        'databaseBytes' => filesize($databaseBackup),
        'format' => 1,
    ];
    $metadataBytes = file_put_contents(
        $temporaryPath . '/metadata.json',
        json_encode($metadata, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n",
        LOCK_EX,
    );
    if ($metadataBytes === false) {
        throw new RuntimeException('Could not write runtime backup metadata.');
    }
    chmod($temporaryPath . '/metadata.json', 0600);

    if (!rename($temporaryPath, $finalPath)) {
        throw new RuntimeException('Could not publish runtime backup atomically.');
    }
    chmod($finalPath, 0700);

    $backups = array_values(array_filter(glob($backupRoot . '/runtime-*') ?: [], 'is_dir'));
    rsort($backups, SORT_STRING);
    foreach (array_slice($backups, $retain) as $oldBackup) {
        $resolved = realpath($oldBackup);
        if (
            $resolved === false
            || dirname($resolved) !== realpath($backupRoot)
            || !preg_match('/^runtime-\d{8}T\d{6}Z-\d+$/', basename($resolved))
        ) {
            throw new RuntimeException('Refusing to remove an unexpected backup path.');
        }
        foreach (glob($resolved . '/*') ?: [] as $file) {
            if (!is_file($file) || !unlink($file)) {
                throw new RuntimeException('Could not rotate an old runtime backup.');
            }
        }
        if (!rmdir($resolved)) {
            throw new RuntimeException('Could not remove an old runtime backup directory.');
        }
    }
} catch (Throwable $error) {
    removeIncompleteBackup($temporaryPath);
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}

fwrite(STDOUT, 'BACKUP_PATH=' . $finalPath . "\n");
