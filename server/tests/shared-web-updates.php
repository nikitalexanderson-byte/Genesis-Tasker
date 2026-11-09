<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
// Also invoked by shared-space-settings.php in the existing deployment workflow.
if (!function_exists('genesisDb')) {
    require dirname(__DIR__) . '/src/bootstrap.php';
    require dirname(__DIR__) . '/src/repository.php';
    require dirname(__DIR__) . '/src/google.php';
    require dirname(__DIR__) . '/src/shared-projects.php';
}
if (!function_exists('genesisSharedGoogleTaskPayload')) require_once dirname(__DIR__) . '/src/shared-google.php';
function webExpect(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
function webDenied(callable $action): void {
    try { $action(); } catch (GenesisSharedAccessException) { return; }
    throw new RuntimeException('Private shared data escaped membership checks.');
}
function webInvalid(callable $action): void {
    try { $action(); } catch (InvalidArgumentException) { return; }
    throw new RuntimeException('Invalid image or inbox input was accepted.');
}
$db = genesisDb(); $users = ['web-updates-owner', 'web-updates-member', 'web-updates-outsider'];
foreach ($users as $id) {
    $db->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at)
        VALUES (:id, :id, :email, :id, :now, :now)')->execute(['id' => $id, 'email' => $id . '@example.test', 'now' => genesisNow()]);
    genesisTestEnableSharedProjects($id);
}
[$owner, $member, $outsider] = $users;
try {
    $space = genesisSharedCreateSpace($owner, ['title' => 'Private photos']);
    $db->prepare("INSERT INTO shared_space_members (space_id, user_id, role, joined_at) VALUES (:space, :user, 'member', :now)")
        ->execute(['space' => $space['id'], 'user' => $member, 'now' => genesisNow()]);
    $project = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Photos']);
    $grant = $db->prepare("INSERT INTO shared_project_members (project_id, user_id, role, joined_at) VALUES (:project, :user, 'member', :now)");
    $grant->execute(['project' => $project['id'], 'user' => $member, 'now' => genesisNow()]);
    $status = genesisSharedProjectSnapshot($owner, $project['id'])['statuses'][0]['id'];
    $bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZ0AAAAASUVORK5CYII=');
    $data = 'data:image/png;base64,' . base64_encode($bytes);
    $request = ['title' => 'Private photo', 'statusId' => $status, 'imageData' => $data, 'requestId' => genesisUuid()];
    $task = genesisSharedTask($owner, $project['id'], $request);
    webExpect($task['imageUrl'] !== null && !str_contains(json_encode($task), base64_encode($bytes)), 'Image bytes leaked in task JSON.');
    webExpect(genesisSharedTask($owner, $project['id'], $request)['id'] === $task['id'], 'Image upload retry duplicated task.');
    $query = $db->prepare('SELECT ciphertext FROM shared_task_images WHERE task_id = :task'); $query->execute(['task' => $task['id']]);
    $cipher = $query->fetchColumn();
    webExpect($cipher !== $data && !str_contains($cipher, base64_encode($bytes)) && genesisDecrypt($cipher) === $bytes, 'Photo is not authenticated ciphertext.');
    webExpect(genesisSharedReadTaskImage($member, $task['id'])['bytes'] === $bytes, 'Invited member cannot view photo.');
    webDenied(fn() => genesisSharedReadTaskImage($outsider, $task['id']));
    $count = $db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn();
    webInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Invalid', 'statusId' => $status, 'imageData' => 'data:image/svg+xml;base64,' . base64_encode('<svg/>')]));
    webInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Mismatch', 'statusId' => $status, 'imageData' => 'data:image/jpeg;base64,' . base64_encode($bytes)]));
    webInvalid(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Oversized', 'statusId' => $status, 'imageData' => 'data:image/png;base64,' . base64_encode(str_pad($bytes, 3145729, 'x'))]));
    webExpect($db->query('SELECT COUNT(*) FROM shared_tasks')->fetchColumn() === $count, 'Invalid photo left a half-created task.');
    $boundary = genesisSharedTask($owner, $project['id'], ['title' => '3 MB boundary', 'statusId' => $status, 'imageData' => 'data:image/png;base64,' . base64_encode(str_pad($bytes, 3145728, 'x'))]);
    webExpect(strlen(genesisSharedReadTaskImage($member, $boundary['id'])['bytes']) === 3145728, 'Exact 3 MB limit was rejected.');
    $task = genesisSharedTask($owner, $project['id'], ['title' => 'Legacy update', 'expectedRevision' => $task['revision']], $task['id']);
    webExpect(genesisSharedReadTaskImage($member, $task['id'])['bytes'] === $bytes, 'Legacy client erased photo.');
    $payload = genesisSharedGoogleTaskPayload(['id' => $task['id'], 'project_id' => $project['id'], 'space_id' => $space['id'], 'title' => 'Photo', 'completed_at' => null, 'due_date' => null, 'description' => 'Secret']);
    webExpect(str_contains($payload['notes'], 'https://genesiscalendar.com/?affairs=shared') && str_contains($payload['notes'], '&task=' . $task['id']), 'Google Tasks lacks task link.');
    webExpect(!str_contains($payload['notes'], 'Secret') && !str_contains($payload['notes'], '/image') && !str_contains($payload['notes'], base64_encode($bytes)), 'Google received private image or description.');
    $totals = genesisSharedOverview($member);
    webExpect($totals['projects'] === 1 && $totals['tasks'] === 2 && $totals['newProjects'] === 1 && $totals['newTasks'] === 2, 'Shared summary is inaccurate.');
    $secondSpace = genesisSharedCreateSpace($owner, ['title' => 'Separate workspace']);
    $secondProject = genesisSharedCreateProject($owner, $secondSpace['id'], ['title' => 'Separate project']);
    $secondStatus = genesisSharedProjectSnapshot($owner, $secondProject['id'])['statuses'][0]['id'];
    genesisSharedTask($owner, $secondProject['id'], ['title' => 'Separate task', 'statusId' => $secondStatus]);
    webExpect(genesisSharedOverview($owner)['tasks'] === 3 && genesisSharedOverview($owner, $space['id'])['tasks'] === 2
        && genesisSharedOverview($owner, $secondSpace['id'])['tasks'] === 1, 'Workspace scope mixes totals from other spaces.');
    webDenied(fn() => genesisSharedOverview($member, $secondSpace['id']));
    webDenied(fn() => genesisSharedOverview($outsider, $space['id']));
    $historyBefore = count(genesisSharedActivity($owner, $project['id'], $task['id'], null)['events']);
    $task = genesisSharedTask($owner, $project['id'], ['title' => $task['title'], 'expectedRevision' => $task['revision']], $task['id']);
    webExpect(count(genesisSharedActivity($owner, $project['id'], $task['id'], null)['events']) === $historyBefore, 'Saving unchanged fields duplicated task history.');
    webExpect(genesisSharedOverview($outsider)['tasks'] === 0 && genesisSharedInbox($outsider)['notifications'] === [], 'Inbox leaks another workspace.');
    // B7 comments require an explicit watch; membership alone is not a subscription.
    genesisSharedTaskWatch($member,$project['id'],$task['id'],['watching'=>true]);
    genesisSharedTaskWatch($member,$project['id'],$boundary['id'],['watching'=>true]);
    for ($i = 0; $i < 55; $i++) genesisSharedAddComment($owner, $project['id'], $task['id'], ['body' => 'Comment ' . $i]);
    $first = genesisSharedInbox($member, '', true); $second = genesisSharedInbox($member, $first['nextCursor'], true);
    $commentNotice = array_values(array_filter($first['notifications'], static fn($event) => $event['action'] === 'comment.created'))[0];
    webExpect($commentNotice['objectId'] === $task['id'] && !empty($commentNotice['commentId']), 'Comment notice lost its task or exact comment destination.');
    webExpect((bool)array_filter(genesisSharedComments($member, $project['id'], $task['id']), static fn($comment) => $comment['id'] === $commentNotice['commentId']), 'Comment destination does not belong to its task.');
    webExpect(count($first['notifications']) === 50 && count($second['notifications']) === 8, 'Inbox pagination loses older updates.');
    $older = array_values(array_filter($second['notifications'], static fn($event) => $event['action'] === 'comment.created'))[0]['id'];
    webDenied(fn() => genesisSharedReadInbox($outsider, ['eventIds' => [$older]]));
    genesisSharedReadInbox($member, ['eventIds' => [$older]]);
    webExpect(genesisSharedOverview($member)['newComments'] === 54, 'Reading an old comment did not persist.');
    $unrelated = genesisSharedAddComment($owner, $project['id'], $boundary['id'], ['body' => 'Unopened task comment']);
    $displayed = array_column(genesisSharedComments($member, $project['id'], $task['id']), 'id');
    webDenied(fn() => genesisSharedReadTaskUpdates($outsider, $project['id'], $task['id'], ['commentIds' => $displayed]));
    webDenied(fn() => genesisSharedReadTaskUpdates($member, $project['id'], genesisUuid(), []));
    webInvalid(fn() => genesisSharedReadTaskUpdates($member, $project['id'], $task['id'], ['commentIds' => ['invalid']]));
    $readTask = genesisSharedReadTaskUpdates($member, $project['id'], $task['id'], []);
    webExpect($readTask['overview']['newTasks'] === 1 && $readTask['overview']['newComments'] === 55, 'Opening task fields consumed hidden comments or another task.');
    $later = genesisSharedAddComment($owner, $project['id'], $task['id'], ['body' => 'Arrived after discussion loaded']);
    $readDiscussion = genesisSharedReadTaskUpdates($member, $project['id'], $task['id'], ['commentIds' => [...$displayed, $unrelated['id']]]);
    webExpect($readDiscussion['overview']['newComments'] === 2 && $readDiscussion['overview']['newProjects'] === 1,
        'Viewing discussion consumed unseen comments or project updates.');
    webExpect(genesisSharedReadTaskUpdates($member, $project['id'], $task['id'], ['commentIds' => $displayed])['overview']['newComments'] === 2,
        'Repeated acknowledgement changed the unread count.');
    $left = array_column(genesisSharedInbox($member, '', true)['notifications'], 'commentId');
    webExpect(in_array($later['id'], $left, true) && in_array($unrelated['id'], $left, true), 'Unseen comment was marked as read.');
    genesisSharedReadTaskUpdates($member, $project['id'], $task['id'], ['commentIds' => [$later['id']]]);
    webExpect(genesisSharedOverview($member)['newComments'] === 1, 'A newly displayed comment did not clear.');
    genesisSharedReadInbox($member, ['all' => true]);
    webExpect(genesisSharedInbox($member, '', true)['notifications'] === [] && genesisSharedOverview($member)['newTasks'] === 0, 'Mark all read did not persist.');
    // The existing server-only SQLite backup includes ciphertext and passes integrity checking.
    $query->closeCursor();
    $backupPath = tempnam(sys_get_temp_dir(), 'genesis-image-backup-');
    try {
        $db->exec('VACUUM INTO ' . $db->quote($backupPath)); $backup = new PDO('sqlite:' . $backupPath);
        webExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $backup->query('SELECT COUNT(*) FROM shared_task_images')->fetchColumn() == 2, 'Consistent backup lost photos.');
    } finally { $backup = null; if (is_file($backupPath)) unlink($backupPath); }
    $db->prepare('DELETE FROM shared_project_members WHERE project_id = :project AND user_id = :user')->execute(['project' => $project['id'], 'user' => $member]);
    webDenied(fn() => genesisSharedReadTaskImage($member, $task['id']));
    webExpect(genesisSharedOverview($member)['tasks'] === 0, 'Removed project membership retained counts.');
    $destination = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Move destination']);
    $grant->execute(['project' => $destination['id'], 'user' => $member, 'now' => genesisNow()]);
    $destinationStatus = genesisSharedProjectSnapshot($owner, $destination['id'])['statuses'][0]['id'];
    $moved = genesisSharedMoveTask($owner, $project['id'], $task['id'], ['destinationProjectId' => $destination['id'], 'statusId' => $destinationStatus, 'expectedRevision' => $task['revision'], 'position' => 0]);
    webExpect(genesisSharedReadTaskImage($member, $task['id'])['bytes'] === $bytes, 'Moved photo does not follow current task access.');
    $db->prepare('DELETE FROM shared_space_members WHERE space_id = :space AND user_id = :user')->execute(['space' => $space['id'], 'user' => $member]);
    webDenied(fn() => genesisSharedReadTaskImage($member, $task['id']));
    genesisSharedDeleteTask($owner, $destination['id'], $task['id'], ['expectedRevision' => $moved['revision']]);
    $query->execute(['task' => $task['id']]); webExpect($query->fetchColumn() !== false, 'Trash lost recoverable photo ciphertext.');
    $query->closeCursor(); // Release the retained row before the next test opens a separate HTTP writer.
    webDenied(fn() => genesisSharedReadTaskImage($owner, $task['id']));
} finally { foreach ($users as $id) if (genesisFindUser($id)) genesisDeleteAccount($id); }
echo "Shared web summary, persistent inbox, encrypted images, ACL and Google task links passed.\n";
require __DIR__ . '/shared-task-attachments.php';
