<?php
declare(strict_types=1);
require_once __DIR__ . '/shared-mutation-payload.php';
require_once __DIR__ . '/shared-task-review.php';
require_once __DIR__ . '/shared-trash.php';

require_once __DIR__ . '/shared-labels.php';
require_once __DIR__ . '/shared-project-categories.php';
require_once __DIR__ . '/shared-activity.php';
require_once __DIR__ . '/shared-task-images.php';
require_once __DIR__ . '/shared-task-attachments.php';
require_once __DIR__ . '/shared-overview.php';
require_once __DIR__ . '/shared-schedule.php';
require_once __DIR__ . '/shared-space-covers.php';
require_once __DIR__ . '/shared-task-approvals.php';
require_once __DIR__ . '/shared-member-categories.php';
require_once __DIR__ . '/entry-types.php';
require_once __DIR__ . '/shared-presence.php';
require_once __DIR__ . '/shared-private-messages.php';
require_once __DIR__ . '/messenger.php';
require_once __DIR__ . '/shared-task-details.php';
require_once __DIR__ . '/shared-task-lifecycle.php';
require_once __DIR__ . '/shared-task-query.php';
require_once __DIR__ . '/shared-series.php';
require_once __DIR__ . '/shared-views.php';
require_once __DIR__ . '/shared-bulk.php';
require_once __DIR__ . '/shared-notifications.php';
require_once __DIR__ . '/shared-project-access.php';
require_once __DIR__ . '/shared-custom-fields.php';
require_once __DIR__ . '/template-apply.php';
require_once __DIR__ . '/automation-worker.php';
require_once __DIR__ . '/shared-data-apply.php';
require_once __DIR__ . '/shared-reports-history.php';
require_once __DIR__ . '/shared-reports.php';
require_once __DIR__ . '/shared-planning.php';
require_once __DIR__ . '/shared-planning-reports.php';
require_once __DIR__ . '/shared-sprint-reports.php';
require_once __DIR__ . '/shared-workflows.php';

final class GenesisSharedAccessException extends RuntimeException
{
    public function __construct(string $message = 'SHARED_PROJECT_NOT_FOUND', public readonly int $status = 404, public readonly array $details = [])
    {
        parent::__construct($message);
    }
}

function genesisSharedRequireEligible(string $userId): array
{
    $user = genesisFindUser($userId);
    if (!$user || !genesisSharedEligible($user)) {
        throw new GenesisSharedAccessException('SHARED_PROJECTS_DISABLED', 403);
    }
    return $user;
}

function genesisSharedRequireEnabled(string $userId): array
{
    $user = genesisSharedRequireEligible($userId);
    if (empty($user['shared_projects_enabled'])) {
        throw new GenesisSharedAccessException('SHARED_PROJECTS_DISABLED', 403);
    }
    return $user;
}

function genesisSharedTitle(mixed $value, int $limit = 160): string
{
    if (!is_string($value)) throw new InvalidArgumentException('TITLE_REQUIRED');
    $title = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    if ($title === '' || mb_strlen($title) > $limit) throw new InvalidArgumentException('INVALID_TITLE');
    return $title;
}

function genesisSharedText(mixed $value, int $limit): string
{
    if (!is_string($value) || mb_strlen($value) > $limit) throw new InvalidArgumentException('INVALID_TEXT');
    return trim($value);
}

function genesisSharedTags(mixed $value): array
{
    if (!is_array($value) || !array_is_list($value) || count($value) > 30) throw new InvalidArgumentException('INVALID_TAGS');
    $result = [];
    foreach ($value as $tag) {
        if (!is_string($tag) || mb_strlen($tag) > 80) throw new InvalidArgumentException('INVALID_TAGS');
        $tag = ltrim(trim($tag), '#');
        if ($tag !== '' && !in_array($tag, $result, true)) $result[] = $tag;
    }
    return $result;
}

function genesisSharedRowTags(array $row): array
{
    $row['tags'] = json_decode((string)($row['tagsJson'] ?? '[]'), true) ?: [];
    unset($row['tagsJson']);
    if (array_key_exists('dependsOnIdsCsv', $row)) {
        $row['dependsOnIds'] = $row['dependsOnIdsCsv'] ? explode(',', $row['dependsOnIdsCsv']) : [];
        unset($row['dependsOnIdsCsv']);
    }
    if (array_key_exists('labelIdsCsv', $row)) {
        $row['labelIds'] = $row['labelIdsCsv'] ? explode(',', $row['labelIdsCsv']) : [];
        unset($row['labelIdsCsv']);
    }
    return $row;
}

function genesisSharedSpaceAccess(string $spaceId, string $userId): array
{
    $query = genesisDb()->prepare('SELECT s.*, m.role AS member_role, m.permissions_json, m.can_organize_tasks, m.project_access_restricted FROM shared_spaces s
        JOIN shared_space_members m ON m.space_id = s.id AND m.user_id = :user
        WHERE s.id = :id LIMIT 1');
    $query->execute(['id' => $spaceId, 'user' => $userId]);
    $row = $query->fetch();
    if (!$row) throw new GenesisSharedAccessException();
    return $row;
}

function genesisSharedProjectAccess(string $projectId, string $userId, string $permission = 'read', bool $includeArchived = false): array
{
    $query = genesisDb()->prepare('SELECT p.*, m.role AS member_role,
        sm.role AS space_member_role, sm.permissions_json AS space_permissions_json, sm.can_organize_tasks AS can_organize_tasks, sm.project_access_restricted FROM shared_projects p
        JOIN shared_project_members m ON m.project_id = p.id AND m.user_id = :user
        JOIN shared_space_members sm ON sm.space_id = p.space_id AND sm.user_id = :user
        WHERE p.id = :id AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind=\'project\' AND tr.object_id=p.id)' . ($includeArchived ? '' : ' AND p.archived_at IS NULL') . ' LIMIT 1');
    $query->execute(['id' => $projectId, 'user' => $userId]);
    $project = $query->fetch();
    if (!$project) throw new GenesisSharedAccessException();
    $permissions = genesisSharedPermissions($project['space_member_role'], $project['space_permissions_json'],
        (int)$project['can_organize_tasks'] === 1, $project['member_role'], (bool)$project['project_access_restricted']);
    $key = ['write' => 'editTasks', 'comment' => 'comment', 'manage' => 'manageProjects',
        'organize' => 'organizeTasks', 'invite' => 'inviteMembers', 'owner' => 'manageProjects'][$permission] ?? null;
    if ($permission !== 'read' && (!$key || !$permissions[$key]
        || ($permission === 'owner' && $project['member_role'] !== 'owner'))) {
        throw new GenesisSharedAccessException('SHARED_PROJECT_FORBIDDEN', 403);
    }
    $project['permissions'] = $permissions;
    return $project;
}

function genesisSharedAudit(string $projectId, string $actorId, string $action, string $objectId, array $details = []): string
{
    if(GenesisDataHistoricalScope::active())return genesisUuid();
    $db=genesisDb();$ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);
    try {
    $details = genesisSharedEventContext($projectId, $action, $objectId, $details);
    $reportState=genesisSharedReportEventState($projectId,$action,$objectId,$details);unset($details['reportBefore']);
    $notificationDetails = $details;
    if($reportState!==null)$details['reportState']=$reportState;
    foreach($details['changes']??[] as $field=>$change)if(in_array($field,['projectId','parentId','statusId','boardStatusId','parentTaskId','dependsOnIds'],true))$details['referenceIds'][$field]=$change;
    $details = genesisSharedReadableChanges($details);
    $eventId = genesisUuid();
    genesisDb()->prepare('INSERT INTO shared_audit_events (id, project_id, actor_id, action, object_id, created_at, task_id, board_id, details_json)
        VALUES (:id, :project, :actor, :action, :object, :created, :task, :board, :details)')->execute([
        'id' => $eventId, 'project' => $projectId, 'actor' => $actorId,
        'action' => $action, 'object' => $objectId, 'created' => genesisNow(),
        'task' => $details['taskId'] ?? null, 'board' => $details['boardId'] ?? null,
        'details' => json_encode($details, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);
    if($action!=='task.observed'){
        genesisNotificationCapture($eventId,$projectId,$actorId,$action,$objectId,$notificationDetails);
        genesisAutomationCapture($eventId,$projectId,$action,$objectId,$notificationDetails);
    }
    if($ownsTransaction)$db->commit();
    return $eventId;
    } catch(Throwable $error) { if($ownsTransaction&&$db->inTransaction())$db->rollBack();throw$error; }
}

function genesisSharedSpaces(string $userId): array
{
    genesisSharedRequireEnabled($userId);
    $query = genesisDb()->prepare('SELECT s.id, s.title, s.description, s.revision, s.cover_x, s.cover_y, (length(s.cover_image) > 0) AS hasCover, s.updated_at AS updatedAt, m.role, m.permissions_json, m.can_organize_tasks, m.project_access_restricted
        , (SELECT GROUP_CONCAT(u.display_name, \', \') FROM shared_space_members owners JOIN users u ON u.id = owners.user_id
            WHERE owners.space_id = s.id AND owners.role = \'owner\') AS ownerName,
        (SELECT COUNT(*) FROM shared_space_members members WHERE members.space_id = s.id) AS memberCount
        FROM shared_spaces s JOIN shared_space_members m ON m.space_id = s.id
        WHERE m.user_id = :user ORDER BY s.updated_at DESC LIMIT 100');
    $query->execute(['user' => $userId]);
    return array_map(static function (array $space): array {
        $space['permissions'] = genesisSharedPermissions($space['role'], $space['permissions_json'], (int)$space['can_organize_tasks'] === 1,null,(bool)$space['project_access_restricted']);
        $space['revision'] = (int)$space['revision'];
        $space['projectQuota'] = genesisSharedProjectQuota(genesisSharedOwnerResourceUsage($space['id'],'shared-projects'));
        $space += genesisSharedCoverInfo($space);
        unset($space['permissions_json'], $space['can_organize_tasks'], $space['cover_x'], $space['cover_y'], $space['hasCover']); return $space;
    }, $query->fetchAll());
}

function genesisSharedCreateSpace(string $userId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $title = genesisSharedTitle($input['title'] ?? null);
    $description = genesisSharedText($input['description'] ?? '', 5000);
    $cover = genesisSharedCoverInput($input);
    $invitations = $input['invitations'] ?? [];
    if (!is_array($invitations) || !array_is_list($invitations) || count($invitations) > 20) throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
    $id = genesisUuid();
    $now = genesisNow();
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        // A space creates only an excluded inbox, but cannot be created once the root pool is full.
        genesisRequireSharedUserQuota($userId,'shared-projects');
        $db->prepare('INSERT INTO shared_spaces (id, title, description, cover_image, cover_x, cover_y, created_by, created_at, updated_at)
            VALUES (:id, :title, :description, :image, :x, :y, :user, :now, :now)')->execute(compact('id', 'title', 'description') + $cover + ['user' => $userId, 'now' => $now]);
        $db->prepare("INSERT INTO shared_space_members (space_id, user_id, role, joined_at)
            VALUES (:space, :user, 'owner', :now)")->execute(['space' => $id, 'user' => $userId, 'now' => $now]);
        $inboxId = genesisUuid();
        $db->prepare("INSERT INTO shared_projects (id, space_id, title, description, layout, is_inbox,
            created_by, created_at, updated_at) VALUES (:id, :space, 'Хаос-бокс',
            'Общие задачи без отдельного проекта', 'list', 1, :user, :now, :now)")->execute([
                'id' => $inboxId, 'space' => $id, 'user' => $userId, 'now' => $now,
            ]);
        $db->prepare("INSERT INTO shared_project_members (project_id, user_id, role, joined_at)
            VALUES (:project, :user, 'owner', :now)")->execute([
                'project' => $inboxId, 'user' => $userId, 'now' => $now,
            ]);
        foreach ([['К выполнению', 0], ['Готово', 1]] as $position => [$statusTitle, $done]) {
            $db->prepare('INSERT INTO shared_project_statuses (id, project_id, title, position, is_done)
                VALUES (:id, :project, :title, :position, :done)')->execute([
                    'id' => genesisUuid(), 'project' => $inboxId, 'title' => $statusTitle,
                    'position' => $position, 'done' => $done,
                ]);
        }
        $emails = [];
        foreach ($invitations as $invitation) {
            if (!is_array($invitation)) throw new InvalidArgumentException('INVALID_SPACE_INVITATIONS');
            $email = mb_strtolower(trim((string)($invitation['email'] ?? '')));
            if (in_array($email, $emails, true)) throw new InvalidArgumentException('DUPLICATE_SPACE_INVITATION');
            $emails[] = $email;
            genesisSharedSpaceInvite($userId, $id, $invitation);
        }
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    return ['id' => $id, 'title' => $title, 'role' => 'owner', 'description' => $description, 'revision' => 1, 'updatedAt' => $now,
        'projectQuota'=>genesisSharedProjectQuota(genesisSharedOwnerResourceUsage($id,'shared-projects'))] + genesisSharedCoverInfo(['id' => $id, 'revision' => 1, 'cover_image' => $cover['image'], 'cover_x' => $cover['x'], 'cover_y' => $cover['y']]);
}

/** Legacy workspace inboxes hold membership, never task content. */
function genesisSharedRequireTaskProject(array $project): void
{
    if ((int)$project['is_inbox'] === 1) throw new GenesisSharedAccessException('SHARED_PROJECT_REQUIRED', 409);
    if (($project['kind'] ?? 'project') === 'task-list' && empty($project['parent_id']))
        throw new GenesisSharedAccessException('SHARED_PROJECT_REQUIRED', 409);
}

/** A hidden status keeps old status_id foreign keys and completion semantics compatible. */
function genesisSharedProjectInboxStatus(PDO $db, string $projectId, bool $done = false): string
{
    $id = ($done ? 'chaos-done:' : 'chaos-open:') . $projectId;
    $db->prepare('INSERT OR IGNORE INTO shared_project_statuses(id,project_id,title,position,is_done,is_chaos)
        VALUES(?,?,?, ?,?,1)')->execute([$id,$projectId,'Хаос-бокс',$done ? -1 : -2,$done ? 1 : 0]);
    return $id;
}

function genesisSharedProjects(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $query = genesisDb()->prepare('SELECT p.id, p.space_id AS spaceId, p.parent_id AS parentId, p.category_id AS categoryId,
        (SELECT GROUP_CONCAT(label_id) FROM shared_project_labels WHERE project_id = p.id) AS labelIdsCsv,
        p.title, p.description, p.tags_json AS tagsJson, p.layout, p.kind, p.board_status_id AS boardStatusId, p.is_inbox AS isInbox, p.revision, p.updated_at AS updatedAt,
        m.role, sm.role AS spaceRole, sm.can_organize_tasks AS canOrganizeTasks, sm.permissions_json AS permissionsJson, sm.project_access_restricted AS projectAccessRestricted,
        (SELECT COUNT(*) FROM shared_tasks_read t WHERE t.project_id = p.id) AS taskCount,
        CASE WHEN p.is_inbox = 1 THEN 0 ELSE (SELECT COUNT(*) FROM shared_project_statuses s WHERE s.project_id = p.id AND s.is_chaos=0) END AS boardCount
        FROM shared_projects p JOIN shared_project_members m ON m.project_id = p.id
        JOIN shared_space_members sm ON sm.space_id = p.space_id AND sm.user_id = m.user_id
        WHERE p.space_id = :space AND m.user_id = :user AND p.archived_at IS NULL
        ORDER BY p.updated_at DESC');
    $query->execute(['space' => $spaceId, 'user' => $userId]);
    return array_map(static function (array $project): array {
        $project['permissions'] = genesisSharedPermissions($project['spaceRole'], $project['permissionsJson'], (int)$project['canOrganizeTasks'] === 1, $project['role'], (bool)$project['projectAccessRestricted']);
        $project['canOrganizeTasks'] = $project['permissions']['organizeTasks'];
        $project['canCreateBoards'] = $project['permissions'][$project['permissionsJson'] === null ? 'editTasks' : 'manageProjects'];
        unset($project['permissionsJson']); return genesisSharedRowTags($project);
    }, $query->fetchAll());
}

function genesisSharedArchivedProjects(string $userId, string $spaceId): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    $query = genesisDb()->prepare('SELECT p.id, p.space_id AS spaceId, p.parent_id AS parentId,
        (SELECT GROUP_CONCAT(label_id) FROM shared_project_labels WHERE project_id = p.id) AS labelIdsCsv,
        p.title, p.description, p.tags_json AS tagsJson, p.layout, p.kind, p.board_status_id AS boardStatusId, p.revision, p.archived_at AS archivedAt, m.role
        FROM shared_projects p JOIN shared_project_members m ON m.project_id = p.id
        WHERE p.space_id = :space AND m.user_id = :user AND p.archived_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shared_trash tr WHERE tr.kind=\'project\' AND tr.object_id=p.id)
        ORDER BY p.archived_at DESC');
    $query->execute(['space' => $spaceId, 'user' => $userId]);
    return array_map(static fn($row)=>[...genesisSharedRowTags($row),'permissions'=>genesisSharedProjectAccess($row['id'],$userId,'read',true)['permissions']], $query->fetchAll());
}

function genesisSharedSetArchived(string $userId, string $projectId, bool $archived): void
{
    genesisSharedRequireEnabled($userId);
    $project = genesisSharedProjectAccess($projectId, $userId, 'owner', true);
    if ((int)$project['is_inbox'] === 1) throw new GenesisSharedAccessException('INBOX_CANNOT_BE_ARCHIVED', 403);
    if ($archived && $project['archived_at'] !== null) return;
    if (!$archived && $project['archived_at'] === null) return;
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'owner', true);
        if ($archived) {
            $children = $db->prepare('SELECT 1 FROM shared_projects WHERE parent_id = :project
                AND archived_at IS NULL LIMIT 1');
            $children->execute(['project' => $projectId]);
            if ($children->fetchColumn()) throw new GenesisSharedAccessException('ARCHIVE_CHILD_PROJECTS_FIRST', 409);
        } elseif ($project['parent_id'] !== null) {
            $parent = $db->prepare('SELECT 1 FROM shared_projects WHERE id = :parent AND archived_at IS NULL');
            $parent->execute(['parent' => $project['parent_id']]);
            if (!$parent->fetchColumn()) throw new GenesisSharedAccessException('RESTORE_PARENT_FIRST', 409);
        }
        $changed = $db->prepare('UPDATE shared_projects SET archived_at = :archived, updated_at = :now,
            revision = revision + 1 WHERE id = :project AND revision = :revision');
        $changed->execute(['archived' => $archived ? genesisNow() : null,
            'now' => genesisNow(), 'project' => $projectId, 'revision' => (int)$project['revision']]);
        if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('SHARED_PROJECT_CONFLICT', 409);
        if (!$archived) genesisWorkflowAssertProject($userId,$projectId);
        genesisSharedAudit($projectId, $userId, $archived ? 'project.archived' : 'project.restored', $projectId);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedCreateStatus(string $userId, string $projectId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $requestId = genesisSharedRequestId($input);
    $title = genesisSharedTitle($input['title'] ?? null, 80);
    $isDone = $input['isDone'] ?? false;
    if (!is_bool($isDone)) throw new InvalidArgumentException('INVALID_STATUS_KIND');
    $color = genesisSharedCategoryColor($input['color'] ?? '#2d6c68');
    $db = genesisDb();
    $ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);
    try {
        $project = genesisSharedProjectAccess($projectId, $userId);
        genesisSharedProjectAccess($projectId, $userId, $project['space_permissions_json'] === null ? 'write' : 'manage');
        $payloadHash = genesisSharedMutationPayloadHash('status.create',$input,['projectId'=>$projectId]);
        $receipt = genesisSharedMutationReceipt($db, $userId, $requestId, 'status.create', $projectId, $payloadHash);
        if ($receipt !== null) {
            if($ownsTransaction)$db->commit();
            return $receipt;
        }
        genesisSharedRequireTaskProject($project);
        $query = $db->prepare('SELECT COUNT(*) AS count, COALESCE(MAX(position), -1) AS lastPosition
            FROM shared_project_statuses WHERE project_id = :project AND is_chaos=0');
        $query->execute(['project' => $projectId]);
        $summary = $query->fetch();
        if ((int)$summary['count'] >= 30) throw new GenesisSharedAccessException('STATUS_LIMIT', 409);
        $id = genesisUuid();
        $position = (int)$summary['lastPosition'] + 1;
        genesisWorkflowStatusEdit($projectId);
        $db->prepare('INSERT INTO shared_project_statuses (id, project_id, title, position, is_done, color)
            VALUES (:id, :project, :title, :position, :done, :color)')->execute([
                'id' => $id, 'project' => $projectId, 'title' => $title,
                'position' => $position, 'done' => $isDone ? 1 : 0, 'color' => $color,
            ]);
        genesisSharedAudit($projectId, $userId, 'status.created', $id);
        $response = ['id' => $id, 'title' => $title, 'position' => $position, 'color' => $color,
            'isDone' => $isDone ? 1 : 0, 'revision' => 1, 'taskTitleLines' => $isDone ? 2 : 0, 'visibleTaskCount' => $isDone ? 5 : 0];
        genesisSharedSaveMutationReceipt($db, $userId, $requestId, 'status.create', $projectId, $response, $payloadHash);
        if($ownsTransaction)$db->commit();
        return $response;
    } catch (Throwable $error) {
        if($ownsTransaction&&$db->inTransaction())$db->rollBack();
        throw $error;
    }
}

function genesisSharedUpdateStatus(string $userId, string $projectId, string $statusId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $title = genesisSharedTitle($input['title'] ?? null, 80);
    $expected = filter_var($input['expectedRevision'] ?? null, FILTER_VALIDATE_INT);
    if ($expected === false || $expected < 1) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb(); genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'manage');
        $query = $db->prepare('SELECT * FROM shared_project_statuses WHERE id = :id AND project_id = :project AND is_chaos=0');
        $query->execute(['id' => $statusId, 'project' => $projectId]); $status = $query->fetch();
        if (!$status || (int)$status['revision'] !== $expected) throw new GenesisSharedAccessException('STATUS_CONFLICT', 409);
        $color = array_key_exists('color', $input) ? genesisSharedCategoryColor($input['color']) : $status['color'];
        $image = array_key_exists('imageUrl', $input) ? genesisSharedBoardImage($input['imageUrl']) : $status['image_url'];
        $done = array_key_exists('isDone', $input) ? (int)(bool)$input['isDone'] : (int)$status['is_done'];
        if ($done !== (int)$status['is_done']) genesisWorkflowStatusEdit($projectId);
        $titleLines = array_key_exists('taskTitleLines', $input) ? $input['taskTitleLines'] : ($status['task_title_lines'] ?? ($status['is_done'] ? 2 : 0));
        $visibleCount = array_key_exists('visibleTaskCount', $input) ? $input['visibleTaskCount'] : ($status['visible_task_count'] ?? ($status['is_done'] ? 5 : 0));
        if (!is_int($titleLines) || $titleLines < 0 || $titleLines > 3
            || !is_int($visibleCount) || $visibleCount < 0 || $visibleCount > 1000) throw new InvalidArgumentException('INVALID_BOARD_DISPLAY');
        if (!$done && (int)$status['is_done']) {
            $count = $db->prepare('SELECT COUNT(*) FROM shared_project_statuses WHERE project_id = :project AND is_done = 1 AND is_chaos=0');
            $count->execute(['project' => $projectId]);
            if ((int)$count->fetchColumn() <= 1) throw new GenesisSharedAccessException('LAST_DONE_STATUS', 409);
        }
        $changed = $db->prepare('UPDATE shared_project_statuses SET title = :title, color = :color, image_url = :image,
            is_done = :done, task_title_lines = :title_lines, visible_task_count = :visible_count,
            revision = revision + 1 WHERE id = :id AND project_id = :project AND revision = :expected');
        $changed->execute(['title' => $title, 'color' => $color, 'image' => $image, 'done' => $done,
            'title_lines' => $titleLines, 'visible_count' => $visibleCount,
            'id' => $statusId, 'project' => $projectId, 'expected' => $expected]);
        if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('STATUS_CONFLICT', 409);
        if ($done !== (int)$status['is_done']) {
            $affected = $db->prepare('SELECT id FROM shared_tasks_read WHERE project_id = :project AND status_id = :status');
            $affected->execute(['project' => $projectId, 'status' => $statusId]);
            $affectedIds = $affected->fetchAll(PDO::FETCH_COLUMN);
            foreach ($affectedIds as $affectedId) {
                if ($done) genesisSharedRequireTaskApproval($affectedId);
                else genesisSharedResetTaskApprovals($affectedId);
            }
            $db->prepare('UPDATE shared_tasks SET completed_by = :completed_by, completed_at = :completed_at,
                updated_by = :user, updated_at = :now, revision = revision + 1 WHERE project_id = :project AND status_id = :status')
                ->execute(['completed_by' => $done ? $userId : null, 'completed_at' => $done ? genesisNow() : null,
                    'user' => $userId, 'now' => genesisNow(), 'project' => $projectId, 'status' => $statusId]);
            foreach ($affectedIds as $affectedId) genesisSharedAudit($projectId, $userId, 'task.updated', $affectedId, ['changes' => ['isDone' => ['from' => (bool)$status['is_done'], 'to' => (bool)$done]]]);
        }
        genesisSharedAudit($projectId, $userId, 'status.updated', $statusId, ['changes' => genesisSharedChanges(
            ['title' => $status['title'], 'color' => $status['color'], 'isDone' => (int)$status['is_done'],
                'taskTitleLines' => $status['task_title_lines'] ?? ($status['is_done'] ? 2 : 0), 'visibleTaskCount' => $status['visible_task_count'] ?? ($status['is_done'] ? 5 : 0)],
            ['title' => $title, 'color' => $color, 'isDone' => $done, 'taskTitleLines' => $titleLines, 'visibleTaskCount' => $visibleCount]), 'imageChanged' => $image !== $status['image_url']]); $db->commit();
        return ['id' => $statusId, 'title' => $title, 'color' => $color, 'imageUrl' => $image,
            'isDone' => $done, 'position' => (int)$status['position'], 'revision' => $expected + 1, 'taskTitleLines' => $titleLines, 'visibleTaskCount' => $visibleCount];
    } catch (Throwable $error) { $db->rollBack(); throw $error; }
}

function genesisSharedDeleteStatus(string $userId, string $projectId, string $statusId, array $input): void
{
    genesisSharedRequireEnabled($userId);
    $targetId = (string)($input['destinationStatusId'] ?? '');
    $expected = filter_var($input['expectedRevision'] ?? null, FILTER_VALIDATE_INT);
    if ($targetId === '' || $targetId === $statusId || $expected === false || $expected < 1) {
        throw new InvalidArgumentException('INVALID_STATUS_DESTINATION');
    }
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'manage');
        $query = $db->prepare('SELECT id, title, is_done, revision FROM shared_project_statuses
            WHERE project_id = :project AND is_chaos=0 AND id IN (:source, :target)');
        $query->execute(['project' => $projectId, 'source' => $statusId, 'target' => $targetId]);
        $statuses = [];
        foreach ($query->fetchAll() as $row) $statuses[$row['id']] = $row;
        if (!isset($statuses[$statusId], $statuses[$targetId])) throw new GenesisSharedAccessException();
        if ((int)$statuses[$statusId]['revision'] !== $expected) {
            throw new GenesisSharedAccessException('STATUS_CONFLICT', 409);
        }
        genesisWorkflowStatusEdit($projectId);
        if ((int)$statuses[$statusId]['is_done'] === 1) {
            $done = $db->prepare('SELECT COUNT(*) FROM shared_project_statuses
                WHERE project_id = :project AND is_done = 1 AND is_chaos=0');
            $done->execute(['project' => $projectId]);
            if ((int)$done->fetchColumn() <= 1) throw new GenesisSharedAccessException('LAST_DONE_STATUS', 409);
        }
        $now = genesisNow();
        $affected = $db->prepare('SELECT id FROM shared_tasks_read WHERE project_id = :project AND status_id = :status');
        $affected->execute(['project' => $projectId, 'status' => $statusId]);
        $affectedIds = $affected->fetchAll(PDO::FETCH_COLUMN);
        $targetDone = (int)$statuses[$targetId]['is_done'];
        foreach ($affectedIds as $affectedId) {
            if ($targetDone) genesisSharedRequireTaskApproval($affectedId);
            elseif ((int)$statuses[$statusId]['is_done']) genesisSharedResetTaskApprovals($affectedId);
        }
        $completion = $targetDone === 1
            ? 'completed_by = COALESCE(completed_by, :actor1), completed_at = COALESCE(completed_at, :now1),'
            : 'completed_by = NULL, completed_at = NULL,';
        $updates = $db->prepare('UPDATE shared_tasks SET status_id = :target, ' . $completion . '
            updated_by = :actor2, updated_at = :now2, revision = revision + 1
            WHERE project_id = :project AND status_id = :source');
        $values = ['target' => $targetId, 'actor2' => $userId,
            'now2' => $now, 'project' => $projectId, 'source' => $statusId];
        if ($targetDone === 1) $values += ['actor1' => $userId, 'now1' => $now];
        $updates->execute($values);
        foreach ($affectedIds as $affectedId) genesisSharedAudit($projectId, $userId, 'task.updated', $affectedId, ['changes' => ['statusId' => ['from' => $statusId, 'to' => $targetId], 'isDone' => ['from' => (bool)$statuses[$statusId]['is_done'], 'to' => (bool)$targetDone]]]);
        $deleteDetails = genesisSharedReadableChanges(['changes' => ['statusId' => ['from' => $statusId, 'to' => $targetId]]]);
        $db->prepare('UPDATE shared_projects SET board_status_id = :target, revision = revision + 1,
            updated_at = :now WHERE board_status_id = :source')->execute([
                'target' => $targetId, 'source' => $statusId, 'now' => genesisNow(),
            ]);
        $changed = $db->prepare('DELETE FROM shared_project_statuses
            WHERE id = :id AND project_id = :project AND revision = :expected');
        $changed->execute(['id' => $statusId, 'project' => $projectId, 'expected' => $expected]);
        if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('STATUS_CONFLICT', 409);
        genesisSharedAudit($projectId, $userId, 'status.deleted', $statusId, ['objectTitle' => $statuses[$statusId]['title'], 'boardId' => $statusId,
            'changes' => ['destination' => $deleteDetails['changes']['statusId']]]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedCategoryColor(mixed $value): string
{
    if (!is_string($value) || !preg_match('/\A#[0-9a-fA-F]{6}\z/', $value)) {
        throw new InvalidArgumentException('INVALID_CATEGORY_COLOR');
    }
    return strtolower($value);
}

function genesisSharedCreateCategory(string $userId, string $projectId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $title = genesisSharedTitle($input['title'] ?? null, 80);
    $color = genesisSharedCategoryColor($input['color'] ?? '#2d6c68');
    $db = genesisDb();
    $ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'manage');
        $query = $db->prepare('SELECT COUNT(*) AS count, COALESCE(MAX(position), -1) AS lastPosition
            FROM shared_project_categories WHERE project_id = :project');
        $query->execute(['project' => $projectId]);
        $summary = $query->fetch();
        if ((int)$summary['count'] >= 50) throw new GenesisSharedAccessException('CATEGORY_LIMIT', 409);
        $id = genesisUuid();
        $position = (int)$summary['lastPosition'] + 1;
        $db->prepare('INSERT INTO shared_project_categories (id, project_id, title, color, position)
            VALUES (:id, :project, :title, :color, :position)')->execute([
                'id' => $id, 'project' => $projectId, 'title' => $title,
                'color' => $color, 'position' => $position,
            ]);
        genesisSharedAudit($projectId, $userId, 'category.created', $id);
        if($ownsTransaction)$db->commit();
        return ['id' => $id, 'title' => $title, 'color' => $color,
            'position' => $position, 'revision' => 1];
    } catch (Throwable $error) {
        if($ownsTransaction&&$db->inTransaction())$db->rollBack();
        throw $error;
    }
}

function genesisSharedUpdateCategory(string $userId, string $projectId, string $categoryId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $title = genesisSharedTitle($input['title'] ?? null, 80);
    $color = genesisSharedCategoryColor($input['color'] ?? null);
    $expected = filter_var($input['expectedRevision'] ?? null, FILTER_VALIDATE_INT);
    if ($expected === false || $expected < 1) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'manage');
        $changed = $db->prepare('UPDATE shared_project_categories SET title = :title, color = :color,
            revision = revision + 1 WHERE id = :id AND project_id = :project AND revision = :expected');
        $changed->execute(['title' => $title, 'color' => $color, 'id' => $categoryId,
            'project' => $projectId, 'expected' => $expected]);
        if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('CATEGORY_CONFLICT', 409);
        genesisSharedAudit($projectId, $userId, 'category.updated', $categoryId);
        $db->commit();
        return ['id' => $categoryId, 'title' => $title, 'color' => $color,
            'revision' => $expected + 1];
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedDeleteCategory(string $userId, string $projectId, string $categoryId, array $input): void
{
    genesisSharedRequireEnabled($userId);
    $expected = filter_var($input['expectedRevision'] ?? null, FILTER_VALIDATE_INT);
    if ($expected === false || $expected < 1) throw new InvalidArgumentException('EXPECTED_REVISION_REQUIRED');
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'manage');
        $db->prepare('UPDATE shared_tasks SET category_id = NULL, revision = revision + 1,
            updated_by = :actor, updated_at = :now
            WHERE project_id = :project AND category_id = :category')->execute([
                'actor' => $userId, 'now' => genesisNow(), 'project' => $projectId,
                'category' => $categoryId,
            ]);
        $changed = $db->prepare('DELETE FROM shared_project_categories
            WHERE id = :id AND project_id = :project AND revision = :expected');
        $changed->execute(['id' => $categoryId, 'project' => $projectId, 'expected' => $expected]);
        if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('CATEGORY_CONFLICT', 409);
        genesisSharedAudit($projectId, $userId, 'category.deleted', $categoryId);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedCreateProject(string $userId, string $spaceId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    if (!genesisSharedSpacePermission($space, 'createProjects')) {
        throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    }
    $title = genesisSharedTitle($input['title'] ?? null);
    $description = genesisSharedText($input['description'] ?? '', 5000);
    $tags = genesisSharedTags($input['tags'] ?? []);
    $layout = $input['layout'] ?? 'list';
    if (!in_array($layout, ['list', 'board'], true)) throw new InvalidArgumentException('INVALID_LAYOUT');
    $parentId = $input['parentId'] ?? null;
    if ($parentId !== null) {
        $parent = genesisSharedProjectAccess((string)$parentId, $userId, 'write');
        if ($parent['space_id'] !== $spaceId) throw new GenesisSharedAccessException();
        if ((int)$parent['is_inbox'] === 1) throw new GenesisSharedAccessException('SHARED_PROJECT_REQUIRED',409);
    }
    $kind = $input['kind'] ?? 'project';
    if (!in_array($kind, ['project', 'task-list'], true)) throw new InvalidArgumentException('INVALID_PROJECT_KIND');
    if ($kind === 'task-list' && ($parentId === null || (int)$parent['is_inbox'] === 1))
        throw new GenesisSharedAccessException('SHARED_PROJECT_REQUIRED', 409);
    $categoryId = genesisSharedValidateProjectCategory($spaceId, $input['categoryId'] ?? null, $kind);
    $boardStatusId = genesisSharedBoardPlacement($userId, $spaceId, $parentId, $input['boardStatusId'] ?? null);
    $statusDefinitions=$input['statuses']??[['title'=>'К выполнению','isDone'=>false],['title'=>'В работе','isDone'=>false],['title'=>'Готово','isDone'=>true]];
    if(!is_array($statusDefinitions)||!array_is_list($statusDefinitions)||!$statusDefinitions||count($statusDefinitions)>30)throw new InvalidArgumentException('INVALID_STATUS');
    foreach($statusDefinitions as &$definition){
        if(!is_array($definition)||!is_bool($definition['isDone']??null)||array_diff(array_keys($definition),['title','isDone','color','taskTitleLines','visibleTaskCount']))throw new InvalidArgumentException('INVALID_STATUS');
        $definition['title']=genesisSharedTitle($definition['title']??null,80);
        $definition['color']=genesisSharedCategoryColor($definition['color']??'#2d6c68');
        $definition['taskTitleLines']=$definition['taskTitleLines']??($definition['isDone']?2:0);$definition['visibleTaskCount']=$definition['visibleTaskCount']??($definition['isDone']?5:0);
        if(!is_int($definition['taskTitleLines'])||$definition['taskTitleLines']<0||$definition['taskTitleLines']>3||!is_int($definition['visibleTaskCount'])||$definition['visibleTaskCount']<0||$definition['visibleTaskCount']>1000)throw new InvalidArgumentException('INVALID_BOARD_DISPLAY');
    }unset($definition);
    if(count(array_unique(array_column($statusDefinitions,'isDone'),SORT_REGULAR))!==2)throw new InvalidArgumentException('INVALID_STATUS_KIND');
    $id = genesisUuid();
    $now = genesisNow();
    $db = genesisDb();
    $ownsTransaction=!$db->inTransaction();if($ownsTransaction)genesisBeginWriteTransaction($db);
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if (!genesisSharedSpacePermission($space, 'createProjects')) {
            throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
        }
        if ($parentId !== null) {
            $parent=genesisSharedProjectAccess((string)$parentId,$userId,'write');
            if ($parent['space_id']!==$spaceId || (int)$parent['is_inbox']===1) throw new GenesisSharedAccessException();
        }
        if ($kind==='project' && $parentId===null) genesisRequireSharedOwnerQuota($spaceId,'shared-projects');
        $db->prepare('INSERT INTO shared_projects (id, space_id, parent_id, category_id, title, description, tags_json, layout, kind, board_status_id,
            created_by, created_at, updated_at) VALUES (:id, :space, :parent, :category, :title, :description, :tags, :layout, :kind, :board,
            :user, :now, :now)')->execute([
                'id' => $id, 'space' => $spaceId, 'parent' => $parentId, 'category' => $categoryId, 'title' => $title,
                'description' => $description, 'tags' => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'layout' => $layout, 'kind' => $kind, 'board' => $boardStatusId, 'user' => $userId, 'now' => $now,
            ]);
        $db->prepare("INSERT INTO shared_project_members (project_id, user_id, role, joined_at)
            VALUES (:project, :user, 'owner', :now)")->execute(['project' => $id, 'user' => $userId, 'now' => $now]);
        $db->prepare("INSERT OR IGNORE INTO shared_project_members (project_id, user_id, role, joined_at)
            SELECT :project, sm.user_id, CASE sm.role WHEN 'owner' THEN 'manager' WHEN 'admin' THEN 'manager' WHEN 'member' THEN 'member' ELSE 'viewer' END, :now FROM shared_space_members sm
            WHERE sm.space_id = :space AND (sm.role IN ('owner', 'admin') OR sm.all_projects = 1)")->execute([
                'project' => $id, 'space' => $spaceId, 'now' => $now]);
        foreach ($statusDefinitions as $position=>$definition) {
            $db->prepare('INSERT INTO shared_project_statuses (id,project_id,title,position,is_done,color,task_title_lines,visible_task_count) VALUES(?,?,?,?,?,?,?,?)')
                ->execute([genesisUuid(),$id,$definition['title'],$position,(int)$definition['isDone'],$definition['color'],$definition['taskTitleLines'],$definition['visibleTaskCount']]);
        }
        genesisSharedProjectInboxStatus($db,$id,false);
        genesisSharedProjectInboxStatus($db,$id,true);
        $labelIds = genesisSharedAssignLabels($spaceId, 'project', $id, $input);
        genesisSharedRefreshRestrictedProjectAccess($spaceId,$userId);
        genesisSharedAudit($id, $userId, 'project.created', $id, ['labelIds' => $labelIds]);
        if($ownsTransaction)$db->commit();
    } catch (Throwable $error) {
        if($ownsTransaction&&$db->inTransaction())$db->rollBack();
        throw $error;
    }
    return ['id' => $id, 'spaceId' => $spaceId, 'parentId' => $parentId, 'categoryId' => $categoryId, 'title' => $title,
        'description' => $description, 'tags' => $tags, 'labelIds' => $labelIds, 'layout' => $layout, 'kind' => $kind, 'boardStatusId' => $boardStatusId, 'revision' => 1, 'role' => 'owner', 'updatedAt' => $now];
}

/** The shared copy commits as one unit; private cleanup is a separate client step. */
function genesisSharedImportProjectTree(string $userId, string $spaceId, array $input): array
{
    genesisRequireFeature($userId,'data-export');
    genesisSharedRequireEnabled($userId);
    $transferId = $input['transferId'] ?? null;
    $mode = $input['mode'] ?? null;
    $projects = $input['projects'] ?? null;
    $categories = $input['categories'] ?? null;
    $tasks = $input['tasks'] ?? null;
    if (!is_string($transferId) || !preg_match('/\A[a-zA-Z0-9-]{8,100}\z/', $transferId)
        || !in_array($mode, ['copy', 'move'], true)
        || !is_array($projects) || !array_is_list($projects) || count($projects) < 1 || count($projects) > 50
        || !is_array($categories) || !array_is_list($categories) || count($categories) > 200
        || !is_array($tasks) || !array_is_list($tasks) || count($tasks) > 500) {
        throw new InvalidArgumentException('INVALID_PROJECT_IMPORT');
    }
    $sourceId = static function (mixed $value): string {
        if (!is_string($value) || !preg_match('/\A[^\x00-\x1f]{1,100}\z/u', $value)) {
            throw new InvalidArgumentException('INVALID_IMPORT_SOURCE_ID');
        }
        return $value;
    };
    $normalizedProjects = [];
    foreach ($projects as $index => $project) {
        if (!is_array($project)) throw new InvalidArgumentException('INVALID_PROJECT_IMPORT');
        $source = $sourceId($project['sourceId'] ?? null);
        $parent = $project['parentSourceId'] ?? null;
        if ($index === 0 && $parent !== null || $index > 0 && (!is_string($parent) || !isset($normalizedProjects[$parent]))
            || isset($normalizedProjects[$source])) throw new InvalidArgumentException('INVALID_IMPORT_TREE');
        $layout = $project['layout'] ?? 'list';
        if (!in_array($layout, ['list', 'board'], true)) throw new InvalidArgumentException('INVALID_LAYOUT');
        $normalizedProjects[$source] = [
            'parent' => $parent, 'title' => genesisSharedTitle($project['title'] ?? null),
            'description' => genesisSharedText($project['description'] ?? '', 5000), 'tags' => genesisSharedTags($project['tags'] ?? []), 'layout' => $layout,
        ];
    }
    $normalizedCategories = [];
    foreach ($categories as $category) {
        if (!is_array($category)) throw new InvalidArgumentException('INVALID_IMPORT_CATEGORY');
        $projectSource = $sourceId($category['projectSourceId'] ?? null);
        $source = $sourceId($category['sourceId'] ?? null);
        $color = $category['color'] ?? null;
        if (!isset($normalizedProjects[$projectSource]) || !is_string($color)
            || !preg_match('/\A#[0-9a-fA-F]{6}\z/', $color)
            || isset($normalizedCategories[$projectSource][$source])) throw new InvalidArgumentException('INVALID_IMPORT_CATEGORY');
        $normalizedCategories[$projectSource][$source] = [
            'title' => genesisSharedTitle($category['title'] ?? null), 'color' => strtolower($color),
        ];
    }
    $normalizedTasks = [];
    foreach ($tasks as $task) {
        if (!is_array($task)) throw new InvalidArgumentException('INVALID_IMPORT_TASK');
        $source = $sourceId($task['sourceId'] ?? null);
        $projectSource = $sourceId($task['projectSourceId'] ?? null);
        $categorySource = $task['categorySourceId'] ?? null;
        $due = $task['dueDate'] ?? null;
        if (!isset($normalizedProjects[$projectSource]) || isset($normalizedTasks[$source])
            || $categorySource !== null && (!is_string($categorySource)
                || !isset($normalizedCategories[$projectSource][$categorySource]))
            || !is_bool($task['done'] ?? null)
            || $due !== null && (!is_string($due) || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $due)
                || !checkdate((int)substr($due, 5, 2), (int)substr($due, 8, 2), (int)substr($due, 0, 4)))) {
            throw new InvalidArgumentException('INVALID_IMPORT_TASK');
        }
        $entryType = genesisEntryType($task['entryType'] ?? 'task');
        if ($entryType === 'birthday') throw new InvalidArgumentException('День рождения доступен только в личных делах.');
        $normalizedTasks[$source] = [
            'entryType' => $entryType,
            'projectSource' => $projectSource, 'categorySource' => $categorySource,
            'title' => genesisSharedTitle($task['title'] ?? null),
            'description' => genesisSharedText($task['description'] ?? '', 20000), 'tags' => genesisSharedTags($task['tags'] ?? []),
            'due' => $due, 'done' => $task['done'],
        ];
    }
    $targetParent = $input['targetParentId'] ?? null;
    if ($targetParent !== null) {
        $parent = genesisSharedProjectAccess((string)$targetParent, $userId, 'write');
        if ($parent['space_id'] !== $spaceId) throw new GenesisSharedAccessException();
    }
    $targetBoard = genesisSharedBoardPlacement($userId, $spaceId, $targetParent, $input['targetStatusId'] ?? null);
    $payloadHash = hash('sha256', json_encode([$spaceId, $mode, $targetParent, $targetBoard, $normalizedProjects, $normalizedCategories, $normalizedTasks],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if (!genesisSharedSpacePermission($space, 'createProjects')) {
            throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
        }
        $existing = $db->prepare('SELECT payload_hash, receipt_json FROM shared_project_imports
            WHERE source_user_id = :user AND transfer_id = :transfer');
        $existing->execute(['user' => $userId, 'transfer' => $transferId]);
        $saved = $existing->fetch();
        if ($saved) {
            if (!hash_equals((string)$saved['payload_hash'], $payloadHash)) {
                throw new GenesisSharedAccessException('SHARED_IMPORT_CONFLICT', 409);
            }
            $db->commit();
            return json_decode((string)$saved['receipt_json'], true, 16, JSON_THROW_ON_ERROR);
        }
        if ($mode === 'move') {
            $transferred = $db->prepare('SELECT 1 FROM shared_task_transfers
                WHERE source_user_id = :user AND source_task_id = :source LIMIT 1');
            foreach (array_keys($normalizedTasks) as $source) {
                $transferred->execute(['user' => $userId, 'source' => $source]);
                if ($transferred->fetchColumn()) {
                    throw new GenesisSharedAccessException('SHARED_TASK_ALREADY_TRANSFERRED', 409);
                }
            }
        }
        $now = genesisNow();
        $projectIds = []; $statusIds = []; $categoryIds = []; $taskIds = [];
        if ($targetParent !== null) {
            $parent=genesisSharedProjectAccess((string)$targetParent,$userId,'write');
            if ($parent['space_id']!==$spaceId || (int)$parent['is_inbox']===1) throw new GenesisSharedAccessException();
            genesisSharedBoardPlacement($userId,$spaceId,$targetParent,$targetBoard);
        }
        genesisRequireSharedOwnerQuota($spaceId,'shared-projects',$targetParent===null?1:0);
        $insertProject = $db->prepare('INSERT INTO shared_projects
            (id, space_id, parent_id, title, description, tags_json, layout, created_by, created_at, updated_at)
            VALUES (:id, :space, :parent, :title, :description, :tags, :layout, :user, :now, :now)');
        $insertMember = $db->prepare("INSERT INTO shared_project_members
            (project_id, user_id, role, joined_at) VALUES (:project, :user, :role, :now)");
        $spaceMembers = $db->prepare('SELECT user_id, role FROM shared_space_members WHERE space_id = :space');
        $spaceMembers->execute(['space' => $spaceId]);
        $members = $spaceMembers->fetchAll();
        $insertStatus = $db->prepare('INSERT INTO shared_project_statuses
            (id, project_id, title, position, is_done) VALUES (:id, :project, :title, :position, :done)');
        foreach ($normalizedProjects as $source => $project) {
            $id = genesisUuid();
            $projectIds[$source] = $id;
            $insertProject->execute(['id' => $id, 'space' => $spaceId,
                'parent' => $project['parent'] === null ? $targetParent : $projectIds[$project['parent']],
                'title' => $project['title'], 'description' => $project['description'], 'tags' => json_encode($project['tags'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'layout' => $project['layout'], 'user' => $userId, 'now' => $now]);
            foreach ($members as $member) {
                $role = $member['user_id'] === $userId ? 'owner' : match ($member['role']) {
                    'owner', 'admin' => 'manager', 'member' => 'member', default => 'viewer',
                };
                $insertMember->execute(['project' => $id, 'user' => $member['user_id'],
                    'role' => $role, 'now' => $now]);
            }
            foreach ([['К выполнению', 0], ['В работе', 0], ['Готово', 1]] as $position => [$title, $done]) {
                $statusId = genesisUuid();
                $insertStatus->execute(['id' => $statusId, 'project' => $id, 'title' => $title,
                    'position' => $position, 'done' => $done]);
                $statusIds[$source][$done ? 'done' : ($position === 0 ? 'open' : 'progress')] = $statusId;
            }
            genesisSharedAudit($id, $userId, 'project.imported', $id);
        }
        $insertCategory = $db->prepare('INSERT INTO shared_project_categories
            (id, project_id, title, color, position) VALUES (:id, :project, :title, :color, :position)');
        foreach ($normalizedCategories as $projectSource => $group) {
            foreach ($group as $categorySource => $category) {
                $id = genesisUuid();
                $categoryIds[$projectSource][$categorySource] = $id;
                $insertCategory->execute(['id' => $id, 'project' => $projectIds[$projectSource],
                    'title' => $category['title'], 'color' => $category['color'],
                    'position' => count($categoryIds[$projectSource]) - 1]);
            }
        }
        $insertTask = $db->prepare('INSERT INTO shared_tasks
            (id, project_id, status_id, category_id, title, description, tags_json, due_date, entry_type,
            created_by, updated_by, completed_by, completed_at, created_at, updated_at)
            VALUES (:id, :project, :status, :category, :title, :description, :tags, :due, :entry,
            :user, :user, :completed_by, :completed_at, :now, :now)');
        foreach ($normalizedTasks as $source => $task) {
            $id = genesisUuid();
            $taskIds[$source] = $id;
            $projectSource = $task['projectSource'];
            $insertTask->execute(['id' => $id, 'project' => $projectIds[$projectSource],
                'status' => $statusIds[$projectSource][$task['done'] ? 'done' : 'open'],
                'category' => $task['categorySource'] === null ? null
                    : $categoryIds[$projectSource][$task['categorySource']],
                'title' => $task['title'], 'description' => $task['description'], 'tags' => json_encode($task['tags'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'due' => $task['due'], 'entry' => $task['entryType'], 'user' => $userId,
                'completed_by' => $task['done'] ? $userId : null,
                'completed_at' => $task['done'] ? $now : null, 'now' => $now]);
            $db->prepare('INSERT INTO shared_notification_task_state(task_id,due_date,completed,imported) VALUES(?,?,?,1)')->execute([$id,$task['due'],$task['done']?1:0]);
            if ($mode === 'move') {
                $db->prepare('INSERT INTO shared_task_transfers
                    (source_user_id, source_task_id, target_project_id, target_task_id, created_at)
                    VALUES (:user, :source, :project, :task, :now)')->execute([
                    'user' => $userId, 'source' => $source,
                    'project' => $projectIds[$projectSource], 'task' => $id, 'now' => $now]);
            }
        }
        if ($targetParent !== null) {
            genesisSharedProjectAccess((string)$targetParent, $userId, 'write');
            $db->prepare('UPDATE shared_projects SET parent_id = :parent, board_status_id = :board WHERE id = :id')
                ->execute(['parent' => $targetParent, 'board' => $targetBoard, 'id' => reset($projectIds)]);
        }
        $receipt = ['rootProjectId' => reset($projectIds), 'projectIds' => $projectIds,
            'taskIds' => $taskIds, 'taskCount' => count($taskIds), 'mode' => $mode];
        $db->prepare('INSERT INTO shared_project_imports
            (source_user_id, transfer_id, payload_hash, root_project_id, receipt_json, created_at)
            VALUES (:user, :transfer, :hash, :root, :receipt, :now)')->execute([
            'user' => $userId, 'transfer' => $transferId, 'hash' => $payloadHash,
            'root' => $receipt['rootProjectId'],
            'receipt' => json_encode($receipt, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'now' => $now]);
        genesisSharedRefreshRestrictedProjectAccess($spaceId,$userId);
        $db->commit();
        return $receipt;
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

/** Board columns and list-view groups are the same server-owned team task lists. */
function genesisSharedTaskLists(string $userId): array
{
    genesisSharedRequireEnabled($userId);
    $query = genesisDb()->prepare('SELECT st.id, st.title, st.position, st.is_done AS isDone,
        st.revision, p.id AS projectId, p.title AS projectTitle,
        s.id AS spaceId, s.title AS spaceTitle, pm.role,
        COUNT(t.id) AS taskCount,
        SUM(CASE WHEN t.id IS NOT NULL AND st.is_done = 0 THEN 1 ELSE 0 END) AS openCount
        FROM shared_project_statuses st
        JOIN shared_projects p ON p.id = st.project_id AND p.archived_at IS NULL AND p.is_inbox = 0 AND st.is_chaos=0
        JOIN shared_spaces s ON s.id = p.space_id
        JOIN shared_project_members pm ON pm.project_id = p.id AND pm.user_id = :user
        JOIN shared_space_members sm ON sm.space_id = s.id AND sm.user_id = :user
        LEFT JOIN shared_tasks_read t ON t.status_id = st.id AND t.project_id = p.id
        GROUP BY st.id ORDER BY s.title, p.title, st.position LIMIT 1000');
    $query->execute(['user' => $userId]);
    return $query->fetchAll();
}

function genesisSharedRequestId(array $input): ?string
{
    if (!array_key_exists('requestId', $input)) return null;
    $requestId = $input['requestId'];
    if (!is_string($requestId) || !preg_match('/\A[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/i', $requestId)) {
        throw new InvalidArgumentException('INVALID_SHARED_REQUEST_ID');
    }
    return strtolower($requestId);
}

function genesisSharedMutationReceipt(PDO $db, string $userId, ?string $requestId,
    string $action, string $resourceId, ?string $payloadHash = null): ?array
{
    if ($requestId === null) return null;
    $query = $db->prepare('SELECT action, resource_id, response_json, payload_hash FROM shared_mutation_receipts
        WHERE user_id = :user AND request_id = :request LIMIT 1');
    $query->execute(['user' => $userId, 'request' => $requestId]);
    $row = $query->fetch();
    if (!$row) return null;
    if ($row['action'] !== $action || $row['resource_id'] !== $resourceId
        || $row['payload_hash'] !== null && ($payloadHash === null || !hash_equals($row['payload_hash'],$payloadHash))) {
        throw new GenesisSharedAccessException('SHARED_REQUEST_ID_CONFLICT', 409);
    }
    $response=json_decode((string)$row['response_json'],true,512,JSON_THROW_ON_ERROR);
    foreach(['storyPoints','estimateHours'] as $field)if(is_array($response[$field]??null)&&is_string($response[$field]['planningValue']??null))$response[$field]=genesisPlanningOpen($response[$field]['planningValue'])['value'];
    if(array_key_exists('customFields',$response))$response['customFields']=(object)$response['customFields'];
    return $response;
}

function genesisSharedSaveMutationReceipt(PDO $db, string $userId, ?string $requestId,
    string $action, string $resourceId, array $response, ?string $payloadHash = null): void
{
    if ($requestId === null) return;
    // Old receipt records stay readable; new estimate values follow content encryption too.
    foreach(['storyPoints','estimateHours'] as $field)if(isset($response[$field]))$response[$field]=['planningValue'=>genesisPlanningSeal(['value'=>$response[$field]])];
    $db->prepare('INSERT INTO shared_mutation_receipts
        (user_id, request_id, action, resource_id, response_json, created_at, payload_hash)
        VALUES (:user, :request, :action, :resource, :response, :created, :payload_hash)')->execute([
            'user' => $userId, 'request' => $requestId, 'action' => $action,
            'resource' => $resourceId, 'response' => json_encode($response, JSON_THROW_ON_ERROR),
            'created' => genesisNow(),
            'payload_hash' => $payloadHash,
        ]);
}

function genesisSharedUpdateProject(string $userId, string $projectId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        $project = genesisSharedProjectAccess($projectId, $userId, 'manage');
        if ((int)$project['is_inbox'] === 1) throw new GenesisSharedAccessException('INBOX_CANNOT_BE_EDITED', 403);
        if (!isset($input['expectedRevision']) || (int)$input['expectedRevision'] !== (int)$project['revision']) {
            throw new GenesisSharedAccessException('SHARED_PROJECT_CONFLICT', 409);
        }
        $title = array_key_exists('title', $input) ? genesisSharedTitle($input['title']) : $project['title'];
        $description = array_key_exists('description', $input)
            ? genesisSharedText($input['description'], 5000) : $project['description'];
        $tags = array_key_exists('tags', $input) ? genesisSharedTags($input['tags']) : json_decode($project['tags_json'], true);
        $layout = $input['layout'] ?? $project['layout'];
        if (!in_array($layout, ['list', 'board'], true)) throw new InvalidArgumentException('INVALID_LAYOUT');
        $categoryId = genesisSharedValidateProjectCategory($project['space_id'],
            array_key_exists('categoryId', $input) ? $input['categoryId'] : $project['category_id'], $project['kind']);
        $parentId = array_key_exists('parentId', $input) ? $input['parentId'] : $project['parent_id'];
        if ($parentId !== null) {
            if (!is_string($parentId)) throw new InvalidArgumentException('INVALID_PARENT');
            $visited = [$projectId => true];
            $cursor = $parentId;
            $query = genesisDb()->prepare('SELECT parent_id, space_id FROM shared_projects
                WHERE id = :id AND archived_at IS NULL');
            while ($cursor !== null) {
                if (isset($visited[$cursor])) throw new InvalidArgumentException('PROJECT_CYCLE');
                $visited[$cursor] = true;
                genesisSharedProjectAccess($cursor, $userId, 'write');
                $query->execute(['id' => $cursor]);
                $ancestor = $query->fetch();
                if (!$ancestor || $ancestor['space_id'] !== $project['space_id']) throw new GenesisSharedAccessException();
                $cursor = $ancestor['parent_id'];
            }
        }
        if ($project['kind'] === 'task-list' && $parentId === null) throw new GenesisSharedAccessException('SHARED_PROJECT_REQUIRED',409);
        if ($parentId !== null && (int)genesisSharedProjectAccess($parentId,$userId,'write')['is_inbox'] === 1)
            throw new GenesisSharedAccessException('SHARED_PROJECT_REQUIRED',409);
        $boardStatusId = genesisSharedBoardPlacement($userId, $project['space_id'], $parentId,
            array_key_exists('boardStatusId', $input) ? $input['boardStatusId']
                : ($parentId === $project['parent_id'] ? $project['board_status_id'] : null));
        $now = genesisNow();
        if ($project['kind']==='project' && $project['parent_id']!==null && $parentId===null)
            genesisRequireSharedOwnerQuota($project['space_id'],'shared-projects');
        $changed = $db->prepare('UPDATE shared_projects SET title = :title, description = :description, tags_json = :tags,
            layout = :layout, parent_id = :parent, category_id = :category, board_status_id = :board, updated_at = :now, revision = revision + 1
            WHERE id = :id AND revision = :expected');
        $changed->execute([
            'title' => $title, 'description' => $description, 'tags' => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'layout' => $layout,
            'parent' => $parentId, 'category' => $categoryId, 'board' => $boardStatusId, 'now' => $now, 'id' => $projectId,
            'expected' => (int)$project['revision'],
        ]);
        if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('SHARED_PROJECT_CONFLICT', 409);
        $oldLabels = genesisSharedLabelIds('project', $projectId);
        $labelIds = genesisSharedAssignLabels($project['space_id'], 'project', $projectId, $input);
        genesisSharedRefreshRestrictedProjectAccess($project['space_id'],$userId);
        genesisSharedAudit($projectId, $userId, 'project.updated', $projectId, ['changes' => genesisSharedChanges(
            ['title' => $project['title'], 'description' => $project['description'], 'tags' => json_decode($project['tags_json'], true), 'layout' => $project['layout'], 'parentId' => $project['parent_id'], 'labelIds' => $oldLabels, 'categoryId' => $project['category_id']],
            compact('title', 'description', 'tags', 'layout', 'parentId', 'labelIds', 'categoryId'))]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    return ['id' => $projectId, 'spaceId' => $project['space_id'], 'parentId' => $parentId, 'categoryId' => $categoryId,
        'title' => $title, 'description' => $description, 'tags' => $tags, 'labelIds' => $labelIds, 'layout' => $layout, 'kind' => $project['kind'], 'boardStatusId' => $boardStatusId,
        'revision' => (int)$project['revision'] + 1, 'role' => $project['member_role'],
        'updatedAt' => $now];
}

function genesisSharedSetMemberRole(string $userId, string $projectId, string $targetId, array $input): void
{
    genesisSharedRequireEnabled($userId);
    $project = genesisSharedProjectAccess($projectId, $userId, 'owner');
    if ((int)$project['is_inbox'] === 1) throw new GenesisSharedAccessException('INBOX_MEMBERSHIP_MANAGED_BY_SPACE', 403);
    $role = (string)($input['role'] ?? '');
    if (!in_array($role, ['owner', 'manager', 'member', 'commenter', 'viewer'], true)) {
        throw new InvalidArgumentException('INVALID_ROLE');
    }
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'owner');
        $query = $db->prepare('SELECT role FROM shared_project_members WHERE project_id = :project AND user_id = :user');
        $query->execute(['project' => $projectId, 'user' => $targetId]);
        $oldRole = $query->fetchColumn();
        if ($oldRole === false) throw new GenesisSharedAccessException();
        if ($oldRole === 'owner' && $role !== 'owner') {
            $owners = $db->prepare("SELECT COUNT(*) FROM shared_project_members WHERE project_id = :project AND role = 'owner'");
            $owners->execute(['project' => $projectId]);
            if ((int)$owners->fetchColumn() <= 1) throw new GenesisSharedAccessException('LAST_OWNER', 409);
        }
        $db->prepare('UPDATE shared_project_members SET role = :role WHERE project_id = :project AND user_id = :user')
            ->execute(['role' => $role, 'project' => $projectId, 'user' => $targetId]);
        if ($oldRole !== $role) genesisSharedRevokeInvitationsByMember($targetId, $projectId);
        genesisSharedRememberDirectProjectAccess($projectId,$targetId,$role);
        genesisSharedRefreshRestrictedProjectAccess((string)$project['space_id'],$userId,$targetId);
        genesisSharedAudit($projectId, $userId, 'member.role_changed', $targetId, ['changes' => ['role' => ['from' => $oldRole, 'to' => $role]]]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedSetSpaceRole(string $userId, string $spaceId, string $targetId, array $input): void
{
    genesisSharedRequireEnabled($userId);
    $space = genesisSharedSpaceAccess($spaceId, $userId);
    if ($space['member_role'] !== 'owner') throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
    $role = (string)($input['role'] ?? '');
    if (!in_array($role, ['owner', 'admin', 'member', 'guest'], true)) throw new InvalidArgumentException('INVALID_ROLE');
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        $space = genesisSharedSpaceAccess($spaceId, $userId);
        if ($space['member_role'] !== 'owner') throw new GenesisSharedAccessException('SHARED_SPACE_FORBIDDEN', 403);
        $member = $db->prepare('SELECT role, can_organize_tasks, permissions_json FROM shared_space_members
            WHERE space_id = :space AND user_id = :user');
        $member->execute(['space' => $spaceId, 'user' => $targetId]);
        $existing = $member->fetch();
        if (!$existing) throw new GenesisSharedAccessException();
        $oldRole = $existing['role'];
        $permissions = array_key_exists('permissions', $input) ? genesisSharedPermissionInput($input['permissions'])
            : ($role !== $oldRole ? genesisSharedPermissions($role) : null);
        $permissionsJson = array_key_exists('permissions', $input) || $role !== $oldRole
            ? ($permissions === null ? null : json_encode($permissions, JSON_THROW_ON_ERROR)) : $existing['permissions_json'];
        $canOrganize = $input['canOrganizeTasks'] ?? ((int)$existing['can_organize_tasks'] === 1);
        if (!is_bool($canOrganize)) throw new InvalidArgumentException('INVALID_ORGANIZER_PERMISSION');
        if ($oldRole === 'owner' && $role !== 'owner') {
            $owners = $db->prepare("SELECT COUNT(*) FROM shared_space_members WHERE space_id = :space AND role = 'owner'");
            $owners->execute(['space' => $spaceId]);
            if ((int)$owners->fetchColumn() <= 1) throw new GenesisSharedAccessException('LAST_OWNER', 409);
        }
        $db->prepare('UPDATE shared_space_members SET role = :role, can_organize_tasks = :organize, permissions_json = :permissions,
            member_category_id = CASE WHEN :manual = 1 THEN NULL ELSE member_category_id END
            WHERE space_id = :space AND user_id = :user')->execute([
                'role' => $role, 'organize' => $canOrganize ? 1 : 0, 'permissions' => $permissionsJson,
                'manual' => (int)($role !== $oldRole || array_key_exists('permissions', $input) || array_key_exists('canOrganizeTasks', $input)),
                'space' => $spaceId, 'user' => $targetId]);
        if ($role !== $oldRole || $permissionsJson !== $existing['permissions_json']
            || $canOrganize !== ((int)$existing['can_organize_tasks'] === 1)) {
            genesisSharedRevokeInvitationsByMember($targetId, null, $spaceId);
        }
        if (in_array($role, ['owner', 'admin'], true)) {
            $db->prepare("INSERT OR IGNORE INTO shared_project_members (project_id, user_id, role, joined_at)
                SELECT p.id, :user, 'manager', :now FROM shared_projects p WHERE p.space_id = :space")
                ->execute(['user' => $targetId, 'now' => genesisNow(), 'space' => $spaceId]);
        }
        $inbox = $db->prepare('SELECT id FROM shared_projects WHERE space_id = :space AND is_inbox = 1');
        $inbox->execute(['space' => $spaceId]);
        $inboxId = $inbox->fetchColumn();
        if ($inboxId !== false) {
            if ($role === 'guest') {
                $db->prepare('DELETE FROM shared_google_projection_links
                    WHERE user_id = :user AND task_id IN
                    (SELECT id FROM shared_tasks_read WHERE project_id = :project)')
                    ->execute(['project' => $inboxId, 'user' => $targetId]);
                $db->prepare('DELETE FROM shared_project_members WHERE project_id = :project AND user_id = :user')
                    ->execute(['project' => $inboxId, 'user' => $targetId]);
                $db->prepare('UPDATE shared_tasks SET assignee_id = NULL, revision = revision + 1,
                    updated_by = :actor, updated_at = :now WHERE project_id = :project AND assignee_id = :user')
                    ->execute(['actor' => $userId, 'now' => genesisNow(), 'project' => $inboxId, 'user' => $targetId]);
            } else {
                $db->prepare('INSERT INTO shared_project_members (project_id, user_id, role, joined_at)
                    VALUES (:project, :user, :role, :now)
                    ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role')->execute([
                        'project' => $inboxId, 'user' => $targetId,
                        'role' => $role === 'owner' ? 'owner' : 'member', 'now' => genesisNow(),
                    ]);
            }
            genesisSharedAudit((string)$inboxId, $userId, 'space_member.role_changed', $targetId);
        }
        genesisSharedRefreshRestrictedProjectAccess($spaceId,$userId,$targetId);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedRemoveMember(string $userId, string $projectId, string $targetId): void
{
    genesisSharedRequireEnabled($userId);
    $project = genesisSharedProjectAccess($projectId, $userId, $userId === $targetId ? 'read' : 'owner');
    if ((int)$project['is_inbox'] === 1) throw new GenesisSharedAccessException('INBOX_MEMBERSHIP_MANAGED_BY_SPACE', 403);
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, $userId === $targetId ? 'read' : 'owner');
        $query = $db->prepare('SELECT role FROM shared_project_members WHERE project_id = :project AND user_id = :user');
        $query->execute(['project' => $projectId, 'user' => $targetId]);
        $role = $query->fetchColumn();
        if ($role === false) throw new GenesisSharedAccessException();
        if ($role === 'owner') {
            $owners = $db->prepare("SELECT COUNT(*) FROM shared_project_members WHERE project_id = :project AND role = 'owner'");
            $owners->execute(['project' => $projectId]);
            if ((int)$owners->fetchColumn() <= 1) throw new GenesisSharedAccessException('LAST_OWNER', 409);
        }
        $db->prepare('DELETE FROM shared_google_projection_links
            WHERE user_id = :user AND task_id IN
            (SELECT id FROM shared_tasks_read WHERE project_id = :project)')
            ->execute(['project' => $projectId, 'user' => $targetId]);
        $db->prepare('DELETE FROM shared_project_members WHERE project_id = :project AND user_id = :user')
            ->execute(['project' => $projectId, 'user' => $targetId]);
        genesisSharedRevokeInvitationsByMember($targetId, $projectId);
        $db->prepare('UPDATE shared_tasks SET assignee_id = NULL, revision = revision + 1,
            updated_by = :actor, updated_at = :now
            WHERE project_id = :project AND assignee_id = :user')->execute([
                'project' => $projectId, 'user' => $targetId,
                'actor' => $userId, 'now' => genesisNow(),
            ]);
        $space = $db->prepare('SELECT space_id FROM shared_projects WHERE id = :project');
        $space->execute(['project' => $projectId]);
        $spaceId = $space->fetchColumn();
        $otherProjects = $db->prepare('SELECT COUNT(*) FROM shared_project_members m
            JOIN shared_projects p ON p.id = m.project_id
            WHERE p.space_id = :space AND p.is_inbox = 0 AND m.user_id = :user');
        $otherProjects->execute(['space' => $spaceId, 'user' => $targetId]);
        if ((int)$otherProjects->fetchColumn() === 0) {
            $spaceRole = $db->prepare('SELECT role FROM shared_space_members WHERE space_id = :space AND user_id = :user');
            $spaceRole->execute(['space' => $spaceId, 'user' => $targetId]);
            if ($spaceRole->fetchColumn() === 'guest') {
                $db->prepare('DELETE FROM shared_project_members WHERE project_id IN
                    (SELECT id FROM shared_projects WHERE space_id = :space AND is_inbox = 1) AND user_id = :user')
                    ->execute(['space' => $spaceId, 'user' => $targetId]);
                $db->prepare('DELETE FROM shared_space_members WHERE space_id = :space AND user_id = :user')
                    ->execute(['space' => $spaceId, 'user' => $targetId]);
                genesisSharedRevokeInvitationsByMember($targetId, null, (string)$spaceId);
            }
        }
        genesisSharedForgetDirectProjectAccess($projectId,$targetId);
        if($spaceId!==false)genesisSharedRefreshRestrictedProjectAccess((string)$spaceId,$userId,$targetId);
        genesisSharedAudit($projectId, $userId, 'member.removed', $targetId);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function genesisSharedProjectSnapshot(string $userId, string $projectId, array $filter = [], ?string $cursor = null, string $sort = 'position'): array
{
    genesisSharedRequireEnabled($userId);
    $project = genesisSharedProjectAccess($projectId, $userId);
    $db = genesisDb();
    $statuses = $db->prepare('SELECT id, title, position, is_done AS isDone, revision, color, image_url AS imageUrl,
        COALESCE(task_title_lines, CASE WHEN is_done = 1 THEN 2 ELSE 0 END) AS taskTitleLines,
        COALESCE(visible_task_count, CASE WHEN is_done = 1 THEN 5 ELSE 0 END) AS visibleTaskCount FROM shared_project_statuses
        WHERE project_id = :project AND is_chaos=0 ORDER BY position');
    $statuses->execute(['project' => $projectId]);
    $categories = $db->prepare('SELECT id, title, color, position, revision
        FROM shared_project_categories WHERE project_id = :project ORDER BY position');
    $categories->execute(['project' => $projectId]);
    $page = genesisSharedQueryTasks($userId, ['projectIds'=>[$projectId]] + $filter, $cursor, 100, $sort);
    $members = $db->prepare('SELECT m.user_id AS userId, m.role, sm.role AS spaceRole,
        sm.can_organize_tasks AS canOrganizeTasks, sm.permissions_json AS permissionsJson, sm.project_access_restricted AS projectAccessRestricted,
        u.display_name AS displayName FROM shared_project_members m
        JOIN users u ON u.id = m.user_id
        JOIN shared_space_members sm ON sm.space_id = :space AND sm.user_id = m.user_id
        WHERE m.project_id = :project');
    $members->execute(['project' => $projectId, 'space' => $project['space_id']]);
    return [
        'project' => [
            'id' => $projectId, 'spaceId' => $project['space_id'], 'parentId' => $project['parent_id'], 'categoryId' => $project['category_id'],
            'title' => $project['title'], 'description' => $project['description'], 'tags' => json_decode($project['tags_json'], true),
            'labelIds' => genesisSharedLabelIds('project', $projectId),
            'layout' => $project['layout'], 'kind' => $project['kind'], 'boardStatusId' => $project['board_status_id'], 'isInbox' => (int)$project['is_inbox'],
            'revision' => (int)$project['revision'],
            'role' => $project['member_role'], 'spaceRole' => $project['space_member_role'],
            'canOrganizeTasks' => $project['permissions']['organizeTasks'],
            'canCreateBoards' => $project['permissions'][$project['space_permissions_json'] === null ? 'editTasks' : 'manageProjects'],
            'planning'=>genesisPlanningConfig($projectId),
            'workflow'=>genesisWorkflowConfig($projectId),
            'permissions' => $project['permissions'],
            'updatedAt' => $project['updated_at'], 'createdAt' => $project['created_at'], 'createdBy' => $project['created_by'],
        ],
        'statuses' => $statuses->fetchAll(), 'categories' => $categories->fetchAll(),
        'customFieldDefinitions'=>genesisSharedCustomFields($userId,$project['space_id'],$projectId,true),
        'tasks' => $page['tasks'], 'taskPage'=>array_diff_key($page,['tasks'=>true]), 'members' => array_map(static function (array $member): array {
            $member['permissions'] = genesisSharedPermissions($member['spaceRole'], $member['permissionsJson'], (int)$member['canOrganizeTasks'] === 1, $member['role'], (bool)$member['projectAccessRestricted']);
            unset($member['permissionsJson']); return $member;
        }, $members->fetchAll()),
    ];
}

/** Pending grants cannot survive a change in the authority that issued them. */
function genesisSharedRevokeInvitationsByMember(string $userId, ?string $projectId = null, ?string $spaceId = null): void
{
    $values = ['user' => $userId, 'now' => genesisNow()];
    $filter = '';
    if ($projectId !== null) {
        $filter = ' AND project_id = :project';
        $values['project'] = $projectId;
    } elseif ($spaceId !== null) {
        $filter = ' AND project_id IN (SELECT id FROM shared_projects WHERE space_id = :space)';
        $values['space'] = $spaceId;
    }
    genesisDb()->prepare('UPDATE shared_invitations SET revoked_at = :now WHERE created_by = :user
        AND consumed_at IS NULL AND revoked_at IS NULL' . $filter)->execute($values);
    if ($spaceId !== null) {
        genesisDb()->prepare('UPDATE shared_space_invitations SET revoked_at = :now
            WHERE created_by = :user AND space_id = :space AND consumed_at IS NULL AND revoked_at IS NULL')
            ->execute(['now' => $values['now'], 'user' => $userId, 'space' => $spaceId]);
    }
}

function genesisSharedRequireInvitationGrant(string $userId, string $projectId, string $role): void
{
    $project = genesisSharedProjectAccess($projectId, $userId, 'invite');
    $granted = genesisSharedPermissions('guest', null, false, $role);
    foreach ($granted as $permission => $enabled) {
        if ($enabled && !$project['permissions'][$permission]) {
            throw new GenesisSharedAccessException('INVITATION_UNAVAILABLE', 409);
        }
    }
}

function genesisSharedInvite(string $userId, string $projectId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedProjectAccess($projectId, $userId, 'invite');
    $email = mb_strtolower(trim((string)($input['email'] ?? '')));
    if (!genesisIsValidEmail($email)) throw new InvalidArgumentException('INVALID_EMAIL');
    $role = (string)($input['role'] ?? 'member');
    if (!in_array($role, ['manager', 'member', 'commenter', 'viewer'], true)) {
        throw new InvalidArgumentException('INVALID_ROLE');
    }
    genesisSharedRequireInvitationGrant($userId, $projectId, $role);
    $existingMember = genesisDb()->prepare('SELECT 1 FROM shared_project_members m
        JOIN users u ON u.id = m.user_id WHERE m.project_id = :project AND u.email = :email COLLATE NOCASE');
    $existingMember->execute(['project' => $projectId, 'email' => $email]);
    if ($existingMember->fetchColumn()) throw new InvalidArgumentException('ALREADY_PROJECT_MEMBER');
    $recipientQuery = genesisDb()->prepare('SELECT * FROM users WHERE email = :email COLLATE NOCASE LIMIT 1');
    $recipientQuery->execute(['email' => $email]);
    $recipient = $recipientQuery->fetch();
    if (!$recipient) throw new GenesisSharedAccessException('INVITEE_ACCOUNT_NOT_FOUND', 404);
    if (!genesisSharedEligible($recipient)) {
        throw new GenesisSharedAccessException('INVITEE_ACCOUNT_UNSUPPORTED', 403);
    }
    $token = bin2hex(random_bytes(32));
    $id = genesisUuid();
    $now = genesisNow();
    $expires = gmdate('Y-m-d\TH:i:s\Z', time() + 7 * 86400);
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedRequireInvitationGrant($userId, $projectId, $role);
        $db->prepare('UPDATE shared_invitations SET revoked_at = :now
            WHERE project_id = :project AND email = :email COLLATE NOCASE
            AND consumed_at IS NULL AND revoked_at IS NULL')->execute([
                'now' => $now, 'project' => $projectId, 'email' => $email,
            ]);
        $db->prepare('INSERT INTO shared_invitations (id, project_id, email, role, token_hash,
            expires_at, created_by, created_at) VALUES (:id, :project, :email, :role, :hash,
            :expires, :user, :now)')->execute([
                'id' => $id, 'project' => $projectId, 'email' => $email, 'role' => $role,
                'hash' => hash('sha256', $token), 'expires' => $expires, 'user' => $userId, 'now' => $now,
            ]);
        genesisSharedAudit($projectId, $userId, 'invitation.created', $id);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    return ['id' => $id, 'expiresAt' => $expires];
}

function genesisSharedInvitations(string $userId): array
{
    $user = genesisSharedRequireEligible($userId);
    $query = genesisDb()->prepare('SELECT i.id, i.role, i.expires_at AS expiresAt,
        p.title AS projectTitle, s.title AS spaceTitle,
        COALESCE(NULLIF(inviter.display_name, \'\'), inviter.email, \'Участник GENESIS\') AS inviterName
        FROM shared_invitations i
        JOIN shared_projects p ON p.id = i.project_id AND p.archived_at IS NULL
        JOIN shared_spaces s ON s.id = p.space_id
        LEFT JOIN users inviter ON inviter.id = i.created_by
        WHERE i.email = :email COLLATE NOCASE AND i.consumed_at IS NULL
        AND i.revoked_at IS NULL AND i.expires_at > :now
        ORDER BY i.created_at DESC LIMIT 100');
    $query->execute(['email' => $user['email'], 'now' => genesisNow()]);
    return $query->fetchAll();
}

function genesisSharedCalendarTasks(string $userId, string $from, string $to): array
{
    genesisSharedRequireEnabled($userId);
    $start = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
    $end = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
    if (!$start || !$end || $start->format('Y-m-d') !== $from || $end->format('Y-m-d') !== $to
        || $end < $start || $start->diff($end)->days > 1200) {
        throw new InvalidArgumentException('INVALID_SHARED_CALENDAR_RANGE');
    }
    // Internal legacy adapter; HTTP clients use the bounded page contract directly.
    $tasks=[];$cursor=null;
    do {$page=genesisSharedQueryTasks($userId,['dueFrom'=>$from,'dueTo'=>$to,'completion'=>'open'],$cursor);array_push($tasks,...$page['tasks']);$cursor=$page['nextCursor'];}while($cursor!==null);
    return $tasks;
}

/** Team activity is visible only while the user retains membership in each project. */
function genesisSharedNotifications(string $userId): array
{
    $items=genesisNotificationInbox($userId,'',false,100)['notifications'];
    return array_map(static function($item){if($item['kind']==='mentions')$item['action']='comment.mentioned';elseif(in_array($item['kind'],['dueSoon','overdue','approvalRequest','approvalResult'],true))$item['action']='task.updated';return$item;},$items);
}

function genesisSharedReadNotifications(string $userId, array $input): void
{
    genesisNotificationRead($userId,$input);
}

function genesisSharedAcceptInvite(string $userId, array $input): array
{
    $user = genesisSharedRequireEligible($userId);
    $id = (string)($input['id'] ?? '');
    if (!preg_match('/\A[a-f0-9-]{36}\z/', $id)) throw new InvalidArgumentException('INVALID_INVITATION');
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        $query = $db->prepare('SELECT i.*, p.space_id FROM shared_invitations i
            JOIN shared_projects p ON p.id = i.project_id
            WHERE i.id = :id AND i.consumed_at IS NULL AND i.revoked_at IS NULL
            AND i.expires_at > :now AND p.archived_at IS NULL LIMIT 1');
        $now = genesisNow();
        $query->execute(['id' => $id, 'now' => $now]);
        $invite = $query->fetch();
        if (!$invite || !hash_equals(mb_strtolower((string)$invite['email']), mb_strtolower((string)$user['email']))) {
            throw new GenesisSharedAccessException('INVALID_INVITATION');
        }
        genesisSharedRequireInvitationGrant((string)$invite['created_by'], (string)$invite['project_id'], (string)$invite['role']);
        $db->prepare('UPDATE users SET shared_projects_enabled = 1, updated_at = :now WHERE id = :user')
            ->execute(['now' => $now, 'user' => $userId]);
        $db->prepare("INSERT OR IGNORE INTO shared_space_members (space_id, user_id, role, joined_at)
            VALUES (:space, :user, 'guest', :now)")->execute([
                'space' => $invite['space_id'], 'user' => $userId, 'now' => $now,
            ]);
        $db->prepare('INSERT OR IGNORE INTO shared_project_members (project_id, user_id, role, joined_at)
            VALUES (:project, :user, :role, :now)')->execute([
                'project' => $invite['project_id'], 'user' => $userId,
                'role' => $invite['role'], 'now' => $now,
            ]);
        genesisSharedRememberDirectProjectAccess((string)$invite['project_id'],$userId,(string)$invite['role']);
        $spaceRole = $db->prepare('SELECT role FROM shared_space_members WHERE space_id = :space AND user_id = :user');
        $spaceRole->execute(['space' => $invite['space_id'], 'user' => $userId]);
        if ($spaceRole->fetchColumn() !== 'guest') {
            $inbox = $db->prepare('SELECT id FROM shared_projects WHERE space_id = :space AND is_inbox = 1');
            $inbox->execute(['space' => $invite['space_id']]);
            $inboxId = $inbox->fetchColumn();
            if ($inboxId !== false) {
            $db->prepare("INSERT OR IGNORE INTO shared_project_members (project_id, user_id, role, joined_at)
                VALUES (:project, :user, 'member', :now)")->execute([
                    'project' => $inboxId, 'user' => $userId, 'now' => $now,
                ]);
            }
        }
        $db->prepare('UPDATE shared_invitations SET consumed_at = :now WHERE id = :id
            AND consumed_at IS NULL')->execute(['now' => $now, 'id' => $invite['id']]);
        genesisSharedRefreshRestrictedProjectAccess((string)$invite['space_id'],$userId,$userId);
        genesisSharedAudit((string)$invite['project_id'], $userId, 'invitation.accepted', (string)$invite['id']);
        $db->commit();
        return ['projectId' => $invite['project_id'], 'spaceId' => $invite['space_id']];
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

/** Move one server-owned task within its workspace, including to or from its inbox. */
function genesisSharedMoveTask(string $userId, string $sourceProjectId, string $taskId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    $requestId = genesisSharedRequestId($input);
    $destinationId = (string)($input['destinationProjectId'] ?? $sourceProjectId);
    $statusId = (string)($input['statusId'] ?? '');
    $expected = $input['expectedRevision'] ?? null;
    $position = $input['position'] ?? null;
    if (!is_int($expected) || $expected < 1 || !is_int($position) || $position < 0) {
        throw new InvalidArgumentException('INVALID_TASK_MOVE');
    }
    $db = genesisDb();
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) genesisBeginWriteTransaction($db);
    try {
        $source = genesisSharedProjectAccess($sourceProjectId, $userId, 'organize');
        $destination = genesisSharedProjectAccess($destinationId, $userId, 'organize');
        if ($source['space_id'] !== $destination['space_id']) {
            throw new GenesisSharedAccessException('SHARED_CROSS_SPACE_MOVE_FORBIDDEN', 403);
        }
        $payloadHash = genesisSharedMutationPayloadHash('task.move',$input,['projectId'=>$sourceProjectId]);
        $receipt = genesisSharedMutationReceipt($db, $userId, $requestId, 'task.move', $taskId, $payloadHash);
        if ($receipt !== null) {
            if ($ownsTransaction) $db->commit();
            return $receipt;
        }
        genesisSharedRequireTaskProject($destination);
        $query = $db->prepare('SELECT * FROM shared_tasks_read WHERE id = :id AND project_id = :project');
        $query->execute(['id' => $taskId, 'project' => $sourceProjectId]);
        $task = $query->fetch();
        if (!$task) throw new GenesisSharedAccessException();
        if ((int)$task['revision'] !== $expected) {
            throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT', 409);
        }
        if ($statusId === '') $statusId = genesisSharedProjectInboxStatus($db,$destinationId,$task['completed_at'] !== null);
        $query = $db->prepare('SELECT is_done FROM shared_project_statuses
            WHERE id = :status AND project_id = :project');
        $query->execute(['status' => $statusId, 'project' => $destinationId]);
        $isDone = $query->fetchColumn();
        if ($isDone === false) throw new InvalidArgumentException('INVALID_STATUS');
        $dueDate = array_key_exists('dueDate', $input) ? $input['dueDate'] : $task['due_date'];
        if ($dueDate !== null && (!is_string($dueDate) || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $dueDate) || !checkdate((int)substr($dueDate, 5, 2), (int)substr($dueDate, 8, 2), (int)substr($dueDate, 0, 4)))) throw new InvalidArgumentException('INVALID_DUE_DATE');
        $schedule = genesisSharedSchedule($input, $task, $dueDate);
        $now = genesisNow();
        $changedProject = $sourceProjectId !== $destinationId;
        $done = (int)$isDone === 1;
        $assignee = $task['assignee_id'];
        if (!$done && $task['parent_task_id'] !== null) {
            $parent=$db->prepare('SELECT completed_at FROM shared_tasks_history_read WHERE id=?');$parent->execute([$task['parent_task_id']]);
            if ($parent->fetchColumn()) throw new GenesisSharedAccessException('TASK_PARENT_COMPLETED',409);
        }
        if ($changedProject) {
            genesisSharedCustomFieldsRequireMove([$task],$destinationId);
            $children=$db->prepare('SELECT COUNT(*) FROM shared_tasks WHERE parent_task_id=?');$children->execute([$taskId]);
            if ($task['parent_task_id'] !== null || (int)$children->fetchColumn()>0) throw new GenesisSharedAccessException('TASK_MOVE_RELATIONS',409);
            $lists=json_decode($task['checklists_json'],true);
            foreach($lists as &$list) foreach($list['items'] as &$item) if($item['assigneeId']) {
                $member=$db->prepare('SELECT 1 FROM shared_project_members WHERE project_id=? AND user_id=?');$member->execute([$destinationId,$item['assigneeId']]);
                if(!$member->fetchColumn()) $item['assigneeId']=null;
            }
            unset($list,$item);
            $db->prepare('UPDATE shared_tasks SET checklists_json=? WHERE id=?')->execute([json_encode($lists,JSON_THROW_ON_ERROR),$taskId]);
        }
        if ($changedProject && $assignee !== null) {
            $query = $db->prepare('SELECT 1 FROM shared_project_members
                WHERE project_id = :project AND user_id = :user');
            $query->execute(['project' => $destinationId, 'user' => $assignee]);
            if (!$query->fetchColumn()) $assignee = null;
        }
        $done = (int)$isDone === 1;
        if ($done) { genesisSharedRequireTaskChildrenComplete($taskId); genesisSharedRequireTaskApproval($taskId); }
        elseif ($task['completed_at'] !== null) genesisSharedResetTaskApprovals($taskId);
        if($changedProject||$done&&$task['completed_at']===null)genesisSharedCustomTaskInput($userId,$destination,$taskId,[],true);
        if ($changedProject) {
            $missing = $db->prepare('SELECT COUNT(*) FROM shared_task_approvals a WHERE a.task_id = :task AND a.approved_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM shared_project_members m JOIN shared_projects p ON p.id = m.project_id
                JOIN shared_space_members sm ON sm.space_id = p.space_id AND sm.user_id = m.user_id
                WHERE m.project_id = :project AND m.user_id = a.user_id)');
            $missing->execute(['task' => $taskId, 'project' => $destinationId]);
            if ((int)$missing->fetchColumn()) throw new GenesisSharedAccessException('В новом проекте должны быть все участники, подтверждающие выполнение.', 409);
        }
        $completedBy = $done ? ($task['completed_by'] ?? $userId) : null;
        $completedAt = $done ? ($task['completed_at'] ?? $now) : null;
        $update = $db->prepare('UPDATE shared_tasks SET project_id = :project, status_id = :status,
            category_id = :category, assignee_id = :assignee, completed_by = :completed_by,
            completed_at = :completed_at, due_date = :due, start_date = :start_date, start_time = :start_time, end_time = :end_time, updated_by = :actor, updated_at = :now,
            revision = revision + 1 WHERE id = :id AND project_id = :source AND revision = :expected');
        $update->execute(['project' => $destinationId, 'status' => $statusId,
                'category' => $changedProject ? null : $task['category_id'], 'assignee' => $assignee,
                'completed_by' => $completedBy, 'completed_at' => $completedAt, 'due' => $dueDate, 'start_date' => $schedule['startDate'], 'start_time' => $schedule['startTime'], 'end_time' => $schedule['endTime'],
                'actor' => $userId, 'now' => $now, 'id' => $taskId,
                'source' => $sourceProjectId, 'expected' => $expected]);
        if ($update->rowCount() !== 1) throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT', 409);
        if ($changedProject) {
            genesisSharedDetachDependencies($sourceProjectId, $taskId, $userId);
            $links = $db->prepare('SELECT l.user_id, l.destination, l.google_id,
                COALESCE(l.google_list_id, source_pref.google_task_list_id) AS source_list_id,
                destination_member.user_id AS destination_member_id,
                destination_pref.tasks_enabled, destination_pref.calendar_enabled
                FROM shared_google_projection_links l
                LEFT JOIN shared_google_preferences source_pref ON source_pref.project_id = :source
                    AND source_pref.user_id = l.user_id
                LEFT JOIN shared_project_members destination_member
                    ON destination_member.project_id = :destination AND destination_member.user_id = l.user_id
                LEFT JOIN shared_google_preferences destination_pref
                    ON destination_pref.project_id = :destination_pref AND destination_pref.user_id = l.user_id
                WHERE l.task_id = :task');
            $links->execute(['source' => $sourceProjectId, 'destination' => $destinationId,
                'destination_pref' => $destinationId, 'task' => $taskId]);
            $setList = $db->prepare('UPDATE shared_google_projection_links SET google_list_id = :list
                WHERE task_id = :task AND user_id = :user AND destination = \'tasks\'');
            $queue = $db->prepare('INSERT INTO shared_google_projection_cleanup
                (id, user_id, destination, google_id, google_list_id, created_at)
                VALUES (:id, :user, :destination, :google, :list, :now)');
            $deleteLink = $db->prepare('DELETE FROM shared_google_projection_links
                WHERE task_id = :task AND user_id = :user AND destination = :destination');
            foreach ($links->fetchAll() as $link) {
                $destinationConsent = $link['destination'] === 'tasks'
                    ? !empty($link['tasks_enabled']) : !empty($link['calendar_enabled']);
                if ($link['destination_member_id'] !== null && $destinationConsent) {
                    if ($link['destination'] === 'tasks') $setList->execute([
                        'list' => $link['source_list_id'], 'task' => $taskId, 'user' => $link['user_id'],
                    ]);
                    continue;
                }
                if ($link['google_id'] !== '') $queue->execute([
                    'id' => genesisUuid(), 'user' => $link['user_id'], 'destination' => $link['destination'],
                    'google' => $link['google_id'], 'list' => $link['source_list_id'], 'now' => $now,
                ]);
                $deleteLink->execute(['task' => $taskId, 'user' => $link['user_id'],
                    'destination' => $link['destination']]);
            }
        }
        $query = $db->prepare('SELECT id FROM shared_tasks_read WHERE project_id = :project
            AND status_id = :status AND id <> :task ORDER BY position, created_at, id');
        $query->execute(['project' => $destinationId, 'status' => $statusId, 'task' => $taskId]);
        $ordered = $query->fetchAll(PDO::FETCH_COLUMN);
        array_splice($ordered, min($position, count($ordered)), 0, [$taskId]);
        $reposition = $db->prepare('UPDATE shared_tasks SET position = :position WHERE id = :id');
        foreach ($ordered as $index => $id) $reposition->execute(['position' => $index, 'id' => $id]);
        genesisWorkflowTask($userId,$destinationId,$taskId,$task);
        $moveDetails = ['taskId' => $taskId, 'objectTitle' => $task['title'], 'destinationBoardId' => $statusId,
            'reportBefore' => ['statusId' => $task['status_id'], 'completed' => $task['completed_at'] !== null],
            'changes' => genesisSharedChanges(
                ['statusId' => $task['status_id'], 'projectId' => $sourceProjectId, 'isDone' => $task['completed_at'] !== null,
                    'dueDate' => $task['due_date'], 'startDate' => $task['start_date'], 'startTime' => $task['start_time'], 'endTime' => $task['end_time']],
                ['statusId' => $statusId, 'projectId' => $destinationId, 'isDone' => $done, 'dueDate' => $dueDate] + $schedule)];
        genesisSharedAudit($sourceProjectId, $userId, $changedProject ? 'task.moved_out' : 'task.updated', $taskId,
            $moveDetails + ['boardId' => $changedProject ? $task['status_id'] : $statusId]);
        if ($changedProject) genesisSharedAudit($destinationId, $userId, 'task.moved_in', $taskId, $moveDetails + ['boardId' => $statusId]);
        $response = ['id' => $taskId, 'projectId' => $destinationId, 'statusId' => $statusId,
            'position' => min($position, count($ordered) - 1), 'revision' => $expected + 1,
            'assigneeId' => $assignee, 'categoryId' => $changedProject ? null : $task['category_id'],
            'dueDate' => $dueDate, 'startDate' => $schedule['startDate'], 'startTime' => $schedule['startTime'], 'endTime' => $schedule['endTime'], 'completedAt' => $completedAt, 'completedBy' => $completedBy,
            'labelIds' => genesisSharedLabelIds('task', $taskId), 'dependsOnIds' => genesisSharedDependencyIds($taskId)];
        $response['entryType'] = $task['entry_type'];
        $response['approvals'] = genesisSharedTaskApprovals($taskId);
        $response['approvalRequired'] = count($response['approvals']) > 0;
        genesisSharedSaveMutationReceipt($db, $userId, $requestId, 'task.move', $taskId, $response, $payloadHash);
        if ($ownsTransaction) $db->commit();
        return $response;
    } catch (Throwable $error) {
        if ($ownsTransaction && $db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function genesisSharedRejectInvite(string $userId, string $id): void
{
    $user = genesisSharedRequireEligible($userId);
    $query = genesisDb()->prepare('SELECT i.project_id FROM shared_invitations i
        WHERE i.id = :id AND i.email = :email COLLATE NOCASE AND i.consumed_at IS NULL
        AND i.revoked_at IS NULL AND i.expires_at > :now');
    $query->execute(['id' => $id, 'email' => $user['email'], 'now' => genesisNow()]);
    $projectId = $query->fetchColumn();
    if ($projectId === false) throw new GenesisSharedAccessException('INVALID_INVITATION');
    genesisDb()->prepare('UPDATE shared_invitations SET revoked_at = :now WHERE id = :id AND revoked_at IS NULL')
        ->execute(['now' => genesisNow(), 'id' => $id]);
    genesisSharedAudit((string)$projectId, $userId, 'invitation.rejected', $id);
}

/** Legacy callers use the same recoverable delete contract as the HTTP endpoint. */
function genesisSharedDeleteTask(string $userId, string $projectId, string $taskId, array $input): array
{
    return genesisSharedTrashTask($userId,$projectId,$taskId,$input);
}

function genesisSharedTask(string $userId, string $projectId, array $input, ?string $taskId = null): array
{
    genesisSharedRequireEnabled($userId);
    $requestId = genesisSharedRequestId($input);
    $action = $taskId === null ? 'task.create' : 'task.update';
    $resourceId = $taskId ?? $projectId;
    $db = genesisDb();
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) genesisBeginWriteTransaction($db);
    try {
        $project = genesisSharedProjectAccess($projectId, $userId, 'write');
        $payloadHash = genesisSharedMutationPayloadHash($action,$input,['projectId'=>$projectId]);
        $receipt = genesisSharedMutationReceipt($db, $userId, $requestId, $action, $resourceId, $payloadHash);
        if ($receipt !== null) {
            if ($ownsTransaction) $db->commit();
            return $receipt;
        }
        genesisSharedRequireTaskProject($project);
        if ($taskId === null && isset($input['mindmapSource'])) {
            if (!is_array($input['mindmapSource'])) throw new InvalidArgumentException('INVALID_MINDMAP');
            $converted = genesisSharedMindmapConversion($userId, $project, $input['mindmapSource']);
            if ($converted !== null) {
                genesisSharedSaveMutationReceipt($db,$userId,$requestId,$action,$resourceId,$converted,$payloadHash);
                if ($ownsTransaction) $db->commit(); return $converted;
            }
        }
        $sourceTaskId = null;
        if ($taskId === null && array_key_exists('sourceTaskId', $input)) {
            if (!is_string($input['sourceTaskId']) || !preg_match('/\A[^\x00-\x1f]{1,100}\z/u', $input['sourceTaskId'])) {
                throw new InvalidArgumentException('INVALID_SOURCE_TASK_ID');
            }
            $sourceTaskId = $input['sourceTaskId'];
            $transfer = $db->prepare('SELECT target_project_id, target_task_id FROM shared_task_transfers
                WHERE source_user_id = :user AND source_task_id = :source LIMIT 1');
            $transfer->execute(['user' => $userId, 'source' => $sourceTaskId]);
            $target = $transfer->fetch();
            if ($target) {
                if ($target['target_project_id'] !== $projectId) {
                    throw new GenesisSharedAccessException('SHARED_TRANSFER_CONFLICT', 409);
                }
                $query = $db->prepare('SELECT id, project_id AS projectId, status_id AS statusId,
                    category_id AS categoryId, title, description, tags_json AS tagsJson, due_date AS dueDate,
                    assignee_id AS assigneeId, revision, completed_by AS completedBy,
                    completed_at AS completedAt, updated_at AS updatedAt
                    FROM shared_tasks_read WHERE id = :id AND project_id = :project LIMIT 1');
                $query->execute(['id' => $target['target_task_id'], 'project' => $projectId]);
                $copied = $query->fetch();
                if (!$copied) throw new GenesisSharedAccessException('SHARED_TRANSFER_TARGET_REMOVED', 409);
                genesisSharedSaveMutationReceipt($db,$userId,$requestId,$action,$resourceId,$copied,$payloadHash);
                if ($ownsTransaction) $db->commit();
                return $copied;
            }
        }
        $existing = null;
        if ($taskId !== null) {
            $query = $db->prepare('SELECT * FROM shared_tasks_read WHERE id = :id AND project_id = :project LIMIT 1');
            $query->execute(['id' => $taskId, 'project' => $projectId]);
            $existing = $query->fetch();
            if (!$existing) throw new GenesisSharedAccessException();
            if (!isset($input['expectedRevision']) || (int)$input['expectedRevision'] !== (int)$existing['revision']) {
                throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT', 409);
            }
        }
        $title = array_key_exists('title', $input) ? genesisSharedTitle($input['title']) : ($existing['title'] ?? null);
        if ($title === null) throw new InvalidArgumentException('TITLE_REQUIRED');
        $description = array_key_exists('description', $input)
            ? genesisSharedText($input['description'], 20000) : ($existing['description'] ?? '');
        $entryType = genesisEntryType($input['entryType'] ?? $existing['entry_type'] ?? 'task');
        if ($entryType === 'birthday') throw new InvalidArgumentException('День рождения доступен только в личных делах.');
        $tags = array_key_exists('tags', $input) ? genesisSharedTags($input['tags']) : json_decode($existing['tags_json'] ?? '[]', true);
        $statusId = (string)($input['statusId'] ?? $existing['status_id'] ?? '');
        if ($statusId === '') $statusId = genesisSharedProjectInboxStatus($db,$projectId,$existing !== null && $existing['completed_at'] !== null);
        if ($existing && $statusId !== $existing['status_id']) {
            genesisSharedProjectAccess($projectId, $userId, 'organize');
        }
        $status = $db->prepare('SELECT 1 FROM shared_project_statuses WHERE id = :id AND project_id = :project');
        $status->execute(['id' => $statusId, 'project' => $projectId]);
        if (!$status->fetchColumn()) throw new InvalidArgumentException('INVALID_STATUS');
        $doneStatus = $db->prepare('SELECT is_done FROM shared_project_statuses WHERE id = :id');
        $doneStatus->execute(['id' => $statusId]);
        $isDone = (int)$doneStatus->fetchColumn() === 1;
        $assigneeId = array_key_exists('assigneeId', $input) ? $input['assigneeId'] : ($existing['assignee_id'] ?? null);
        if ($assigneeId !== null) {
            $member = $db->prepare('SELECT 1 FROM shared_project_members WHERE project_id = :project AND user_id = :user');
            $member->execute(['project' => $projectId, 'user' => $assigneeId]);
            if (!$member->fetchColumn()) throw new InvalidArgumentException('INVALID_ASSIGNEE');
        }
        $categoryId = array_key_exists('categoryId', $input) ? $input['categoryId'] : ($existing['category_id'] ?? null);
        if ($categoryId !== null) {
            if (!is_string($categoryId)) throw new InvalidArgumentException('INVALID_CATEGORY');
            $category = $db->prepare('SELECT 1 FROM shared_project_categories WHERE id = :id AND project_id = :project');
            $category->execute(['id' => $categoryId, 'project' => $projectId]);
            if (!$category->fetchColumn()) throw new InvalidArgumentException('INVALID_CATEGORY');
        }
        $dueDate = array_key_exists('dueDate', $input) ? $input['dueDate'] : ($existing['due_date'] ?? null);
        if ($dueDate !== null && (!is_string($dueDate) || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $dueDate)
            || !checkdate((int)substr($dueDate, 5, 2), (int)substr($dueDate, 8, 2), (int)substr($dueDate, 0, 4)))) {
            throw new InvalidArgumentException('INVALID_DUE_DATE');
        }
        $now = genesisNow();
        $id = $taskId ?? genesisUuid();
        $schedule = genesisSharedSchedule($input, $existing, $dueDate);
        $details = genesisSharedTaskDetailsInput($projectId, $id, $input, $existing, $isDone);
        $custom=genesisSharedCustomTaskInput($userId,$project,$id,$input,$existing===null,$isDone&&(!$existing||$existing['completed_at']===null));
        $planning=genesisPlanningTaskInput($userId,$project,$id,$input,$existing===null);
        $oldDependencies = genesisSharedDependencyIds($id);
        $completedBy = $isDone ? ($existing['completed_by'] ?? $userId) : null;
        $completedAt = $isDone ? ($existing['completed_at'] ?? $now) : null;
        if ($isDone && $existing) genesisSharedRequireTaskApproval($id);
        elseif ($existing && $existing['completed_at'] !== null) genesisSharedResetTaskApprovals($id);
        if ($existing) {
            $changed = $db->prepare('UPDATE shared_tasks SET title = :title, description = :description, tags_json = :tags,
                status_id = :status, category_id = :category, assignee_id = :assignee, due_date = :due,
                completed_by = :completed_by, completed_at = :completed_at,
                updated_by = :user, updated_at = :now, revision = revision + 1
                WHERE id = :id AND project_id = :project AND revision = :expected');
            $changed->execute([
                    'title' => $title, 'description' => $description, 'tags' => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'status' => $statusId,
                    'category' => $categoryId, 'assignee' => $assigneeId, 'due' => $dueDate, 'user' => $userId,
                    'completed_by' => $completedBy, 'completed_at' => $completedAt,
                    'now' => $now, 'id' => $id, 'project' => $projectId,
                    'expected' => (int)$existing['revision'],
                ]);
            if ($changed->rowCount() !== 1) throw new GenesisSharedAccessException('SHARED_TASK_CONFLICT', 409);
        } else {
            $db->prepare('INSERT INTO shared_tasks (id, project_id, status_id, category_id, title, description, tags_json,
                due_date, assignee_id, created_by, updated_by, completed_by, completed_at,
                created_at, updated_at)
                VALUES (:id, :project, :status, :category, :title, :description, :tags, :due, :assignee,
                :user, :user, :completed_by, :completed_at, :now, :now)')->execute([
                    'id' => $id, 'project' => $projectId, 'status' => $statusId,
                    'category' => $categoryId, 'title' => $title, 'description' => $description, 'tags' => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'due' => $dueDate,
                    'assignee' => $assigneeId, 'user' => $userId,
                    'completed_by' => $completedBy, 'completed_at' => $completedAt, 'now' => $now,
                ]);
            if ($sourceTaskId !== null) {
                $db->prepare('INSERT INTO shared_task_transfers
                    (source_user_id, source_task_id, target_project_id, target_task_id, created_at)
                    VALUES (:user, :source, :project, :task, :now)')->execute([
                    'user' => $userId, 'source' => $sourceTaskId,
                    'project' => $projectId, 'task' => $id, 'now' => $now,
                ]);
            }
        }
        genesisSharedTaskDetailsSave($id, $details);
        genesisSharedSaveCustomTaskValues($id,$custom['values']);
        if($planning['old']!==$planning['values'])genesisPlanningSaveTask($id,$planning['values']);
        if (array_key_exists('imageData', $input)) genesisSharedSaveTaskImage($id, $input['imageData']);
        if (array_key_exists('attachments', $input) || array_key_exists('removeAttachmentIds', $input)) {
            genesisSharedSaveTaskAttachments($id, $input);
        }
        $oldLabels = genesisSharedLabelIds('task', $id);
        $db->prepare('UPDATE shared_tasks SET entry_type = :entry, start_date = :start, start_time = :start_time, end_time = :end_time WHERE id = :id')->execute([
            'id' => $id, 'entry' => $entryType, 'start' => $schedule['startDate'], 'start_time' => $schedule['startTime'], 'end_time' => $schedule['endTime']]);
        $dependsOnIds = genesisSharedAssignDependencies($projectId, $id, $input);
        $labelIds = genesisSharedAssignLabels($project['space_id'], 'task', $id, $input);
        genesisWorkflowTask($userId,$projectId,$id,$existing);
        $taskChanges = genesisSharedChanges(
            ['entryType' => $existing['entry_type'] ?? 'task', 'title' => $existing['title'] ?? null, 'description' => $existing['description'] ?? null, 'tags' => isset($existing['tags_json']) ? json_decode($existing['tags_json'], true) : [],
             'dueDate' => $existing['due_date'] ?? null, 'statusId' => $existing['status_id'] ?? null, 'categoryId' => $existing['category_id'] ?? null, 'assigneeId' => $existing['assignee_id'] ?? null, 'labelIds' => $oldLabels,
             'startDate' => $existing['start_date'] ?? null, 'startTime' => $existing['start_time'] ?? null, 'endTime' => $existing['end_time'] ?? null, 'dependsOnIds' => $oldDependencies, 'priority'=>(int)($existing['priority']??0), 'parentTaskId'=>$existing['parent_task_id']??null, 'checklists'=>json_decode($existing['checklists_json']??'[]',true)],
            compact('entryType', 'title', 'description', 'tags', 'dueDate', 'statusId', 'categoryId', 'assigneeId', 'labelIds', 'dependsOnIds') + $schedule + ['priority'=>$details['priority'],'parentTaskId'=>$details['parentId'],'checklists'=>$details['checklists']]);
        $taskChanges+=genesisSharedChanges($planning['old'],$planning['values']);
        if($custom['old']!==$custom['values']){
            $from=[];$to=[];foreach(array_unique(array_merge(array_keys($custom['old']),array_keys($custom['values']))) as $fieldId){
                $before=$custom['old'][$fieldId]??null;$after=$custom['values'][$fieldId]??null;
                if($before!==$after){$from[$fieldId]=$before;$to[$fieldId]=$after;}
            }
            $taskChanges['customFields']=['from'=>$from,'to'=>$to];
        }
        if (!$existing || $taskChanges || !empty($input['attachments']) || !empty($input['removeAttachmentIds']) || array_key_exists('imageData', $input)) {
            genesisSharedAudit($projectId, $userId, $existing ? 'task.updated' : 'task.created', $id, ['changes' => $taskChanges,'reportBefore'=>$existing===null?null:['statusId'=>$existing['status_id'],'completed'=>$existing['completed_at']!==null]]);
        } else {
            // This accepted write still advances revision/updated_at; keep an observation without change notifications.
            genesisSharedAudit($projectId,$userId,'task.observed',$id,['reportBefore'=>['statusId'=>$existing['status_id'],'completed'=>$existing['completed_at']!==null]]);
        }
        $response = ['id' => $id, 'projectId' => $projectId, 'statusId' => $statusId,
            'title' => $title, 'description' => $description, 'tags' => $tags, 'dueDate' => $dueDate,
            'assigneeId' => $assigneeId, 'categoryId' => $categoryId, 'labelIds' => $labelIds,
            'revision' => $existing ? (int)$existing['revision'] + 1 : 1,
            'completedBy' => $completedBy, 'completedAt' => $completedAt,
            'updatedAt' => $now, 'dependsOnIds' => $dependsOnIds] + $schedule;
        $image = $db->prepare('SELECT 1 FROM shared_task_images WHERE task_id = :id');
        $image->execute(['id' => $id]);
        $response['imageUrl'] = genesisSharedTaskImageUrl($id, (bool)$image->fetchColumn());
        $response['attachments'] = genesisSharedTaskAttachments($id);
        $response['entryType'] = $entryType;
        genesisSharedConfigureTaskApprovals($userId, $projectId, $id, $input, $existing, $isDone);
        $response['approvals'] = genesisSharedTaskApprovals($id);
        $response['approvalRequired'] = count($response['approvals']) > 0;
        if ($taskId === null && isset($input['mindmapSource'])) {
            $source=$input['mindmapSource'];
            $db->prepare('INSERT INTO shared_mindmap_conversions VALUES(?,?,?,?,?)')->execute([$project['space_id'],$source['mapId'],$source['nodeId'],$projectId,$id]);
        }
        $response = genesisSharedGetTask($userId, $projectId, $id);
        genesisSharedSaveMutationReceipt($db, $userId, $requestId, $action, $resourceId, $response, $payloadHash);
        if ($ownsTransaction) $db->commit();
        return $response;
    } catch (Throwable $error) {
        if ($ownsTransaction && $db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function genesisSharedComments(string $userId, string $projectId, string $taskId): array
{
    return genesisSharedCommentPage($userId, $projectId, $taskId)['comments'];
}

/** Newest window, chronological within each page; older pages never shift on new arrivals. */
function genesisSharedCommentPage(string $userId, string $projectId, string $taskId, mixed $before = null): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedProjectAccess($projectId, $userId);
    $owner = genesisDb()->prepare('SELECT 1 FROM shared_tasks_history_read WHERE id = ? AND project_id = ?');
    $owner->execute([$taskId, $projectId]);
    if ($owner->fetchColumn() === false) throw new GenesisSharedAccessException('TASK_NOT_FOUND', 404);
    $values = ['task' => $taskId, 'project' => $projectId];
    $boundary = '';
    if ($before !== null) {
        if (!is_string($before) || !preg_match('/\A[a-f0-9-]{36}\z/', $before)) throw new InvalidArgumentException('INVALID_COMMENT_CURSOR');
        $cursor = genesisDb()->prepare('SELECT created_at FROM shared_comments_read WHERE id = ? AND task_id = ?');
        $cursor->execute([$before, $taskId]);
        $created = $cursor->fetchColumn();
        if ($created === false) throw new InvalidArgumentException('INVALID_COMMENT_CURSOR');
        $boundary = ' AND (c.created_at < :beforeTime OR (c.created_at = :beforeTime AND c.id < :beforeId))';
        $values += ['beforeTime' => $created, 'beforeId' => $before];
    }
    $query = genesisDb()->prepare('SELECT c.id, c.body, c.created_at AS createdAt,
        (SELECT GROUP_CONCAT(user_id) FROM shared_comment_mentions WHERE comment_id = c.id) AS mentionIdsCsv,
        c.author_id AS authorId, COALESCE(u.display_name, \'Удалённый участник\') AS authorName
        FROM shared_comments_read c JOIN shared_tasks_history_read t ON t.id = c.task_id
        LEFT JOIN users u ON u.id = c.author_id
        WHERE t.id = :task AND t.project_id = :project' . $boundary . ' ORDER BY c.created_at DESC, c.id DESC LIMIT 201');
    $query->execute($values);
    $rows = $query->fetchAll();
    $hasMore = count($rows) > 200;
    $comments = array_reverse(array_map(static function ($row) { $row['mentionIds'] = $row['mentionIdsCsv'] ? explode(',', $row['mentionIdsCsv']) : [];
        unset($row['mentionIdsCsv']); return genesisDataCommentProvenance($row); }, array_slice($rows, 0, 200)));
    return ['comments' => $comments, 'hasMore' => $hasMore, 'nextBefore' => $hasMore ? $comments[0]['id'] : null];
}

function genesisSharedProjectComments(string $userId,string $projectId,?array $input=null,?string $boardId=null): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedProjectAccess($projectId,$userId,$input===null ? 'read' : 'comment');
    $db=genesisDb();
    $boardId=$input['boardId']??$boardId;
    if($boardId!==null){if(!is_string($boardId))throw new InvalidArgumentException('INVALID_BOARD');$q=$db->prepare('SELECT 1 FROM shared_project_statuses WHERE id=? AND project_id=? AND is_chaos=0');$q->execute([$boardId,$projectId]);if(!$q->fetchColumn())throw new GenesisSharedAccessException('BOARD_NOT_FOUND');}
    if($input!==null){
        $body=genesisSharedText($input['body']??'',5000);if($body==='')throw new InvalidArgumentException('TITLE_REQUIRED');
        $ids=$input['mentionIds']??[];
        if(!is_array($ids)||!array_is_list($ids)||count($ids)>20||array_filter($ids,static fn($id)=>!is_string($id)||strlen($id)>100))throw new InvalidArgumentException('INVALID_MENTIONS');
        genesisBeginWriteTransaction($db);
        try{
            genesisSharedProjectAccess($projectId,$userId,'comment');
            $q=$db->prepare('SELECT u.display_name FROM shared_project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.user_id=?');
            foreach($ids as $id){$q->execute([$projectId,$id]);$name=$q->fetchColumn();if(!is_string($name)||$name===''||!preg_match('/@'.preg_quote($name,'/').'(?![\p{L}\p{N}_])/u',$body))throw new InvalidArgumentException('INVALID_MENTIONS');}
            $q=$db->prepare('SELECT COUNT(*) FROM shared_project_comments WHERE project_id=?');$q->execute([$projectId]);if((int)$q->fetchColumn()>=10000)throw new GenesisSharedAccessException('MESSAGE_STORAGE_LIMIT',409);
            $db->prepare('INSERT INTO shared_project_comments(id,project_id,board_id,author_id,body,mention_ids_json,created_at) VALUES(?,?,?,?,?,?,?)')->execute([genesisUuid(),$projectId,$boardId,$userId,$body,json_encode(array_values(array_unique($ids)),JSON_THROW_ON_ERROR),genesisNow()]);
            $db->commit();
        }catch(Throwable $error){$db->rollBack();throw $error;}
    }
    $q=$db->prepare('SELECT c.id,c.body,c.author_id AS authorId,COALESCE(u.display_name,\'GENESIS\') AS authorName,c.created_at AS createdAt,c.mention_ids_json FROM shared_project_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.project_id=? AND c.board_id IS ? ORDER BY c.created_at DESC,c.id DESC LIMIT 200');$q->execute([$projectId,$boardId]);
    return array_reverse(array_map(static function($row){$row['mentionIds']=json_decode($row['mention_ids_json'],true);unset($row['mention_ids_json']);return genesisDataCommentProvenance($row);},$q->fetchAll()));
}

function genesisSharedAddComment(string $userId, string $projectId, string $taskId, array $input): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedProjectAccess($projectId, $userId, 'comment');
    $body = genesisSharedText($input['body'] ?? '', 5000);
    if ($body === '') throw new InvalidArgumentException('TITLE_REQUIRED');
    $mentions = $input['mentionIds'] ?? [];
    if (!is_array($mentions) || !array_is_list($mentions) || count($mentions) > 20 || array_filter($mentions, static fn($id) => !is_string($id) || strlen($id) > 100)) throw new InvalidArgumentException('INVALID_MENTIONS');
    $mentions = array_values(array_unique($mentions));
    $db = genesisDb();
    genesisBeginWriteTransaction($db);
    try {
        genesisSharedProjectAccess($projectId, $userId, 'comment');
        $query = $db->prepare('SELECT 1 FROM shared_tasks_read WHERE id = :task AND project_id = :project');
        $query->execute(['task' => $taskId, 'project' => $projectId]);
        if (!$query->fetchColumn()) throw new GenesisSharedAccessException();
        $member = $db->prepare('SELECT u.display_name FROM shared_project_members pm JOIN users u ON u.id = pm.user_id
            JOIN shared_projects p ON p.id = pm.project_id JOIN shared_space_members sm ON sm.space_id = p.space_id AND sm.user_id = pm.user_id
            WHERE pm.project_id = :project AND pm.user_id = :user');
        foreach ($mentions as $mentionedId) {
            $member->execute(['project' => $projectId, 'user' => $mentionedId]); $name = $member->fetchColumn();
            if (!is_string($name) || $name === '' || !preg_match('/@' . preg_quote($name, '/') . '(?![\p{L}\p{N}_])/u', $body)) throw new InvalidArgumentException('INVALID_MENTIONS');
        }
        $id = genesisUuid();
        $now = genesisNow();
        $db->prepare('INSERT INTO shared_comments (id, task_id, author_id, body, created_at)
            VALUES (:id, :task, :user, :body, :now)')->execute([
                'id' => $id, 'task' => $taskId, 'user' => $userId, 'body' => $body, 'now' => $now,
            ]);
        $mention = $db->prepare('INSERT INTO shared_comment_mentions (comment_id, user_id) VALUES (:comment, :user)');
        foreach ($mentions as $mentionedId) $mention->execute(['comment' => $id, 'user' => $mentionedId]);
        genesisSharedAudit($projectId, $userId, 'comment.created', $id);
        $db->commit();
        return ['id' => $id, 'body' => $body, 'mentionIds' => $mentions, 'authorId' => $userId, 'createdAt' => $now];
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

/** Called inside the account-deletion transaction before membership rows cascade. */
function genesisSharedPrepareAccountDeletion(string $userId): void
{
    $db = genesisDb();
    $ownedProjects = $db->prepare("SELECT project_id FROM shared_project_members
        WHERE user_id = :user AND role = 'owner'");
    $ownedProjects->execute(['user' => $userId]);
    foreach ($ownedProjects->fetchAll(PDO::FETCH_COLUMN) as $projectId) {
        $successor = $db->prepare('SELECT user_id FROM shared_project_members
            WHERE project_id = :project AND user_id <> :user
            ORDER BY CASE role WHEN \'manager\' THEN 0 WHEN \'member\' THEN 1 ELSE 2 END, joined_at LIMIT 1');
        $successor->execute(['project' => $projectId, 'user' => $userId]);
        $next = $successor->fetchColumn();
        if ($next === false) {
            $inbox = $db->prepare('SELECT space_id FROM shared_projects WHERE id = :project AND is_inbox = 1');
            $inbox->execute(['project' => $projectId]);
            $spaceId = $inbox->fetchColumn();
            if ($spaceId !== false) {
                $spaceSuccessor = $db->prepare('SELECT user_id FROM shared_space_members
                    WHERE space_id = :space AND user_id <> :user ORDER BY joined_at LIMIT 1');
                $spaceSuccessor->execute(['space' => $spaceId, 'user' => $userId]);
                $next = $spaceSuccessor->fetchColumn();
                if ($next !== false) {
                    $db->prepare("INSERT INTO shared_project_members (project_id, user_id, role, joined_at)
                        VALUES (:project, :user, 'owner', :now)")->execute([
                            'project' => $projectId, 'user' => $next, 'now' => genesisNow(),
                        ]);
                }
            }
            if ($next === false) {
                $db->prepare('DELETE FROM shared_projects WHERE id = :project')->execute(['project' => $projectId]);
            }
        } else {
            $db->prepare("UPDATE shared_project_members SET role = 'owner'
                WHERE project_id = :project AND user_id = :user")->execute([
                    'project' => $projectId, 'user' => $next,
                ]);
        }
    }
    $ownedSpaces = $db->prepare("SELECT space_id FROM shared_space_members
        WHERE user_id = :user AND role = 'owner'");
    $ownedSpaces->execute(['user' => $userId]);
    foreach ($ownedSpaces->fetchAll(PDO::FETCH_COLUMN) as $spaceId) {
        $successor = $db->prepare('SELECT user_id FROM shared_space_members
            WHERE space_id = :space AND user_id <> :user
            ORDER BY CASE role WHEN \'admin\' THEN 0 ELSE 1 END, joined_at LIMIT 1');
        $successor->execute(['space' => $spaceId, 'user' => $userId]);
        $next = $successor->fetchColumn();
        if ($next === false) {
            $db->prepare('DELETE FROM shared_spaces WHERE id = :space')->execute(['space' => $spaceId]);
        } else {
            $db->prepare("UPDATE shared_space_members SET role = 'owner'
                WHERE space_id = :space AND user_id = :user")->execute([
                    'space' => $spaceId, 'user' => $next,
                ]);
        }
    }
}

function genesisSharedSearch(string $userId, string $spaceId, string $query, ?string $cursor = null): array
{
    genesisSharedRequireEnabled($userId);
    genesisSharedSpaceAccess($spaceId, $userId);
    if (mb_strlen($query) > 200) throw new InvalidArgumentException('INVALID_SEARCH');
    $normalize = static fn(string $value): string => str_replace('ё', 'е', mb_strtolower($value));
    $tokens = preg_split('/[\s,;]+/u', trim($query), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    if (!$tokens) return ['projects' => [], 'tasks' => []];
    $matches = static function (array $item) use ($tokens, $normalize): bool {
        $title = $normalize((string)$item['title']);
        $tags = array_map($normalize, $item['tags'] ?? []);
        foreach ($tokens as $token) {
            $tagOnly = str_starts_with($token, '#');
            $term = $normalize(ltrim($token, '#'));
            if ($term === '' || !$tagOnly && str_contains($title, $term)) continue;
            $found = false;
            foreach ($tags as $tag) if (str_contains($tag, $term)) { $found = true; break; }
            if (!$found) return false;
        }
        return true;
    };
    $projects = array_values(array_filter(genesisSharedProjects($userId, $spaceId), $matches));
    $page=genesisSharedQueryTasks($userId,['spaceId'=>$spaceId,'q'=>$query],$cursor,100,'updatedAt');
    return ['projects'=>$projects,'projectTotal'=>count($projects)] + $page;
}

require_once __DIR__ . '/shared-space-settings.php';
require_once __DIR__ . '/shared-ui.php';
