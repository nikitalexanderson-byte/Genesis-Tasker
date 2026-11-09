<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/shared-content-storage.php';
function contentExpect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec('PRAGMA foreign_keys = ON');
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) if (basename($file) < '043_') $db->exec(file_get_contents($file));
$db->exec(<<<'SQL'
    INSERT INTO users (id, google_sub, email, created_at, updated_at) VALUES ('u','u','synthetic@example.test','now','now');
    INSERT INTO shared_spaces (id,title,created_by,created_at,updated_at) VALUES ('s','Space','u','now','now');
    INSERT INTO shared_projects (id,space_id,title,created_at,updated_at) VALUES ('p','s','Project','now','now');
    INSERT INTO shared_project_statuses (id,project_id,title,position) VALUES ('b','p','Open',0);
    INSERT INTO shared_tasks (id,project_id,status_id,title,description,tags_json,created_at,updated_at) VALUES ('t','p','b','Private task','Private description','["private"]','now','now');
    INSERT INTO shared_comments (id,task_id,author_id,body,created_at) VALUES ('c','t','u','Private comment','now');
    INSERT INTO shared_audit_events (id,project_id,actor_id,action,object_id,details_json,created_at) VALUES ('e','p','u','task.created','t','{"objectTitle":"Private task"}','now');
    SQL);
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-content-backup-');
try {
    $db->exec('VACUUM INTO ' . $db->quote($backupPath));
    $db->exec(file_get_contents(dirname(__DIR__) . '/migrations/043_shared_content_storage.sql'));
    genesisRegisterSharedContentFunctions($db);
    genesisInitializeSharedContentStorage($db);
    genesisInitializeSharedContentStorage($db);
    foreach (['shared_tasks' => 'title', 'shared_comments' => 'body', 'shared_audit_events' => 'details_json'] as $table => $field) {
        $stored = $db->query('SELECT ' . $field . ' FROM ' . $table)->fetchColumn();
        contentExpect(str_starts_with($stored, GENESIS_SHARED_CONTENT_PREFIX) && !str_contains($stored, 'Private'), 'Content remained plaintext.');
    }
    $task = $db->query('SELECT * FROM shared_tasks_read')->fetch();
    contentExpect($task['title'] === 'Private task' && $task['description'] === 'Private description' && json_decode($task['tags_json'], true) === ['private'], 'Migration changed task content.');
    $db->exec("UPDATE shared_tasks SET title='Updated title',description='Updated description' WHERE id='t'");
    contentExpect($db->query('SELECT title FROM shared_tasks_read')->fetchColumn() === 'Updated title', 'Updated task cannot be read.');
    contentExpect(str_starts_with($db->query('SELECT title FROM shared_tasks')->fetchColumn(), GENESIS_SHARED_CONTENT_PREFIX), 'Update bypassed encryption.');
    $backup = new PDO('sqlite:' . $backupPath);
    contentExpect($backup->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Private task', 'Pre-migration backup changed.');
    $backup = null;
    genesisRollbackSharedContentStorage($db);
    contentExpect($db->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Updated title', 'Forward rollback lost task changes.');
    contentExpect($db->query('SELECT body FROM shared_comments')->fetchColumn() === 'Private comment', 'Rollback lost comments.');
    genesisInitializeSharedContentStorage($db);
    contentExpect($db->query('SELECT title FROM shared_tasks_read')->fetchColumn() === 'Updated title', 'Encryption could not be reapplied.');
    echo "Shared content encryption, migration, update, backup and forward rollback passed.\n";
} finally { if (is_file($backupPath)) unlink($backupPath); }
