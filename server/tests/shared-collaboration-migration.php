<?php
declare(strict_types=1);
// Pure schema fixtures: never load application configuration or production data.
function collaborationMigrationExpect(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function collaborationMigrate(PDO $db, string $through): void {
    $db->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    $files = glob(dirname(__DIR__) . '/migrations/*.sql');
    sort($files, SORT_STRING);
    foreach ($files as $file) {
        $name = basename($file);
        if (strcmp($name, $through) > 0) continue;
        $applied = $db->prepare('SELECT 1 FROM schema_migrations WHERE name=?');
        $applied->execute([$name]);
        if ($applied->fetchColumn()) continue;
        $db->beginTransaction();
        try {
            $db->exec(file_get_contents($file));
            $db->prepare('INSERT INTO schema_migrations VALUES (?,?)')->execute([$name, 'fixture']);
            $db->commit();
        } catch (Throwable $error) {
            $db->rollBack();
            throw $error;
        }
    }
}
$collaborationOptions = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
$collaborationDb = new PDO('sqlite::memory:', null, null, $collaborationOptions);
$collaborationDb->exec('PRAGMA foreign_keys=ON');
collaborationMigrate($collaborationDb, '054_shared_mindmap_project_index.sql');
collaborationMigrationExpect((int)$collaborationDb->query("SELECT COUNT(*) FROM schema_migrations WHERE name='054_shared_mindmap_project_index.sql'")->fetchColumn() === 1, 'Pre-055 schema is incomplete');
$collaborationDb->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES ('legacy-a','a','a@example.test','now','now'),('legacy-b','b','b@example.test','now','now');
    INSERT INTO workspace_blobs(user_id,ciphertext,iv,updated_at) VALUES ('legacy-a','opaque-workspace','opaque-iv','now');
    INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES ('legacy-space','Existing space','legacy-a','now','now');
    INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES ('legacy-space','legacy-a','owner','now'),('legacy-space','legacy-b','member','now');
    INSERT INTO shared_projects(id,space_id,title,created_at,updated_at) VALUES ('legacy-project','legacy-space','Existing project','now','now');
    INSERT INTO shared_project_statuses(id,project_id,title,position) VALUES ('legacy-status','legacy-project','Existing board',0);
    INSERT INTO shared_tasks(id,project_id,status_id,title,created_at,updated_at) VALUES ('legacy-task','legacy-project','legacy-status','Existing task','now','now')");
$collaborationBefore = [];
foreach (['users','workspace_blobs','shared_spaces','shared_space_members','shared_projects','shared_tasks'] as $table) {
    $collaborationBefore[$table] = $collaborationDb->query('SELECT * FROM ' . $table)->fetchAll();
}
$collaborationBackupPath = tempnam(sys_get_temp_dir(), 'genesis-migration-55-');
try {
    $collaborationDb->exec('VACUUM INTO ' . $collaborationDb->quote($collaborationBackupPath));
    collaborationMigrate($collaborationDb, '055_space_presence_private_messages.sql');
    collaborationMigrate($collaborationDb, '055_space_presence_private_messages.sql');
    foreach ($collaborationBefore as $table => $rows) {
        collaborationMigrationExpect($collaborationDb->query('SELECT * FROM ' . $table)->fetchAll() === $rows, 'Migration changed legacy ' . $table);
    }
    collaborationMigrationExpect((int)$collaborationDb->query("SELECT COUNT(*) FROM schema_migrations WHERE name='055_space_presence_private_messages.sql'")->fetchColumn() === 1, 'Migration was not recorded exactly once');
    $collaborationDb->exec("INSERT INTO shared_space_presence VALUES ('legacy-space','legacy-b','fixture-tab',1);
        INSERT INTO shared_private_conversations VALUES ('fixture-chat','legacy-space','legacy-a','legacy-b','now');
        INSERT INTO shared_private_messages(id,conversation_id,sender_id,payload_json,created_at,updated_at) VALUES ('fixture-message','fixture-chat','legacy-a','opaque-ciphertext','now','now');
        INSERT INTO shared_private_message_reads VALUES ('fixture-chat','legacy-b',1)");
    $legacyMessages=$collaborationDb->query('SELECT * FROM shared_private_messages')->fetchAll();
    collaborationMigrate($collaborationDb, '057_shared_project_comments.sql');collaborationMigrate($collaborationDb, '057_shared_project_comments.sql');
    collaborationMigrationExpect($collaborationDb->query('SELECT * FROM shared_private_messages')->fetchAll()===$legacyMessages,'Attachment upgrade changed legacy messages');
    $collaborationDb->exec("INSERT INTO shared_private_files VALUES('file','fixture-chat','legacy-a','fixture-message',1,16,'now'); INSERT INTO shared_private_file_chunks VALUES('file',0,'opaque-file'); INSERT INTO shared_project_comments VALUES('comment','legacy-project',NULL,'legacy-a','Discussion','[]','now')");
    collaborationMigrationExpect($collaborationDb->query('PRAGMA foreign_key_check')->fetch() === false, 'Migration foreign keys failed');
    $collaborationDb->exec("DELETE FROM shared_space_members WHERE user_id='legacy-b'");
    collaborationMigrationExpect((int)$collaborationDb->query('SELECT COUNT(*) FROM shared_space_presence')->fetchColumn() === 0, 'Revoked membership retained presence');
    $collaborationDb->exec("DELETE FROM shared_spaces WHERE id='legacy-space'");
    foreach (['shared_private_conversations','shared_private_messages','shared_private_message_reads','shared_private_files','shared_private_file_chunks','shared_project_comments'] as $table) {
        collaborationMigrationExpect((int)$collaborationDb->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() === 0, 'Space deletion did not cascade to ' . $table);
    }
    $collaborationBackup = new PDO('sqlite:' . $collaborationBackupPath, null, null, $collaborationOptions);
    collaborationMigrationExpect($collaborationBackup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Pre-migration backup is inconsistent');
    collaborationMigrationExpect((int)$collaborationBackup->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_private_messages'")->fetchColumn() === 0, 'Backup contains new schema');
    foreach ($collaborationBefore as $table => $rows) {
        collaborationMigrationExpect($collaborationBackup->query('SELECT * FROM ' . $table)->fetchAll() === $rows, 'Pre-migration recovery lost ' . $table);
    }
    $collaborationFresh = new PDO('sqlite::memory:', null, null, $collaborationOptions);
    $collaborationFresh->exec('PRAGMA foreign_keys=ON');
    collaborationMigrate($collaborationFresh, '057_shared_project_comments.sql');
    collaborationMigrationExpect($collaborationFresh->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Fresh schema failed');
    collaborationMigrationExpect((int)$collaborationFresh->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('shared_space_presence','shared_messaging_keys','shared_private_conversations','shared_private_messages','shared_private_message_reads')")->fetchColumn() === 5, 'Fresh schema is incomplete');
} finally {
    $collaborationBackup = null;
    if (is_file($collaborationBackupPath)) unlink($collaborationBackupPath);
}
echo "Collaboration migration: fresh schema, pre-055 backup, additive upgrade, repeat startup, legacy queries, foreign keys and recovery passed.\n";
