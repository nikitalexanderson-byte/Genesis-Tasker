<?php
declare(strict_types=1);

const GENESIS_GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GENESIS_GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GENESIS_GEMINI_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const GENESIS_GIGACHAT_DEFAULT_MODEL = 'GigaChat';
const GENESIS_GIGACHAT_DEFAULT_AUTH_ENDPOINT = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GENESIS_GIGACHAT_DEFAULT_API_ENDPOINT = 'https://api.giga.chat/v1';
const GENESIS_GEMINI_AUDIO_MIME_TYPES = [
    'audio/aac',
    'audio/flac',
    'audio/m4a',
    'audio/mp3',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/opus',
    'audio/wav',
    'audio/webm',
];

function genesisGeminiApiKey(): string
{
    $environmentKey = getenv('GEMINI_API_KEY');
    if (is_string($environmentKey) && trim($environmentKey) !== '') {
        return trim($environmentKey);
    }
    return trim((string)(genesisConfig()['gemini_api_key'] ?? ''));
}

function genesisGeminiEnabled(): bool
{
    $environmentValue = getenv('GEMINI_ENABLED');
    $configuredValue = is_string($environmentValue)
        ? $environmentValue
        : (genesisConfig()['gemini_enabled'] ?? false);
    return filter_var($configuredValue, FILTER_VALIDATE_BOOLEAN) === true;
}

function genesisGeminiModel(): string
{
    $configured = trim((string)(genesisConfig()['gemini_model'] ?? GENESIS_GEMINI_DEFAULT_MODEL));
    return preg_match('/^[a-z0-9][a-z0-9._-]{2,80}$/', $configured) === 1
        ? $configured
        : GENESIS_GEMINI_DEFAULT_MODEL;
}

function genesisGeminiEndpoint(): string
{
    $configured = trim((string)(genesisConfig()['gemini_api_endpoint'] ?? ''));
    if ($configured === '') {
        return GENESIS_GEMINI_DEFAULT_ENDPOINT;
    }
    $parts = parse_url($configured);
    return is_array($parts)
        && ($parts['scheme'] ?? '') === 'https'
        && is_string($parts['host'] ?? null)
        && trim((string)$parts['host']) !== ''
            ? $configured
            : GENESIS_GEMINI_DEFAULT_ENDPOINT;
}

function genesisGeminiRequest(array $request): array
{
    try {
        return genesisCurl(genesisGeminiEndpoint(), [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($request, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
                'x-goog-api-key: ' . genesisGeminiApiKey(),
            ],
            CURLOPT_TIMEOUT => 90,
        ]);
    } catch (RuntimeException $error) {
        $message = mb_strtolower($error->getMessage());
        if (str_contains($message, 'not available in your current location')
            || str_contains($message, 'user location is not supported')) {
            genesisJson(['error' => 'GEMINI_REGION_UNAVAILABLE'], 503);
        }
        if (str_contains($message, 'api key not valid')
            || str_contains($message, 'api_key_invalid')
            || str_contains($message, 'permission denied')) {
            genesisJson(['error' => 'GEMINI_KEY_INVALID'], 503);
        }
        throw $error;
    }
}

function genesisGeminiAvailable(): bool
{
    return genesisGeminiEnabled() && genesisGeminiApiKey() !== '';
}

function genesisGeminiRateLimit(): void
{
    $now = time();
    $windowStart = $now - 600;
    $requests = array_values(array_filter(
        is_array($_SESSION['gemini_requests'] ?? null) ? $_SESSION['gemini_requests'] : [],
        static fn(mixed $value): bool => is_int($value) && $value >= $windowStart,
    ));
    if (count($requests) >= 12) {
        genesisJson(['error' => 'GEMINI_RATE_LIMIT'], 429);
    }
    $requests[] = $now;
    $_SESSION['gemini_requests'] = $requests;
}

function genesisGeminiString(mixed $value, int $limit): string
{
    return mb_substr(trim(is_string($value) ? $value : ''), 0, $limit);
}

function genesisGeminiStringList(mixed $value, int $itemLimit, int $countLimit): array
{
    if (!is_array($value)) {
        return [];
    }
    $result = [];
    foreach (array_slice($value, 0, $countLimit) as $item) {
        $clean = genesisGeminiString($item, $itemLimit);
        if ($clean !== '') {
            $result[] = $clean;
        }
    }
    return array_values(array_unique($result));
}

function genesisAssistantTaskTitle(mixed $value): string
{
    $title = genesisGeminiString($value, 300);
    $title = preg_replace([
        '/^(?:(?:ну|пожалуйста)\s*[,—–-]?\s*)*(?:(?:мне\s+)?(?:нужно|надо)\s+)?(?:(?:создай|создать|добавь|добавить|запиши|записать|запланируй|запланировать|поставь|поставить)(?:\s+мне)?(?:\s+(?:новую?\s+)?(?:задач[а-яё]*|напоминан[а-яё]*))?|напомни(?:\s+мне)?|задачу)\s*[.:;—–,-]?\s*/iu',
        '/^(?:please\s+)?(?:(?:create|add|schedule|plan|make)(?:\s+me)?(?:\s+(?:a\s+)?(?:new\s+)?(?:task|reminder))?|remind\s+me(?:\s+to)?)\s*[.:;—–,-]?\s*/i',
    ], '', $title) ?? $title;
    $title = preg_replace('/^(?:задач[а-яё]*|напоминан[а-яё]*|task|reminder)\s*[:—–-]\s*/iu', '', $title) ?? $title;
    $title = preg_replace('/^(?:(?:под|с)\s+названием|по\s+имени|(?:назови|назвать)(?:\s+(?:е[её]|задачу))?|которую\s+назови|название(?:\s+задачи)?|которая\s+называется|with\s+(?:the\s+)?(?:title|name)|named|called)\s*[:—–,-]?\s*/iu', '', $title) ?? $title;
    return trim((string)(preg_replace('/^[«“"\s]+|[»”"\s.,!?]+$/u', '', $title) ?? $title));
}

function genesisGeminiLanguageInstruction(string $language): string
{
    $names = ['ru' => 'Russian', 'en' => 'English', 'el' => 'Greek', 'de' => 'German',
        'fr' => 'French', 'es' => 'Spanish', 'it' => 'Italian', 'pt' => 'Portuguese',
        'pl' => 'Polish', 'sr' => 'Serbian', 'uk' => 'Ukrainian', 'zh' => 'Simplified Chinese',
        'tr' => 'Turkish', 'ja' => 'Japanese'];
    return 'Write request and summary in ' . ($names[$language] ?? 'Russian') . '.';
}

function genesisGeminiContext(mixed $value): array
{
    $context = is_array($value) ? $value : [];
    $language = in_array($context['language'] ?? '', ['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'], true)
        ? (string)$context['language'] : 'ru';
    $calendarMode = in_array($context['calendarMode'] ?? '', ['profane', 'sacred', 'lunar'], true)
        ? (string)$context['calendarMode']
        : 'sacred';
    $today = genesisGeminiString($context['today'] ?? '', 10);
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $today) !== 1) {
        $today = (new DateTimeImmutable('now', genesisClientTimeZone()))->format('Y-m-d');
    }

    $cleanRows = static function (mixed $rows, array $fields, int $limit): array {
        if (!is_array($rows)) {
            return [];
        }
        $result = [];
        foreach (array_slice($rows, 0, $limit) as $row) {
            if (!is_array($row)) {
                continue;
            }
            $clean = [];
            foreach ($fields as $field => $length) {
                $clean[$field] = genesisGeminiString($row[$field] ?? '', $length);
            }
            if (($clean['title'] ?? $clean['name'] ?? $clean['email'] ?? '') !== '') {
                $result[] = $clean;
            }
        }
        return $result;
    };

    return [
        'language' => $language,
        'calendarMode' => $calendarMode,
        'today' => $today,
        'timeZone' => genesisGeminiString($context['timeZone'] ?? '', 80),
        'categories' => $cleanRows($context['categories'] ?? [], ['name' => 100], 100),
        'projects' => $cleanRows($context['projects'] ?? [], [
            'title' => 160,
            'parent' => 160,
            'category' => 100,
        ], 250),
        'taskLists' => $cleanRows($context['taskLists'] ?? [], [
            'title' => 160,
            'accountEmail' => 254,
        ], 100),
        'accounts' => $cleanRows($context['accounts'] ?? [], ['email' => 254], 20),
    ];
}

function genesisGeminiPlanSchema(): array
{
    $text = static fn(string $description = ''): array => [
        'type' => 'string',
        'description' => $description,
    ];
    $stringArray = static fn(string $description = ''): array => [
        'type' => 'array',
        'description' => $description,
        'items' => ['type' => 'string'],
    ];

    return [
        'type' => 'object',
        'additionalProperties' => false,
        'properties' => [
            'request' => $text('A concise transcript or restatement of what the user asked.'),
            'summary' => $text('A concise summary of the proposed changes in the user language.'),
            'projects' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'additionalProperties' => false,
                    'properties' => [
                        'title' => $text(),
                        'description' => $text(),
                        'parentProject' => $text('Exact existing or newly proposed parent project title, or empty string.'),
                        'category' => $text('Exact existing category name, or empty string.'),
                        'tags' => $stringArray(),
                    ],
                    'required' => ['title', 'description', 'parentProject', 'category', 'tags'],
                ],
            ],
            'taskLists' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'additionalProperties' => false,
                    'properties' => [
                        'title' => $text(),
                        'project' => $text('Exact existing or newly proposed project title, or empty string.'),
                        'accountEmail' => $text('Exact connected account email when the user chose one, or empty string.'),
                    ],
                    'required' => ['title', 'project', 'accountEmail'],
                ],
            ],
            'tasks' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'additionalProperties' => false,
                    'properties' => [
                        'title' => $text(),
                        'description' => $text(),
                        'startDate' => $text('Gregorian YYYY-MM-DD date when work starts.'),
                        'dueDate' => $text('Gregorian YYYY-MM-DD final deadline, never before startDate.'),
                        'time' => $text('24-hour HH:MM start time, or empty string.'),
                        'project' => $text('Exact existing or newly proposed project title, or empty string.'),
                        'taskList' => $text('Exact existing or newly proposed Google Tasks list title, or empty string.'),
                        'tags' => $stringArray(),
                        'priority' => [
                            'type' => 'integer',
                            'minimum' => 1,
                            'maximum' => 10,
                        ],
                        'reminderMinutes' => [
                            'type' => 'integer',
                            'minimum' => 0,
                            'maximum' => 43200,
                            'description' => 'Minutes before the task; zero means no reminder.',
                        ],
                    ],
                    'required' => ['title', 'description', 'startDate', 'dueDate', 'time', 'project', 'taskList', 'tags', 'priority', 'reminderMinutes'],
                ],
            ],
        ],
        'required' => ['request', 'summary', 'projects', 'taskLists', 'tasks'],
    ];
}

function genesisGeminiOutputText(array $response): string
{
    $steps = is_array($response['steps'] ?? null) ? $response['steps'] : [];
    for ($stepIndex = count($steps) - 1; $stepIndex >= 0; $stepIndex--) {
        $step = $steps[$stepIndex] ?? null;
        if (!is_array($step) || ($step['type'] ?? '') !== 'model_output') {
            continue;
        }
        $content = is_array($step['content'] ?? null) ? $step['content'] : [];
        for ($contentIndex = count($content) - 1; $contentIndex >= 0; $contentIndex--) {
            $part = $content[$contentIndex] ?? null;
            if (is_array($part) && ($part['type'] ?? '') === 'text' && is_string($part['text'] ?? null)) {
                return trim($part['text']);
            }
        }
    }
    throw new RuntimeException('Gemini returned no planning result.');
}

function genesisNormalizeGeminiPlan(array $plan): array
{
    $projects = [];
    foreach (array_slice(is_array($plan['projects'] ?? null) ? $plan['projects'] : [], 0, 20) as $project) {
        if (!is_array($project)) continue;
        $title = genesisGeminiString($project['title'] ?? '', 160);
        if ($title === '') continue;
        $projects[] = [
            'title' => $title,
            'description' => genesisGeminiString($project['description'] ?? '', 2000),
            'parentProject' => genesisGeminiString($project['parentProject'] ?? '', 160),
            'category' => genesisGeminiString($project['category'] ?? '', 100),
            'tags' => genesisGeminiStringList($project['tags'] ?? [], 60, 10),
        ];
    }

    $taskLists = [];
    foreach (array_slice(is_array($plan['taskLists'] ?? null) ? $plan['taskLists'] : [], 0, 20) as $taskList) {
        if (!is_array($taskList)) continue;
        $title = genesisGeminiString($taskList['title'] ?? '', 160);
        if ($title === '') continue;
        $taskLists[] = [
            'title' => $title,
            'project' => genesisGeminiString($taskList['project'] ?? '', 160),
            'accountEmail' => genesisGeminiString($taskList['accountEmail'] ?? '', 254),
        ];
    }

    $tasks = [];
    foreach (array_slice(is_array($plan['tasks'] ?? null) ? $plan['tasks'] : [], 0, 100) as $task) {
        if (!is_array($task)) continue;
        $title = genesisAssistantTaskTitle($task['title'] ?? '');
        if ($title === '') continue;
        $startDate = genesisGeminiString($task['startDate'] ?? '', 10);
        $dueDate = genesisGeminiString($task['dueDate'] ?? '', 10);
        $time = genesisGeminiString($task['time'] ?? '', 5);
        $tasks[] = [
            'title' => $title,
            'description' => genesisGeminiString($task['description'] ?? '', 4000),
            'startDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate) === 1 ? $startDate : '',
            'dueDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate) === 1 ? $dueDate : '',
            'time' => preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time) === 1 ? $time : '',
            'project' => genesisGeminiString($task['project'] ?? '', 160),
            'taskList' => genesisGeminiString($task['taskList'] ?? '', 160),
            'tags' => genesisGeminiStringList($task['tags'] ?? [], 60, 6),
            'priority' => genesisClampInt($task['priority'] ?? 5, 1, 10, 5),
            'reminderMinutes' => genesisClampInt($task['reminderMinutes'] ?? 0, 0, 40320, 0),
        ];
    }

    return [
        'request' => genesisGeminiString($plan['request'] ?? '', 2000),
        'summary' => genesisGeminiString($plan['summary'] ?? '', 2000),
        'projects' => $projects,
        'taskLists' => $taskLists,
        'tasks' => $tasks,
    ];
}

function genesisCreateGeminiPlan(array $payload): array
{
    if (!genesisGeminiAvailable()) {
        genesisJson(['error' => 'GEMINI_NOT_CONFIGURED'], 503);
    }

    $command = genesisGeminiString($payload['command'] ?? '', 4000);
    $audio = is_array($payload['audio'] ?? null) ? $payload['audio'] : null;
    if ($command === '' && $audio === null) {
        throw new InvalidArgumentException('Voice recording or command text is required.');
    }

    $context = genesisGeminiContext($payload['context'] ?? []);
    $input = [[
        'type' => 'text',
        'text' => "Current GENESIS context (user-provided planning metadata):\n"
            . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
            . "\n\nWritten command (may be empty when audio is present):\n"
            . $command,
    ]];

    if ($audio !== null) {
        $mimeType = strtolower(trim(explode(';', genesisGeminiString($audio['mimeType'] ?? '', 100), 2)[0]));
        if (!in_array($mimeType, GENESIS_GEMINI_AUDIO_MIME_TYPES, true)) {
            throw new InvalidArgumentException('Unsupported audio format.');
        }
        $decoded = base64_decode((string)($audio['data'] ?? ''), true);
        if (!is_string($decoded) || $decoded === '' || strlen($decoded) > GENESIS_GEMINI_MAX_AUDIO_BYTES) {
            throw new InvalidArgumentException('Voice recording is empty or too large.');
        }
        $input[] = [
            'type' => 'audio',
            'data' => base64_encode($decoded),
            'mime_type' => $mimeType,
        ];
    }

    genesisGeminiRateLimit();

    $languageInstruction = genesisGeminiLanguageInstruction($context['language']);
    $systemInstruction = <<<PROMPT
You are the planning parser for the GENESIS calendar. Convert the user's written or spoken request into a draft only. Never execute actions and never invent goals the user did not request.

Rules:
- Return only the structured response required by the JSON schema.
- {$languageInstruction}
- The written command may be a noisy automatic speech transcript. Correct obvious recognition errors when an exact project, category, task-list, or account name from the context is clearly intended.
- Interpret relative dates using context.today and context.timeZone. All output dates must be Gregorian ISO YYYY-MM-DD.
- startDate is when work starts; dueDate is the final deadline. If only one date is given, use it for both. If no date is given, use context.today for both.
- Never make dueDate earlier than startDate. Do not choose a past date unless the user explicitly named that past date.
- Match existing project, category, task-list, and account names exactly when the user refers to them.
- When the user asks to put, place, add, move, or assign a task in/to/for an existing project, set that task's project field to the exact context title and do not leave the placement words in the task title.
- Add an item to projects or taskLists only when the user explicitly asks to create it. A task may reference an existing item without recreating it.
- A taskLists item means a Google Tasks list. Use accountEmail only when the user selected a connected account.
- Keep titles concise. Preserve meaningful wording from the user. Use empty strings and empty arrays for omitted optional details.
- Treat "под названием", "с названием", "назови её", "named", "called", and "with the title" as instructions about the title field. For "создай задачу под названием Задача номер 1", output title exactly "Задача номер 1"; keep the word "Задача" when it is part of the requested name.
- priority is 1 to 10 (10 is highest); default to 5. reminderMinutes is 0 when no reminder was requested.
- If the request is not about creating projects, Google Tasks lists, or tasks, return empty action arrays and explain briefly in summary.
PROMPT;

    $request = [
        'model' => genesisGeminiModel(),
        'input' => $input,
        'system_instruction' => $systemInstruction,
        'store' => false,
        'generation_config' => [
            'temperature' => 0.1,
            'max_output_tokens' => 8192,
        ],
        'response_format' => [
            'type' => 'text',
            'mime_type' => 'application/json',
            'schema' => genesisGeminiPlanSchema(),
        ],
    ];

    $response = genesisGeminiRequest($request);

    $plan = json_decode(genesisGeminiOutputText($response), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($plan)) {
        throw new RuntimeException('Gemini returned an invalid planning result.');
    }

    return [
        'model' => genesisGeminiModel(),
        'plan' => genesisNormalizeGeminiPlan($plan),
    ];
}

function genesisGigaChatAuthorizationKey(): string
{
    $environmentKey = getenv('GIGACHAT_AUTHORIZATION_KEY');
    if (is_string($environmentKey) && trim($environmentKey) !== '') {
        return trim($environmentKey);
    }
    return trim((string)(genesisConfig()['gigachat_authorization_key'] ?? ''));
}

function genesisGigaChatEnabled(): bool
{
    $environmentValue = getenv('GIGACHAT_ENABLED');
    $configuredValue = is_string($environmentValue)
        ? $environmentValue
        : (genesisConfig()['gigachat_enabled'] ?? false);
    return filter_var($configuredValue, FILTER_VALIDATE_BOOLEAN) === true;
}

function genesisGigaChatAvailable(): bool
{
    return genesisGigaChatEnabled() && genesisGigaChatAuthorizationKey() !== '';
}

function genesisGigaChatModel(): string
{
    $configured = trim((string)(genesisConfig()['gigachat_model'] ?? GENESIS_GIGACHAT_DEFAULT_MODEL));
    return preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/', $configured) === 1
        ? $configured
        : GENESIS_GIGACHAT_DEFAULT_MODEL;
}

function genesisGigaChatScope(): string
{
    $scope = trim((string)(genesisConfig()['gigachat_scope'] ?? 'GIGACHAT_API_PERS'));
    return in_array($scope, ['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'], true)
        ? $scope
        : 'GIGACHAT_API_PERS';
}

function genesisGigaChatHttpsEndpoint(string $key, string $fallback): string
{
    $configured = trim((string)(genesisConfig()[$key] ?? ''));
    if ($configured === '') return $fallback;
    $parts = parse_url($configured);
    return is_array($parts)
        && ($parts['scheme'] ?? '') === 'https'
        && is_string($parts['host'] ?? null)
        && trim((string)$parts['host']) !== ''
            ? rtrim($configured, '/')
            : $fallback;
}

function genesisGigaChatAuthEndpoint(): string
{
    return genesisGigaChatHttpsEndpoint('gigachat_auth_endpoint', GENESIS_GIGACHAT_DEFAULT_AUTH_ENDPOINT);
}

function genesisGigaChatApiEndpoint(): string
{
    return genesisGigaChatHttpsEndpoint('gigachat_api_endpoint', GENESIS_GIGACHAT_DEFAULT_API_ENDPOINT);
}

function genesisGigaChatTlsOptions(): array
{
    $caPath = trim((string)(genesisConfig()['gigachat_ca_path'] ?? ''));
    return $caPath !== '' && is_file($caPath) ? [CURLOPT_CAINFO => $caPath] : [];
}

function genesisGigaChatUuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
        . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
}

function genesisGigaChatHandleError(RuntimeException $error): never
{
    $message = mb_strtolower($error->getMessage());
    if (str_contains($message, '(401)') || str_contains($message, 'unauthorized') || str_contains($message, 'invalid credentials')) {
        genesisJson(['error' => 'GIGACHAT_KEY_INVALID'], 503);
    }
    if (str_contains($message, '(429)') || str_contains($message, 'too many requests')) {
        genesisJson(['error' => 'GIGACHAT_RATE_LIMIT'], 429);
    }
    if (str_contains($message, 'certificate') || str_contains($message, 'ssl')) {
        genesisJson(['error' => 'GIGACHAT_CERTIFICATE_ERROR'], 503);
    }
    throw $error;
}

function genesisGigaChatAccessToken(): string
{
    $cachedToken = trim((string)($_SESSION['gigachat_access_token'] ?? ''));
    $cachedExpiry = (int)($_SESSION['gigachat_access_token_expires_at'] ?? 0);
    if ($cachedToken !== '' && $cachedExpiry > time() + 60) {
        return $cachedToken;
    }

    try {
        $response = genesisCurl(genesisGigaChatAuthEndpoint(), genesisGigaChatTlsOptions() + [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query(['scope' => genesisGigaChatScope()], '', '&', PHP_QUERY_RFC3986),
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Content-Type: application/x-www-form-urlencoded',
                'Authorization: Basic ' . genesisGigaChatAuthorizationKey(),
                'RqUID: ' . genesisGigaChatUuid(),
            ],
            CURLOPT_TIMEOUT => 30,
        ]);
    } catch (RuntimeException $error) {
        genesisGigaChatHandleError($error);
    }

    $token = trim((string)($response['access_token'] ?? ''));
    $expiresAt = (int)($response['expires_at'] ?? 0);
    if ($expiresAt > 10_000_000_000) $expiresAt = (int)floor($expiresAt / 1000);
    if ($token === '') throw new RuntimeException('GigaChat returned no access token.');
    $_SESSION['gigachat_access_token'] = $token;
    $_SESSION['gigachat_access_token_expires_at'] = $expiresAt > time() ? $expiresAt : time() + 1500;
    return $token;
}

function genesisGigaChatRequest(string $path, array $options = []): array
{
    try {
        return genesisCurl(genesisGigaChatApiEndpoint() . '/' . ltrim($path, '/'), genesisGigaChatTlsOptions() + $options);
    } catch (RuntimeException $error) {
        genesisGigaChatHandleError($error);
    }
}

function genesisGigaChatAudioFile(array $audio): array
{
    $mimeType = strtolower(trim(explode(';', genesisGeminiString($audio['mimeType'] ?? '', 100), 2)[0]));
    $formats = [
        'audio/mp4' => ['audio/mp4', 'm4a'],
        'audio/m4a' => ['audio/x-m4a', 'm4a'],
        'audio/mpeg' => ['audio/mpeg', 'mp3'],
        'audio/mp3' => ['audio/mpeg', 'mp3'],
        'audio/ogg' => ['audio/x-ogg', 'ogg'],
        'audio/opus' => ['audio/opus', 'opus'],
        'audio/wav' => ['audio/wav', 'wav'],
        'audio/webm' => ['audio/webm', 'weba'],
    ];
    if (!isset($formats[$mimeType])) throw new InvalidArgumentException('Unsupported audio format.');
    $decoded = base64_decode((string)($audio['data'] ?? ''), true);
    if (!is_string($decoded) || $decoded === '' || strlen($decoded) > GENESIS_GEMINI_MAX_AUDIO_BYTES) {
        throw new InvalidArgumentException('Voice recording is empty or too large.');
    }
    return ['bytes' => $decoded, 'mimeType' => $formats[$mimeType][0], 'extension' => $formats[$mimeType][1]];
}

function genesisGigaChatUploadAudio(array $audio, string $accessToken): string
{
    $file = genesisGigaChatAudioFile($audio);
    $temporaryPath = tempnam(sys_get_temp_dir(), 'genesis-voice-');
    if (!is_string($temporaryPath) || file_put_contents($temporaryPath, $file['bytes'], LOCK_EX) === false) {
        throw new RuntimeException('Could not prepare the voice recording.');
    }
    try {
        $response = genesisGigaChatRequest('/files', [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => [
                'file' => new CURLFile($temporaryPath, $file['mimeType'], 'genesis-command.' . $file['extension']),
                'purpose' => 'general',
            ],
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $accessToken,
            ],
            CURLOPT_TIMEOUT => 60,
        ]);
    } finally {
        @unlink($temporaryPath);
    }
    $fileId = trim((string)($response['id'] ?? ''));
    if ($fileId === '') throw new RuntimeException('GigaChat returned no uploaded file ID.');
    return $fileId;
}

function genesisGigaChatDeleteFile(string $fileId, string $accessToken): void
{
    if ($fileId === '') return;
    try {
        genesisGigaChatRequest('/files/' . rawurlencode($fileId) . '/delete', [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => '',
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $accessToken,
            ],
            CURLOPT_TIMEOUT => 30,
        ]);
    } catch (Throwable $error) {
        genesisLogError('Could not delete the temporary GigaChat audio file.', $error);
    }
}

function genesisGigaChatOutputText(array $response): string
{
    $content = $response['choices'][0]['message']['content'] ?? null;
    if (!is_string($content) || trim($content) === '') {
        throw new RuntimeException('GigaChat returned no planning result.');
    }
    return trim($content);
}

function genesisAssistantSystemInstruction(array $context): string
{
    $languageInstruction = genesisGeminiLanguageInstruction($context['language']);
    return <<<PROMPT
You are the planning parser for the GENESIS calendar. Convert the user's written or spoken request into a draft only. Never execute actions and never invent goals the user did not request.

Rules:
- Return only the structured response required by the JSON schema.
- {$languageInstruction}
- The command or audio may contain a noisy speech transcript. Remove interface phrases such as "create a task", "создай задачу", "add a reminder", and similar wording from the task title. A task title must describe the action itself, for example "Позвонить врачу", never "Создай задачу".
- Interpret relative dates using context.today and context.timeZone. All output dates must be Gregorian ISO YYYY-MM-DD.
- startDate is when work starts; dueDate is the final deadline. If only one date is given, use it for both. If no date is given, use context.today for both.
- Never make dueDate earlier than startDate. Do not choose a past date unless the user explicitly named that past date.
- Match existing project, category, task-list, and account names exactly when the user refers to them.
- When the user asks to put, place, add, move, or assign a task in/to/for an existing project, set that task's project field to the exact context title and do not leave the placement words in the task title.
- Add an item to projects or taskLists only when the user explicitly asks to create it. A task may reference an existing item without recreating it.
- A taskLists item means a Google Tasks list. Use accountEmail only when the user selected a connected account.
- Keep titles concise. Preserve meaningful wording from the user. Use empty strings and empty arrays for omitted optional details.
- Treat "под названием", "с названием", "назови её", "named", "called", and "with the title" as instructions about the title field. For "создай задачу под названием Задача номер 1", output title exactly "Задача номер 1"; keep the word "Задача" when it is part of the requested name.
- priority is 1 to 10 (10 is highest); default to 5. reminderMinutes is 0 when no reminder was requested.
- If the request is not about creating projects, Google Tasks lists, or tasks, return empty action arrays and explain briefly in summary.
PROMPT;
}

function genesisCreateGigaChatPlan(array $payload): array
{
    if (!genesisGigaChatAvailable()) genesisJson(['error' => 'GIGACHAT_NOT_CONFIGURED'], 503);
    $command = genesisGeminiString($payload['command'] ?? '', 4000);
    $audio = is_array($payload['audio'] ?? null) ? $payload['audio'] : null;
    if ($command === '' && $audio === null) throw new InvalidArgumentException('Voice recording or command text is required.');

    $context = genesisGeminiContext($payload['context'] ?? []);
    genesisGeminiRateLimit();
    $accessToken = genesisGigaChatAccessToken();
    $audioFileId = $audio !== null ? genesisGigaChatUploadAudio($audio, $accessToken) : '';
    $userMessage = [
        'role' => 'user',
        'content' => "Current GENESIS context (user-provided planning metadata):\n"
            . json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
            . "\n\nWritten command (may be empty when audio is attached):\n"
            . $command
            . ($audioFileId !== '' ? "\n\nListen to the attached audio command and use it as the primary request." : ''),
    ];
    if ($audioFileId !== '') $userMessage['attachments'] = [$audioFileId];

    try {
        $response = genesisGigaChatRequest('/chat/completions', [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode([
                'model' => genesisGigaChatModel(),
                'messages' => [
                    ['role' => 'system', 'content' => genesisAssistantSystemInstruction($context)],
                    $userMessage,
                ],
                'temperature' => 0.1,
                'max_tokens' => 8192,
                'response_format' => [
                    'type' => 'json_schema',
                    'schema' => genesisGeminiPlanSchema(),
                    'strict' => true,
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Content-Type: application/json',
                'Authorization: Bearer ' . $accessToken,
            ],
            CURLOPT_TIMEOUT => 90,
        ]);
    } finally {
        genesisGigaChatDeleteFile($audioFileId, $accessToken);
    }

    $plan = json_decode(genesisGigaChatOutputText($response), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($plan)) throw new RuntimeException('GigaChat returned an invalid planning result.');
    return ['provider' => 'gigachat', 'model' => genesisGigaChatModel(), 'plan' => genesisNormalizeGeminiPlan($plan)];
}

function genesisAssistantProvider(): string
{
    if (genesisGigaChatAvailable()) return 'gigachat';
    if (genesisGeminiAvailable()) return 'gemini';
    return 'local';
}

function genesisAssistantAvailable(): bool
{
    return genesisAssistantProvider() !== 'local';
}

function genesisAssistantModel(): string
{
    return genesisAssistantProvider() === 'gigachat' ? genesisGigaChatModel()
        : (genesisAssistantProvider() === 'gemini' ? genesisGeminiModel() : '');
}

function genesisCreateAssistantPlan(array $payload): array
{
    if (genesisGigaChatAvailable()) return genesisCreateGigaChatPlan($payload);
    if (genesisGeminiAvailable()) return ['provider' => 'gemini'] + genesisCreateGeminiPlan($payload);
    genesisJson(['error' => 'ASSISTANT_NOT_CONFIGURED'], 503);
}
