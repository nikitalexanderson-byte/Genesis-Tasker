<?php
declare(strict_types=1);
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-writer-');
if ($backupPath === false) throw new RuntimeException('Cannot create isolated backup.');
try {
    $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ("synthetic");
        CREATE TABLE workspace_blobs(user_id TEXT PRIMARY KEY REFERENCES users(id),ciphertext TEXT NOT NULL,iv TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
        INSERT INTO workspace_blobs VALUES ("synthetic","opaque legacy ciphertext","opaque IV",1,"2026-10-16T00:00:00Z")');
    $db->exec('VACUUM INTO ' . $db->quote($backupPath));
    $db->beginTransaction();
    $db->exec(file_get_contents(dirname(__DIR__).'/migrations/065_workspace_writer_protocol.sql'));
    $db->commit();
    $row = $db->query('SELECT * FROM workspace_blobs')->fetch(PDO::FETCH_ASSOC);
    if ($row['ciphertext'] !== 'opaque legacy ciphertext' || (int)$row['version'] !== 1 || (int)$row['minimum_writer_protocol'] !== 1)
        throw new RuntimeException('Migration changed the opaque document.');
    $db->exec('UPDATE workspace_blobs SET version=2');
    $db->exec('UPDATE workspace_blobs SET version=3,minimum_writer_protocol=2,writer_protocol_version=3');
    try { $db->exec('UPDATE workspace_blobs SET version=4,ciphertext="old writer"'); throw new RuntimeException('Unsafe rollback write accepted.'); }
    catch (PDOException $error) { if (!str_contains($error->getMessage(),'WORKSPACE_UPGRADE_REQUIRED')) throw $error; }
    $backup = new PDO('sqlite:'.$backupPath);
    $before = $backup->query('SELECT * FROM workspace_blobs')->fetch(PDO::FETCH_ASSOC);
    if ($before['ciphertext'] !== 'opaque legacy ciphertext' || (int)$before['version'] !== 1 || array_key_exists('minimum_writer_protocol',$before))
        throw new RuntimeException('The consistent pre-migration backup was not preserved.');
    $backup = null;
    echo "Workspace migration: opaque document, legacy SQL, rollback guard and consistent pre-migration backup passed.\n";
} finally { @unlink($backupPath); }
