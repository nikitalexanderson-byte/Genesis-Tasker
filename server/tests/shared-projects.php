<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';

require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/shared-projects.php';
require dirname(__DIR__) . '/src/shared-google.php';

function sharedExpect(bool $value, string $message): void
{
    if (!$value) throw new RuntimeException($message);
}

function sharedUser(string $email, string $suffix): string
{
    $id = 'shared-smoke-' . $suffix;
    genesisDb()->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at)
        VALUES (:id, :sub, :email, :name, :now, :now)')->execute([
            'id' => $id, 'sub' => 'shared-smoke-sub-' . $suffix, 'email' => $email,
            'name' => 'Shared Test ' . $suffix, 'now' => genesisNow(),
        ]);
    genesisTestGrantCollaboration($id);
    return $id;
}

function sharedReject(callable $action, int $status): void
{
    try { $action(); } catch (GenesisSharedAccessException $error) {
        sharedExpect($error->status === $status, 'Unexpected shared access status.');
        return;
    }
    throw new RuntimeException('Shared access check was bypassed.');
}

function sharedInvalid(callable $action): void
{
    try { $action(); } catch (InvalidArgumentException) { return; }
    throw new RuntimeException('Invalid cross-project reference was accepted.');
}

$a = sharedUser('jurijjlogvinov@gmail.com', 'a');
$b = sharedUser('mechrahod@gmail.com', 'b');
$viewer = sharedUser('eagbread@gmail.com', 'viewer');
$outsider = sharedUser('shared-outsider@example.org', 'outsider');
try {
    sharedExpect(!genesisUserForClient(genesisFindUser($a))['sharedProjectsEnabled'], 'Shared flag must start off.');
    sharedExpect(genesisSharedEligible(genesisFindUser($outsider)), 'A registered user cannot enable shared projects.');
    sharedExpect(genesisSharedEligible([...genesisFindUser($a), 'auth_provider' => 'yandex']),
        'Yandex accounts cannot use shared projects.');
    sharedExpect(!genesisSharedTester(genesisFindUser($outsider)), 'Lifetime access was granted to all users.');
    sharedExpect(genesisUserForClient(genesisFindUser($outsider))['sharedProjectsEligible'],
        'The shared projects switch remains locked for a registered user.');
    foreach ([$a, $b, $viewer] as $id) genesisTestEnableSharedProjects($id);
    $space = genesisSharedCreateSpace($a, ['title' => 'Космос']);
    $importSpace = genesisSharedCreateSpace($a, ['title' => 'Перенос']);
    genesisDb()->prepare("INSERT INTO shared_space_members (space_id, user_id, role, joined_at)
        VALUES (:space, :user, 'member', :now)")->execute([
            'space' => $importSpace['id'], 'user' => $b, 'now' => genesisNow(),
        ]);
    $import = [
        'transferId' => 'shared-smoke-project-tree-1', 'mode' => 'move',
        'projects' => [
            ['sourceId' => 'private-root', 'parentSourceId' => null, 'title' => 'Личная цель',
                'description' => 'План', 'tags' => ['Перенос'], 'layout' => 'list'],
            ['sourceId' => 'private-child', 'parentSourceId' => 'private-root', 'title' => 'Подпроект',
                'description' => '', 'layout' => 'board'],
        ],
        'categories' => [['sourceId' => 'private-category', 'projectSourceId' => 'private-child',
            'title' => 'Важное', 'color' => '#a5543f']],
        'tasks' => [['sourceId' => 'private-task-import', 'projectSourceId' => 'private-child',
            'categorySourceId' => 'private-category', 'title' => 'Проверить перенос',
            'description' => 'Описание задачи', 'tags' => ['Перенос'], 'dueDate' => '2026-10-12', 'done' => false]],
    ];
    $receipt = genesisSharedImportProjectTree($a, $importSpace['id'], $import);
    sharedExpect(count($receipt['projectIds']) === 2 && count($receipt['taskIds']) === 1,
        'A complete project tree was not imported.');
    sharedExpect(genesisSharedImportProjectTree($a, $importSpace['id'], $import) === $receipt,
        'A retry created a second project tree.');
    $imported = genesisSharedProjectSnapshot($a, $receipt['projectIds']['private-child']);
    sharedExpect($imported['project']['parentId'] === $receipt['rootProjectId']
        && $imported['tasks'][0]['categoryId'] === $imported['categories'][0]['id'],
        'Imported project relationships were not preserved.');
    sharedExpect(genesisSharedProjectSnapshot($b, $receipt['projectIds']['private-child'])['tasks'][0]['title']
        === 'Проверить перенос', 'A space member cannot access the imported server copy.');
    sharedReject(static fn() => genesisSharedUpdateProject($b, $receipt['rootProjectId'], [
        'title' => 'Недопустимая правка', 'expectedRevision' => 1,
    ]), 403);
    sharedReject(static fn() => genesisSharedImportProjectTree($a, $importSpace['id'],
        [...$import, 'tasks' => []]), 409);
    sharedReject(static fn() => genesisSharedImportProjectTree($a, $importSpace['id'],
        [...$import, 'transferId' => 'shared-smoke-project-tree-3']), 409);
    sharedInvalid(static fn() => genesisSharedImportProjectTree($a, $importSpace['id'],
        [...$import, 'transferId' => 'shared-smoke-project-tree-2', 'projects' => [
            ['sourceId' => 'bad-child', 'parentSourceId' => 'missing', 'title' => 'Ошибка'],
        ]]));
    sharedExpect(count(genesisSharedProjects($a, $importSpace['id'])) === 3,
        'Invalid project import left a partial tree.');
    $memberOwned = genesisSharedCreateProject($b, $importSpace['id'], ['title' => 'Проект участника']);
    sharedExpect(genesisSharedProjectSnapshot($a, $memberOwned['id'])['project']['canOrganizeTasks'],
        'Workspace owner cannot organize a project created by a member.');
    $project = genesisSharedCreateProject($a, $space['id'], ['title' => 'Общий план', 'tags' => ['Генезис'], 'layout' => 'board']);
    $googleSample = ['id' => 'shared-test-task', 'title' => 'Общее дело',
        'description' => 'Личная заметка и имена участников', 'due_date' => '2026-10-12',
        'completed_at' => null];
    $tasksPayload = genesisSharedGoogleTaskPayload($googleSample);
    $calendarPayload = genesisSharedGoogleCalendarPayload($googleSample);
    sharedExpect($tasksPayload['title'] === 'Общее дело'
        && !str_contains(json_encode($tasksPayload, JSON_UNESCAPED_UNICODE), $googleSample['description'])
        && !str_contains(json_encode($calendarPayload, JSON_UNESCAPED_UNICODE), $googleSample['description']),
        'Google copies exposed a shared task description without separate consent.');
    $googleOptions = genesisSharedGoogleSettings($a, $project['id']);
    sharedExpect(!$googleOptions['tasksEnabled'] && !$googleOptions['calendarEnabled'],
        'Google projection was enabled without the member choosing it.');
    sharedReject(static fn() => genesisSharedSetGoogleSettings($a, $project['id'],
        ['tasksEnabled' => true]), 403);
    sharedInvalid(static fn() => genesisSharedSetGoogleSettings($a, $project['id'],
        ['tasksEnabled' => 'true']));
    sharedExpect(genesisSharedSetGoogleSettings($a, $project['id'],
        ['tasksEnabled' => false, 'calendarEnabled' => false])['tasksEnabled'] === false,
        'Member could not keep Google copies disabled.');
    sharedExpect(genesisSharedSyncGoogleCron()['projectsChecked'] === 0,
        'Background sync touched a project without member consent.');
    genesisDb()->prepare('UPDATE shared_google_preferences SET tasks_enabled = 1, calendar_enabled = 1
        WHERE project_id = :project AND user_id = :user')->execute([
        'project' => $project['id'], 'user' => $a,
    ]);
    $failedProjection = genesisSharedSyncGoogleCron();
    sharedExpect($failedProjection['projectsChecked'] === 1 && $failedProjection['failures'] === 1,
        'Background sync did not isolate missing Google permission.');
    sharedExpect(genesisSharedSyncGoogleCron()['projectsChecked'] === 0,
        'A failed Google projection was not rate-limited.');
    $disabledGoogle = genesisSharedSetGoogleSettings($a, $project['id'],
        ['tasksEnabled' => false, 'calendarEnabled' => false]);
    sharedExpect(!$disabledGoogle['tasksEnabled'] && !$disabledGoogle['calendarEnabled'],
        'A member could not revoke Google projection after losing OAuth access.');
    sharedReject(static fn() => genesisSharedGoogleSettings($outsider, $project['id']), 403);
    $snapshot = genesisSharedProjectSnapshot($a, $project['id']);
    sharedExpect(count($snapshot['statuses']) === 3, 'Default board statuses missing.');
    $listed = array_column(genesisSharedProjects($a, $space['id']), null, 'id');
    sharedExpect((int)$listed[$project['id']]['boardCount'] === 3 && (int)$listed[$project['id']]['taskCount'] === 0,
        'Board count was confused with the task count.');
    foreach ($listed as $listedProject) {
        if ($listedProject['isInbox']) sharedExpect((int)$listedProject['boardCount'] === 0,
            'The inbox was counted as a board.');
    }
    $category = genesisSharedCreateCategory($a, $project['id'], [
        'title' => 'Приоритет', 'color' => '#a5543f',
    ]);
    $otherProject = genesisSharedCreateProject($a, $space['id'], ['title' => 'Соседний проект']);
    $otherSnapshot = genesisSharedProjectSnapshot($a, $otherProject['id']);
    $transferred = genesisSharedTask($a, $otherProject['id'], [
        'sourceTaskId' => 'private-task-1', 'title' => 'Опубликованная задача',
        'statusId' => $otherSnapshot['statuses'][0]['id'],
    ]);
    $retried = genesisSharedTask($a, $otherProject['id'], [
        'sourceTaskId' => 'private-task-1', 'title' => 'Повтор запроса',
        'statusId' => $otherSnapshot['statuses'][0]['id'],
    ]);
    sharedExpect($retried['id'] === $transferred['id'] && $retried['title'] === 'Опубликованная задача',
        'A retried private transfer created or overwrote a shared task.');
    sharedExpect(count(genesisSharedProjectSnapshot($a, $otherProject['id'])['tasks']) === 1,
        'A retried private transfer duplicated the task.');
    $transferReceipt=['sourceTaskId'=>'private-task-1','title'=>'Transfer retry','statusId'=>$otherSnapshot['statuses'][0]['id'],'requestId'=>genesisUuid()];
    sharedExpect(genesisSharedTask($a,$otherProject['id'],$transferReceipt)['id']===$transferred['id'],'Existing transfer lost its result');
    sharedReject(static fn()=>genesisSharedTask($a,$otherProject['id'],[...$transferReceipt,'sourceTaskId'=>'another-private-task']),409);
    sharedReject(static fn() => genesisSharedTask($a, $project['id'], [
        'sourceTaskId' => 'private-task-1', 'title' => 'Wrong destination',
        'statusId' => $snapshot['statuses'][0]['id'],
    ]), 409);
    $otherCategory = genesisSharedCreateCategory($a, $otherProject['id'], ['title' => 'Чужая категория']);
    sharedInvalid(static fn() => genesisSharedTask($a, $project['id'], [
        'title' => 'Подмена статуса', 'statusId' => $otherSnapshot['statuses'][0]['id'],
    ]));
    sharedInvalid(static fn() => genesisSharedTask($a, $project['id'], [
        'title' => 'Подмена категории', 'statusId' => $snapshot['statuses'][0]['id'],
        'categoryId' => $otherCategory['id'],
    ]));
    $category = genesisSharedUpdateCategory($a, $project['id'], $category['id'], [
        'title' => 'Важное', 'color' => '#a5543f', 'expectedRevision' => 1,
    ]);
    sharedExpect($category['revision'] === 2, 'Category update failed.');
    sharedReject(static fn() => genesisSharedUpdateCategory($a, $project['id'], $category['id'], [
        'title' => 'Устаревшая версия', 'color' => '#a5543f', 'expectedRevision' => 1,
    ]), 409);
    $customStatus = genesisSharedCreateStatus($a, $project['id'], ['title' => 'Проверка']);
    $listed = array_column(genesisSharedProjects($a, $space['id']), null, 'id');
    sharedExpect((int)$listed[$project['id']]['boardCount'] === 4, 'Created board missing from the board count.');
    $renamedStatus = genesisSharedUpdateStatus($a, $project['id'], $customStatus['id'], [
        'title' => 'На проверке', 'expectedRevision' => 1,
    ]);
    sharedExpect($renamedStatus['revision'] === 2, 'Status revision did not advance.');
    sharedReject(static fn() => genesisSharedUpdateStatus($a, $project['id'], $customStatus['id'], [
        'title' => 'Устаревшая правка', 'expectedRevision' => 1,
    ]), 409);
    genesisSharedDeleteStatus($a, $project['id'], $customStatus['id'], [
        'destinationStatusId' => $snapshot['statuses'][0]['id'], 'expectedRevision' => 2,
    ]);
    $listed = array_column(genesisSharedProjects($a, $space['id']), null, 'id');
    sharedExpect((int)$listed[$project['id']]['boardCount'] === 3, 'Deleted board remained in the board count.');
    $edited = genesisSharedUpdateProject($a, $project['id'], [
        'title' => 'Обновлённый план', 'description' => 'Командное описание', 'expectedRevision' => 1,
    ]);
    sharedExpect($edited['revision'] === 2 && $edited['title'] === 'Обновлённый план', 'Project edit failed.');
    sharedReject(static fn() => genesisSharedUpdateProject($a, $project['id'], [
        'title' => 'Устаревшая версия', 'expectedRevision' => 1,
    ]), 409);
    sharedReject(static fn() => genesisSharedProjectSnapshot($b, $project['id']), 404);
    sharedReject(static fn() => genesisSharedProjectSnapshot($outsider, $project['id']), 403);
    $openInvite = genesisSharedInvite($a, $project['id'], [
        'email' => 'shared-outsider@example.org', 'role' => 'member',
    ]);
    sharedExpect(count(genesisSharedInvitations($outsider)) === 1,
        'A user with shared projects switched off cannot see an invitation in their account.');
    genesisSharedRejectInvite($outsider, $openInvite['id']);
    sharedExpect(count(genesisSharedInvitations($outsider)) === 0,
        'A declined invitation remained in the account.');
    sharedExpect(count(genesisSharedInvitations($b)) === 0, 'Another user received the invitation.');
    $invitation = genesisSharedInvite($a, $project['id'], ['email' => 'mechrahod@gmail.com', 'role' => 'member']);
    $stored = genesisDb()->query('SELECT token_hash FROM shared_invitations LIMIT 1')->fetchColumn();
    sharedExpect(!isset($invitation['token']) && is_string($stored), 'Invitation secret was exposed to the client.');
    $pending = genesisSharedInvitations($b);
    sharedExpect(count($pending) === 1 && $pending[0]['id'] === $invitation['id']
        && $pending[0]['projectTitle'] === 'Обновлённый план' && $pending[0]['spaceTitle'] === 'Космос',
        'Invitation was not delivered to the recipient account.');
    sharedReject(static fn() => genesisSharedAcceptInvite($viewer, ['id' => $invitation['id']]), 404);
    genesisSharedAcceptInvite($b, ['id' => $invitation['id']]);
    sharedReject(static fn() => genesisSharedAcceptInvite($b, ['id' => $invitation['id']]), 404);
    sharedExpect(count(genesisSharedInvitations($b)) === 0, 'Accepted invitation remained visible.');
    sharedExpect(count(genesisSharedProjects($b, $space['id'])) === 1,
        'Project guest unexpectedly saw the shared inbox.');
    sharedReject(static fn() => genesisSharedCreateProject($b, $space['id'], ['title' => 'Forbidden']), 403);
    $createRequest = '11111111-1111-4111-8111-111111111111';
    $createInput = [
        'title' => 'Задача 1', 'tags' => ['Запуск'], 'statusId' => $snapshot['statuses'][0]['id'],
        'categoryId' => $category['id'], 'dueDate' => '2026-10-12',
        'requestId' => $createRequest,
    ];
    $task = genesisSharedTask($a, $project['id'], $createInput);
    sharedExpect($task['tags'] === ['Запуск'], 'Task tags were lost during creation.');
    sharedExpect(genesisSharedProjectSnapshot($a, $project['id'])['project']['tags'] === ['Генезис'],
        'A legacy project edit dropped tags.');
    $search = genesisSharedSearch($a, $space['id'], '#зап');
    sharedExpect(count($search['tasks']) === 1 && $search['tasks'][0]['id'] === $task['id'],
        'Live tag search failed for a Cyrillic task.');
    sharedExpect(in_array($task['id'], array_column(genesisSharedSearch($a, $space['id'], 'ЗАдА')['tasks'], 'id'), true),
        'Partial title search was not case-insensitive.');
    sharedExpect(count(genesisSharedSearch($a, $space['id'], '#ГЕН')['projects']) === 1,
        'Shared project tags were not searchable.');
    sharedReject(static fn() => genesisSharedSearch($outsider, $space['id'], '#зап'), 403);
    sharedInvalid(static fn() => genesisSharedTask($a, $project['id'], [
        'title' => 'Invalid tag', 'tags' => [42], 'statusId' => $snapshot['statuses'][0]['id'],
    ]));

    sharedExpect(genesisSharedTask($a, $project['id'], $createInput)['id'] === $task['id'],
        'A retried team task created a duplicate.');
    sharedReject(static fn() => genesisSharedTask($a,$project['id'],[...$createInput,'title'=>'Different content with the same request']),409);
    sharedReject(static fn() => genesisSharedTask($a, $otherProject['id'], [
        'title' => 'Wrong scope', 'statusId' => $otherSnapshot['statuses'][0]['id'],
        'requestId' => $createRequest,
    ]), 409);
    sharedExpect(count(array_filter(genesisSharedCalendarTasks($b, '2026-01-01', '2026-12-31'),
        static fn(array $item): bool => $item['id'] === $task['id'])) === 1,
        'Invited member cannot see shared calendar task.');
    sharedReject(static fn() => genesisSharedCalendarTasks($outsider, '2026-01-01', '2026-12-31'), 403);
    $activity = genesisSharedNotifications($b);
    $taskNotice = array_values(array_filter($activity,
        static fn(array $item): bool => $item['action'] === 'task.created' && $item['objectId'] === $task['id']));
    sharedExpect(count($taskNotice) === 1 && (int)$taskNotice[0]['isRead'] === 0,
        'Member did not receive team activity.');
    genesisSharedReadNotifications($b, ['eventIds' => [$taskNotice[0]['id']]]);
    sharedExpect((int)array_values(array_filter(genesisSharedNotifications($b),
        static fn(array $item): bool => $item['id'] === $taskNotice[0]['id']))[0]['isRead'] === 1,
        'Team activity read state was not saved.');
    sharedReject(static fn() => genesisSharedReadNotifications($outsider,
        ['eventIds' => [$taskNotice[0]['id']]]), 403);
    $listedProject = array_values(array_filter(genesisSharedProjects($a, $space['id']),
        static fn(array $item): bool => $item['id'] === $project['id']))[0];
    sharedExpect((int)$listedProject['taskCount'] === 1, 'Project list did not expose the current task count.');
    sharedExpect(count(genesisSharedProjectSnapshot($b, $project['id'])['tasks']) === 1, 'Second user cannot see the task.');
    sharedExpect(genesisSharedProjectSnapshot($b, $project['id'])['tasks'][0]['categoryId'] === $category['id'],
        'Team category did not reach the second user.');
    sharedReject(static fn() => genesisSharedTask($b, $project['id'], [
        'statusId' => $snapshot['statuses'][1]['id'], 'expectedRevision' => 1,
    ], $task['id']), 403);
    sharedReject(static fn() => genesisSharedMoveTask($b, $project['id'], $task['id'], [
        'destinationProjectId' => $project['id'], 'statusId' => $snapshot['statuses'][1]['id'],
        'expectedRevision' => 1, 'position' => 0,
    ]), 403);
    $deleteTask = genesisSharedTask($a, $project['id'], [
        'title' => 'Deletion fixture', 'statusId' => $snapshot['statuses'][0]['id'], 'tags' => ['deletefixture'],
    ]);
    $deleteInput = ['expectedRevision' => 1, 'requestId' => '77777777-7777-4777-8777-777777777777'];
    sharedReject(static fn() => genesisSharedDeleteTask($b, $project['id'], $deleteTask['id'], $deleteInput), 403);
    sharedReject(static fn() => genesisSharedDeleteTask($a, $project['id'], $deleteTask['id'],
        [...$deleteInput, 'expectedRevision' => 2]), 409);
    genesisDb()->prepare('INSERT INTO shared_google_projection_links
        (task_id, user_id, destination, google_id, synced_at) VALUES (:task, :user, :destination, :google, :now)')
        ->execute(['task' => $deleteTask['id'], 'user' => $a, 'destination' => 'calendar',
            'google' => 'qa-delete-copy', 'now' => genesisNow()]);
    sharedExpect(genesisSharedDeleteTask($a, $project['id'], $deleteTask['id'], $deleteInput)['ok'], 'Task deletion failed.');
    sharedExpect(genesisSharedDeleteTask($a, $project['id'], $deleteTask['id'], $deleteInput)['ok'], 'Deletion retry was not idempotent.');
    sharedExpect(count(genesisSharedSearch($a, $space['id'], '#deletefixture')['tasks']) === 0, 'Deleted task remained searchable.');
    sharedExpect((int)genesisDb()->query("SELECT COUNT(*) FROM shared_google_projection_cleanup WHERE google_id = 'qa-delete-copy'")->fetchColumn() === 1,
        'Task deletion lost or duplicated Google cleanup work.');
    genesisSharedSetSpaceRole($a, $space['id'], $b, [
        'role' => 'guest', 'canOrganizeTasks' => true,
    ]);
    sharedExpect(genesisSharedProjectSnapshot($b, $project['id'])['project']['canOrganizeTasks'],
        'Delegated organizer access was not exposed to the member.');
    $updateInput = ['statusId' => $snapshot['statuses'][1]['id'], 'expectedRevision' => 1,
        'requestId' => '22222222-2222-4222-8222-222222222222'];
    $updated = genesisSharedTask($b, $project['id'], $updateInput, $task['id']);
    sharedExpect(genesisSharedTask($b, $project['id'], $updateInput, $task['id'])['revision'] === 2,
        'A retried team task edit advanced the revision twice.');
    sharedReject(static fn() => genesisSharedTask($b,$project['id'],[...$updateInput,'priority'=>3],$task['id']),409);
    sharedExpect($updated['revision'] === 2, 'Task revision did not advance.');
    sharedExpect($updated['tags'] === ['Запуск'], 'An older client edit dropped task tags.');
    $done = genesisSharedTask($b, $project['id'], [
        'statusId' => $snapshot['statuses'][2]['id'], 'expectedRevision' => 2,
    ], $task['id']);
    sharedExpect($done['completedBy'] === $b && $done['completedAt'] !== null,
        'Completion provenance was not saved.');
    $listInput = ['title' => 'Мой список', 'isDone' => false,
        'requestId' => '44444444-4444-4444-8444-444444444444'];
    $memberList = genesisSharedCreateStatus($b, $project['id'], $listInput);
    sharedExpect($memberList['title'] === 'Мой список', 'A project member cannot create a task list.');
    sharedExpect(genesisSharedCreateStatus($b, $project['id'], $listInput)['id'] === $memberList['id'],
        'A retried shared task list creation made a duplicate list.');
    sharedReject(static fn() => genesisSharedCreateStatus($b,$project['id'],[...$listInput,'title'=>'Different list with the same request']),409);
    $taskLists = genesisSharedTaskLists($b);
    sharedExpect(count(array_filter($taskLists, static fn(array $list): bool =>
        $list['id'] === $memberList['id'] && $list['projectId'] === $project['id']
            && $list['spaceId'] === $space['id'])) === 1,
        'The Tasks screen cannot discover a member-created shared task list.');
    sharedReject(static fn() => genesisSharedTaskLists($outsider), 403);
    $alternateDone = genesisSharedCreateStatus($a, $project['id'], ['title' => 'Принято', 'isDone' => true]);
    genesisSharedDeleteStatus($a, $project['id'], $snapshot['statuses'][2]['id'], [
        'destinationStatusId' => $alternateDone['id'], 'expectedRevision' => 1,
    ]);
    $movedByStatusDeletion = genesisSharedProjectSnapshot($b, $project['id'])['tasks'][0];
    sharedExpect($movedByStatusDeletion['statusId'] === $alternateDone['id']
        && $movedByStatusDeletion['completedBy'] === $b,
        'Deleting a status lost a task or its completion author.');
    genesisSharedDeleteCategory($a, $project['id'], $category['id'], ['expectedRevision' => 2]);
    sharedExpect(genesisSharedProjectSnapshot($b, $project['id'])['tasks'][0]['categoryId'] === null,
        'Deleting a category did not detach the task.');
    sharedReject(static fn() => genesisSharedTask($a, $project['id'], [
        'title' => 'Lost update', 'expectedRevision' => 1,
    ], $task['id']), 409);
    genesisSharedAddComment($b, $project['id'], $task['id'], ['body' => 'Сделаю сегодня']);
    sharedExpect(count(genesisSharedComments($a, $project['id'], $task['id'])) === 1, 'Comment did not persist.');
    genesisDb()->prepare('INSERT INTO shared_google_preferences
        (project_id, user_id, tasks_enabled, calendar_enabled, updated_at)
        VALUES (:project, :user, 1, 0, :now)')->execute([
        'project' => $otherProject['id'], 'user' => $a, 'now' => genesisNow(),
    ]);
    genesisDb()->prepare("INSERT INTO shared_google_projection_links
        (task_id, user_id, destination, google_id, google_list_id, synced_revision, synced_at)
        VALUES (:task, :user, 'tasks', 'google-task-copy', 'old-google-list', 1, :now)")->execute([
        'task' => $task['id'], 'user' => $a, 'now' => genesisNow(),
    ]);
    $beforeMove = genesisSharedProjectSnapshot($a, $project['id'])['tasks'][0];
    $moveInput = [
        'destinationProjectId' => $otherProject['id'],
        'statusId' => $otherSnapshot['statuses'][0]['id'],
        'expectedRevision' => (int)$beforeMove['revision'], 'position' => 0,
        'requestId' => '33333333-3333-4333-8333-333333333333',
    ];
    $moved = genesisSharedMoveTask($a, $project['id'], $task['id'], $moveInput);
    sharedExpect(genesisSharedMoveTask($a, $project['id'], $task['id'], $moveInput)['revision'] === $moved['revision'],
        'A retried board move advanced the revision twice.');
    sharedReject(static fn()=>genesisSharedMoveTask($a,$project['id'],$task['id'],[...$moveInput,'position'=>1]),409);
    sharedExpect($moved['projectId'] === $otherProject['id']
        && count(genesisSharedProjectSnapshot($a, $project['id'])['tasks']) === 0,
        'Task was not moved atomically to the second project.');
    sharedExpect(genesisDb()->query("SELECT google_list_id FROM shared_google_projection_links
        WHERE google_id = 'google-task-copy'")->fetchColumn() === 'old-google-list',
        'A consented member lost the Google copy before it could move between lists.');
    $movedBack = genesisSharedMoveTask($a, $otherProject['id'], $task['id'], [
        'destinationProjectId' => $project['id'], 'statusId' => $snapshot['statuses'][0]['id'],
        'expectedRevision' => $moved['revision'], 'position' => 0,
    ]);
    sharedExpect($movedBack['projectId'] === $project['id']
        && count(genesisSharedComments($a, $project['id'], $task['id'])) === 1,
        'Moving a task back lost its identity or discussion.');
    sharedExpect((int)genesisDb()->query("SELECT COUNT(*) FROM shared_google_projection_cleanup
        WHERE google_id = 'google-task-copy' AND google_list_id = 'old-google-list'")->fetchColumn() === 1,
        'A copy without destination consent was not queued for deletion.');
    $viewerInvite = genesisSharedInvite($a, $project['id'], ['email' => 'eagbread@gmail.com', 'role' => 'viewer']);
    $declined = genesisSharedInvite($a, $otherProject['id'], ['email' => 'eagbread@gmail.com', 'role' => 'viewer']);
    sharedReject(static fn() => genesisSharedRejectInvite($b, $declined['id']), 404);
    genesisSharedRejectInvite($viewer, $declined['id']);
    sharedExpect(count(genesisSharedInvitations($viewer)) === 1, 'Declined invitation remained visible.');
    sharedReject(static fn() => genesisSharedAcceptInvite($viewer, ['id' => $declined['id']]), 404);
    genesisSharedAcceptInvite($viewer, ['id' => $viewerInvite['id']]);
    sharedExpect(count(genesisSharedProjects($viewer, $space['id'])) === 1,
        'Viewer unexpectedly saw another shared project.');
    sharedExpect(count(genesisSharedProjectSnapshot($viewer, $project['id'])['tasks']) === 1, 'Viewer cannot read.');
    sharedReject(static fn() => genesisSharedTask($viewer, $project['id'], [
        'title' => 'Forbidden', 'statusId' => $snapshot['statuses'][0]['id'],
    ]), 403);
    sharedReject(static fn() => genesisSharedAddComment($viewer, $project['id'], $task['id'], [
        'body' => 'Forbidden',
    ]), 403);
    sharedReject(static fn() => genesisSharedSetArchived($viewer, $project['id'], true), 403);
    $child = genesisSharedCreateProject($a, $space['id'], [
        'title' => 'Подпроект', 'parentId' => $project['id'],
    ]);
    sharedReject(static fn() => genesisSharedSetArchived($a, $project['id'], true), 409);
    genesisSharedSetArchived($a, $child['id'], true);
    genesisSharedSetArchived($a, $project['id'], true);
    sharedReject(static fn() => genesisSharedProjectSnapshot($b, $project['id']), 404);
    sharedExpect(count(genesisSharedArchivedProjects($a, $space['id'])) === 2,
        'Archived projects were not listed.');
    sharedReject(static fn() => genesisSharedSetArchived($a, $child['id'], false), 409);
    genesisSharedSetArchived($a, $project['id'], false);
    genesisSharedSetArchived($a, $child['id'], false);
    sharedExpect(count(genesisSharedProjectSnapshot($b, $project['id'])['tasks']) === 1,
        'Archive and restore lost a team task.');
    sharedReject(static fn() => genesisSharedSetMemberRole($a, $project['id'], $a, ['role' => 'member']), 409);
    genesisSharedSetMemberRole($a, $project['id'], $b, ['role' => 'manager']);
    sharedExpect(genesisSharedProjectSnapshot($b, $project['id'])['project']['role'] === 'manager',
        'Member role change failed.');
    sharedReject(static fn() => genesisSharedSetSpaceRole($a, $space['id'], $a, ['role' => 'guest']), 409);
    genesisSharedSetSpaceRole($a, $space['id'], $b, ['role' => 'member']);
    sharedExpect(count(genesisSharedProjects($b, $space['id'])) === 2,
        'Promoted space member cannot see the shared inbox.');
    genesisSharedRemoveMember($a, $project['id'], $b);
    sharedExpect(count(genesisSharedProjects($b, $space['id'])) === 1,
        'Removing a project role also removed promoted space membership.');
    $returnInvite = genesisSharedInvite($a, $project['id'], ['email' => 'mechrahod@gmail.com', 'role' => 'manager']);
    genesisSharedAcceptInvite($b, ['id' => $returnInvite['id']]);
    $viewerArchive = genesisSharedCreateProject($a, $space['id'], ['title' => 'Архив гостя']);
    $archiveInvite = genesisSharedInvite($a, $viewerArchive['id'], ['email' => 'eagbread@gmail.com']);
    genesisSharedAcceptInvite($viewer, ['id' => $archiveInvite['id']]);
    genesisSharedSetArchived($a, $viewerArchive['id'], true);
    genesisSharedRemoveMember($a, $project['id'], $viewer);
    sharedExpect(count(genesisSharedArchivedProjects($viewer, $space['id'])) === 1,
        'Removing access to one project also erased a guest archived project.');
    sharedReject(static fn() => genesisSharedProjectSnapshot($viewer, $project['id']), 404);
    sharedReject(static fn() => genesisSharedTask($viewer, $project['id'], [
        'title' => 'Revoked', 'statusId' => $snapshot['statuses'][0]['id'],
    ]), 404);
    $guestSpace = genesisSharedCreateSpace($a, ['title' => 'Второе пространство']);
    $guestProject = genesisSharedCreateProject($a, $guestSpace['id'], ['title' => 'Только гости']);
    $guestInvite = genesisSharedInvite($a, $guestProject['id'], ['email' => 'eagbread@gmail.com']);
    genesisSharedAcceptInvite($viewer, ['id' => $guestInvite['id']]);
    sharedExpect(count(genesisSharedProjects($viewer, $guestSpace['id'])) === 1,
        'Guest inherited the shared inbox before ownership transfer.');
    genesisUpdateAccountPreferences($b, ['sharedProjectsEnabled' => false]);
    sharedExpect(!genesisUserForClient(genesisFindUser($b))['sharedProjectsEnabled'],
        'Disabling shared projects did not update the account flag.');
    sharedReject(static fn() => genesisSharedSpaces($b), 403);
    genesisTestEnableSharedProjects($b);
    sharedExpect(count(genesisSharedProjects($b, $space['id'])) > 0,
        'Re-enabling shared projects lost existing memberships.');
    $newcomerInvite = genesisSharedInvite($a, $project['id'], [
        'email' => 'shared-outsider@example.org', 'role' => 'member',
    ]);
    genesisSharedAcceptInvite($outsider, ['id' => $newcomerInvite['id']]);
    sharedExpect(genesisUserForClient(genesisFindUser($outsider))['sharedProjectsEnabled'],
        'Accepting an invitation did not enable shared projects for an eligible user.');
    sharedExpect(genesisSharedProjectSnapshot($outsider, $project['id'])['project']['id'] === $project['id'],
        'A new member cannot open a shared project after accepting an invitation.');
    genesisDeleteAccount($a);
    sharedExpect(genesisSharedProjectSnapshot($b, $project['id'])['project']['role'] === 'owner',
        'Account deletion did not transfer project ownership.');
    sharedExpect(count(genesisSharedComments($b, $project['id'], $task['id'])) === 1,
        'Account deletion lost team comments.');
    sharedExpect(count(genesisSharedProjects($viewer, $guestSpace['id'])) === 2,
        'Deleting the sole owner lost the shared inbox for a surviving guest.');
} finally {
    foreach ([$a, $b, $viewer, $outsider] as $id) {
        if (genesisFindUser($id)) genesisDeleteAccount($id);
    }
}

echo "Shared projects smoke passed.\n";
require __DIR__ . '/shared-collaboration.php';
require __DIR__ . '/shared-approvals-permissions.php';
require __DIR__ . '/security-lifecycle.php';
