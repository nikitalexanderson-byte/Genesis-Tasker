<?php
declare(strict_types=1);

// Seed the opt-in JVM HTTP contracts inside a fresh owned runtime. Never uses server/config.php.
if (PHP_SAPI !== 'cli') throw new RuntimeException('CLI fixture required');
$legacyOptions = getopt('', ['dir:', 'origin:', 'run-id:']);
if (($legacyOptions['origin'] ?? '') !== 'http://127.0.0.1:4338') throw new RuntimeException('Legacy contracts require loopback port 4338');
ob_start();
try { require __DIR__ . '/backend-fixture.php'; } finally { ob_end_clean(); }
foreach (['google', 'shared-projects'] as $module) require_once dirname(__DIR__, 2) . '/server/src/' . $module . '.php';
if (genesisConfig()['db_path'] !== $directory . '/genesis.sqlite' || genesisConfig()['app_url'] !== $origin) throw new RuntimeException('Fixture isolation mismatch');
function legacyCheck(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function legacySaveField(string $actor, string $space, array $input): array {
    $preview = genesisSharedPreviewCustomField($actor, $space, $input);
    return genesisSharedSaveCustomField($actor, $space, [...$input, 'operationId' => genesisUuid(),
        'fingerprint' => $preview['fingerprint'], 'replaceType' => $preview['replaceType']])['field'];
}
function legacyEditField(array $field, array $changes): array {
    return [...array_intersect_key($field, array_flip(['id', 'title', 'type', 'projectId', 'options', 'position', 'required', 'showCard', 'showList', 'archived'])),
        'expectedRevision' => $field['revision'], ...$changes];
}
function legacyTarget(string $path, array $data): void {
    $file = fopen($path, 'x'); if ($file === false) throw new RuntimeException('Refusing existing fixture target');
    try { if (fwrite($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)) === false) throw new RuntimeException('Cannot write fixture target'); }
    finally { fclose($file); }
}

$db = genesisDb(); $actors = []; $now = genesisNow();
foreach (['editor', 'viewer'] as $actor) {
    $id = genesisUuid();
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,auth_provider,subscription_plan,subscription_valid_until,shared_projects_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        ->execute([$id, 'legacy-' . $runId . '-' . $actor, 'improvements-' . $actor . '@example.invalid', 'Synthetic ' . $actor,
            'google', 'business', '2035-01-01T00:00:00Z', 1, $now, $now]);
    $user = genesisEnsureWorkspaceKey(genesisFindUser($id));
    legacyCheck(!genesisIsAdminUser($user) && !genesisSharedTester($user), 'Fixture must use ordinary Business accounts');
    $actors[$actor] = $id;
}
$editor = $actors['editor']; $viewer = $actors['viewer'];
$targets = $directory . '/output'; if (!mkdir($targets, 0700)) throw new RuntimeException('Cannot create target directory');

// The checked-in capture is explicitly synthetic and contains the full 131-row export graph.
$envelope = json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/android/app/src/androidTest/assets/native-export-http-json.json'), true, 256, JSON_THROW_ON_ERROR);
$exportSpace = genesisSharedCreateSpace($editor, ['title' => 'Native HTTP data exchange'])['id'];
$command = ['format' => 'json', 'content' => $envelope['content'], 'spaceId' => $exportSpace];
$preview = genesisSharedDataPreview($editor, $command);
legacyCheck($preview['canApply'] && $preview['taskCount'] === 131, 'Recorded synthetic export cannot be imported');
$receipt = genesisSharedDataApply($editor, [...$command, 'operationId' => genesisUuid(), 'fingerprint' => $preview['fingerprint']]);
$exportProject = $receipt['rootProjectId'];
$export = genesisSharedDataExport($editor, $exportSpace, ['scope' => 'tree', 'projectId' => $exportProject, 'format' => 'json']);
legacyCheck($export['taskCount'] === 131 && $export['projectCount'] === 2
    && genesisSharedProjectAccess($exportProject, $editor)['title'] === 'Проверка экспорта 🌙', 'Export fixture changed its exact graph');
legacyTarget($targets . '/native-export-http-target.json', ['spaceId' => $exportSpace, 'projectId' => $exportProject, 'expectedTasks' => 131]);

// Seven current types plus an archived definition/value and retired options exercise old data preservation.
$fieldSpace = genesisSharedCreateSpace($editor, ['title' => 'Native HTTP custom fields'])['id'];
$fieldProject = genesisSharedCreateProject($editor, $fieldSpace, ['title' => 'Карточка с полями'])['id'];
$fields = []; $keys = []; $position = 0;
foreach (['text', 'number', 'date', 'select', 'multi', 'checkbox', 'url', 'archived'] as $key) {
    $type = $key === 'archived' ? 'text' : $key; $options = [];
    if (in_array($type, ['select', 'multi'], true)) foreach (['first', 'second', 'retired'] as $option) $options[] = ['id' => $option, 'title' => ucfirst($option), 'archived' => false];
    $fields[$key] = legacySaveField($editor, $fieldSpace, ['id' => genesisUuid(), 'title' => 'Поле ' . $key, 'type' => $type,
        'projectId' => $fieldProject, 'options' => $options, 'position' => $position++, 'required' => $key === 'checkbox',
        'showCard' => true, 'showList' => true, 'archived' => false, 'expectedRevision' => 0]);
    $keys[$key] = $fields[$key]['id'];
}
$task = genesisSharedTask($editor, $fieldProject, ['title' => 'Задача с семью типами полей', 'customFields' => [
    $keys['text'] => 'Исходный текст 🌿', $keys['number'] => 42, $keys['date'] => '2026-10-20', $keys['select'] => 'retired',
    $keys['multi'] => ['first', 'retired'], $keys['checkbox'] => false, $keys['url'] => 'https://example.invalid/source', $keys['archived'] => 'Сохранённая история',
]]);
foreach (['select', 'multi'] as $key) {
    $options = array_map(static fn(array $option): array => [...$option, 'archived' => $option['id'] === 'retired'], $fields[$key]['options']);
    $fields[$key] = legacySaveField($editor, $fieldSpace, legacyEditField($fields[$key], ['options' => $options]));
}
$fields['archived'] = legacySaveField($editor, $fieldSpace, legacyEditField($fields['archived'], ['archived' => true]));
$stored = (array)genesisSharedGetTask($editor, $fieldProject, $task['id'])['customFields'];
legacyCheck(count($stored) === 8 && $stored[$keys['select']] === 'retired' && $stored[$keys['checkbox']] === false, 'Historical custom values lost');
legacyTarget($targets . '/native-custom-fields-http-target.json', ['spaceId' => $fieldSpace, 'projectId' => $fieldProject,
    'taskId' => $task['id'], 'fields' => $keys]);

// The Kotlin desired-policy contract contains fixed synthetic IDs. Materialize those rows in this fresh database.
$accessSpace = genesisSharedCreateSpace($editor, ['title' => 'Проверка проектного доступа'])['id'];
$db->prepare("INSERT INTO shared_space_members(space_id,user_id,role,all_projects,joined_at) VALUES(?,?,'member',1,?)")
    ->execute([$accessSpace, $viewer, $now]);
$contract = json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/android/app/src/test/resources/project-access/preview.json'), true, 32, JSON_THROW_ON_ERROR);
$projects = array_values(array_filter($contract['projects'], static fn(array $project): bool => !$project['isInbox']));
usort($projects, static fn(array $a, array $b): int => ($a['parentId'] !== null) <=> ($b['parentId'] !== null));
genesisBeginWriteTransaction($db);
try {
    foreach ($projects as $project) {
        $id = $project['id'];
        $db->prepare("INSERT INTO shared_projects(id,space_id,parent_id,title,layout,kind,created_by,created_at,updated_at) VALUES(?,?,?,?,'list','project',?,?,?)")
            ->execute([$id, $accessSpace, $project['parentId'], $project['title'], $editor, $now, $now]);
        foreach ([$editor => 'owner', $viewer => 'member'] as $userId => $role) $db->prepare('INSERT INTO shared_project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)')->execute([$id, $userId, $role, $now]);
        foreach ([['К выполнению', 0], ['Готово', 1]] as $index => [$title, $done]) $db->prepare('INSERT INTO shared_project_statuses(id,project_id,title,position,is_done) VALUES(?,?,?,?,?)')->execute([genesisUuid(), $id, $title, $index, $done]);
        genesisSharedProjectInboxStatus($db, $id, false); genesisSharedProjectInboxStatus($db, $id, true);
    }
    $db->commit();
} catch (Throwable $error) { if ($db->inTransaction()) $db->rollBack(); throw $error; }
foreach ($projects as $project) if ($project['assignedTaskCount']) genesisSharedTask($editor, $project['id'], ['title' => 'Synthetic assignment for revocation', 'assigneeId' => $viewer]);
$access = genesisSharedProjectAccessState($editor, $accessSpace, $viewer);
legacyCheck($access['allProjects'] && count($access['projects']) === count($contract['projects']), 'Project access fixture incomplete');
legacyCheck(genesisSharedPreviewProjectAccess($editor, $accessSpace, $viewer, $contract['desired'])['blockers'] === [], 'Project access desired contract is blocked');
legacyTarget($targets . '/native-project-access-http-target.json', ['spaceId' => $accessSpace, 'userId' => $viewer, 'expectedProjects' => count($contract['projects'])]);
legacyCheck($db->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Synthetic fixture has broken references');
legacyTarget($directory . '/legacy-http.json', ['synthetic' => true, 'actors' => $actors]);
echo json_encode(['status' => 'READY', 'runId' => $runId, 'directory' => $directory, 'origin' => $origin, 'targets' => $targets,
    'synthetic' => true, 'ordinaryBusinessActors' => 2, 'exportTasks' => 131, 'customFieldTypes' => 7, 'projectAccessRows' => count($access['projects'])], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
