<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-fixture-plan.php';
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/google.php';
require dirname(__DIR__) . '/src/shared-projects.php';

function settingsExpect(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function settingsReject(callable $action, int $status): void {
    try { $action(); }
    catch (GenesisSharedAccessException $error) {
        settingsExpect($error->status === $status, 'Unexpected rejection: ' . $error->getMessage());
        return;
    }
    throw new RuntimeException('Forbidden or stale action succeeded');
}
// Verify the pre-migration SQLite snapshot and legacy queries independently of the app DB.
$legacy = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$migration = dirname(__DIR__) . '/migrations/035_shared_space_settings.sql';
foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) {
    if (strcmp(basename($file), basename($migration)) < 0) $legacy->exec(file_get_contents($file));
}
$legacy->exec("INSERT INTO users (id, google_sub, email, created_at, updated_at)
    VALUES ('legacy-user', 'legacy-user', 'legacy@example.test', 'now', 'now');
    INSERT INTO shared_spaces (id, title, created_by, created_at, updated_at)
    VALUES ('legacy-space', 'Legacy title', 'legacy-user', 'now', 'now');
    INSERT INTO shared_space_members (space_id, user_id, role, joined_at)
    VALUES ('legacy-space', 'legacy-user', 'member', 'now')");
$backupPath = tempnam(sys_get_temp_dir(), 'genesis-migration-35-');
if ($backupPath === false) throw new RuntimeException('Could not create the migration backup fixture');
try {
    $legacy->exec('VACUUM INTO ' . $legacy->quote($backupPath));
    $legacy->beginTransaction();
    $legacy->exec(file_get_contents($migration));
    $legacy->commit();
    $row = $legacy->query('SELECT s.title, s.description, s.revision, m.role, m.permissions_json
        FROM shared_spaces s JOIN shared_space_members m ON m.space_id = s.id')->fetch(PDO::FETCH_ASSOC);
    settingsExpect($row['title'] === 'Legacy title' && $row['role'] === 'member' && $row['permissions_json'] === null,
        'Migration changed legacy membership or permissions');
    settingsExpect($row['description'] === '' && (int)$row['revision'] === 1, 'Migration defaults are incompatible');
    settingsExpect($legacy->query('SELECT title, updated_at FROM shared_spaces')->fetchColumn() === 'Legacy title',
        'Old code queries cannot read the migrated schema');
    $backup = new PDO('sqlite:' . $backupPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    settingsExpect($backup->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'SQLite backup failed integrity check');
    settingsExpect($backup->query('SELECT title FROM shared_spaces')->fetchColumn() === 'Legacy title', 'Backup lost data');
    settingsExpect(!in_array('description', array_column($backup->query('PRAGMA table_info(shared_spaces)')->fetchAll(PDO::FETCH_ASSOC), 'name'), true),
        'Pre-migration backup contains the migrated schema');
} finally {
    $backup = null;
    unlink($backupPath);
}
$users = [];
foreach (['owner', 'member', 'admin'] as $role) {
    $id = 'space-settings-test-' . $role;
    $users[$role] = $id;
    genesisDb()->prepare('INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at)
        VALUES (:id, :id, :email, :name, :now, :now)')->execute([
        'id' => $id, 'email' => $id . '@gmail.com', 'name' => 'Settings test', 'now' => genesisNow(),
    ]);
    genesisTestEnableSharedProjects($id);
}
[$owner, $member, $admin] = array_values($users);
try {
    $permissions = array_fill_keys(['createProjects', 'editTasks', 'organizeTasks', 'comment', 'manageProjects', 'inviteMembers'], false);
    $space = genesisSharedCreateSpace($owner, ['title' => 'Settings', 'description' => 'Workspace description',
        'invitations' => [['email' => $member . '@gmail.com', 'role' => 'member', 'permissions' => $permissions],
            ['email' => $admin . '@gmail.com', 'role' => 'admin', 'permissions' => $permissions]]]);
    $settings = genesisSharedSpaceSettings($owner, $space['id']);
    settingsExpect($settings['space']['description'] === 'Workspace description' && count($settings['invitations']) === 2,
        'Creation lost the description or initial invitations');
    foreach ([$member, $admin] as $recipient) {
        $invitation = genesisSharedSpaceInvitations($recipient)[0];
        genesisSharedRespondSpaceInvitation($recipient, $invitation['id'], true);
    }
    $project = genesisSharedCreateProject($owner, $space['id'], ['title' => 'Permission checks']);
    foreach ([$member, $admin] as $restricted) {
        settingsReject(fn() => genesisSharedCreateProject($restricted, $space['id'], ['title' => 'Denied']), 403);
        foreach (['write', 'organize', 'comment', 'manage'] as $permission) {
            settingsReject(fn() => genesisSharedProjectAccess($project['id'], $restricted, $permission), 403);
        }
        settingsReject(fn() => genesisSharedSpaceInvite($restricted, $space['id'], ['email' => 'denied-invite@gmail.com']), 403);
        settingsReject(fn() => genesisSharedCreateStatus($restricted, $project['id'], ['title' => 'Denied board']), 403);
        settingsExpect(genesisSharedProjectAccess($project['id'], $restricted)['id'] === $project['id'], 'Read access disappeared');
    }
    $grant = $permissions;
    $grant['editTasks'] = true;
    $grant['inviteMembers'] = true;
    genesisSharedSetSpaceRole($owner, $space['id'], $member, ['role' => 'member', 'permissions' => $grant]);
    settingsExpect(genesisSharedProjectAccess($project['id'], $member, 'write')['permissions']['editTasks'], 'Granted permission was ignored');
    settingsReject(fn() => genesisSharedProjectAccess($project['id'], $member, 'organize'), 403);
    settingsReject(fn() => genesisSharedCreateStatus($member, $project['id'], ['title' => 'Task editor cannot manage boards']), 403);
    $boardGrant = $permissions;
    $boardGrant['manageProjects'] = true;
    genesisSharedSetSpaceRole($owner, $space['id'], $admin, ['role' => 'admin', 'permissions' => $boardGrant]);
    settingsExpect(genesisSharedCreateStatus($admin, $project['id'], ['title' => 'Managed board'])['title'] === 'Managed board',
        'Board manager could not create a board without task editing rights');
    settingsReject(fn() => genesisSharedSpaceInvite($member, $space['id'], ['email' => 'escalation@gmail.com']), 403);
    settingsReject(fn() => genesisSharedSetSpaceRole($member, $space['id'], $admin, ['role' => 'owner']), 403);
    settingsReject(fn() => genesisSharedSetSpaceRole($owner, $space['id'], $owner, ['role' => 'member']), 409);
    $updated = genesisSharedUpdateSpace($owner, $space['id'], ['title' => 'Updated', 'description' => 'Saved', 'expectedRevision' => 1]);
    settingsExpect($updated['revision'] === 2 && $updated['title'] === 'Updated', 'Settings revision did not advance');
    settingsReject(fn() => genesisSharedUpdateSpace($owner, $space['id'], ['title' => 'Stale', 'expectedRevision' => 1]), 409);
    settingsReject(fn() => genesisSharedDeleteSpace($member, $space['id'], ['expectedRevision' => 2]), 403);
    settingsReject(fn() => genesisSharedDeleteSpace($owner, $space['id'], ['expectedRevision' => 1]), 409);
    $invite = genesisSharedSpaceInvite($owner, $space['id'], ['email' => 'revoked-settings@gmail.com', 'role' => 'guest']);
    genesisSharedRevokeSpaceInvitation($owner, $space['id'], $invite['id']);
    settingsExpect(genesisSharedSpaceSettings($owner, $space['id'])['invitations'] === [], 'Revoked invitation remained pending');
    $before = count(genesisSharedSpaces($owner));
    try {
        genesisSharedCreateSpace($owner, ['title' => 'Invalid invitations', 'invitations' => [['email' => 'invalid@example.org']]]);
        throw new RuntimeException('Invalid initial invitation succeeded');
    } catch (InvalidArgumentException $expected) {
        settingsExpect(count(genesisSharedSpaces($owner)) === $before, 'Failed creation left a partial space');
    }
    genesisSharedDeleteSpace($owner, $space['id'], ['expectedRevision' => 2]);
    settingsReject(fn() => genesisSharedProjectAccess($project['id'], $owner), 404);
    settingsExpect(genesisSharedSpaces($member) === [], 'Deleted space membership survived');
} finally {
    foreach ($users as $id) if (genesisFindUser($id)) genesisDeleteAccount($id);
}
echo "Shared space settings, permission isolation, revisions and rollback passed.\n";
require __DIR__ . '/shared-web-updates.php';
require __DIR__ . '/shared-private-messages.php';
require __DIR__ . '/shared-collaboration-migration.php';
