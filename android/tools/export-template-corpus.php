<?php
declare(strict_types=1);

// Pure server normalization only: this exporter opens no database or user session.
if (PHP_SAPI !== 'cli') throw new RuntimeException('CLI only.');
$server = dirname(__DIR__, 2) . '/server';
foreach (['bootstrap', 'repository', 'google', 'shared-projects', 'shared-google', 'template-manifest', 'template-starters'] as $module) {
    require_once $server . '/src/' . $module . '.php';
}
$directory = dirname(__DIR__) . '/app/src/test/resources/templates';
if (!is_dir($directory) && !mkdir($directory, 0755, true)) throw new RuntimeException('Corpus directory unavailable.');
$languages = ['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'];
$starters = [];
foreach ($languages as $language) $starters[$language] = genesisSharedStarterTemplates($language);
file_put_contents($directory . '/starters.json', json_encode($starters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
$fields = [];
foreach (['text', 'number', 'date', 'checkbox', 'url', 'select', 'multi'] as $index => $type) {
    $fields[] = ['key' => 'field:' . $type, 'projectKey' => $index % 2 ? null : 'root', 'title' => 'Synthetic ' . $type, 'type' => $type,
        'options' => in_array($type, ['select', 'multi'], true) ? [['id' => 'option:first', 'title' => 'First', 'archived' => false], ['id' => 'option:old', 'title' => 'Old', 'archived' => true]] : [],
        'required' => false, 'showCard' => true, 'showList' => true, 'position' => $index];
}
$rich = genesisTemplateManifest([
    'schemaVersion' => 1, 'kind' => 'project', 'calendarMode' => 'sacred',
    'calendarContext' => ['version' => 2, 'timeZone' => 'Europe/Berlin', 'gregorianYearStart' => 'march'],
    'projects' => [
        ['key' => 'root', 'parentKey' => null, 'title' => 'Synthetic source', 'description' => 'Portable content', 'layout' => 'board', 'kind' => 'project',
            'statuses' => [['key' => 'root:open', 'title' => 'Open', 'isDone' => false], ['key' => 'root:done', 'title' => 'Done', 'isDone' => true]],
            'categories' => [['key' => 'category:first', 'title' => 'Category', 'color' => '#abcdef']], 'labelKeys' => ['label:first'], 'tags' => ['synthetic']],
        ['key' => 'nested', 'parentKey' => 'root', 'boardStatusKey' => 'root:open', 'title' => 'Nested list', 'description' => '', 'layout' => 'list', 'kind' => 'task-list',
            'statuses' => [['key' => 'nested:open', 'title' => 'Open', 'isDone' => false], ['key' => 'nested:done', 'title' => 'Done', 'isDone' => true]]],
    ],
    'labels' => [['key' => 'label:first', 'title' => 'Label', 'color' => '#abcdef']], 'fields' => $fields,
    'tasks' => [
        ['key' => 'task:parent', 'projectKey' => 'root', 'title' => 'Synthetic parent', 'description' => 'Кириллица 🌿', 'statusKey' => 'root:open', 'categoryKey' => 'category:first', 'priority' => 3,
            'assigneeId' => 'synthetic:owner', 'approvalRequired' => true, 'approverIds' => ['synthetic:reviewer'], 'labelKeys' => ['label:first'], 'tags' => ['portable'],
            'storyPoints' => 0, 'estimateHours' => 1.25, 'due' => ['amount' => 1, 'unit' => 'month'], 'start' => ['amount' => -1, 'unit' => 'day'], 'startTime' => '09:00', 'endTime' => '10:30',
            'customValues' => ['field:text' => 'Own text', 'field:number' => 0, 'field:date' => '2026-10-20', 'field:checkbox' => false, 'field:url' => 'https://example.invalid/reference', 'field:select' => 'option:old', 'field:multi' => ['option:first', 'option:old']],
            'checklists' => [['key' => 'list:first', 'title' => 'Checklist', 'items' => [['key' => 'item:first', 'title' => 'Linked child', 'linkedTaskKey' => 'task:child', 'assigneeId' => 'synthetic:owner', 'due' => ['amount' => 0, 'unit' => 'day']]]]]],
        ['key' => 'task:child', 'projectKey' => 'root', 'parentKey' => 'task:parent', 'title' => 'Child', 'statusKey' => 'root:done', 'dependsOnKeys' => ['task:leaf'], 'storyPoints' => null, 'estimateHours' => 0],
        ['key' => 'task:leaf', 'projectKey' => 'root', 'title' => 'Dependency', 'statusKey' => 'root:open'],
        ['key' => 'task:nested', 'projectKey' => 'nested', 'title' => 'Nested task', 'statusKey' => 'nested:open'],
    ],
]);
file_put_contents($directory . '/rich-manifest.json', json_encode($rich, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
echo "Generated 56 real PHP starter sources in 14 languages and one normalized synthetic graph; no database access.\n";
