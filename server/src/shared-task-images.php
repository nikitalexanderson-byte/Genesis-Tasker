<?php
declare(strict_types=1);

/** No public files, original filenames, or image bytes in task JSON/audit receipts. */
function genesisSharedSaveTaskImage(string $taskId, mixed $data): void
{
    $db = genesisDb();
    if ($data === null || $data === '') {
        $db->prepare('DELETE FROM shared_task_images WHERE task_id = :task')->execute(['task' => $taskId]);
        return;
    }
    if (!is_string($data) || strlen($data) > 4194335) throw new InvalidArgumentException('TASK_IMAGE_TOO_LARGE');
    if (!preg_match('/\Adata:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+\/=]+)\z/', $data, $match)) {
        throw new InvalidArgumentException('INVALID_TASK_IMAGE');
    }
    $bytes = base64_decode($match[2], true);
    if ($bytes === false || strlen($bytes) === 0) throw new InvalidArgumentException('INVALID_TASK_IMAGE');
    if (strlen($bytes) > 3 * 1024 * 1024) throw new InvalidArgumentException('TASK_IMAGE_TOO_LARGE');
    $info = @getimagesizefromstring($bytes);
    if (!$info || ($info['mime'] ?? '') !== 'image/' . $match[1] || $info[0] * $info[1] > 40000000) {
        throw new InvalidArgumentException('INVALID_TASK_IMAGE');
    }
    $db->prepare('INSERT INTO shared_task_images (task_id, mime_type, byte_size, ciphertext, updated_at)
        VALUES (:task, :mime, :size, :cipher, :now) ON CONFLICT(task_id) DO UPDATE SET
        mime_type = excluded.mime_type, byte_size = excluded.byte_size,
        ciphertext = excluded.ciphertext, updated_at = excluded.updated_at')->execute([
        'task' => $taskId, 'mime' => $info['mime'], 'size' => strlen($bytes),
        'cipher' => genesisEncrypt($bytes), 'now' => genesisNow(),
    ]);
}

function genesisSharedTaskImageUrl(string $taskId, bool $hasImage): ?string
{
    return $hasImage ? '/api/shared/tasks/' . rawurlencode($taskId) . '/image' : null;
}

/** Resolve current membership on every request, including after a move or removal. */
function genesisSharedReadTaskImage(string $userId, string $taskId): array
{
    genesisSharedRequireEnabled($userId);
    $query = genesisDb()->prepare('SELECT project_id FROM shared_tasks_history_read WHERE id = :task');
    $query->execute(['task' => $taskId]);
    $projectId = $query->fetchColumn();
    if (!$projectId) throw new GenesisSharedAccessException();
    genesisSharedProjectAccess((string)$projectId, $userId);
    $query = genesisDb()->prepare('SELECT mime_type, ciphertext FROM shared_task_images WHERE task_id = :task');
    $query->execute(['task' => $taskId]);
    $image = $query->fetch();
    if (!$image) throw new GenesisSharedAccessException();
    $bytes = genesisDecrypt($image['ciphertext']);
    if ($bytes === null) throw new GenesisSharedAccessException();
    return ['type' => $image['mime_type'], 'bytes' => $bytes];
}
