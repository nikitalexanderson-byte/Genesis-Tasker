<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
if (!function_exists('genesisDb')) {
    require dirname(__DIR__) . '/src/bootstrap.php';
    require dirname(__DIR__) . '/src/repository.php';
    require dirname(__DIR__) . '/src/google.php';
    require dirname(__DIR__) . '/src/shared-projects.php';
}
function attachmentExpect(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
function attachmentDenied(callable $action): void {
    try { $action(); } catch (GenesisSharedAccessException) { return; }
    throw new RuntimeException('Attachment access escaped current task membership.');
}
function attachmentInvalid(callable $action): void {
    try { $action(); } catch (InvalidArgumentException) { return; }
    throw new RuntimeException('Invalid attachment was accepted.');
}
function attachmentInput(string $name, string $bytes): array {
    return ['name' => $name, 'data' => 'data:application/octet-stream;base64,' . base64_encode($bytes)];
}
require __DIR__ . '/shared-task-download-http.php';
$db = genesisDb(); $users = ['files-owner', 'files-member', 'files-outsider'];
foreach ($users as $id) {
    $db->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at)
        VALUES (:id, :id, :email, :id, :now, :now)')->execute(['id' => $id, 'email' => $id . '@example.test', 'now' => genesisNow()]);
    genesisTestEnableSharedProjects($id);
}
[$owner, $member, $outsider] = $users;
try {
    $space = genesisSharedCreateSpace($owner, ['title' => 'Files']);
    $db->prepare("INSERT INTO shared_space_members (space_id, user_id, role, joined_at) VALUES (:space, :user, 'member', :now)")
        ->execute(['space' => $space['id'], 'user' => $member, 'now' => genesisNow()]);
    $project = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Files']);
    $grant = $db->prepare("INSERT INTO shared_project_members (project_id, user_id, role, joined_at) VALUES (:project, :user, 'member', :now)");
    $grant->execute(['project' => $project['id'], 'user' => $member, 'now' => genesisNow()]);
    $status = genesisSharedProjectSnapshot($owner, $project['id'])['statuses'][0]['id'];
    $pdf = "%PDF-1.4\n% private test document\n%%EOF";
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII=');
    $input = ['title' => 'Files', 'statusId' => $status, 'requestId' => genesisUuid(), 'imageData' => 'data:image/png;base64,' . base64_encode($png),
        'attachments' => [attachmentInput('Отчёт.pdf', $pdf), attachmentInput('Таблица.csv', "Имя,Число\nГенезис,1\n")]];
    $task = genesisSharedTask($owner, $project['id'], $input);
    $file = $task['attachments'][0];
    attachmentExpect(count($task['attachments']) === 2 && $file['name'] === 'Отчёт.pdf', 'Filename or attachment metadata lost.');
    attachmentExpect(!str_contains(json_encode($task), base64_encode($pdf)), 'File bytes leaked into JSON/receipt.');
    attachmentExpect(genesisSharedTask($owner, $project['id'], $input)['attachments'] === $task['attachments'], 'Retry duplicated files.');
    attachmentExpect(genesisSharedReadTaskAttachment($member, $task['id'], $file['id'])['bytes'] === $pdf, 'Member download corrupted.');
    attachmentDenied(fn() => genesisSharedReadTaskAttachment($outsider, $task['id'], $file['id']));
    attachmentDenied(fn() => genesisSharedReadTaskAttachment($owner, 'wrong-task', $file['id']));
    attachmentHttpDownloads($owner, $task['id'], $file, $pdf, $png);
    $stored = $db->prepare('SELECT filename_ciphertext, ciphertext FROM shared_task_attachments WHERE id = :id');
    $stored->execute(['id' => $file['id']]); $encrypted = $stored->fetch();
    attachmentExpect(!str_contains($encrypted['ciphertext'], base64_encode($pdf))
        && genesisDecrypt($encrypted['ciphertext']) === $pdf
        && genesisDecrypt($encrypted['filename_ciphertext']) === 'Отчёт.pdf', 'File/name encryption failed.');
    $oldClient = genesisSharedTask($owner, $project['id'], ['title' => 'Old client update', 'expectedRevision' => $task['revision']], $task['id']);
    attachmentExpect(count($oldClient['attachments']) === 2, 'Old client erased attachments.'); $task = $oldClient;
    $snapshot = genesisSharedProjectSnapshot($member, $project['id']);
    attachmentExpect($snapshot['tasks'][0]['attachments'] === $task['attachments'], 'Snapshot loses file metadata.');
    $count = $db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn();
    foreach ([attachmentInput('run.exe', 'MZx'), attachmentInput('fake.pdf', '<html>'), attachmentInput('../report.pdf', $pdf),
        attachmentInput('empty.txt', ''), attachmentInput('fake.docx', 'not a zip'), attachmentInput('bad.png', $pdf)] as $invalid) {
        attachmentInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Invalid', 'statusId' => $status, 'attachments' => [$invalid]]));
    }
    attachmentInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Too many', 'statusId' => $status,
        'attachments' => array_fill(0, 6, attachmentInput('file.txt', 'x'))]));
    attachmentInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Too big', 'statusId' => $status,
        'attachments' => [attachmentInput('big.txt', str_repeat('x', 10485761))]]));
    attachmentExpect($db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn() === $count, 'Invalid file left a partial task.');
    // Failure after a requested removal must roll back both fields and attachments.
    attachmentInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Should roll back', 'expectedRevision' => $task['revision'],
        'removeAttachmentIds' => [$file['id']], 'attachments' => [attachmentInput('fake.pdf', 'bad')]], $task['id']));
    attachmentExpect(genesisSharedReadTaskAttachment($owner, $task['id'], $file['id'])['bytes'] === $pdf, 'Failed edit removed a file.');
    attachmentDenied(fn() => genesisSharedTask($owner, $project['id'], ['expectedRevision' => 0, 'removeAttachmentIds' => [$file['id']]], $task['id']));
    $ole = "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" . str_repeat("\0", 512);
    foreach (['doc', 'xls', 'ppt'] as $ext) attachmentExpect(genesisSharedAttachmentDecode(attachmentInput('file.' . $ext, $ole))['bytes'] === $ole, 'Legacy office format rejected.');
    foreach (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'] as $ext) {
        $zip = "PK\x03\x04" . str_repeat("\0", 30);
        attachmentExpect(genesisSharedAttachmentDecode(attachmentInput('file.' . $ext, $zip))['bytes'] === $zip, 'Office ZIP format rejected.');
    }
    // The new table is part of the existing consistent SQLite runtime backup.
    $stored->closeCursor();
    $backupPath = tempnam(sys_get_temp_dir(), 'genesis-files-backup-');
    try {
        $db->exec('VACUUM INTO ' . $db->quote($backupPath)); $backup = new PDO('sqlite:' . $backupPath);
        attachmentExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok'
            && $backup->query('SELECT COUNT(*) FROM shared_task_attachments')->fetchColumn() == 2, 'Backup lost attachments.');
        // Re-applying this additive migration is harmless; rollback leaves the table/data intact.
        $backup->exec(file_get_contents(dirname(__DIR__) . '/migrations/039_shared_task_attachments.sql'));
        attachmentExpect($backup->query('SELECT COUNT(*) FROM shared_task_attachments')->fetchColumn() == 2, 'Migration reapply changed data.');
    } finally { $backup = null; if (is_file($backupPath)) unlink($backupPath); }
    $task = genesisSharedTask($owner, $project['id'], ['expectedRevision' => $task['revision'], 'removeAttachmentIds' => [$task['attachments'][1]['id']]], $task['id']);
    attachmentExpect(count($task['attachments']) === 1, 'Explicit file removal failed.');
    $destination = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Private destination']);
    $destinationStatus = genesisSharedProjectSnapshot($owner, $destination['id'])['statuses'][0]['id'];
    $moved = genesisSharedMoveTask($owner, $project['id'], $task['id'], ['destinationProjectId' => $destination['id'],
        'statusId' => $destinationStatus, 'expectedRevision' => $task['revision'], 'position' => 0]);
    attachmentDenied(fn() => genesisSharedReadTaskAttachment($member, $task['id'], $file['id']));
    $grant->execute(['project' => $destination['id'], 'user' => $member, 'now' => genesisNow()]);
    attachmentExpect(genesisSharedReadTaskAttachment($member, $task['id'], $file['id'])['bytes'] === $pdf, 'File did not follow moved task.');
    $db->prepare('DELETE FROM shared_space_members WHERE space_id = :space AND user_id = :user')->execute(['space' => $space['id'], 'user' => $member]);
    attachmentDenied(fn() => genesisSharedReadTaskAttachment($member, $task['id'], $file['id']));
    genesisSharedDeleteTask($owner, $destination['id'], $task['id'], ['expectedRevision' => $moved['revision']]);
    $stored->execute(['id' => $file['id']]); attachmentExpect($stored->fetch() !== false, 'Trash lost recoverable file ciphertext.');
    $stored->closeCursor();
    attachmentDenied(fn() => genesisSharedReadTaskAttachment($owner, $task['id'], $file['id']));
} finally { foreach ($users as $id) if (genesisFindUser($id)) genesisDeleteAccount($id); }
echo "Shared task files: formats, encryption, atomicity, retries, compatibility, backup, ACL and deletion passed.\n";
