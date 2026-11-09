<?php
declare(strict_types=1);
// Included by the shared-projects smoke suite, using its isolated database/helpers.
// Upgrade a populated pre-feature database and verify its server-only backup.
$legacy = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$legacy->exec('PRAGMA foreign_keys = ON');
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) if (basename($file) < '036_') $legacy->exec(file_get_contents($file));
$legacy->exec("INSERT INTO users (id, google_sub, email, created_at, updated_at) VALUES ('u', 'u', 'legacy@example.test', 'now', 'now');
    INSERT INTO shared_spaces (id, title, created_by, created_at, updated_at) VALUES ('s', 'Legacy space', 'u', 'now', 'now');
    INSERT INTO shared_projects (id, space_id, title, created_at, updated_at) VALUES ('p', 's', 'Legacy project', 'now', 'now');
    INSERT INTO shared_project_statuses (id, project_id, title, position) VALUES ('b', 'p', 'Legacy board', 0);
    INSERT INTO shared_tasks (id, project_id, status_id, title, due_date, created_at, updated_at) VALUES ('t', 'p', 'b', 'Legacy task', '2026-10-10', 'now', 'now');
    INSERT INTO shared_comments (id, task_id, body, created_at) VALUES ('c', 't', 'Legacy comment', 'now')");
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-collaboration-backup-');
try {
    $legacy->exec('VACUUM INTO ' . $legacy->quote($backupPath));
    foreach (['036_shared_labels_activity.sql', '037_shared_space_covers.sql'] as $migration) { $legacy->beginTransaction(); $legacy->exec(file_get_contents(dirname(__DIR__) . '/migrations/' . $migration)); $legacy->commit(); }
    sharedExpect($legacy->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Legacy task', 'Upgrade lost tasks.');
    sharedExpect($legacy->query('SELECT body FROM shared_comments')->fetchColumn() === 'Legacy comment', 'Upgrade lost comments.');
    sharedExpect($legacy->query('SELECT start_date FROM shared_tasks')->fetchColumn() === null, 'Legacy schedule changed.');
    sharedExpect($legacy->query('SELECT cover_image FROM shared_spaces')->fetchColumn() === '', 'Legacy cover changed.');
    sharedExpect(!$legacy->query('PRAGMA foreign_key_check')->fetchAll(), 'Upgrade broke references.');
    $backup = new PDO('sqlite:' . $backupPath);
    sharedExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Backup is invalid.');
    sharedExpect($backup->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Legacy task', 'Backup lost data.');
} finally { $backup = null; unlink($backupPath); }
$co = sharedUser('collaboration-owner@example.test', 'collaboration-owner');
$cm = sharedUser('collaboration-member@example.test', 'collaboration-member');
$cv = sharedUser('collaboration-viewer@example.test', 'collaboration-viewer');
$cx = sharedUser('collaboration-outsider@example.test', 'collaboration-outsider');
try {
    foreach ([$co, $cm, $cv, $cx] as $user) genesisUpdateAccountPreferences($user, ['sharedProjectsEnabled' => true]);
    $cs = genesisSharedCreateSpace($co, ['title' => 'Collaboration test']);
    $coverImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZ0AAAAASUVORK5CYII=';
    $cs = genesisSharedUpdateSpace($co, $cs['id'], ['title' => 'With cover', 'coverImage' => $coverImage, 'coverPosition' => ['x' => 20, 'y' => 80], 'expectedRevision' => 1]);
    sharedExpect($cs['coverPosition']['x'] === 20.0 && $cs['coverUrl'] !== null, 'Cover crop was not saved.');
    $cs = genesisSharedUpdateSpace($co, $cs['id'], ['title' => 'Legacy edit', 'expectedRevision' => $cs['revision']]);
    sharedExpect($cs['coverUrl'] !== null && $cs['coverPosition']['y'] === 80.0, 'Old client erased cover.');
    sharedExpect(genesisSharedReadCover($co, $cs['id'])['type'] === 'image/png', 'Cover did not decode.');
    sharedReject(static fn() => genesisSharedReadCover($cx, $cs['id']), 404);
    sharedInvalid(static fn() => genesisSharedCoverInput(['coverImage' => 'data:image/png;base64,' . base64_encode(str_repeat('x', 3 * 1024 * 1024 + 1))]));
    sharedInvalid(static fn() => genesisSharedCoverInput(['coverImage' => 'data:image/png;base64,' . base64_encode('not an image')]));
    sharedInvalid(static fn() => genesisSharedCoverInput(['coverPosition' => ['x' => 200, 'y' => 50]]));
    $otherSpace = genesisSharedCreateSpace($cx, ['title' => 'Isolated space']);
    $cp = genesisSharedCreateProject($co, $cs['id'], ['title' => 'Work']);
    $otherProject = genesisSharedCreateProject($cx, $otherSpace['id'], ['title' => 'Private']);
    foreach ([$cm => 'member', $cv => 'viewer'] as $user => $role) {
        $invite = genesisSharedInvite($co, $cp['id'], ['email' => genesisFindUser($user)['email'], 'role' => $role]);
        genesisSharedAcceptInvite($user, ['id' => $invite['id']]);
    }
    $label = genesisSharedSaveLabel($co, $cs['id'], null, ['title' => 'Priority', 'color' => '#993355']);
    $label2 = genesisSharedSaveLabel($co, $cs['id'], null, ['title' => 'Design', 'color' => '#2d6c68']);
    $foreignLabel = genesisSharedSaveLabel($cx, $otherSpace['id'], null, ['title' => 'Secret', 'color' => '#993355']);
    sharedReject(static fn() => genesisSharedLabels($cx, $cs['id']), 404);
    sharedReject(static fn() => genesisSharedSaveLabel($cv, $cs['id'], null, ['title' => 'No']), 403);
    sharedReject(static fn() => genesisSharedSaveLabel($co, $cs['id'], $label['id'], ['title' => 'Stale', 'expectedRevision' => 0]), 409);
    $cp = genesisSharedUpdateProject($co, $cp['id'], ['labelIds' => [$label['id'], $label2['id']], 'expectedRevision' => $cp['revision']]);
    sharedExpect(count($cp['labelIds']) === 2, 'Multiple project labels were not saved.');
    sharedInvalid(static fn() => genesisSharedUpdateProject($co, $cp['id'], ['labelIds' => [$foreignLabel['id']], 'expectedRevision' => $cp['revision']]));
    $snapshot = genesisSharedProjectSnapshot($co, $cp['id']);
    $open = array_values(array_filter($snapshot['statuses'], static fn($status) => !$status['isDone']))[0]['id'];
    $done = array_values(array_filter($snapshot['statuses'], static fn($status) => $status['isDone']))[0]['id'];
    $ct = genesisSharedTask($co, $cp['id'], ['title' => 'Timed work', 'statusId' => $open, 'labelIds' => [$label['id'], $label2['id']],
        'startDate' => '2026-10-10', 'dueDate' => '2026-10-11', 'startTime' => '23:00', 'endTime' => '01:30']);
    $follow = genesisSharedTask($co, $cp['id'], ['title' => 'Follow-up', 'statusId' => $open, 'dependsOnIds' => [$ct['id']]]);
    sharedInvalid(static fn() => genesisSharedTask($co, $cp['id'], ['dependsOnIds' => [$follow['id']], 'expectedRevision' => $ct['revision']], $ct['id']));
    sharedInvalid(static fn() => genesisSharedTask($co, $cp['id'], ['startDate' => '2026-10-12', 'expectedRevision' => $ct['revision']], $ct['id']));
    sharedInvalid(static fn() => genesisSharedTask($co, $cp['id'], ['startTime' => '25:00', 'expectedRevision' => $ct['revision']], $ct['id']));
    $otherStatus = genesisSharedProjectSnapshot($cx, $otherProject['id'])['statuses'][0]['id'];
    $otherTask = genesisSharedTask($cx, $otherProject['id'], ['title' => 'Private task', 'statusId' => $otherStatus]);
    sharedInvalid(static fn() => genesisSharedTask($co, $cp['id'], ['dependsOnIds' => [$otherTask['id']], 'expectedRevision' => $ct['revision']], $ct['id']));
    $ct = genesisSharedTask($cm, $cp['id'], ['title' => 'Legacy edit', 'expectedRevision' => $ct['revision']], $ct['id']);
    sharedExpect(count($ct['labelIds']) === 2 && $ct['startTime'] === '23:00', 'Old clients erased labels or schedule.');
    sharedExpect(genesisSharedProjectSnapshot($co, $cp['id'])['tasks'][0]['dependsOnIds'] !== null, 'Snapshot omitted dependencies.');
    sharedReject(static fn() => genesisSharedActivity($cx, $cp['id'], null, null), 404);
    sharedReject(static fn() => genesisSharedActivity($co, $cp['id'], $otherTask['id'], null), 404);
    sharedInvalid(static fn() => genesisSharedActivity($co, $cp['id'], null, null, genesisUuid()));
    // A long thread must return the latest 200, with stable ties and a backwards-only cursor.
    $thread = genesisSharedTask($co, $cp['id'], ['title' => 'Long discussion', 'statusId' => $open]);
    $insert = genesisDb()->prepare('INSERT INTO shared_comments(id,task_id,author_id,body,created_at) VALUES(?,?,?,?,?)');
    $threadIds = [];
    genesisDb()->beginTransaction();
    for ($i = 0; $i < 205; $i++) {
        $id = genesisUuid(); $threadIds[] = $id;
        $insert->execute([$id, $thread['id'], $co, 'Synthetic comment ' . $i, '2025-01-01T00:00:00Z']);
    }
    genesisDb()->commit(); sort($threadIds);
    $newest = genesisSharedCommentPage($cm, $cp['id'], $thread['id']);
    sharedExpect(array_column($newest['comments'], 'id') === array_slice($threadIds, 5) && $newest['hasMore'], 'Thread returned old comments or unstable timestamp ties.');
    $arriving = genesisSharedAddComment($co, $cp['id'], $thread['id'], ['body' => 'Arrived between pages']);
    $older = genesisSharedCommentPage($cm, $cp['id'], $thread['id'], $newest['nextBefore']);
    sharedExpect(array_column($older['comments'], 'id') === array_slice($threadIds, 0, 5) && !$older['hasMore'], 'New arrival shifted the history cursor.');
    sharedExpect(array_slice(genesisSharedComments($cm, $cp['id'], $thread['id']), -1)[0]['id'] === $arriving['id'], 'Newest comment was hidden after 200 entries.');
    sharedInvalid(static fn() => genesisSharedCommentPage($cm, $cp['id'], $ct['id'], $newest['nextBefore']));
    sharedInvalid(static fn() => genesisSharedCommentPage($cm, $cp['id'], $thread['id'], ['invalid']));
    sharedReject(static fn() => genesisSharedCommentPage($cx, $cp['id'], $thread['id']), 404);
    $boardRequest = ['title' => 'Custom palette', 'isDone' => false, 'color' => '#A45BCE', 'requestId' => genesisUuid()];
    $coloredBoard = genesisSharedCreateStatus($co, $cp['id'], $boardRequest);
    sharedExpect(strtolower($coloredBoard['color']) === '#a45bce', 'New board lost its custom color.');
    sharedExpect(genesisSharedCreateStatus($co, $cp['id'], $boardRequest)['id'] === $coloredBoard['id'], 'Board creation retry duplicated the board.');
    sharedInvalid(static fn() => genesisSharedCreateStatus($co, $cp['id'], ['title' => 'Bad color', 'color' => 'red']));
    $comment = genesisSharedAddComment($co, $cp['id'], $ct['id'], ['body' => "@Shared Test collaboration-member\nPlease review.", 'mentionIds' => [$cm]]);
    sharedExpect(genesisSharedComments($cm, $cp['id'], $ct['id'])[0]['mentionIds'] === [$cm], 'Mention IDs were not retained.');
    sharedExpect((bool)array_filter(genesisSharedNotifications($cm), static fn($event) => $event['action'] === 'comment.mentioned'), 'Mention did not create an internal notification.');
    sharedInvalid(static fn() => genesisSharedAddComment($co, $cp['id'], $ct['id'], ['body' => 'No mention', 'mentionIds' => [$cm]]));
    sharedInvalid(static fn() => genesisSharedAddComment($co, $cp['id'], $ct['id'], ['body' => '@Shared Test collaboration-outsider', 'mentionIds' => [$cx]]));
    $move = ['destinationProjectId' => $cp['id'], 'statusId' => $done, 'position' => 0, 'expectedRevision' => $ct['revision']];
    sharedReject(static fn() => genesisSharedMoveTask($cv, $cp['id'], $ct['id'], $move), 403);
    $ct = [...$ct, ...genesisSharedMoveTask($co, $cp['id'], $ct['id'], $move)];
    $closed = array_values(array_filter(genesisSharedProjectSnapshot($co, $cp['id'])['tasks'], static fn($task) => $task['id'] === $ct['id']))[0];
    sharedExpect($closed['completedAt'] !== null, 'Checkbox move did not close the task.');
    $ct = [...$ct, ...genesisSharedMoveTask($co, $cp['id'], $ct['id'], [...$move, 'statusId' => $open, 'expectedRevision' => $ct['revision']])];
    $activity = genesisSharedActivity($co, $cp['id'], $ct['id'], null);
    sharedExpect(!array_filter($activity['events'], static fn($event) => !str_starts_with($event['action'], 'task.')), 'Task history includes comments or project activity.');
    sharedExpect(!array_filter($activity['events'], static fn($event) => str_starts_with($event['action'], 'task.moved_')), 'Board moves inside a project fabricated a project transfer.');
    $boardChanges = array_values(array_filter($activity['events'], static fn($event) =>
        $event['action'] === 'task.updated' && isset($event['details']['referenceIds']['statusId'])));
    sharedExpect(count($boardChanges) === 2, 'Two board moves must produce exactly two task history entries.');
    foreach ([[$open, $done, false, true], [$done, $open, true, false]] as [$from, $to, $wasDone, $isDone]) {
        $matching = array_values(array_filter($boardChanges, static fn($event) =>
            $event['details']['referenceIds']['statusId'] === ['from' => $from, 'to' => $to]));
        sharedExpect(count($matching) === 1, 'Completion or reopening history was missing or duplicated.');
        $event = $matching[0];
        sharedExpect($event['boardId'] === $to && $event['details']['destinationBoardId'] === $to,
            'Board transition history did not retain its destination.');
        sharedExpect(($event['details']['changes']['isDone'] ?? null) === ['from' => $wasDone, 'to' => $isDone],
            'Board transition history lost its completion change.');
        sharedExpect(!isset($event['details']['referenceIds']['projectId']), 'An unchanged project was recorded as a project change.');
    }
    sharedExpect((bool)array_filter(genesisSharedActivity($co, $cp['id'], null, $open)['events'], static fn($event) => $event['taskId'] === $ct['id']), 'Board arrival history was lost.');
    sharedExpect((bool)array_filter(genesisSharedActivity($co, $cp['id'], null, $done)['events'], static fn($event) => $event['taskId'] === $ct['id']), 'Board history omitted status changes.');
    for ($i = 0; $i < 53; $i++) genesisSharedAudit($cp['id'], $co, 'task.updated', $ct['id']);
    $page = genesisSharedActivity($co, $cp['id'], null, null);
    sharedExpect(count($page['events']) === 50 && $page['nextCursor'] !== null, 'Activity pagination failed.');
    $next = genesisSharedActivity($co, $cp['id'], null, null, $page['nextCursor']);
    sharedExpect(!array_intersect(array_column($page['events'], 'id'), array_column($next['events'], 'id')), 'Activity pages overlap.');
    $inbox = array_values(array_filter(genesisSharedProjects($co, $cs['id']), static fn($project) => $project['isInbox']))[0];
    sharedReject(static fn()=>genesisSharedTask($co,$inbox['id'],['title'=>'Root task is forbidden']),409);
    $unscheduled = genesisSharedTask($co, $cp['id'], ['title' => 'Project inbox drop', 'statusId' => '']);
    sharedExpect($unscheduled['statusId']==='chaos-open:'.$cp['id'],'Unassigned task did not enter its project inbox.');
    sharedExpect(!array_filter(genesisSharedProjectSnapshot($co,$cp['id'])['statuses'],static fn($s)=>str_starts_with($s['id'],'chaos-')),'Project inbox leaked into boards.');
    sharedInvalid(static fn() => genesisSharedMoveTask($co, $cp['id'], $unscheduled['id'], ['destinationProjectId' => $cp['id'], 'statusId' => $open, 'position' => 0, 'expectedRevision' => 1, 'startDate' => '2026-10-11', 'dueDate' => '2026-10-10']));
    sharedExpect(genesisSharedGetTask($co,$cp['id'],$unscheduled['id'])['statusId']==='chaos-open:'.$cp['id'],'Invalid drop partially moved task.');
    $placed = genesisSharedMoveTask($co, $cp['id'], $unscheduled['id'], ['destinationProjectId' => $cp['id'], 'statusId' => $open, 'position' => 0, 'expectedRevision' => 1, 'startDate' => '2026-10-10', 'dueDate' => '2026-10-10', 'startTime' => '09:15', 'endTime' => '10:15']);
    sharedExpect($placed['startTime'] === '09:15' && $placed['dueDate'] === '2026-10-10', 'Project inbox drop did not atomically save schedule.');
    $returned=genesisSharedMoveTask($co,$cp['id'],$placed['id'],['destinationProjectId'=>$cp['id'],'statusId'=>'','position'=>0,'expectedRevision'=>$placed['revision']]);
    sharedExpect($returned['statusId']==='chaos-open:'.$cp['id'],'Cannot return a board task to project inbox.');
    sharedReject(static fn()=>genesisSharedMoveTask($co,$cp['id'],$returned['id'],['destinationProjectId'=>$inbox['id'],'statusId'=>'','position'=>0,'expectedRevision'=>$returned['revision']]),409);
    genesisSharedDeleteTask($co, $cp['id'], $ct['id'], ['expectedRevision' => $ct['revision']]);
    $followSnapshot = array_values(array_filter(genesisSharedProjectSnapshot($co, $cp['id'])['tasks'], static fn($task) => $task['id'] === $follow['id']))[0];
    sharedExpect($followSnapshot['dependsOnIds'] === [$ct['id']], 'Trash destroyed recoverable dependency relationships.');
    genesisSharedDeleteLabel($co, $cs['id'], $label['id'], ['expectedRevision' => 1]);
    sharedExpect(!in_array($label['id'], genesisSharedProjectSnapshot($co, $cp['id'])['project']['labelIds'], true), 'Label deletion left assignments.');
} finally {
    foreach ([$co, $cm, $cv, $cx] as $user) if (genesisFindUser($user)) genesisDeleteAccount($user);
}
echo "Shared collaboration smoke passed.\n";
