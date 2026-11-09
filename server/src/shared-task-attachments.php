<?php
declare(strict_types=1);

/** Attachments are encrypted in SQLite; nothing is written to the public web root. */
function genesisSharedAttachmentDecode(mixed $input): array
{
    if (!is_array($input) || !is_string($input['name'] ?? null) || !is_string($input['data'] ?? null)) {
        throw new InvalidArgumentException('INVALID_TASK_FILE');
    }
    $name = trim($input['name']);
    if ($name === '' || mb_strlen($name) > 180 || preg_match('/[\x00-\x1f\x7f\/\\\\]/u', $name)) {
        throw new InvalidArgumentException('INVALID_TASK_FILENAME');
    }
    $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $types = [
        'pdf' => 'application/pdf', 'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt' => 'application/vnd.ms-powerpoint',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'odt' => 'application/vnd.oasis.opendocument.text',
        'ods' => 'application/vnd.oasis.opendocument.spreadsheet',
        'odp' => 'application/vnd.oasis.opendocument.presentation',
        'rtf' => 'application/rtf', 'txt' => 'text/plain', 'csv' => 'text/csv',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
        'webp' => 'image/webp', 'gif' => 'image/gif', 'bmp' => 'image/bmp',
        'tif' => 'image/tiff', 'tiff' => 'image/tiff',
    ];
    if (!isset($types[$extension])) throw new InvalidArgumentException('UNSUPPORTED_TASK_FILE');
    if (strlen($input['data']) > 13981120) throw new InvalidArgumentException('TASK_FILES_TOO_LARGE');
    if (!preg_match('/\Adata:[a-zA-Z0-9.+\/-]*;base64,([a-zA-Z0-9+\/=]+)\z/', $input['data'], $match)) {
        throw new InvalidArgumentException('INVALID_TASK_FILE');
    }
    $bytes = base64_decode($match[1], true);
    if ($bytes === false || $bytes === '') throw new InvalidArgumentException('INVALID_TASK_FILE');
    if (strlen($bytes) > 10 * 1024 * 1024) throw new InvalidArgumentException('TASK_FILES_TOO_LARGE');
    $mime = $types[$extension];
    $valid = true;
    if (str_starts_with($mime, 'image/')) {
        $info = @getimagesizefromstring($bytes);
        $valid = $info && ($info['mime'] ?? '') === $mime && $info[0] * $info[1] <= 40000000;
    } elseif ($extension === 'pdf') {
        $valid = str_starts_with($bytes, '%PDF-');
    } elseif (in_array($extension, ['doc', 'xls', 'ppt'], true)) {
        $valid = str_starts_with($bytes, "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
    } elseif (in_array($extension, ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'], true)) {
        $valid = str_starts_with($bytes, "PK\x03\x04");
    } elseif ($extension === 'rtf') {
        $valid = str_starts_with(ltrim($bytes), '{\\rtf');
    } else {
        $valid = !str_contains($bytes, "\0") && mb_check_encoding($bytes, 'UTF-8');
    }
    if (!$valid) throw new InvalidArgumentException('INVALID_TASK_FILE_CONTENT');
    return ['name' => $name, 'type' => $mime, 'bytes' => $bytes];
}

/** Called inside the task mutation transaction, after edit permission/revision checks. */
function genesisSharedSaveTaskAttachments(string $taskId, array $input): void
{
    $files = $input['attachments'] ?? [];
    $remove = $input['removeAttachmentIds'] ?? [];
    if (!is_array($files) || !array_is_list($files) || count($files) > 5
        || !is_array($remove) || !array_is_list($remove) || count($remove) > 5) {
        throw new InvalidArgumentException('INVALID_TASK_FILES');
    }
    $db = genesisDb();
    $query = $db->prepare('SELECT id, byte_size FROM shared_task_attachments WHERE task_id = :task');
    $query->execute(['task' => $taskId]);
    $existing = array_column($query->fetchAll(), 'byte_size', 'id');
    foreach ($remove as $id) {
        if (!is_string($id) || !isset($existing[$id])) throw new InvalidArgumentException('INVALID_TASK_FILE_REMOVAL');
    }
    $remaining = array_diff_key($existing, array_flip($remove));
    if (count($remaining) + count($files) > 5) throw new InvalidArgumentException('TOO_MANY_TASK_FILES');
    $decoded = array_map('genesisSharedAttachmentDecode', $files);
    if (array_sum($remaining) + array_sum(array_map(static fn(array $file): int => strlen($file['bytes']), $decoded)) > 10485760) {
        throw new InvalidArgumentException('TASK_FILES_TOO_LARGE');
    }
    $delete = $db->prepare('DELETE FROM shared_task_attachments WHERE id = :id AND task_id = :task');
    foreach ($remove as $id) $delete->execute(['id' => $id, 'task' => $taskId]);
    $insert = $db->prepare('INSERT INTO shared_task_attachments
        (id, task_id, filename_ciphertext, mime_type, byte_size, ciphertext, created_at)
        VALUES (:id, :task, :name, :mime, :size, :cipher, :now)');
    foreach ($decoded as $file) $insert->execute([
        'id' => genesisUuid(), 'task' => $taskId, 'name' => genesisEncrypt($file['name']),
        'mime' => $file['type'], 'size' => strlen($file['bytes']),
        'cipher' => genesisEncrypt($file['bytes']), 'now' => genesisNow(),
    ]);
}

function genesisSharedAttachmentMetadata(array $row): array
{
    return ['id' => $row['id'], 'name' => genesisDecrypt($row['filename_ciphertext']) ?? 'file',
        'type' => $row['mime_type'], 'size' => (int)$row['byte_size'],
        'url' => '/api/shared/tasks/' . rawurlencode($row['task_id']) . '/attachments/' . rawurlencode($row['id'])];
}

function genesisSharedTaskAttachments(string $taskId): array
{
    $query = genesisDb()->prepare('SELECT id, task_id, filename_ciphertext, mime_type, byte_size
        FROM shared_task_attachments WHERE task_id = :task ORDER BY created_at, rowid');
    $query->execute(['task' => $taskId]);
    return array_map('genesisSharedAttachmentMetadata', $query->fetchAll());
}

/** Batch metadata for a project snapshot; ciphertext bytes never enter JSON. */
function genesisSharedAttachmentIndex(string $projectId): array
{
    $query = genesisDb()->prepare('SELECT a.id, a.task_id, a.filename_ciphertext, a.mime_type, a.byte_size
        FROM shared_task_attachments a JOIN shared_tasks_read t ON t.id = a.task_id
        WHERE t.project_id = :project ORDER BY a.created_at, a.rowid');
    $query->execute(['project' => $projectId]);
    $index = [];
    foreach ($query->fetchAll() as $row) $index[$row['task_id']][] = genesisSharedAttachmentMetadata($row);
    return $index;
}

function genesisSharedReadTaskAttachment(string $userId, string $taskId, string $attachmentId): array
{
    genesisSharedRequireEnabled($userId);
    $query = genesisDb()->prepare('SELECT project_id FROM shared_tasks_history_read WHERE id = :task');
    $query->execute(['task' => $taskId]);
    $projectId = $query->fetchColumn();
    if (!$projectId) throw new GenesisSharedAccessException();
    genesisSharedProjectAccess((string)$projectId, $userId);
    $query = genesisDb()->prepare('SELECT filename_ciphertext, mime_type, ciphertext
        FROM shared_task_attachments WHERE id = :id AND task_id = :task');
    $query->execute(['id' => $attachmentId, 'task' => $taskId]);
    $row = $query->fetch();
    if (!$row) throw new GenesisSharedAccessException();
    $bytes = genesisDecrypt($row['ciphertext']);
    $name = genesisDecrypt($row['filename_ciphertext']);
    if ($bytes === null || $name === null) throw new GenesisSharedAccessException();
    return ['name' => $name, 'type' => $row['mime_type'], 'bytes' => $bytes];
}
