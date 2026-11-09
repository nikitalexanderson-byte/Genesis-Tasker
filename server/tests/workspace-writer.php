<?php
declare(strict_types=1);

if (getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated' && !getenv('GENESIS_SMOKE_ROOT')) {
    throw new RuntimeException('This test requires an explicit isolated environment.');
}
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';

$db = genesisDb();
$db->beginTransaction();
try {
    $userId = 'test-workspace-writer-protocol';
    $now = genesisNow();
    $db->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$userId, $userId, 'writer@example.invalid', 'Synthetic Writer', $now, $now]);
    // Writer-version compatibility for an existing lifetime member; Free census limits have their own suite.
    $db->prepare("UPDATE users SET subscription_plan='premium4life' WHERE id=?")->execute([$userId]);
    $body = ['ciphertext'=>base64_encode('opaque test ciphertext'), 'iv'=>base64_encode(random_bytes(12))];
    $legacy = genesisSaveWorkspaceEnvelope($userId, $body);
    if ($legacy['version'] !== 1) throw new RuntimeException('Unchanged legacy workspaces must remain writable.');
    $enabled = genesisSaveWorkspaceEnvelope($userId, $body + ['expectedVersion'=>1, 'writerProtocol'=>2, 'minimumWriterProtocol'=>2]);
    if ($enabled['version'] !== 2) throw new RuntimeException('Activation failed.');
    foreach ([$body, $body + ['expectedVersion'=>2]] as $oldWriter) {
        try { genesisSaveWorkspaceEnvelope($userId, $oldWriter); throw new RuntimeException('Legacy overwrite accepted.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    // The pre-feature SQL used by a rolled-back server cannot bypass the database guard.
    try {
        $db->prepare('UPDATE workspace_blobs SET ciphertext=?, version=version+1 WHERE user_id=?')->execute([base64_encode('lost data'), $userId]);
        throw new RuntimeException('Old server SQL bypassed the guard.');
    } catch (PDOException $error) {
        if (!str_contains($error->getMessage(), 'WORKSPACE_UPGRADE_REQUIRED')) throw $error;
    }
    $new = genesisSaveWorkspaceEnvelope($userId, $body + ['expectedVersion'=>2, 'writerProtocol'=>2]);
    if ($new['version'] !== 3) throw new RuntimeException('Current writer failed.');
    $stored = $db->query("SELECT version, minimum_writer_protocol, writer_protocol_version FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetch();
    if ((int)$stored['minimum_writer_protocol'] !== 2 || (int)$stored['writer_protocol_version'] !== 3)
        throw new RuntimeException('Protection was downgraded.');
    $periodic = genesisSaveWorkspaceEnvelope($userId, $body + ['expectedVersion'=>3, 'writerProtocol'=>3, 'minimumWriterProtocol'=>3]);
    if ($periodic['version'] !== 4) throw new RuntimeException('Periodic activation failed.');
    foreach ([1,2] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>4,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Pre-period client discarded period fields.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    $updated = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>4,'writerProtocol'=>3]);
    if ($updated['version'] !== 5) throw new RuntimeException('Current period writer failed.');
    $stored = $db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn();
    if ((int)$stored !== 3) throw new RuntimeException('Period protection was downgraded.');
    $history = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>5,'writerProtocol'=>4,'minimumWriterProtocol'=>4]);
    if ($history['version'] !== 6) throw new RuntimeException('Causal history activation failed.');
    foreach ([1,2,3] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>6,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Old client discarded causal history.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>6,'writerProtocol'=>4]);
    if ((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn() !== 4)
        throw new RuntimeException('Causal history protection was downgraded.');
    $timers = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>7,'writerProtocol'=>5,'minimumWriterProtocol'=>5]);
    if ($timers['version'] !== 8) throw new RuntimeException('Timer writer activation failed.');
    foreach ([1,2,3,4] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>8,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Old client discarded timer sessions.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>8,'writerProtocol'=>5]);
    if ((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn() !== 5)
        throw new RuntimeException('Timer writer protection was downgraded.');
    $corrections = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>9,'writerProtocol'=>6,'minimumWriterProtocol'=>6]);
    if ($corrections['version'] !== 10) throw new RuntimeException('History correction writer activation failed.');
    foreach ([1,2,3,4,5] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>10,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Old client discarded history corrections.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>10,'writerProtocol'=>6]);
    if ((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn() !== 6)
        throw new RuntimeException('History correction protection was downgraded.');
    $lifecycle = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>11,'writerProtocol'=>7,'minimumWriterProtocol'=>7]);
    if ($lifecycle['version'] !== 12) throw new RuntimeException('Lifecycle writer activation failed.');
    foreach ([1,2,3,4,5,6] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>12,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Old client discarded lifecycle history.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>12,'writerProtocol'=>7]);
    if ((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn() !== 7)
        throw new RuntimeException('Lifecycle protection was downgraded.');
    $automatic = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>13,'writerProtocol'=>8,'minimumWriterProtocol'=>8]);
    if ($automatic['version'] !== 14) throw new RuntimeException('Automatic deletion writer activation failed.');
    foreach ([1,2,3,4,5,6,7] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>14,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Old client discarded automatic deletion policy or XP deductions.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>14,'writerProtocol'=>8]);
    if ((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn() !== 8)
        throw new RuntimeException('Automatic deletion protection was downgraded.');
    $preferences = genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>15,'writerProtocol'=>9,'minimumWriterProtocol'=>9]);
    if ($preferences['version'] !== 16) throw new RuntimeException('Timer preferences writer activation failed.');
    foreach ([1,2,3,4,5,6,7,8] as $oldProtocol) {
        try { genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>16,'writerProtocol'=>$oldProtocol]);
            throw new RuntimeException('Old client discarded timer preferences.'); }
        catch (DomainException $error) { if ($error->getMessage() !== 'WORKSPACE_UPGRADE_REQUIRED') throw $error; }
    }
    genesisSaveWorkspaceEnvelope($userId,$body + ['expectedVersion'=>16,'writerProtocol'=>9]);
    if ((int)$db->query("SELECT minimum_writer_protocol FROM workspace_blobs WHERE user_id='test-workspace-writer-protocol'")->fetchColumn() !== 9)
        throw new RuntimeException('Timer preferences protection was downgraded.');
    echo "Workspace writer: legacy compatibility, activation, rejection, rollback guard, timers, history corrections, lifecycle, automatic deletion, timer preferences and current writes passed.\n";
} finally {
    $db->rollBack();
}
