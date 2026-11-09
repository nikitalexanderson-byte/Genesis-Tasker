<?php
declare(strict_types=1);

/** Shared tasks stay in GENESIS; this is each member's independent, opt-in Google copy. */
function genesisSharedGoogleSettings(string $userId, string $projectId): array
{
    $user = genesisSharedRequireEnabled($userId);
    genesisSharedProjectAccess($projectId, $userId);
    $query = genesisDb()->prepare('SELECT tasks_enabled, calendar_enabled FROM shared_google_preferences
        WHERE project_id = :project AND user_id = :user');
    $query->execute(['project' => $projectId, 'user' => $userId]);
    $saved = $query->fetch() ?: [];
    $connected = !empty($user['refresh_token_enc']);
    return [
        'tasksEnabled' => !empty($saved['tasks_enabled']),
        'calendarEnabled' => !empty($saved['calendar_enabled']),
        'tasksAvailable' => $connected && genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE),
        'calendarAvailable' => $connected && genesisGoogleScopeGranted($user, GENESIS_GOOGLE_CALENDAR_SCOPE),
    ];
}

function genesisSharedSetGoogleSettings(string $userId, string $projectId, array $input): array
{
    $current = genesisSharedGoogleSettings($userId, $projectId);
    foreach (['tasksEnabled', 'calendarEnabled'] as $field) {
        if (array_key_exists($field, $input) && !is_bool($input[$field])) {
            throw new InvalidArgumentException('INVALID_SHARED_GOOGLE_CONSENT');
        }
    }
    $tasks = $input['tasksEnabled'] ?? $current['tasksEnabled'];
    $calendar = $input['calendarEnabled'] ?? $current['calendarEnabled'];
    if ($tasks && !$current['tasksEnabled'] && !$current['tasksAvailable']
        || $calendar && !$current['calendarEnabled'] && !$current['calendarAvailable']) {
        throw new GenesisSharedAccessException('GOOGLE_PERMISSION_REQUIRED', 403);
    }
    genesisDb()->prepare('INSERT INTO shared_google_preferences
        (project_id, user_id, tasks_enabled, calendar_enabled, updated_at)
        VALUES (:project, :user, :tasks, :calendar, :now)
        ON CONFLICT(project_id, user_id) DO UPDATE SET
        tasks_enabled = excluded.tasks_enabled, calendar_enabled = excluded.calendar_enabled,
        last_sync_attempt_at = NULL, updated_at = excluded.updated_at')->execute([
        'project' => $projectId, 'user' => $userId, 'tasks' => $tasks ? 1 : 0,
        'calendar' => $calendar ? 1 : 0, 'now' => genesisNow(),
    ]);
    return genesisSharedGoogleSettings($userId, $projectId);
}

function genesisSharedGoogleTaskList(array $user, string $projectId, string $projectTitle): string
{
    $db = genesisDb();
    $query = $db->prepare('SELECT google_task_list_id FROM shared_google_preferences
        WHERE project_id = :project AND user_id = :user');
    $query->execute(['project' => $projectId, 'user' => $user['id']]);
    $id = (string)$query->fetchColumn();
    if ($id !== '') {
        try {
            genesisGoogleTasksApi('GET', '/users/@me/lists/' . rawurlencode($id), $user);
            return $id;
        } catch (GenesisGoogleHttpException $error) {
            if ($error->status !== 404 && $error->status !== 410) throw $error;
        }
    }
    $created = genesisGoogleTasksApi('POST', '/users/@me/lists', $user,
        ['title' => mb_substr('GENESIS · ' . $projectTitle, 0, 300)]);
    $id = (string)($created['id'] ?? '');
    if ($id === '') throw new RuntimeException('GOOGLE_TASK_LIST_NOT_CREATED');
    $db->prepare('UPDATE shared_google_preferences SET google_task_list_id = :list, updated_at = :now
        WHERE project_id = :project AND user_id = :user')->execute([
        'list' => $id, 'now' => genesisNow(), 'project' => $projectId, 'user' => $user['id'],
    ]);
    return $id;
}

function genesisSharedGoogleTaskPayload(array $task): array
{
    $notes = 'GENESIS shared task ' . $task['id'] . "\n";
    if (!empty($task['space_id']) && !empty($task['project_id'])) {
        $notes .= 'https://genesiscalendar.com/?affairs=shared&space=' . rawurlencode($task['space_id'])
            . '&project=' . rawurlencode($task['project_id']) . '&task=' . rawurlencode($task['id']) . "#projects\n";
    }
    $done = $task['completed_at'] !== null;
    $notes .= genesisEntryDescription($task, '');
    $payload = ['title' => $task['title'], 'notes' => $notes,
        'status' => $done ? 'completed' : 'needsAction'];
    $payload['due'] = $task['due_date'] !== null ? $task['due_date'] . 'T00:00:00.000Z' : null;
    if ($done) $payload['completed'] = $task['completed_at'];
    return $payload;
}

function genesisSharedGoogleCalendarPayload(array $task): array
{
    $date = new DateTimeImmutable($task['due_date'] . ' 12:00:00', new DateTimeZone('UTC'));
    $payload = [
        'summary' => ($task['completed_at'] !== null ? '✓ ' : '') . $task['title'],
        'description' => genesisEntryDescription($task, 'GENESIS shared task'),
        'start' => ['date' => $date->format('Y-m-d')],
        'end' => ['date' => $date->modify('+1 day')->format('Y-m-d')],
        'extendedProperties' => ['private' => ['genesisSharedTaskId' => $task['id']]],
        'reminders' => ['useDefault' => false],
    ];
    if (in_array($task['entry_type'] ?? '', ['meeting', 'event'], true) && !empty($task['start_time']) && !empty($task['end_time'])) {
        $zone = genesisClientTimeZone();
        $start = new DateTimeImmutable(($task['start_date'] ?? $task['due_date']) . ' ' . $task['start_time'], $zone);
        $end = new DateTimeImmutable($task['due_date'] . ' ' . $task['end_time'], $zone);
        if ($end > $start) {
            $payload['start'] = ['dateTime' => $start->format(DATE_RFC3339), 'timeZone' => $zone->getName()];
            $payload['end'] = ['dateTime' => $end->format(DATE_RFC3339), 'timeZone' => $zone->getName()];
        }
    }
    return $payload;
}

function genesisSharedGoogleLink(string $taskId, string $userId, string $destination, string $googleId,
    int $revision, ?string $listId = null): void
{
    genesisDb()->prepare('INSERT INTO shared_google_projection_links
        (task_id, user_id, destination, google_id, synced_revision, synced_at, google_list_id)
        VALUES (:task, :user, :destination, :google, :revision, :now, :list)
        ON CONFLICT(task_id, user_id, destination) DO UPDATE SET
        google_id = excluded.google_id, synced_revision = excluded.synced_revision,
        synced_at = excluded.synced_at, google_list_id = excluded.google_list_id')->execute([
        'task' => $taskId, 'user' => $userId, 'destination' => $destination,
        'google' => $googleId, 'revision' => $revision, 'now' => genesisNow(), 'list' => $listId,
    ]);
}

/** Recover a successful Google Tasks write whose local link was not committed. */
function genesisSharedExistingGoogleTasks(array $user, string $listId): array
{
    $found = []; $pageToken = null;
    do {
        $query = ['maxResults' => 100, 'showCompleted' => 'true', 'showHidden' => 'true'];
        if ($pageToken !== null) $query['pageToken'] = $pageToken;
        $result = genesisGoogleTasksApi('GET', '/lists/' . rawurlencode($listId) . '/tasks?'
            . http_build_query($query, '', '&', PHP_QUERY_RFC3986), $user);
        foreach ($result['items'] ?? [] as $row) {
            if (!is_array($row) || empty($row['id']) || !is_string($row['notes'] ?? null)) continue;
            if (preg_match('/\AGENESIS shared task ([a-f0-9-]{36})\n/', $row['notes'], $match)) {
                $found[$match[1]] = (string)$row['id'];
            }
        }
        $pageToken = is_string($result['nextPageToken'] ?? null) ? $result['nextPageToken'] : null;
    } while ($pageToken !== null && count($found) < 5000);
    return $found;
}

/** A bounded user-initiated batch avoids sharing through another member's Google account. */
/** Releasing the PHP session must not permit duplicate Google writes from parallel tabs. */
function genesisSharedGoogleWithSyncLock(string $userId, callable $operation): array
{
    $path=genesisGoogleCacheDirectory().'/shared-'.hash('sha256',$userId).'.lock';
    $lock=fopen($path,'c+');
    if($lock===false)throw new RuntimeException('Google sync lock is unavailable.');
    @chmod($path,0600);
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);return ['synced'=>0,'pending'=>1,'busy'=>true];}
    try{return $operation();}
    finally{flock($lock,LOCK_UN);fclose($lock);}
}

function genesisSharedSyncGoogle(string $userId, string $projectId, int $batchSize = 20): array
{
    genesisSharedProjectAccess($projectId,$userId);
    return genesisSharedGoogleWithSyncLock($userId,static fn():array=>genesisSharedSyncGoogleLocked($userId,$projectId,$batchSize));
}

function genesisSharedSyncGoogleLocked(string $userId, string $projectId, int $batchSize): array
{
    $settings = genesisSharedGoogleSettings($userId, $projectId);
    genesisSharedCleanGoogleCopies($userId, 5);
    if (!$settings['tasksEnabled'] && !$settings['calendarEnabled']) {
        return ['synced' => 0, 'pending' => 0];
    }
    if ($settings['tasksEnabled'] && !$settings['tasksAvailable']
        || $settings['calendarEnabled'] && !$settings['calendarAvailable']) {
        throw new GenesisSharedAccessException('GOOGLE_PERMISSION_REQUIRED', 403);
    }
    $user = genesisFindUser($userId);
    $project = genesisSharedProjectAccess($projectId, $userId);
    $db = genesisDb();
    $batchSize = max(1, min(20, $batchSize));
    $db->prepare('UPDATE shared_google_preferences SET last_sync_attempt_at = :now
        WHERE project_id = :project AND user_id = :user')->execute([
        'now' => genesisNow(), 'project' => $projectId, 'user' => $userId,
    ]);
    $listId = $settings['tasksEnabled'] ? genesisSharedGoogleTaskList($user, $projectId, (string)$project['title']) : '';
    if ($settings['calendarEnabled']) $user = genesisEnsureGoogleCalendar($user);
    $query = $db->prepare('SELECT t.id, t.title, t.entry_type, t.start_date, t.start_time, t.end_time, t.description, t.due_date, t.completed_at, t.revision,
        t.project_id, p.space_id,
        lt.google_id AS task_google_id, lt.google_list_id AS task_list_id, lt.synced_revision AS task_revision,
        lc.google_id AS event_google_id, lc.synced_revision AS event_revision
        FROM shared_tasks_read t JOIN shared_projects p ON p.id = t.project_id
        LEFT JOIN shared_google_projection_links lt ON lt.task_id = t.id AND lt.user_id = :tasks_user AND lt.destination = \'tasks\'
        LEFT JOIN shared_google_projection_links lc ON lc.task_id = t.id AND lc.user_id = :calendar_user AND lc.destination = \'calendar\'
        WHERE t.project_id = :project AND
        ((:tasks_on = 1 AND COALESCE(lt.synced_revision, 0) < t.revision)
          OR (:calendar_on = 1 AND COALESCE(lc.synced_revision, 0) < t.revision
              AND (t.due_date IS NOT NULL OR lc.google_id <> \'\')))
        ORDER BY t.updated_at, t.id LIMIT ' . ($batchSize + 1));
    $query->execute(['tasks_user' => $userId, 'calendar_user' => $userId, 'project' => $projectId,
        'tasks_on' => $settings['tasksEnabled'] ? 1 : 0,
        'calendar_on' => $settings['calendarEnabled'] ? 1 : 0]);
    $synced = 0; $pending = 0;
    $rows = $query->fetchAll();
    $existingTasks = $settings['tasksEnabled'] && array_filter($rows,
        static fn(array $row): bool => empty($row['task_google_id'])
            || !empty($row['task_list_id']) && $row['task_list_id'] !== $listId)
        ? genesisSharedExistingGoogleTasks($user, $listId) : [];
    foreach ($rows as $task) {
        $taskStale = $settings['tasksEnabled'] && (int)($task['task_revision'] ?? 0) < (int)$task['revision'];
        $eventStale = $settings['calendarEnabled'] && (int)($task['event_revision'] ?? 0) < (int)$task['revision']
            && ($task['due_date'] !== null || !empty($task['event_google_id']));
        if (!$taskStale && !$eventStale) continue;
        if ($synced >= $batchSize) { $pending++; continue; }
        if ($taskStale) {
            $id = (string)($task['task_google_id'] ?: ($existingTasks[$task['id']] ?? ''));
            $path = '/lists/' . rawurlencode($listId) . '/tasks';
            $payload = genesisSharedGoogleTaskPayload($task);
            $sourceList = (string)($task['task_list_id'] ?? '');
            if ($id !== '' && $sourceList !== '' && $sourceList !== $listId) {
                try {
                    $moved = genesisGoogleTasksApi('POST', '/lists/' . rawurlencode($sourceList)
                        . '/tasks/' . rawurlencode($id) . '/move?destinationTasklist=' . rawurlencode($listId), $user);
                    $id = (string)($moved['id'] ?? $id);
                } catch (GenesisGoogleHttpException $error) {
                    if (!in_array($error->status, [404, 410], true)) throw $error;
                    $id = (string)($existingTasks[$task['id']] ?? '');
                }
            }
            try {
                $saved = $id !== ''
                    ? genesisGoogleTasksApi('PATCH', $path . '/' . rawurlencode($id), $user, $payload)
                    : genesisGoogleTasksApi('POST', $path, $user, $payload);
            } catch (GenesisGoogleHttpException $error) {
                if ($id === '' || !in_array($error->status, [404, 410], true)) throw $error;
                $saved = genesisGoogleTasksApi('POST', $path, $user, $payload);
            }
            $googleId = (string)($saved['id'] ?? '');
            if ($googleId === '') throw new RuntimeException('GOOGLE_SHARED_TASK_NOT_SAVED');
            genesisSharedGoogleLink($task['id'], $userId, 'tasks', $googleId, (int)$task['revision'], $listId);
        }
        if ($eventStale && $task['due_date'] === null) {
            $eventId = (string)$task['event_google_id'];
            try {
                genesisGoogleApi('DELETE', '/calendars/' . rawurlencode((string)$user['google_calendar_id'])
                    . '/events/' . rawurlencode($eventId), $user);
            } catch (GenesisGoogleHttpException $error) {
                if (!in_array($error->status, [404, 410], true)) throw $error;
            }
            genesisSharedGoogleLink($task['id'], $userId, 'calendar', '', (int)$task['revision']);
        } elseif ($eventStale) {
            $calendarPath = '/calendars/' . rawurlencode((string)$user['google_calendar_id']) . '/events';
            $eventId = (string)($task['event_google_id'] ?? '');
            $payload = genesisSharedGoogleCalendarPayload($task);
            if ($eventId === '') $payload['id'] = 'genesis' . substr(hash('sha256', $userId . $task['id']), 0, 32);
            try {
                $saved = $eventId !== ''
                    ? genesisGoogleApi('PUT', $calendarPath . '/' . rawurlencode($eventId), $user, $payload)
                    : genesisGoogleApi('POST', $calendarPath, $user, $payload);
            } catch (GenesisGoogleHttpException $error) {
                if ($eventId !== '' || $error->status !== 409) throw $error;
                $eventId = $payload['id'];
                $saved = genesisGoogleApi('PUT', $calendarPath . '/' . rawurlencode($eventId), $user, $payload);
            }
            $googleId = (string)($saved['id'] ?? '');
            if ($googleId === '') throw new RuntimeException('GOOGLE_SHARED_EVENT_NOT_SAVED');
            genesisSharedGoogleLink($task['id'], $userId, 'calendar', $googleId, (int)$task['revision']);
        }
        $synced++;
    }
    return ['synced' => $synced, 'pending' => $pending];
}

/** Copies from projects the member cannot sync are deleted with that member's own Google grant. */
function genesisSharedCleanGoogleCopies(?string $userId = null, int $limit = 10): array
{
    $db = genesisDb();
    $sql = 'SELECT id, user_id, destination, google_id, google_list_id
        FROM shared_google_projection_cleanup';
    if ($userId !== null) $sql .= ' WHERE user_id = :user';
    $sql .= ' ORDER BY created_at, id LIMIT ' . max(1, min(20, $limit));
    $query = $db->prepare($sql);
    $query->execute($userId !== null ? ['user' => $userId] : []);
    $cleaned = 0; $failed = 0;
    foreach ($query->fetchAll() as $row) {
        try {
            $user = genesisFindUser((string)$row['user_id']);
            if (!$user) throw new RuntimeException('SHARED_GOOGLE_USER_NOT_FOUND');
            if ($row['destination'] === 'tasks') {
                $listId = (string)($row['google_list_id'] ?? '');
                if ($listId === '') throw new RuntimeException('SHARED_GOOGLE_LIST_NOT_FOUND');
                genesisGoogleTasksApi('DELETE', '/lists/' . rawurlencode($listId)
                    . '/tasks/' . rawurlencode((string)$row['google_id']), $user);
            } else {
                $user = genesisEnsureGoogleCalendar($user);
                genesisGoogleApi('DELETE', '/calendars/' . rawurlencode((string)$user['google_calendar_id'])
                    . '/events/' . rawurlencode((string)$row['google_id']), $user);
            }
        } catch (GenesisGoogleHttpException $error) {
            if (!in_array($error->status, [404, 410], true)) {
                $failed++;
                $db->prepare('UPDATE shared_google_projection_cleanup SET attempt_count = attempt_count + 1
                    WHERE id = :id')->execute(['id' => $row['id']]);
                continue;
            }
        } catch (Throwable $error) {
            $failed++;
            $db->prepare('UPDATE shared_google_projection_cleanup SET attempt_count = attempt_count + 1
                WHERE id = :id')->execute(['id' => $row['id']]);
            continue;
        }
        $db->prepare('DELETE FROM shared_google_projection_cleanup WHERE id = :id')->execute(['id' => $row['id']]);
        $cleaned++;
    }
    return ['cleaned' => $cleaned, 'failed' => $failed];
}

/** Background sync processes only consented member/project pairs, in small rotating batches. */
function genesisSharedSyncGoogleCron(): array
{
    genesisDb()->prepare('DELETE FROM shared_mutation_receipts WHERE created_at < :cutoff')
        ->execute(['cutoff' => gmdate('Y-m-d\TH:i:s\Z', time() - 90 * 86400)]);
    $cleanup = genesisSharedCleanGoogleCopies(null, 10);
    $before = gmdate('Y-m-d\TH:i:s\Z', time() - 3600);
    $query = genesisDb()->prepare('SELECT p.project_id, p.user_id FROM shared_google_preferences p
        JOIN shared_project_members m ON m.project_id = p.project_id AND m.user_id = p.user_id
        JOIN shared_projects sp ON sp.id = p.project_id AND sp.archived_at IS NULL
        JOIN users u ON u.id = p.user_id AND u.shared_projects_enabled = 1
        WHERE (p.tasks_enabled = 1 OR p.calendar_enabled = 1)
          AND (p.last_sync_attempt_at IS NULL OR p.last_sync_attempt_at < :before)
        ORDER BY COALESCE(p.last_sync_attempt_at, \'\'), p.updated_at LIMIT 5');
    $query->execute(['before' => $before]);
    $processed = 0; $copied = 0; $failed = 0;
    foreach ($query->fetchAll() as $row) {
        genesisDb()->prepare('UPDATE shared_google_preferences SET last_sync_attempt_at = :now
            WHERE project_id = :project AND user_id = :user')->execute([
            'now' => genesisNow(), 'project' => $row['project_id'], 'user' => $row['user_id'],
        ]);
        try {
            $result = genesisSharedSyncGoogle((string)$row['user_id'], (string)$row['project_id'], 3);
            $copied += $result['synced'];
        } catch (Throwable $error) {
            $failed++;
            genesisLogError('[SharedGoogleCron] ' . get_class($error));
        }
        $processed++;
    }
    return ['projectsChecked' => $processed, 'tasksCopied' => $copied,
        'copiesRemoved' => $cleanup['cleaned'], 'failures' => $failed + $cleanup['failed']];
}
