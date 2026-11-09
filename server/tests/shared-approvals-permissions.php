<?php
declare(strict_types=1);
// Included by shared-projects.php with its isolated SQLite connection and helpers.
$previous = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$previous->exec('PRAGMA foreign_keys = ON');
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) if (basename($file) < '042_') $previous->exec(file_get_contents($file));
$previous->exec("INSERT INTO users (id, google_sub, email, created_at, updated_at) VALUES ('u', 'u', 'previous@example.test', 'now', 'now');
    INSERT INTO shared_spaces (id, title, created_by, created_at, updated_at) VALUES ('s', 'Previous', 'u', 'now', 'now');
    INSERT INTO shared_space_members (space_id, user_id, role, joined_at) VALUES ('s', 'u', 'owner', 'now');
    INSERT INTO shared_projects (id, space_id, title, created_at, updated_at) VALUES ('p', 's', 'Project', 'now', 'now');
    INSERT INTO shared_project_statuses (id, project_id, title, position) VALUES ('b', 'p', 'Open', 0);
    INSERT INTO shared_tasks (id, project_id, status_id, title, created_at, updated_at) VALUES ('t', 'p', 'b', 'Previous task', 'now', 'now')");
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-approvals-backup-');
try {
    $previous->exec('VACUUM INTO ' . $previous->quote($backupPath));
    $previous->beginTransaction(); $previous->exec(file_get_contents(dirname(__DIR__) . '/migrations/042_team_permissions_and_task_approvals.sql')); $previous->commit();
    sharedExpect($previous->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Previous task', 'Migration lost an existing task.');
    sharedExpect($previous->query('SELECT role FROM shared_space_members')->fetchColumn() === 'owner', 'Migration changed existing roles.');
    sharedExpect($previous->query('SELECT member_category_id FROM shared_space_members')->fetchColumn() === null, 'Migration assigned a category to an old member.');
    sharedExpect((int)$previous->query('SELECT COUNT(*) FROM shared_task_approvals')->fetchColumn() === 0, 'Migration changed old completion rules.');
    sharedExpect(!$previous->query('PRAGMA foreign_key_check')->fetchAll(), 'Migration broke references.');
    $backup = new PDO('sqlite:' . $backupPath);
    sharedExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Previous-schema backup failed.');
    sharedExpect($backup->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Previous task', 'Backup lost existing data.');
} finally { $backup = null; unlink($backupPath); }

$ao = sharedUser('approval-owner@example.test', 'approval-owner');
$am = sharedUser('approval-member@example.test', 'approval-member');
$av = sharedUser('approval-viewer@example.test', 'approval-viewer');
$ax = sharedUser('approval-outsider@example.test', 'approval-outsider');
try {
    foreach ([$ao, $am, $av, $ax] as $user) genesisUpdateAccountPreferences($user, ['sharedProjectsEnabled' => true]);
    $space = genesisSharedCreateSpace($ao, ['title' => 'Approvals and categories']);
    $project = genesisSharedCreateProject($ao, $space['id'], ['title' => 'Team decisions']);
    foreach ([$am => 'member', $av => 'viewer'] as $user => $role) {
        $invite = genesisSharedInvite($ao, $project['id'], ['email' => genesisFindUser($user)['email'], 'role' => $role]);
        genesisSharedAcceptInvite($user, ['id' => $invite['id']]);
    }
    $snapshot = genesisSharedProjectSnapshot($ao, $project['id']);
    $open = array_values(array_filter($snapshot['statuses'], static fn($s) => !$s['isDone']))[0];
    $done = array_values(array_filter($snapshot['statuses'], static fn($s) => $s['isDone']))[0];
    $input = ['title' => 'Requires both decisions', 'statusId' => $open['id'], 'dueDate' => '2026-10-11', 'approvalRequired' => true, 'approverIds' => [$am, $av]];
    sharedInvalid(static fn() => genesisSharedTask($ao, $project['id'], [...$input, 'approverIds' => []]));
    sharedInvalid(static fn() => genesisSharedTask($ao, $project['id'], [...$input, 'approverIds' => [$ax]]));
    sharedReject(static fn() => genesisSharedTask($ao, $project['id'], [...$input, 'statusId' => $done['id']]), 409);
    $task = genesisSharedTask($ao, $project['id'], $input);
    sharedExpect($task['approvalRequired'] && count($task['approvals']) === 2, 'Creation lost approvers.');
    $task = genesisSharedTask($ao, $project['id'], ['title' => 'Legacy edit', 'expectedRevision' => $task['revision']], $task['id']);
    sharedExpect($task['approvalRequired'], 'A legacy edit removed approvals.');
    sharedReject(static fn() => genesisSharedTask($ao, $project['id'], ['statusId' => $done['id'], 'expectedRevision' => $task['revision']], $task['id']), 409);
    sharedReject(static fn() => genesisSharedMoveTask($ao, $project['id'], $task['id'], ['statusId' => $done['id'], 'position' => 0, 'expectedRevision' => $task['revision']]), 409);
    sharedReject(static fn() => genesisSharedUpdateStatus($ao, $project['id'], $open['id'], ['title' => 'Bypass', 'isDone' => true, 'expectedRevision' => $open['revision']]), 409);
    sharedReject(static fn() => genesisSharedDeleteStatus($ao, $project['id'], $open['id'], ['destinationStatusId' => $done['id'], 'expectedRevision' => $open['revision']]), 409);
    sharedReject(static fn() => genesisSharedApproveTask($ao, $project['id'], $task['id']), 404);
    sharedReject(static fn() => genesisSharedApproveTask($ax, $project['id'], $task['id']), 404);
    $first = genesisSharedApproveTask($am, $project['id'], $task['id']);
    sharedExpect(!$first['completedAt'] && count(array_filter($first['approvals'], static fn($a) => $a['approvedAt'])) === 1, 'One approval closed a task requiring two.');
    $repeat = genesisSharedApproveTask($am, $project['id'], $task['id']);
    sharedExpect($repeat['revision'] === $first['revision'], 'Repeated approval changed revision.');
    $final = genesisSharedApproveTask($av, $project['id'], $task['id']);
    sharedExpect($final['completedAt'] && $final['statusId'] === $done['id'], 'Last approval did not close the task.');
    sharedExpect(!array_filter(genesisSharedCalendarTasks($ao, '2026-10-01', '2026-10-31'), static fn($t) => $t['id'] === $task['id']), 'Completed task stayed in the calendar.');
    $reopened = genesisSharedMoveTask($ao, $project['id'], $task['id'], ['statusId' => $open['id'], 'position' => 0, 'expectedRevision' => $final['revision']]);
    sharedExpect(!array_filter($reopened['approvals'], static fn($a) => $a['approvedAt']), 'Reopening did not reset confirmations.');
    sharedExpect(count(array_filter(genesisSharedCalendarTasks($ao, '2026-10-01', '2026-10-31'), static fn($t) => $t['id'] === $task['id'])) === 1, 'Open task is missing from calendar.');
    $legacyDone = genesisSharedTask($ao, $project['id'], ['title' => 'Legacy done', 'statusId' => $done['id']]);
    sharedExpect($legacyDone['completedAt'] && !$legacyDone['approvalRequired'], 'Ungated completion changed.');
    foreach (['meeting' => 'Встреча', 'event' => 'Событие'] as $type => $label) {
        $entry = genesisSharedTask($ao, $project['id'], ['title' => $label, 'entryType' => $type, 'statusId' => $open['id'], 'dueDate' => '2026-10-11', 'startDate' => '2026-10-11', 'startTime' => '14:00', 'endTime' => '15:30']);
        sharedExpect($entry['entryType'] === $type, 'Entry type was not saved.');
        $copy = genesisSharedTask($ao, $project['id'], ['title' => 'Legacy update', 'expectedRevision' => $entry['revision']], $entry['id']);
        sharedExpect($copy['entryType'] === $type, 'Legacy edit changed the entry type.');
        $raw = ['id' => $entry['id'], 'entry_type' => $type, 'title' => $label, 'due_date' => '2026-10-11', 'start_date' => '2026-10-11', 'start_time' => '14:00', 'end_time' => '15:30', 'completed_at' => null];
        sharedExpect(str_contains(genesisSharedGoogleTaskPayload($raw)['notes'], $label), 'Shared Google Tasks lost the type marker.');
        $event = genesisSharedGoogleCalendarPayload($raw);
        sharedExpect(str_contains($event['description'], $label) && isset($event['start']['dateTime']), 'Shared Calendar lost type or time.');
    }
    sharedInvalid(static fn() => genesisSharedTask($ao, $project['id'], ['title' => 'Private birthday', 'entryType' => 'birthday', 'statusId' => $open['id']]));
    foreach (['meeting', 'birthday', 'event'] as $type) {
        $personal = ['title' => 'Personal entry', 'entryType' => $type, 'description' => 'Details', 'dueDate' => '2026-10-11', 'endDate' => '2026-10-11', 'time' => '14:00', 'endTime' => '15:30'];
        $event = genesisTaskPayloadForGoogle('personal-entry', $personal);
        sharedExpect(genesisGoogleEventForClient([...$event, 'id' => 'google-copy'])['entryType'] === $type, 'Google Calendar round trip lost entry type.');
        sharedExpect($event['extendedProperties']['private']['genesisEndTime'] === '15:30', 'Google Calendar lost meeting duration.');
        $native = genesisGoogleNativeTaskPayload('personal-entry', $personal);
        sharedExpect(genesisGoogleNativeTaskForClient([...$native, 'id' => 'google-task'], 'list', 'List')['entryType'] === $type, 'Google Tasks round trip lost entry type.');
    }

    $rights = array_fill_keys(['createProjects', 'editTasks', 'organizeTasks', 'comment', 'manageProjects', 'inviteMembers'], false);
    $category = genesisSharedMemberCategory($ao, $space['id'], ['title' => 'Reviewers', 'permissions' => [...$rights, 'comment' => true]]);
    sharedReject(static fn() => genesisSharedMemberCategory($am, $space['id'], ['title' => 'Unauthorized', 'permissions' => $rights]), 404);
    sharedReject(static fn() => genesisSharedAssignMemberPermissions($am, $space['id'], $am, ['categoryId' => $category['id']]), 404);
    genesisSharedAssignMemberPermissions($ao, $space['id'], $am, ['categoryId' => $category['id']]);
    $access = genesisSharedProjectSnapshot($am, $project['id'])['project']['permissions'];
    sharedExpect($access['comment'] && !$access['editTasks'] && !$access['organizeTasks'], 'Category rights were not applied.');
    $category = genesisSharedMemberCategory($ao, $space['id'], ['title' => 'Reviewers', 'permissions' => [...$rights, 'editTasks' => true], 'expectedRevision' => $category['revision']], $category['id']);
    $access = genesisSharedProjectSnapshot($am, $project['id'])['project']['permissions'];
    sharedExpect($access['editTasks'] && !$access['comment'], 'Category change did not propagate.');
    sharedReject(static fn() => genesisSharedMemberCategory($ao, $space['id'], ['title' => 'Stale', 'permissions' => $rights, 'expectedRevision' => 1], $category['id']), 409);
    genesisSharedAssignMemberPermissions($ao, $space['id'], $am, ['permissions' => [...$rights, 'organizeTasks' => true]]);
    sharedExpect(genesisSharedProjectSnapshot($am, $project['id'])['project']['permissions']['organizeTasks'], 'Manual rights were not applied.');
    $category = genesisSharedMemberCategory($ao, $space['id'], ['title' => 'Reviewers', 'permissions' => $rights, 'expectedRevision' => $category['revision']], $category['id']);
    sharedExpect(genesisSharedProjectSnapshot($am, $project['id'])['project']['permissions']['organizeTasks'], 'Manual rights kept following the old category.');
    sharedReject(static fn() => genesisSharedAssignMemberPermissions($ao, $space['id'], $ao, ['categoryId' => $category['id']]), 404);
    $foreignSpace = genesisSharedCreateSpace($ax, ['title' => 'Foreign categories']);
    $foreign = genesisSharedMemberCategory($ax, $foreignSpace['id'], ['title' => 'Foreign', 'permissions' => $rights]);
    sharedInvalid(static fn() => genesisSharedAssignMemberPermissions($ao, $space['id'], $am, ['categoryId' => $foreign['id']]));
    sharedExpect(!genesisDb()->query('PRAGMA foreign_key_check')->fetchAll(), 'New features broke foreign keys.');
} finally {
    foreach ([$ao, $am, $av, $ax] as $user) if (genesisFindUser($user)) genesisDeleteAccount($user);
}
echo "Shared approvals, permissions and migration smoke passed.\n";
