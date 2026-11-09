<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/shared-projects.php';
require dirname(__DIR__) . '/src/shared-google.php';
function uiExpect(bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
}
function uiReject(callable $action, ?int $status = null): void {
    try { $action(); }
    catch (GenesisSharedAccessException $error) {
        uiExpect($status === null || $error->status === $status, 'Unexpected access status ' . $error->status . ': ' . $error->getMessage()); return;
    }
    catch (InvalidArgumentException $error) { uiExpect($status === null, 'Expected access rejection'); return; }
    throw new RuntimeException('Invalid action was accepted');
}
// Upgrade a populated previous schema; verify its backup and old queries remain usable.
$legacy = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$legacy->exec('PRAGMA foreign_keys = ON');
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) if (basename($file) < '040_') $legacy->exec(file_get_contents($file));
$legacy->exec("INSERT INTO users (id, google_sub, email, created_at, updated_at) VALUES ('u', 'u', 'legacy@example.test', 'now', 'now');
    INSERT INTO shared_spaces (id, title, created_by, created_at, updated_at) VALUES ('s', 'Legacy space', 'u', 'now', 'now');
    INSERT INTO shared_projects (id, space_id, title, tags_json, created_at, updated_at) VALUES ('p', 's', 'Legacy project', '[\"one\",\"two\"]', 'now', 'now');
    INSERT INTO shared_project_statuses (id, project_id, title, position) VALUES ('b', 'p', 'Legacy board', 0);
    INSERT INTO shared_tasks (id, project_id, status_id, title, created_at, updated_at) VALUES ('t', 'p', 'b', 'Legacy task', 'now', 'now')");
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-project-categories-backup-');
try {
    $legacy->exec('VACUUM INTO ' . $legacy->quote($backupPath));
    $legacy->beginTransaction();
    $legacy->exec(file_get_contents(dirname(__DIR__) . '/migrations/040_shared_project_categories.sql'));
    $legacy->commit();
    uiExpect($legacy->query('SELECT category_id FROM shared_projects')->fetchColumn() === null, 'Migration assigned a category to old projects');
    uiExpect($legacy->query('SELECT title FROM shared_tasks')->fetchColumn() === 'Legacy task', 'Migration changed tasks');
    uiExpect($legacy->query('SELECT tags_json FROM shared_projects')->fetchColumn() === '["one","two"]', 'Migration changed tags');
    $legacy->exec("UPDATE shared_projects SET title = 'Old client title' WHERE id = 'p'");
    uiExpect(!$legacy->query('PRAGMA foreign_key_check')->fetchAll(), 'Migration broke references');
    uiExpect($legacy->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Migrated DB is invalid');
    $backup = new PDO('sqlite:' . $backupPath);
    uiExpect($backup->query('SELECT title FROM shared_projects')->fetchColumn() === 'Legacy project', 'Previous schema backup is not intact');
    uiExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Backup is invalid');
    $backup = null;
} finally { unlink($backupPath); }
$ids = [];
// Additive board settings preserve old clients and a restorable pre-migration backup.
$boards = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$boards->exec("CREATE TABLE shared_project_statuses (id TEXT PRIMARY KEY, title TEXT, is_done INTEGER, revision INTEGER);
    INSERT INTO shared_project_statuses VALUES ('old', 'Legacy board', 1, 1)");
$boardBackup = tempnam(sys_get_temp_dir(), 'genesis-board-backup-');
try {
    $boards->exec('VACUUM INTO ' . $boards->quote($boardBackup));
    $boards->beginTransaction();
    $boards->exec(file_get_contents(dirname(__DIR__) . '/migrations/044_shared_board_display.sql'));
    $boards->commit();
    uiExpect($boards->query('SELECT task_title_lines FROM shared_project_statuses')->fetchColumn() === null, 'Migration rewrote legacy preferences');
    $boards->exec("UPDATE shared_project_statuses SET title = 'Old client rename', revision = revision + 1 WHERE id = 'old'");
    uiExpect($boards->query('SELECT title FROM shared_project_statuses')->fetchColumn() === 'Old client rename', 'Legacy board updates fail');
    uiExpect($boards->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Board migration DB is invalid');
    $savedBoards = new PDO('sqlite:' . $boardBackup);
    uiExpect($savedBoards->query('SELECT title FROM shared_project_statuses')->fetchColumn() === 'Legacy board', 'Board backup changed');
    uiExpect(count($savedBoards->query('PRAGMA table_info(shared_project_statuses)')->fetchAll()) === 4, 'Backup is not pre-migration');
    $savedBoards = null;
} finally { unlink($boardBackup); }
foreach (['owner', 'member', 'guest', 'outsider'] as $role) {
    $id = 'shared-ui-test-' . $role; $ids[$role] = $id;
    genesisDb()->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at)
        VALUES (:id, :sub, :email, :name, :now, :now)')->execute([
        'id' => $id, 'sub' => $id, 'email' => 'genesis-ui-test-' . $role . '@gmail.com',
        'name' => 'UI Test', 'now' => genesisNow(),
    ]);
}
[$owner, $member, $guest, $outsider] = array_values($ids);
try {
    genesisTestEnableSharedProjects($owner);
    $space = genesisSharedCreateSpace($owner, ['title' => 'UI test']);
    $project = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Boards', 'layout' => 'board']);
    $initial = genesisSharedProjectSnapshot($owner, $project['id']);
    uiExpect(count($initial['statuses']) === 3, 'A board project must start with three boards');
    uiExpect(genesisSharedUiState($owner, $space['id'])['expandedIds'] === [], 'Projects must start collapsed');
    genesisSharedUiState($owner, $space['id'], ['expandedIds' => [$project['id']]]);
    uiExpect(genesisSharedUiState($owner, $space['id'])['expandedIds'] === [$project['id']], 'Expansion was not saved');
    uiReject(fn() => genesisSharedUiState($owner, $space['id'], ['expandedIds' => ['foreign-project']]));
    uiReject(fn() => genesisSharedSpaceInvite($owner, $space['id'], ['email' => 'person@example.org']));
    $invitation = genesisSharedSpaceInvite($owner, $space['id'], ['email' => 'genesis-ui-test-member@gmail.com']);
    uiExpect(count(genesisSharedSpaceInvitations($member)) === 1, 'Recipient cannot see invitation before enabling shared affairs');
    uiExpect(genesisSharedSpaceInvitations($outsider) === [], 'Invitations leaked to another user');
    uiReject(fn() => genesisSharedRespondSpaceInvitation($outsider, $invitation['id'], true), 409);
    genesisDb()->prepare("UPDATE shared_space_members SET role = 'member' WHERE space_id = :space AND user_id = :user")
        ->execute(['space' => $space['id'], 'user' => $owner]);
    uiReject(fn() => genesisSharedRespondSpaceInvitation($member, $invitation['id'], true), 409);
    genesisDb()->prepare("UPDATE shared_space_members SET role = 'owner' WHERE space_id = :space AND user_id = :user")
        ->execute(['space' => $space['id'], 'user' => $owner]);
    genesisSharedRespondSpaceInvitation($member, $invitation['id'], true);
    uiExpect(genesisUserForClient(genesisFindUser($member))['sharedProjectsEnabled'], 'Joining did not enable shared affairs');
    uiExpect(genesisSharedProjectSnapshot($member, $project['id'])['project']['role'] === 'member', 'Joining did not grant project access');
    uiExpect(genesisSharedUiState($member, $space['id'])['expandedIds'] === [], 'Expansion leaked between users');
    uiReject(fn() => genesisSharedRespondSpaceInvitation($member, $invitation['id'], true), 409);
    uiReject(fn() => genesisSharedSpaceInvite($member, $space['id'], ['email' => 'genesis-ui-test-outsider@gmail.com']), 403);
    $guestInvitation = genesisSharedSpaceInvite($owner, $space['id'], ['email' => 'genesis-ui-test-guest@gmail.com', 'role' => 'guest']);
    genesisSharedRespondSpaceInvitation($guest, $guestInvitation['id'], true);
    $future = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Created after joining']);
    uiExpect(genesisSharedProjectSnapshot($member, $future['id'])['project']['role'] === 'member', 'Future project membership missing');
    uiExpect(genesisSharedProjectSnapshot($guest, $future['id'])['project']['role'] === 'viewer', 'Guest gained edit access');
    uiReject(fn() => genesisSharedCreateProject($guest, $space['id'], ['title' => 'Forbidden']), 403);
    $folder = genesisSharedSaveProjectCategory($owner, $space['id'], ['title' => 'Projects folder', 'color' => '#123456']);
    uiExpect(genesisSharedProjectCategories($member, $space['id'])[0]['id'] === $folder['id'], 'Members cannot read project folders');
    uiReject(fn() => genesisSharedSaveProjectCategory($guest, $space['id'], ['title' => 'Forbidden']), 403);
    uiReject(fn() => genesisSharedProjectCategories($outsider, $space['id']));
    $categorized = genesisSharedUpdateProject($owner, $project['id'], ['categoryId' => $folder['id'], 'expectedRevision' => 1, 'tags' => ['one', 'two']]);
    uiExpect($categorized['categoryId'] === $folder['id'] && count($categorized['tags']) === 2, 'Project category replaced multiple tags');
    $legacyUpdate = genesisSharedUpdateProject($owner, $project['id'], ['title' => 'Boards', 'expectedRevision' => 2]);
    uiExpect($legacyUpdate['categoryId'] === $folder['id'], 'Old client update erased the folder');
    $subproject = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Categorized child', 'parentId' => $project['id'], 'categoryId' => $folder['id']]);
    $uncategorizedChild = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Uncategorized child', 'parentId' => $project['id']]);
    uiExpect($uncategorizedChild['categoryId'] === null, 'A child cannot opt out of its parent category');
    uiReject(fn() => genesisSharedCreateProject($owner, $space['id'], ['title' => 'Invalid list', 'kind' => 'task-list', 'categoryId' => $folder['id']]));
    $otherSpace = genesisSharedCreateSpace($owner, ['title' => 'Other folder scope']);
    uiReject(fn() => genesisSharedCreateProject($owner, $otherSpace['id'], ['title' => 'Wrong workspace category', 'categoryId' => $folder['id']]));
    $task = genesisSharedTask($owner, $project['id'], ['title' => 'Tagged task', 'statusId' => $initial['statuses'][0]['id'], 'tags' => ['first', 'second']]);
    uiReject(fn() => genesisSharedTask($owner, $project['id'], ['title' => 'Direct folder task', 'statusId' => $initial['statuses'][0]['id'], 'categoryId' => $folder['id']]));
    $renamedFolder = genesisSharedSaveProjectCategory($owner, $space['id'], ['title' => 'Renamed folder', 'color' => '#654321', 'expectedRevision' => 1], $folder['id']);
    uiReject(fn() => genesisSharedDeleteProjectCategory($owner, $space['id'], $folder['id'], ['expectedRevision' => 1]), 409);
    uiExpect(genesisSharedProjectSnapshot($owner, $project['id'])['project']['categoryId'] === $folder['id'], 'Stale category delete changed projects');
    genesisSharedDeleteProjectCategory($owner, $space['id'], $folder['id'], ['expectedRevision' => $renamedFolder['revision']]);
    $afterDelete = genesisSharedProjectSnapshot($owner, $project['id']);
    uiExpect($afterDelete['project']['categoryId'] === null && count($afterDelete['project']['tags']) === 2, 'Folder deletion lost project data');
    uiExpect(genesisSharedProjectSnapshot($owner, $subproject['id'])['project']['categoryId'] === null, 'Folder deletion orphaned a subproject');
    uiExpect($afterDelete['tasks'][0]['id'] === $task['id'] && count($afterDelete['tasks'][0]['tags']) === 2, 'Folder deletion lost task tags');
    uiExpect(genesisSharedSpaces($member)[0]['ownerName'] === 'UI Test' && (int)genesisSharedSpaces($member)[0]['memberCount'] === 3, 'Workspace identity metadata missing');
    $board = $initial['statuses'][0]; $destination = $initial['statuses'][1];
    $child = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Task list', 'kind' => 'task-list',
        'parentId' => $project['id'], 'boardStatusId' => $board['id']]);
    uiExpect($child['kind'] === 'task-list' && $child['boardStatusId'] === $board['id'], 'Task-list board placement missing');
    uiReject(fn() => genesisSharedCreateProject($owner, $space['id'], ['title' => 'Invalid destination',
        'parentId' => $future['id'], 'boardStatusId' => $board['id']]));
    $updated = genesisSharedUpdateStatus($owner, $project['id'], $board['id'], ['title' => 'Review',
        'color' => '#123456', 'imageUrl' => 'https://example.org/board.webp', 'expectedRevision' => 1]);
    uiExpect($updated['color'] === '#123456' && $updated['imageUrl'] === 'https://example.org/board.webp', 'Board appearance was not saved');
    uiReject(fn() => genesisSharedUpdateStatus($guest, $project['id'], $board['id'], ['title' => 'Invalid', 'expectedRevision' => 2]), 403);
    foreach (['taskTitleLines' => [-1, 4, '2', null], 'visibleTaskCount' => [-1, 1001, '5', null]] as $field => $invalid) {
        foreach ($invalid as $value) uiReject(fn() => genesisSharedUpdateStatus($owner, $project['id'], $board['id'],
            ['title' => 'Review', 'expectedRevision' => 2, $field => $value]));
    }
    $display = genesisSharedUpdateStatus($owner, $project['id'], $board['id'],
        ['title' => 'Review', 'expectedRevision' => 2, 'taskTitleLines' => 1, 'visibleTaskCount' => 7]);
    uiExpect($display['taskTitleLines'] === 1 && $display['visibleTaskCount'] === 7, 'Board display was not saved');
    uiReject(fn() => genesisSharedUpdateStatus($owner, $project['id'], $board['id'], ['title' => 'Stale', 'expectedRevision' => 2]), 409);
    $legacyBoard = genesisSharedUpdateStatus($owner, $project['id'], $board['id'], ['title' => 'Review', 'expectedRevision' => 3]);
    uiExpect($legacyBoard['taskTitleLines'] === 1 && $legacyBoard['visibleTaskCount'] === 7, 'Old client erased board display');
    $savedDisplay = genesisSharedProjectSnapshot($owner, $project['id'])['statuses'][0];
    uiExpect($savedDisplay['taskTitleLines'] === 1 && $savedDisplay['visibleTaskCount'] === 7, 'Snapshot lost board display');
    uiReject(fn() => genesisSharedBoardImage('javascript:alert(1)'));
    genesisSharedDeleteStatus($owner, $project['id'], $board['id'], ['destinationStatusId' => $destination['id'], 'expectedRevision' => 4]);
    uiExpect(genesisSharedProjectSnapshot($owner, $child['id'])['project']['boardStatusId'] === $destination['id'], 'Deleting a board orphaned a child project');
    $count = count(genesisSharedProjectSnapshot($owner, $project['id'])['statuses']);
    for ($i = $count; $i < 30; $i++) genesisSharedCreateStatus($owner, $project['id'], ['title' => 'Board ' . $i]);
    uiReject(fn() => genesisSharedCreateStatus($owner, $project['id'], ['title' => '31st board']), 409);
    genesisDeleteAccount($owner);
    uiExpect(genesisFindUser($owner) === null, 'Invitations prevented account deletion');
} finally {
    foreach ($ids as $id) if (genesisFindUser($id)) genesisDeleteAccount($id);
}
echo "Shared UI permissions, invitations, expansion and boards passed.\n";
