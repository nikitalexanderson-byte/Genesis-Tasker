<?php
declare(strict_types=1);

function genesisEntryType(mixed $value): string
{
    if (!in_array($value, ['task', 'meeting', 'birthday', 'event'], true)) throw new InvalidArgumentException('INVALID_ENTRY_TYPE');
    return $value;
}

function genesisEntryDescription(array $task, string $description): string
{
    $type = $task['entryType'] ?? $task['entry_type'] ?? $task['yandexEntryType'] ?? 'task';
    $label = ['meeting' => 'Встреча', 'birthday' => 'День рождения', 'event' => 'Событие'][$type] ?? null;
    if ($label === null) return $description;
    $marker = 'Тип: ' . $label;
    return str_starts_with($description, $marker . "\n") || $description === $marker ? $description : $marker . ($description !== '' ? "\n\n" . $description : '');
}

function genesisEntryTypeFromDescription(string $description): string
{
    foreach (['Встреча' => 'meeting', 'День рождения' => 'birthday', 'Событие' => 'event'] as $label => $type) {
        if ($description === 'Тип: ' . $label || str_starts_with($description, 'Тип: ' . $label . "\n")) return $type;
    }
    return 'task';
}
