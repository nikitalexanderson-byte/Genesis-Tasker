<?php
declare(strict_types=1);
require __DIR__ . '/shared-collaboration-migration.php';

$invitationDb = new PDO('sqlite::memory:', null, null, $collaborationOptions);
$invitationDb->exec('PRAGMA foreign_keys=ON');
collaborationMigrate($invitationDb, '060_shared_saved_views.sql');
$invitationDb->exec("INSERT INTO users(id,google_sub,email,created_at,updated_at) VALUES ('invite-a','ia','ia@example.test','now','now'),('invite-b','ib','ib@example.test','now','now');
    INSERT INTO shared_spaces(id,title,created_by,created_at,updated_at) VALUES ('invite-space','Existing encrypted dialogue','invite-a','now','now');
    INSERT INTO shared_private_conversations VALUES('legacy-dialogue','invite-space','invite-a','invite-b','now');
    INSERT INTO shared_private_messages(id,conversation_id,sender_id,payload_json,created_at,updated_at) VALUES('opaque-message','legacy-dialogue','invite-a','opaque ciphertext','now','now');
    INSERT INTO shared_private_message_reads VALUES('legacy-dialogue','invite-b',1);");
$invitationBefore = [];
foreach (['users','shared_private_conversations','shared_private_messages','shared_private_message_reads'] as $table) {
    $invitationBefore[$table] = $invitationDb->query('SELECT * FROM ' . $table)->fetchAll();
}
$invitationBackupPath = tempnam(sys_get_temp_dir(), 'genesis-pre-invitation-');
try {
    $invitationDb->exec('VACUUM INTO ' . $invitationDb->quote($invitationBackupPath));
    collaborationMigrate($invitationDb, '061_private_conversation_invitations.sql');
    collaborationMigrate($invitationDb, '061_private_conversation_invitations.sql');
    foreach ($invitationBefore as $table => $rows) {
        collaborationMigrationExpect($invitationDb->query('SELECT * FROM ' . $table)->fetchAll() === $rows, 'Invitation upgrade changed ' . $table);
    }
    collaborationMigrationExpect((int)$invitationDb->query('SELECT COUNT(*) FROM shared_private_conversation_invitations')->fetchColumn() === 0, 'Established dialogue requires new consent.');
    $invitationDuplicateRejected = false;
    try { $invitationDb->exec("INSERT INTO shared_private_conversations VALUES('pending-dialogue','invite-space','invite-a','invite-b','later');"); }
    catch (PDOException $error) { $invitationDuplicateRejected = str_contains($error->getMessage(), 'UNIQUE'); }
    collaborationMigrationExpect($invitationDuplicateRejected, 'Upgrade allowed a duplicate pair.');
    $invitationDb->exec("INSERT INTO shared_private_conversation_invitations VALUES('legacy-dialogue','invite-a','pending','now',NULL);");
    collaborationMigrationExpect($invitationDb->query('PRAGMA foreign_key_check')->fetch() === false, 'Invitation FK check failed.');
    $invitationDb->exec("DELETE FROM shared_private_conversations WHERE id='legacy-dialogue'");
    collaborationMigrationExpect((int)$invitationDb->query('SELECT COUNT(*) FROM shared_private_conversation_invitations')->fetchColumn() === 0, 'Deleting dialogue retained invitation.');
    $invitationFresh = new PDO('sqlite::memory:', null, null, $collaborationOptions);
    $invitationFresh->exec('PRAGMA foreign_keys=ON'); collaborationMigrate($invitationFresh, '061_private_conversation_invitations.sql');
    collaborationMigrationExpect($invitationFresh->query('PRAGMA integrity_check')->fetchColumn() === 'ok'
        && $invitationFresh->query('PRAGMA foreign_key_check')->fetch() === false, 'Fresh invitation schema failed.');
    collaborationMigrationExpect((int)$invitationFresh->query("SELECT COUNT(*) FROM sqlite_master WHERE name='shared_private_conversation_invitations'")->fetchColumn() === 1, 'Fresh invitation table missing.');
} finally {
    $invitationBackup = new PDO('sqlite:' . $invitationBackupPath, null, null, $collaborationOptions);
    collaborationMigrationExpect($invitationBackup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Pre-invitation backup failed integrity check.');
    foreach ($invitationBefore as $table => $rows) {
        collaborationMigrationExpect($invitationBackup->query('SELECT * FROM ' . $table)->fetchAll() === $rows, 'Backup recovery lost ' . $table);
    }
    $invitationBackup = null; if (is_file($invitationBackupPath)) unlink($invitationBackupPath);
}
echo "Private invitation migration: additive schema, repeated startup, existing ciphertext/read receipts, backup recovery and cascade passed.\n";
