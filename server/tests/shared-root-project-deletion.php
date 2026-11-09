<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('GENESIS_IMPROVEMENTS_TEST') !== 'isolated' || !defined('GENESIS_LOCAL_TEST_CONFIG')) throw new RuntimeException('Explicit isolated fixture required');
foreach (['bootstrap', 'repository', 'google', 'shared-projects', 'shared-maintenance'] as $module) require_once __DIR__ . '/../src/' . $module . '.php';
if (genesisConfig()['app_url'] !== 'https://localhost.invalid') throw new RuntimeException('Synthetic fixture required');
function qdCheck(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function qdUser(): string {
    $id = genesisUuid(); $now = genesisNow();
    genesisDb()->prepare("INSERT INTO users(id,google_sub,email,display_name,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,'business','2035-01-01T00:00:00Z',1,?,?)")
        ->execute([$id, $id, $id . '@example.invalid', 'Deletion fixture', $now, $now]);
    return $id;
}
function qdCount(string $owner): int { return genesisSharedUserResourceUsage($owner, 'shared-projects')['count']; }
function qdReject(callable $work): void {
    try { $work(); } catch (GenesisResourceLimitException $error) {
        qdCheck($error->status === 403 && $error->getMessage() === 'SUBSCRIPTION_QUOTA_shared-projects', 'Wrong owner quota rejection'); return;
    }
    throw new RuntimeException('Owner root quota was bypassed');
}
function qdPromote(string $actor, string $id): array {
    $row = genesisSharedProjectAccess($id, $actor, 'manage');
    return genesisSharedUpdateProject($actor, $id, ['expectedRevision' => (int)$row['revision'], 'parentId' => null]);
}
/** Bulk seed ordinary valid children; exercise production deletion and quota services below. */
function qdChildren(string $owner, string $space, string $parent, int $count, ?string $manager = null): array {
    $db = genesisDb(); $now = genesisNow(); $ids = []; genesisBeginWriteTransaction($db);
    try {
        $project = $db->prepare("INSERT INTO shared_projects(id,space_id,parent_id,title,created_by,created_at,updated_at) VALUES(?,?,?,'Preserved child',?,?,?)");
        $member = $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)');
        $status = $db->prepare('INSERT INTO shared_project_statuses(id,project_id,title,position,is_done) VALUES(?,?,?,?,?)');
        for ($i = 0; $i < $count; $i++) {
            $id = genesisUuid(); $ids[] = $id; $project->execute([$id, $space, $parent, $owner, $now, $now]);
            $member->execute([$id, $owner, 'owner', $now]); if ($manager !== null) $member->execute([$id, $manager, 'manager', $now]);
            foreach ([['Open', 0], ['Done', 1]] as $position => [$title, $done]) $status->execute([genesisUuid(), $id, $title, $position, $done]);
        }
        $db->commit(); return $ids;
    } catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
}
function qdFillRoots(string $owner, string $space, int $count): array {
    $ids = []; for ($i = 0; $i < $count; $i++) $ids[] = genesisSharedCreateProject($owner, $space, ['title' => 'Root ' . $i])['id']; return $ids;
}
$db = genesisDb(); $failures = [];
$case = static function (string $name, callable $work) use (&$failures): void {
    try { $work(); echo 'PASS ' . $name . "\n"; }
    catch (Throwable $error) { $failures[] = $name . ': ' . $error->getMessage(); echo 'FAIL ' . end($failures) . "\n"; }
};

$case('delete-space-at-100-roots-with-501-children', static function () use ($db): void {
    $owner = qdUser(); $space = genesisSharedCreateSpace($owner, ['title' => 'Delete large space'])['id'];
    $roots = qdFillRoots($owner, $space, 100); $children = qdChildren($owner, $space, $roots[0], 501);
    qdCheck(qdCount($owner) === 100, 'Nested seed charged the root pool');
    qdReject(fn() => qdPromote($owner, $children[0]));
    genesisSharedDeleteSpace($owner, $space, ['expectedRevision' => 1]);
    $query = $db->prepare('SELECT COUNT(*) FROM shared_projects WHERE space_id=?'); $query->execute([$space]);
    qdCheck((int)$query->fetchColumn() === 0 && qdCount($owner) === 0, 'Space deletion left promoted or orphaned rows');
});

$case('delete-account-preserves-member-owned-children-and-blocks-further-growth', static function () use ($db): void {
    $owner = qdUser(); $successor = qdUser(); $space = genesisSharedCreateSpace($owner, ['title' => 'Inherited large tree'])['id'];
    $parent = genesisSharedCreateProject($owner, $space, ['title' => 'Departing parent'])['id'];
    $db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$space, $successor, genesisNow()]);
    $db->prepare("INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,'member',?)")->execute([$parent, $successor, genesisNow()]);
    $children = qdChildren($successor, $space, $parent, 501, $owner);
    $task = genesisSharedTask($successor, $children[0], ['title' => 'Keep collaborator content']);
    // A member can keep separately owned children after access to their parent is removed.
    genesisSharedRemoveMember($owner, $parent, $successor);
    qdCheck(qdCount($successor) === 0, 'Foreign participation charged personal pool');
    genesisDeleteAccount($owner);
    qdCheck(genesisFindUser($owner) === null, 'Account was not deleted');
    qdCheck(genesisSharedSpaceAccess($space, $successor)['member_role'] === 'owner', 'Space did not pass to its successor');
    qdCheck(qdCount($successor) === 501, 'Existing collaborator projects were deleted or miscounted');
    qdCheck(genesisSharedGetTask($successor, $children[0], $task['id'])['title'] === 'Keep collaborator content', 'Account deletion lost collaborator data');
    $nested = genesisSharedCreateProject($successor, $space, ['title' => 'Allowed retained descendant', 'parentId' => $children[0]])['id'];
    qdReject(fn() => qdPromote($successor, $nested));
    qdReject(fn() => genesisSharedCreateProject($successor, $space, ['title' => 'No extra root']));
    qdReject(fn() => genesisSharedCreateSpace($successor, ['title' => 'No extra space']));
    qdCheck(genesisSharedProjectQuota(genesisSharedUserResourceUsage($successor, 'shared-projects'))['remaining'] === 0, 'Inherited excess exposed negative/free capacity');
});

$case('trash-purge-removes-entire-branch-without-root-quota-bypass', static function () use ($db): void {
    $owner = qdUser(); $space = genesisSharedCreateSpace($owner, ['title' => 'Purge large tree'])['id'];
    $roots = qdFillRoots($owner, $space, 100); $children = qdChildren($owner, $space, $roots[0], 501);
    $retainedChild = genesisSharedCreateProject($owner, $space, ['title' => 'Retained child', 'parentId' => $roots[1]])['id'];
    qdReject(fn() => qdPromote($owner, $children[0]));
    genesisSharedTrashProject($owner, $roots[0], ['expectedRevision' => 1, 'retentionDays' => 1]);
    qdCheck(qdCount($owner) === 100, 'Trash incorrectly freed a root slot');
    qdReject(fn() => genesisSharedCreateProject($owner, $space, ['title' => 'Trash bypass']));
    genesisSharedMaintenance(gmdate('Y-m-d\TH:i:s\Z', time() + 2 * 86400));
    qdCheck(qdCount($owner) === 99, 'Purge promoted children or released too many slots');
    $query = $db->prepare('SELECT COUNT(*) FROM shared_projects WHERE id IN (' . implode(',', array_fill(0, count($children) + 1, '?')) . ')');
    $query->execute([$roots[0], ...$children]); qdCheck((int)$query->fetchColumn() === 0, 'Purge retained orphaned descendants');
    genesisSharedCreateProject($owner, $space, ['title' => 'One released slot']);
    qdCheck(qdCount($owner) === 100, 'Released slot not reused correctly');
    qdReject(fn() => qdPromote($owner, $retainedChild));
});
qdCheck($db->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Deletion broke foreign keys');
qdCheck($failures === [], implode(' | ', $failures));
echo "PASS deletion regression: SQLite cascade versus explicit promotion, owner100 versus storage500, account preservation and subtree purge.\n";
