<?php
declare(strict_types=1);
// Never boot the application or read its config: this is an isolated schema-copy test.
if (PHP_SAPI !== 'cli') exit;
$db = new SQLite3(':memory:');
$db->exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE workspace_blobs(user_id TEXT PRIMARY KEY REFERENCES users(id), ciphertext TEXT);');
$db->exec("INSERT INTO users VALUES ('fixture'); INSERT INTO workspace_blobs VALUES ('fixture','opaque-workspace');");
$backup = new SQLite3(':memory:');
if (!$db->backup($backup)) throw new RuntimeException('Backup failed');
$migration = file_get_contents(__DIR__ . '/../migrations/047_personal_mindmaps.sql') . file_get_contents(__DIR__ . '/../migrations/048_personal_task_creation_targets.sql') . file_get_contents(__DIR__ . '/../migrations/049_personal_mindmap_deletions.sql');
if (!$db->exec($migration) || !$db->exec($migration)) throw new RuntimeException('Additive/repeated migration failed');
if ($db->querySingle("SELECT ciphertext FROM workspace_blobs WHERE user_id='fixture'") !== 'opaque-workspace') throw new RuntimeException('Old workspace changed');
if ($db->querySingle("SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'personal_%'") !== 6) throw new RuntimeException('Missing map/receipt tables');
if ($db->query('PRAGMA foreign_key_check')->fetchArray()) throw new RuntimeException('Foreign key violation');
// Exercise restoring the pre-migration backup into another isolated connection.
$restored = new SQLite3(':memory:');
if (!$backup->backup($restored) || $restored->querySingle("SELECT ciphertext FROM workspace_blobs") !== 'opaque-workspace'
    || $restored->querySingle("SELECT count(*) FROM sqlite_master WHERE name='personal_mindmaps'") !== 0) throw new RuntimeException('Backup restore verification failed');
echo "PASS isolated SQLite schema copy: backup, additive migration, repeat application, old workspace preserved, foreign keys, backup restored. No production database used.\n";
