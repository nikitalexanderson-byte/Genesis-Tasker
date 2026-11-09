<?php
declare(strict_types=1);
require_once __DIR__ . '/entry-types.php';
require_once __DIR__ . '/google-sync-cache.php';
require_once __DIR__ . '/calendar.php';

require_once __DIR__ . '/relocation.php';

const GENESIS_GOOGLE_IDENTITY_SCOPES = [
    'openid',
    'email',
    'profile',
];

const GENESIS_GOOGLE_SERVICE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/tasks',
];

const GENESIS_GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

const GENESIS_GOOGLE_SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/tasks',
];

const GENESIS_GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

final class GenesisGoogleHttpException extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $googleError,
        string $message,
    ) {
        parent::__construct($message);
    }
}

function genesisBase64Url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function genesisGoogleRedirectUri(): string
{
    return genesisRelocationWebOrigin(genesisConfig(), $_SERVER) . '/api/auth/google/callback';
}

function genesisGoogleAuthUrl(string $state, string $challenge, string $purpose = 'login', ?string $loginHint = null, ?string $nonce = null): string
{
    $config = genesisConfig();
    if (empty($config['google_client_id'])) {
        throw new RuntimeException('Google OAuth client is not configured.');
    }
    if (!in_array($purpose, ['login', 'services', 'link', 'reauth', 'recovery'], true)) {
        throw new InvalidArgumentException('Google OAuth purpose is invalid.');
    }
    $connectServices = $purpose === 'services' || $purpose === 'link' && !genesisGoogleIdentityManagementEnabled();
    $parameters = [
        'client_id' => (string)$config['google_client_id'],
        'redirect_uri' => genesisGoogleRedirectUri(),
        'response_type' => 'code',
        'scope' => implode(' ', $connectServices ? GENESIS_GOOGLE_SCOPES : GENESIS_GOOGLE_IDENTITY_SCOPES),
        'access_type' => $connectServices ? 'offline' : 'online',
        'include_granted_scopes' => 'true',
        'prompt' => $purpose === 'link' ? 'consent select_account' : ($connectServices ? 'consent' : 'select_account'),
        'state' => $state,
        'code_challenge' => $challenge,
        'code_challenge_method' => 'S256',
    ];
    if ($nonce !== null) $parameters['nonce']=$nonce;
    if (in_array($purpose,['reauth','recovery'],true)) $parameters['max_age']='0';
    if ($purpose === 'services' && is_string($loginHint) && $loginHint !== '') {
        $parameters['login_hint'] = $loginHint;
    }
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986);
}

function genesisCurl(string $url, array $options = []): array
{
    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADER => true,
        CURLOPT_USERAGENT => 'GENESIS-Calendar/2.0',
    ] + $options);
    $raw = curl_exec($handle);
    if ($raw === false) {
        $message = curl_error($handle);
        curl_close($handle);
        throw new RuntimeException('Google connection failed: ' . $message);
    }
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $headerSize = (int)curl_getinfo($handle, CURLINFO_HEADER_SIZE);
    curl_close($handle);
    $body = substr((string)$raw, $headerSize);
    $decoded = json_decode($body, true);
    if ($status < 200 || $status >= 300) {
        $errorValue = is_array($decoded) ? ($decoded['error'] ?? null) : null;
        $errorCode = is_string($errorValue)
            ? $errorValue
            : (is_array($errorValue) ? (string)($errorValue['status'] ?? $errorValue['code'] ?? '') : '');
        $message = is_array($decoded)
            ? (string)($decoded['error_description'] ?? (is_array($errorValue) ? ($errorValue['message'] ?? null) : null) ?? $errorCode ?: 'Google API error')
            : 'Google API error';
        throw new GenesisGoogleHttpException($status, mb_substr($errorCode, 0, 100), $message . ' (' . $status . ')');
    }
    return is_array($decoded) ? $decoded : [];
}

function genesisGoogleTokenRequest(array $fields): array
{
    return genesisCurl('https://oauth2.googleapis.com/token', [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
    ]);
}

function genesisExchangeGoogleCode(string $code, string $verifier): array
{
    $config = genesisConfig();
    return genesisGoogleTokenRequest([
        'code' => $code,
        'client_id' => (string)$config['google_client_id'],
        'client_secret' => (string)$config['google_client_secret'],
        'redirect_uri' => genesisGoogleRedirectUri(),
        'grant_type' => 'authorization_code',
        'code_verifier' => $verifier,
    ]);
}

/** Exchange the one-time code produced by Android AuthorizationClient. */
function genesisExchangeNativeGoogleCode(string $code): array
{
    $config = genesisConfig();
    return genesisGoogleTokenRequest([
        'code' => $code,
        'client_id' => (string)$config['google_client_id'],
        'client_secret' => (string)$config['google_client_secret'],
        'redirect_uri' => '',
        'grant_type' => 'authorization_code',
    ]);
}

function genesisGoogleUserInfo(string $accessToken): array
{
    return genesisCurl('https://openidconnect.googleapis.com/v1/userinfo', [
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
    ]);
}

function genesisGoogleTokenHasScopes(array $tokens, array $requiredScopes): bool
{
    $grantedScopes = preg_split('/\s+/', trim((string)($tokens['scope'] ?? ''))) ?: [];
    foreach ($requiredScopes as $requiredScope) {
        if (!in_array($requiredScope, $grantedScopes, true)) {
            return false;
        }
    }
    return true;
}

function genesisRevokeGoogleToken(array $user): void
{
    $token = genesisDecrypt($user['refresh_token_enc'] ?? null)
        ?: genesisDecrypt($user['access_token_enc'] ?? null);
    if (!is_string($token) || $token === '') {
        return;
    }

    $handle = curl_init('https://oauth2.googleapis.com/revoke');
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query(['token' => $token], '', '&', PHP_QUERY_RFC3986),
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_USERAGENT => 'GENESIS-Calendar/2.0',
    ]);
    $result = curl_exec($handle);
    if ($result === false) {
        $message = curl_error($handle);
        curl_close($handle);
        throw new RuntimeException('Google token revocation failed: ' . $message);
    }
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if (!in_array($status, [200, 400], true)) {
        throw new RuntimeException('Google token revocation failed (' . $status . ').');
    }
}

function genesisGoogleAccessToken(array $user, bool $forceRefresh = false): string
{
    $user = (!empty($user['_linked_account']) ? genesisFindLinkedGoogleAccount((string)$user['id'])
        : genesisFindUser((string)$user['id'])) ?? $user;
    $current = genesisDecrypt($user['access_token_enc'] ?? null);
    if (!$forceRefresh && $current && (int)($user['token_expires_at'] ?? 0) > time() + 60) {
        return $current;
    }
    $refresh = genesisDecrypt($user['refresh_token_enc'] ?? null);
    if (!$refresh) {
        throw new RuntimeException('Google Calendar authorization must be renewed.');
    }
    $config = genesisConfig();
    try {
        $tokens = genesisGoogleTokenRequest([
            'client_id' => (string)$config['google_client_id'],
            'client_secret' => (string)$config['google_client_secret'],
            'refresh_token' => $refresh,
            'grant_type' => 'refresh_token',
        ]);
    } catch (GenesisGoogleHttpException $error) {
        if ($error->googleError === 'invalid_grant') {
            genesisClearGoogleAuthorization($user);
            throw new RuntimeException('Google authorization must be renewed.');
        }
        throw $error;
    }
    $access = (string)$tokens['access_token'];
    $table = !empty($user['_linked_account']) ? 'linked_google_accounts' : 'users';
    genesisDb()->prepare("UPDATE {$table} SET access_token_enc = :access, token_expires_at = :expires_at, updated_at = :updated_at WHERE id = :id AND refresh_token_enc IS :expected_refresh")->execute([
        'access' => genesisEncrypt($access),
        'expires_at' => time() + genesisClampInt($tokens['expires_in'] ?? 3600, 60, 86400, 3600) - 60,
        'updated_at' => genesisNow(),
        'id' => (string)$user['id'],
        'expected_refresh' => $user['refresh_token_enc'] ?? null,
    ]);
    genesisLogError('[AuthFlow] TOKEN_REFRESH_SUCCESS');
    return $access;
}

function genesisClearGoogleAuthorization(array $user): void
{
    $table = !empty($user['_linked_account']) ? 'linked_google_accounts' : 'users';
    genesisDb()->prepare("UPDATE {$table} SET access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL, granted_scopes = '', updated_at = :updated_at WHERE id = :id AND refresh_token_enc IS :expected_refresh AND access_token_enc IS :expected_access")->execute([
        'updated_at' => genesisNow(),
        'id' => (string)$user['id'],
        'expected_refresh' => $user['refresh_token_enc'] ?? null,
        'expected_access' => $user['access_token_enc'] ?? null,
    ]);
}

function genesisRemoveGoogleScope(array $user, string $scope): void
{
    $granted = preg_split('/\s+/', trim((string)($user['granted_scopes'] ?? ''))) ?: [];
    $granted = array_values(array_filter($granted, static fn(string $value): bool => $value !== $scope));
    $table = !empty($user['_linked_account']) ? 'linked_google_accounts' : 'users';
    genesisDb()->prepare("UPDATE {$table} SET access_token_enc = NULL, token_expires_at = NULL, granted_scopes = :scopes, updated_at = :updated_at WHERE id = :id AND refresh_token_enc IS :expected_refresh AND access_token_enc IS :expected_access")->execute([
        'scopes' => implode(' ', $granted),
        'updated_at' => genesisNow(),
        'id' => (string)$user['id'],
        'expected_refresh' => $user['refresh_token_enc'] ?? null,
        'expected_access' => $user['access_token_enc'] ?? null,
    ]);
}

function genesisHandleGoogleAuthorizationFailure(array $user, string $scope, GenesisGoogleHttpException $error): void
{
    if ($error->status === 401) {
        // An expired/rejected access token is not proof that the refresh grant
        // was revoked. Only invalid_grant from the token endpoint clears it.
        throw new RuntimeException('Google access token was rejected; synchronization will retry.');
    }
    if ($error->status === 403 && in_array($error->googleError, ['PERMISSION_DENIED', 'insufficientPermissions', 'authError'], true)) {
        genesisRemoveGoogleScope($user, $scope);
        throw new RuntimeException('Google permission must be renewed.');
    }
    throw $error;
}

function genesisGoogleApi(string $method, string $path, array $user, ?array $payload = null): array
{
    $user = (!empty($user['_linked_account']) ? genesisFindLinkedGoogleAccount((string)$user['id'])
        : genesisFindUser((string)$user['id'])) ?? $user;
    genesisGoogleQuotaCheck('calendar');
    $path .= (str_contains($path, '?') ? '&' : '?') . 'quotaUser=' . substr(genesisGoogleCacheKey($user), 0, 40);
    $headers = [
        'Authorization: Bearer ' . genesisGoogleAccessToken($user),
        'Accept: application/json',
    ];
    $options = [CURLOPT_CUSTOMREQUEST => $method];
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
    $options[CURLOPT_HTTPHEADER] = $headers;
    try {
        return genesisCurl('https://www.googleapis.com/calendar/v3' . $path, $options);
    } catch (GenesisGoogleHttpException $error) {
        if ($error->status === 401) {
            $options[CURLOPT_HTTPHEADER][0] = 'Authorization: Bearer ' . genesisGoogleAccessToken($user, true);
            try { return genesisCurl('https://www.googleapis.com/calendar/v3' . $path, $options); }
            catch (GenesisGoogleHttpException $retryError) { $error = $retryError; }
        }
        genesisGoogleRecordQuotaError('calendar', $error);
        if (genesisGoogleDailyQuotaError($error)) throw new GenesisGoogleHttpException(429, 'GENESIS_GOOGLE_DAILY_QUOTA', genesisGoogleQuotaWarning('calendar'));
        genesisHandleGoogleAuthorizationFailure($user, GENESIS_GOOGLE_CALENDAR_SCOPE, $error);
    }
}

function genesisGoogleTasksApi(string $method, string $path, array $user, ?array $payload = null): array
{
    $user = (!empty($user['_linked_account']) ? genesisFindLinkedGoogleAccount((string)$user['id'])
        : genesisFindUser((string)$user['id'])) ?? $user;
    genesisGoogleQuotaCheck('tasks');
    $path .= (str_contains($path, '?') ? '&' : '?') . 'quotaUser=' . substr(genesisGoogleCacheKey($user), 0, 40);
    $headers = [
        'Authorization: Bearer ' . genesisGoogleAccessToken($user),
        'Accept: application/json',
    ];
    $options = [CURLOPT_CUSTOMREQUEST => $method];
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
    $options[CURLOPT_HTTPHEADER] = $headers;
    try {
        return genesisCurl('https://tasks.googleapis.com/tasks/v1' . $path, $options);
    } catch (GenesisGoogleHttpException $error) {
        if ($error->status === 401) {
            $options[CURLOPT_HTTPHEADER][0] = 'Authorization: Bearer ' . genesisGoogleAccessToken($user, true);
            try { return genesisCurl('https://tasks.googleapis.com/tasks/v1' . $path, $options); }
            catch (GenesisGoogleHttpException $retryError) { $error = $retryError; }
        }
        genesisGoogleRecordQuotaError('tasks', $error);
        if (genesisGoogleDailyQuotaError($error)) throw new GenesisGoogleHttpException(429, 'GENESIS_GOOGLE_DAILY_QUOTA', genesisGoogleQuotaWarning('tasks'));
        genesisHandleGoogleAuthorizationFailure($user, GENESIS_GOOGLE_TASKS_SCOPE, $error);
    }
}

function genesisGoogleScopeGranted(array $user, string $scope): bool
{
    $granted = preg_split('/\s+/', trim((string)($user['granted_scopes'] ?? ''))) ?: [];
    return in_array($scope, $granted, true);
}

function genesisEnsureGoogleCalendar(array $user): array
{
    if (!genesisGoogleScopeGranted($user, GENESIS_GOOGLE_CALENDAR_SCOPE)) {
        throw new RuntimeException('Обновите доступ Google Calendar для синхронизации.');
    }
    if (!empty($user['google_calendar_id'])) {
        return $user;
    }
    $calendar = genesisGoogleApi('POST', '/calendars', $user, [
        'summary' => 'GENESIS',
        'description' => genesisGoogleLanguage($user) === 'en'
            ? 'Tasks and reminders from GENESIS. Content is stored in Google Calendar, not in the GENESIS database.'
            : 'Задачи и напоминания приложения GENESIS. Содержание хранится в Google Calendar, а не в базе GENESIS.',
        'timeZone' => genesisClientTimeZone()->getName(),
    ]);
    if (empty($calendar['id'])) {
        throw new RuntimeException('Google Calendar could not be created.');
    }
    $table = !empty($user['_linked_account']) ? 'linked_google_accounts' : 'users';
    genesisDb()->prepare("UPDATE {$table} SET google_calendar_id = :calendar_id, updated_at = :updated_at WHERE id = :id")->execute([
        'calendar_id' => (string)$calendar['id'],
        'updated_at' => genesisNow(),
        'id' => (string)$user['id'],
    ]);
    $user['google_calendar_id'] = (string)$calendar['id'];
    return $user;
}

function genesisStringList(mixed $value, int $limit = 50): array
{
    if (!is_array($value)) {
        return [];
    }
    $result = [];
    foreach ($value as $item) {
        $clean = mb_substr(trim((string)$item), 0, 100);
        if ($clean !== '' && !in_array($clean, $result, true)) {
            $result[] = $clean;
        }
        if (count($result) >= $limit) {
            break;
        }
    }
    return $result;
}

function genesisTaskOrigin(mixed $value, string $fallback = 'genesis'): string
{
    $origin = trim((string)$value);
    return in_array($origin, ['genesis', 'google-calendar', 'google-tasks'], true) ? $origin : $fallback;
}

function genesisGoogleLanguage(array $source): string
{
    return ($source['_language'] ?? $source['language'] ?? 'ru') === 'ru' ? 'ru' : 'en';
}

function genesisNormalizeTaskReminders(mixed $value, mixed $legacyReminderMinutes = null): array
{
    $source = is_array($value) ? $value : [];
    $result = [];
    $seen = [];
    foreach ($source as $candidate) {
        if (!is_array($candidate)) {
            continue;
        }
        $kind = (string)($candidate['kind'] ?? '');
        $reminder = null;
        if ($kind === 'relative' && is_numeric($candidate['minutes'] ?? null)) {
            $minutes = (int)$candidate['minutes'];
            if ($minutes >= 0 && $minutes <= 40320) {
                $reminder = ['kind' => 'relative', 'minutes' => $minutes];
            }
        } elseif ($kind === 'absolute') {
            $at = trim((string)($candidate['at'] ?? ''));
            if ($at !== '' && strlen($at) <= 64) {
                try {
                    $instant = new DateTimeImmutable($at);
                    $reminder = ['kind' => 'absolute', 'at' => $instant->format(DATE_RFC3339)];
                } catch (Throwable) {
                    $reminder = null;
                }
            }
        }
        if ($reminder === null) {
            continue;
        }
        $key = $reminder['kind'] === 'relative'
            ? 'relative:' . $reminder['minutes']
            : 'absolute:' . $reminder['at'];
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $result[] = $reminder;
        if (count($result) >= 5) {
            break;
        }
    }
    if (!$result && $legacyReminderMinutes !== null && is_numeric($legacyReminderMinutes)) {
        $result[] = [
            'kind' => 'relative',
            'minutes' => genesisClampInt($legacyReminderMinutes, 0, 40320, 30),
        ];
    }
    return $result;
}

function genesisTaskReminderOverrides(array $reminders, DateTimeImmutable $eventStart): array
{
    $overrides = [];
    $seen = [];
    foreach ($reminders as $reminder) {
        if (($reminder['kind'] ?? '') === 'relative') {
            $minutes = (int)($reminder['minutes'] ?? -1);
        } else {
            try {
                $instant = new DateTimeImmutable((string)($reminder['at'] ?? ''));
            } catch (Throwable) {
                throw new InvalidArgumentException('Дата напоминания указана неверно.');
            }
            $minutes = (int)round(($eventStart->getTimestamp() - $instant->getTimestamp()) / 60);
        }
        if ($minutes < 0 || $minutes > 40320) {
            throw new InvalidArgumentException('Напоминание должно быть установлено от момента начала задачи до 4 недель перед ним.');
        }
        if (isset($seen[$minutes])) {
            continue;
        }
        $seen[$minutes] = true;
        $overrides[] = ['method' => 'popup', 'minutes' => $minutes];
    }
    return array_slice($overrides, 0, 5);
}

function genesisGoogleRecurrenceLines(array $task, string $dueDate, string $timeValue, string $timezoneName): array
{
    $mode = (string)($task['recurrenceMode'] ?? 'none');
    $seriesId = trim((string)($task['recurrenceSeriesId'] ?? ''));
    if (!in_array($mode, ['genesis', 'classic', 'lunar'], true) || $seriesId !== '') {
        return [];
    }

    $dates = array_values(array_filter(
        genesisStringList($task['recurrenceDates'] ?? [], 500),
        static fn(string $date): bool => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1,
    ));
    sort($dates);
    $dates = array_values(array_unique($dates));
    $additionalDates = array_values(array_filter($dates, static fn(string $date): bool => $date !== $dueDate));
    if ($additionalDates === []) {
        return [];
    }

    $context = genesisCalendarContext($task['recurrenceContext'] ?? null, $timezoneName);
    $useUtc = $context['version'] === 2 && $timeValue !== '';
    $values = array_map(static function (string $date) use ($timeValue, $context, $useUtc): string {
        if ($useUtc) return genesisCalendarWallDateTime($date, $timeValue, $context['timeZone'])->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
        $compactDate = str_replace('-', '', $date);
        return $timeValue === '' ? $compactDate : $compactDate . 'T' . str_replace(':', '', $timeValue) . '00';
    }, $additionalDates);
    $prefix = $timeValue === '' ? 'RDATE;VALUE=DATE:' : ($useUtc ? 'RDATE:' : 'RDATE;TZID=' . $timezoneName . ':');
    return array_map(
        static fn(array $chunk): string => $prefix . implode(',', $chunk),
        array_chunk($values, 50),
    );
}

function genesisTaskPayloadForGoogle(string $taskId, array $task): array
{
    $timezone = genesisClientTimeZone();
    $timezoneName = $timezone->getName();
    $ruleContext = genesisCalendarContext($task['recurrenceContext'] ?? null, $timezoneName);
    $versionedRule = $ruleContext['version'] === 2 && in_array($task['recurrenceMode'] ?? '', ['genesis','classic','lunar'], true);
    if ($versionedRule) { $timezoneName = $ruleContext['timeZone']; $timezone = new DateTimeZone($timezoneName); }
    $title = mb_substr(trim((string)($task['title'] ?? '')), 0, 500);
    if ($title === '') {
        throw new InvalidArgumentException('Название задачи обязательно.');
    }
    $dueDate = (string)($task['dueDate'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
        throw new InvalidArgumentException('Дата задачи указана неверно.');
    }
    $endDate = (string)($task['endDate'] ?? $dueDate);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate) || $endDate < $dueDate) {
        throw new InvalidArgumentException('Срок выполнения задачи указан неверно.');
    }
    $timeValue = preg_match('/^\d{2}:\d{2}$/', (string)($task['time'] ?? '')) ? (string)$task['time'] : '';
    $eventStart = $versionedRule && $timeValue !== '' ? genesisCalendarWallDateTime($dueDate, $timeValue, $timezoneName) : new DateTimeImmutable($dueDate . ' ' . ($timeValue !== '' ? $timeValue : '00:00'), $timezone);
    $reminders = genesisNormalizeTaskReminders($task['reminders'] ?? [], $task['reminderMinutes'] ?? null);
    $reminderOverrides = genesisTaskReminderOverrides($reminders, $eventStart);
    $done = !empty($task['done']);
    $tags = genesisStringList($task['tags'] ?? [], 10);
    $dependsOn = genesisStringList($task['dependsOnIds'] ?? [], 30);
    $priority = genesisClampInt($task['priority'] ?? 5, 1, 10, 5);
    $recurrence = in_array($task['recurrence'] ?? '', ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'], true) ? (string)$task['recurrence'] : 'none';
    $recurrenceMode = in_array($task['recurrenceMode'] ?? '', ['none', 'genesis', 'classic', 'lunar'], true) ? (string)$task['recurrenceMode'] : 'none';
    $recurrencePattern = in_array($task['recurrencePattern'] ?? '', ['none', 'daily', 'weekdays', 'monthly', 'yearly', 'pyata-days', 'month-days', 'lunar-days', 'lunar-decades', 'lunar-decade-days', 'lunar-phases', 'lunar-yearly'], true) ? (string)$task['recurrencePattern'] : 'none';
    $recurrenceDays = array_values(array_unique(array_filter(
        array_map('intval', genesisStringList($task['recurrenceDays'] ?? [], 30)),
        static fn(int $day): bool => $day >= 1 && $day <= 30,
    )));
    sort($recurrenceDays);
    $recurrenceStartDate = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($task['recurrenceStartDate'] ?? '')) ? (string)$task['recurrenceStartDate'] : '';
    $recurrenceEndDate = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($task['recurrenceEndDate'] ?? '')) ? (string)$task['recurrenceEndDate'] : '';
    $recurrenceMonths = array_values(array_unique(array_filter(
        array_map('intval', genesisStringList($task['recurrenceMonths'] ?? [], 72)),
        static fn(int $month): bool => $month >= 1 && $month <= 72,
    )));
    sort($recurrenceMonths);
    $recurrencePyatas = array_values(array_unique(array_filter(
        array_map('intval', genesisStringList($task['recurrencePyatas'] ?? [], 6)),
        static fn(int $pyata): bool => $pyata >= 1 && $pyata <= 6,
    )));
    sort($recurrencePyatas);
    $recurrenceSeriesId = mb_substr(trim((string)($task['recurrenceSeriesId'] ?? '')), 0, 100);
    $recurrenceExcludedDates = array_values(array_filter(
        genesisStringList($task['recurrenceExcludedDates'] ?? [], 500),
        static fn(string $date): bool => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1,
    ));
    $project = mb_substr(trim((string)($task['project'] ?? '')), 0, 300);
    $description = genesisEntryDescription($task, genesisCleanTaskDescription($task['description'] ?? ''));
    $calendarMode = in_array($task['calendarMode'] ?? '', ['profane', 'sacred', 'lunar'], true) ? (string)$task['calendarMode'] : 'profane';
    $calendarNote = mb_substr(trim((string)($task['calendarNote'] ?? '')), 0, 1200);
    if ($calendarMode === 'profane') {
        $calendarNote = '';
    }
    $createdIn = genesisTaskOrigin($task['createdIn'] ?? null);
    $private = [
        'genesisTaskId' => $taskId,
        'genesisEntryType' => $task['entryType'] ?? $task['yandexEntryType'] ?? 'task',
        'genesisEndTime' => $task['endTime'] ?? '',
        'genesisDone' => $done ? '1' : '0',
        'genesisCompletedAt' => mb_substr((string)($task['completedAt'] ?? ''), 0, 40),
        'genesisProjectId' => mb_substr((string)($task['projectId'] ?? ''), 0, 100),
        'genesisProject' => $project,
        'genesisCategoryId' => mb_substr((string)($task['categoryId'] ?? ''), 0, 100),
        'genesisTags' => genesisBase64Url(json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
        'genesisDependsOn' => genesisBase64Url(json_encode($dependsOn, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
        'genesisRecurrence' => $recurrence,
        'genesisInterval' => (string)genesisClampInt($task['recurrenceInterval'] ?? 1, 1, 99, 1),
        'genesisCalendarContext' => genesisBase64Url(json_encode($ruleContext, JSON_THROW_ON_ERROR)),
        'genesisInvalidDayPolicy' => 'skip',
        'genesisCycleMode' => $recurrenceMode,
        'genesisCyclePattern' => $recurrencePattern,
        'genesisCycleDays' => genesisBase64Url(json_encode($recurrenceDays, JSON_THROW_ON_ERROR)),
        'genesisCycleStart' => $recurrenceStartDate,
        'genesisCycleEnd' => $recurrenceEndDate,
        'genesisCycleMonths' => genesisBase64Url(json_encode($recurrenceMonths, JSON_THROW_ON_ERROR)),
        'genesisCyclePyatas' => genesisBase64Url(json_encode($recurrencePyatas, JSON_THROW_ON_ERROR)),
        'genesisExcludedDates' => genesisBase64Url(json_encode($recurrenceExcludedDates, JSON_THROW_ON_ERROR)),
        'genesisSeriesId' => $recurrenceSeriesId,
        'genesisOccurrenceDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($task['recurrenceOriginalDate'] ?? '')) ? $task['recurrenceOriginalDate'] : '',
        'genesisPriority' => (string)$priority,
        'genesisSource' => $createdIn,
        'genesisEndDate' => $endDate,
        'genesisUpdatedAt' => (string)genesisClampInt($task['updatedAt'] ?? (int)(microtime(true) * 1000), 0, PHP_INT_MAX, (int)(microtime(true) * 1000)),
        'genesisCalendarMode' => $calendarMode,
        'genesisCalendarNote' => genesisBase64Url($calendarNote),
        'genesisReminders' => genesisBase64Url(json_encode($reminders, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
    ];
    $event = [
        'summary' => ($done ? '✓ ' : '') . $title,
        'description' => $description,
        'extendedProperties' => ['private' => $private],
        'reminders' => $reminderOverrides
            ? ['useDefault' => false, 'overrides' => $reminderOverrides]
            : ['useDefault' => false],
    ];
    if ($timeValue !== '') {
        $start = $eventStart;
        $endTime = preg_match('/\A\d{2}:\d{2}\z/', (string)($task['endTime'] ?? '')) ? $task['endTime'] : $timeValue;
        $end = $versionedRule ? genesisCalendarWallDateTime($endDate, $endTime, $timezoneName) : new DateTimeImmutable($endDate . ' ' . $endTime, $timezone);
        if ($end <= $start) {
            $end = $start->modify('+1 hour');
        }
        $event['start'] = ['dateTime' => $start->format(DATE_RFC3339), 'timeZone' => $timezoneName];
        $event['end'] = ['dateTime' => $end->format(DATE_RFC3339), 'timeZone' => $timezoneName];
        if ($versionedRule) {
            // A DST gap changes the emitted instant, never the series' saved wall time.
            $event['extendedProperties']['private']['genesisWallStart'] = $dueDate . 'T' . $timeValue;
            $event['extendedProperties']['private']['genesisWallEnd'] = $endDate . 'T' . $endTime;
            $event['extendedProperties']['private']['genesisResolvedStart'] = (string)$start->getTimestamp();
            $event['extendedProperties']['private']['genesisResolvedEnd'] = (string)$end->getTimestamp();
        }
    } else {
        $date = new DateTimeImmutable($dueDate . ' 12:00:00', $timezone);
        $rangeEnd = new DateTimeImmutable($endDate . ' 12:00:00', $timezone);
        $event['start'] = ['date' => $date->format('Y-m-d')];
        $event['end'] = ['date' => $rangeEnd->modify('+1 day')->format('Y-m-d')];
    }
    $googleRecurrence = genesisGoogleRecurrenceLines($task, $dueDate, $timeValue, $timezoneName);
    if ($googleRecurrence !== []) {
        $event['recurrence'] = $googleRecurrence;
    }
    return $event;
}

function genesisDecodeBase64Json(string $value): array
{
    $decoded = genesisDecodeBase64String($value);
    $json = is_string($decoded) ? json_decode($decoded, true) : null;
    return is_array($json) ? array_values(array_filter($json, 'is_string')) : [];
}

function genesisDecodeBase64String(string $value): string
{
    $padding = (4 - strlen($value) % 4) % 4;
    $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
    return is_string($decoded) ? $decoded : '';
}

function genesisDecodeBase64IntJson(string $value, int $minimum = 1, int $maximum = 30): array
{
    $decoded = genesisDecodeBase64String($value);
    $json = is_string($decoded) ? json_decode($decoded, true) : null;
    if (!is_array($json)) {
        return [];
    }
    $items = array_values(array_unique(array_filter(
        array_map('intval', $json),
        static fn(int $item): bool => $item >= $minimum && $item <= $maximum,
    )));
    sort($items);
    return $items;
}

function genesisDecodeTaskReminders(string $value, array $eventReminders): array
{
    $decoded = genesisDecodeBase64String($value);
    $json = $decoded !== '' ? json_decode($decoded, true) : null;
    $reminders = genesisNormalizeTaskReminders(is_array($json) ? $json : []);
    if ($reminders || ($eventReminders['useDefault'] ?? true) !== false) {
        return $reminders;
    }
    $fallback = [];
    foreach (($eventReminders['overrides'] ?? []) as $override) {
        if (is_array($override) && is_numeric($override['minutes'] ?? null)) {
            $fallback[] = ['kind' => 'relative', 'minutes' => (int)$override['minutes']];
        }
    }
    return genesisNormalizeTaskReminders($fallback);
}

function genesisDecodeTaskNotes(string $notes): array
{
    $metadata = [];
    if (preg_match('/^GENESIS-DATA:([A-Za-z0-9_-]+)$/m', str_replace("\r", '', $notes), $match)) {
        $value = $match[1];
        $padding = (4 - strlen($value) % 4) % 4;
        $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
        $parsed = is_string($decoded) ? json_decode($decoded, true) : null;
        $metadata = is_array($parsed) ? $parsed : [];
    }
    return [
        'description' => genesisCleanTaskDescription($notes),
        'metadata' => $metadata,
    ];
}

function genesisIsLegacyTaskMetadataLine(string $line): bool
{
    return preg_match('/^\s*(?:(?:Приоритет|Priority|Срок|Due|Проект|Project|Теги|Tags|Связанных задач|Linked tasks)\s*:|(?:Создано в|Created in)\s+(?:GENESIS|Google Calendar|Google Tasks)\s*$)/iu', $line) === 1;
}

function genesisHasLegacyTaskDescriptionMetadata(mixed $value): bool
{
    $lines = preg_split('/\R/u', str_replace("\r", '', (string)$value)) ?: [];
    foreach ($lines as $index => $line) {
        if (preg_match('/^\s*GENESIS-DATA:[A-Za-z0-9_-]+\s*$/u', $line) === 1) {
            return true;
        }
        if (preg_match('/^\s*[—–-]\s*GENESIS\s*[—–-]\s*$/iu', $line) !== 1) {
            continue;
        }
        foreach (array_slice($lines, $index + 1) as $candidate) {
            if (genesisIsLegacyTaskMetadataLine($candidate)) {
                return true;
            }
        }
    }
    return false;
}

function genesisCleanTaskDescription(mixed $value): string
{
    $value = preg_replace('/^GENESIS-CREATE:[a-f0-9]{64}\r?\n?/m', '', (string)$value);
    $description = str_replace("\r", '', (string)$value);
    $lines = preg_split('/\R/u', $description) ?: [];
    foreach ($lines as $index => $line) {
        if (preg_match('/^\s*[—–-]\s*GENESIS\s*[—–-]\s*$/iu', $line) !== 1) {
            continue;
        }
        $hasMetadataAfterMarker = array_filter(
            array_slice($lines, $index + 1),
            static fn(string $candidate): bool => genesisIsLegacyTaskMetadataLine($candidate)
                || preg_match('/^\s*GENESIS-DATA:[A-Za-z0-9_-]+\s*$/u', $candidate) === 1,
        ) !== [];
        if ($hasMetadataAfterMarker) {
            return mb_substr(trim(implode("\n", array_slice($lines, 0, $index))), 0, 5000);
        }
    }
    $dataIndex = null;
    foreach ($lines as $index => $line) {
        if (preg_match('/^\s*GENESIS-DATA:[A-Za-z0-9_-]+\s*$/u', $line) === 1) {
            $dataIndex = $index;
            break;
        }
    }
    if ($dataIndex === null) {
        return mb_substr(trim($description), 0, 5000);
    }
    $blockStart = $dataIndex;
    while ($blockStart > 0) {
        $previous = $lines[$blockStart - 1];
        $metadataLine = genesisIsLegacyTaskMetadataLine($previous);
        if (trim($previous) === '' || $metadataLine) {
            $blockStart -= 1;
            continue;
        }
        break;
    }
    array_splice($lines, $blockStart, $dataIndex - $blockStart + 1);
    return mb_substr(trim(implode("\n", $lines)), 0, 5000);
}

function genesisTaskNotesForGoogle(string $taskId, array $task): string
{
    return genesisEntryDescription($task, genesisCleanTaskDescription($task['description'] ?? ''));
}

function genesisGoogleEventForClient(array $event): ?array
{
    $private = $event['extendedProperties']['private'] ?? [];
    if (is_array($private) && !empty($private['genesisSharedTaskId'])) return null;
    if (($event['status'] ?? '') === 'cancelled' || !empty($event['recurringEventId'])) {
        return null;
    }
    $eventId = trim((string)($event['id'] ?? ''));
    if ($eventId === '') {
        return null;
    }
    $managedTaskId = is_array($private) ? trim((string)($private['genesisTaskId'] ?? '')) : '';
    $taskId = $managedTaskId !== ''
        ? $managedTaskId
        : 'google-event-' . substr(hash('sha256', $eventId), 0, 36);
    $createdIn = genesisTaskOrigin(
        is_array($private) ? ($private['genesisSource'] ?? null) : null,
        $managedTaskId !== '' ? 'genesis' : 'google-calendar',
    );
    $summary = (string)($event['summary'] ?? 'Без названия');
    $done = ($private['genesisDone'] ?? '') === '1' || str_starts_with($summary, '✓ ');
    $title = $done && str_starts_with($summary, '✓ ') ? mb_substr($summary, 2) : $summary;
    $timezone = genesisClientTimeZone();
    $ruleContext = genesisCalendarContext(json_decode(genesisDecodeBase64String((string)($private['genesisCalendarContext'] ?? '')), true), (string)($event['start']['timeZone'] ?? $timezone->getName()));
    $versionedRule = $ruleContext['version'] === 2 && in_array($private['genesisCycleMode'] ?? '', ['genesis', 'classic', 'lunar'], true);
    if ($versionedRule) $timezone = new DateTimeZone($ruleContext['timeZone']);
    $dateTime = $event['start']['dateTime'] ?? null;
    $date = $event['start']['date'] ?? null;
    $endDateTime = $event['end']['dateTime'] ?? null;
    $exclusiveEndDate = $event['end']['date'] ?? null;
    $dueDate = date('Y-m-d');
    $endDate = $dueDate;
    $time = '';
    if (is_string($dateTime) && $dateTime !== '') {
        $start = (new DateTimeImmutable($dateTime))->setTimezone($timezone);
        $dueDate = $start->format('Y-m-d');
        $time = $start->format('H:i');
        if ($versionedRule && (string)$start->getTimestamp() === ($private['genesisResolvedStart'] ?? '')
            && preg_match('/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/', (string)($private['genesisWallStart'] ?? ''))) {
            [$dueDate, $time] = explode('T', $private['genesisWallStart']);
        }
        if (is_string($endDateTime) && $endDateTime !== '') {
            $endDate = (new DateTimeImmutable($endDateTime))->setTimezone($timezone)->format('Y-m-d');
            if ($versionedRule && (string)(new DateTimeImmutable($endDateTime))->getTimestamp() === ($private['genesisResolvedEnd'] ?? '')
                && preg_match('/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/', (string)($private['genesisWallEnd'] ?? ''))) {
                $endDate = substr($private['genesisWallEnd'], 0, 10);
            }
        } else {
            $endDate = $dueDate;
        }
    } elseif (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        $dueDate = $date;
        if (is_string($exclusiveEndDate) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $exclusiveEndDate)) {
            $endDate = (new DateTimeImmutable($exclusiveEndDate . ' 12:00:00', $timezone))->modify('-1 day')->format('Y-m-d');
        } else {
            $endDate = $dueDate;
        }
    }
    if ($endDate < $dueDate) $endDate = $dueDate;
    $sacred = genesisSacredFromDate($dueDate);
    $description = genesisCleanTaskDescription($event['description'] ?? '');
    $reminders = genesisDecodeTaskReminders(
        (string)($private['genesisReminders'] ?? ''),
        is_array($event['reminders'] ?? null) ? $event['reminders'] : [],
    );
    $reminder = null;
    foreach ($reminders as $candidateReminder) {
        if (($candidateReminder['kind'] ?? '') === 'relative') {
            $reminder = (int)$candidateReminder['minutes'];
            break;
        }
    }
    return [
        'id' => $taskId,
        'sacredYear' => $sacred['sacredYear'],
        'monthIndex' => $sacred['monthIndex'],
        'day' => $sacred['day'],
        'dueDate' => $dueDate,
        'endDate' => $endDate,
        'title' => mb_substr($title, 0, 500),
        'description' => $description,
        'time' => $time,
        'entryType' => $private['genesisEntryType'] ?? genesisEntryTypeFromDescription($description),
        'endTime' => $private['genesisEndTime'] ?? '',
        'project' => (string)($private['genesisProject'] ?? ''),
        'projectId' => ($private['genesisProjectId'] ?? '') !== '' ? (string)$private['genesisProjectId'] : null,
        'categoryId' => ($private['genesisCategoryId'] ?? '') !== '' ? (string)$private['genesisCategoryId'] : null,
        'tags' => genesisDecodeBase64Json((string)($private['genesisTags'] ?? '')),
        'dependsOnIds' => genesisDecodeBase64Json((string)($private['genesisDependsOn'] ?? '')),
        'priority' => genesisClampInt($private['genesisPriority'] ?? 5, 1, 10, 5),
        'done' => $done,
        'completedAt' => ($private['genesisCompletedAt'] ?? '') !== '' ? (string)$private['genesisCompletedAt'] : null,
        'reminders' => $reminders,
        'reminderMinutes' => $reminder,
        'recurrence' => (string)($private['genesisRecurrence'] ?? 'none'),
        'recurrenceInterval' => genesisClampInt($private['genesisInterval'] ?? 1, 1, 99, 1),
        'recurrenceMode' => in_array($private['genesisCycleMode'] ?? '', ['none', 'genesis', 'classic', 'lunar'], true) ? (string)$private['genesisCycleMode'] : 'none',
        'recurrencePattern' => in_array($private['genesisCyclePattern'] ?? '', ['none', 'daily', 'weekdays', 'monthly', 'yearly', 'pyata-days', 'month-days', 'lunar-days', 'lunar-decades', 'lunar-decade-days', 'lunar-phases', 'lunar-yearly'], true) ? (string)$private['genesisCyclePattern'] : 'none',
        'recurrenceContext' => $ruleContext,
        'recurrenceInvalidDayPolicy' => 'skip',
        'recurrenceDays' => genesisDecodeBase64IntJson((string)($private['genesisCycleDays'] ?? '')),
        'recurrenceStartDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($private['genesisCycleStart'] ?? '')) ? (string)$private['genesisCycleStart'] : null,
        'recurrenceEndDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($private['genesisCycleEnd'] ?? '')) ? (string)$private['genesisCycleEnd'] : null,
        'recurrenceMonths' => genesisDecodeBase64IntJson((string)($private['genesisCycleMonths'] ?? ''), 1, 72),
        'recurrencePyatas' => genesisDecodeBase64IntJson((string)($private['genesisCyclePyatas'] ?? ''), 1, 6),
        'recurrenceExcludedDates' => array_values(array_filter(
            genesisDecodeBase64Json((string)($private['genesisExcludedDates'] ?? '')),
            static fn(string $date): bool => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1,
        )),
        'recurrenceSeriesId' => ($private['genesisSeriesId'] ?? '') !== '' ? (string)$private['genesisSeriesId'] : null,
        'recurrenceOriginalDate' => ($private['genesisOccurrenceDate'] ?? '') !== '' ? (string)$private['genesisOccurrenceDate'] : null,
        'calendarMode' => in_array($private['genesisCalendarMode'] ?? '', ['profane', 'sacred', 'lunar'], true) ? (string)$private['genesisCalendarMode'] : 'profane',
        'calendarNote' => mb_substr(genesisDecodeBase64String((string)($private['genesisCalendarNote'] ?? '')), 0, 1200),
        'syncToGoogle' => true,
        'createdIn' => $createdIn,
        'googleEventId' => $eventId,
        'googleTaskId' => null,
        'googleTaskListId' => null,
        'googleTaskListTitle' => '',
        'googleReadOnly' => false,
        'updatedAt' => genesisClampInt($private['genesisUpdatedAt'] ?? (strtotime((string)($event['updated'] ?? 'now')) * 1000), 0, PHP_INT_MAX, (int)(microtime(true) * 1000)),
    ];
}

function genesisGoogleNativeTaskForClient(array $task, string $taskListId, string $taskListTitle): ?array
{
    if (!empty($task['deleted'])) {
        return null;
    }
    $googleTaskId = trim((string)($task['id'] ?? ''));
    $due = (string)($task['due'] ?? '');
    if ($googleTaskId === '' || ($due !== '' && !preg_match('/^(\d{4}-\d{2}-\d{2})T/', $due, $dueMatch))) {
        return null;
    }
    $notes = genesisDecodeTaskNotes((string)($task['notes'] ?? ''));
    $metadata = $notes['metadata'];
    $managedTaskId = trim((string)($metadata['taskId'] ?? ''));
    $taskId = $managedTaskId !== ''
        ? $managedTaskId
        : 'google-task-' . substr(hash('sha256', $taskListId . "\0" . $googleTaskId), 0, 36);
    $createdIn = genesisTaskOrigin($metadata['createdIn'] ?? null, $managedTaskId !== '' ? 'genesis' : 'google-tasks');
    $endDate = $dueMatch[1] ?? '';
    $metadataStartDate = (string)($metadata['startDate'] ?? '');
    $dueDate = preg_match('/^\d{4}-\d{2}-\d{2}$/', $metadataStartDate) && $metadataStartDate <= $endDate
        ? $metadataStartDate
        : $endDate;
    $time = preg_match('/^\d{2}:\d{2}$/', (string)($metadata['time'] ?? '')) ? (string)$metadata['time'] : '';
    $sacred = $dueDate !== '' ? genesisSacredFromDate($dueDate) : ['sacredYear'=>0,'monthIndex'=>0,'day'=>0];
    $done = ($task['status'] ?? '') === 'completed';
    $updatedAt = strtotime((string)($task['updated'] ?? ''));
    $completedAt = trim((string)($task['completed'] ?? ''));
    return [
        'id' => $taskId,
        'sacredYear' => $sacred['sacredYear'],
        'monthIndex' => $sacred['monthIndex'],
        'day' => $sacred['day'],
        'dueDate' => $dueDate,
        'endDate' => $endDate,
        'title' => mb_substr(trim((string)($task['title'] ?? '')) ?: 'Без названия', 0, 500),
        'description' => $notes['description'],
        'time' => $time,
        'entryType' => $metadata['entryType'] ?? genesisEntryTypeFromDescription($notes['description']),
        'project' => mb_substr(trim((string)($metadata['project'] ?? '')), 0, 300),
        'projectId' => ($metadata['projectId'] ?? '') !== '' ? mb_substr((string)$metadata['projectId'], 0, 100) : null,
        'categoryId' => ($metadata['categoryId'] ?? '') !== '' ? mb_substr((string)$metadata['categoryId'], 0, 100) : null,
        'tags' => genesisStringList($metadata['tags'] ?? [], 10),
        'dependsOnIds' => genesisStringList($metadata['dependsOnIds'] ?? [], 30),
        'priority' => genesisClampInt($metadata['priority'] ?? 5, 1, 10, 5),
        'done' => $done,
        'completedAt' => $completedAt !== '' ? $completedAt : null,
        'reminders' => [],
        'reminderMinutes' => null,
        'recurrence' => 'none',
        'recurrenceInterval' => genesisClampInt($metadata['recurrenceInterval'] ?? 1, 1, 99, 1),
        'recurrenceMode' => in_array($metadata['recurrenceMode'] ?? '', ['none', 'genesis', 'classic', 'lunar'], true) ? (string)$metadata['recurrenceMode'] : 'none',
        'recurrencePattern' => in_array($metadata['recurrencePattern'] ?? '', ['none', 'daily', 'weekdays', 'monthly', 'yearly', 'pyata-days', 'month-days', 'lunar-days', 'lunar-decades', 'lunar-decade-days', 'lunar-phases', 'lunar-yearly'], true) ? (string)$metadata['recurrencePattern'] : 'none',
        'recurrenceContext' => genesisCalendarContext($metadata['recurrenceContext'] ?? null),
        'recurrenceInvalidDayPolicy' => 'skip',
        'recurrenceDays' => array_values(array_filter(array_map('intval', is_array($metadata['recurrenceDays'] ?? null) ? $metadata['recurrenceDays'] : []), static fn(int $day): bool => $day >= 1 && $day <= 30)),
        'recurrenceStartDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($metadata['recurrenceStartDate'] ?? '')) ? (string)$metadata['recurrenceStartDate'] : null,
        'recurrenceEndDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($metadata['recurrenceEndDate'] ?? '')) ? (string)$metadata['recurrenceEndDate'] : null,
        'recurrenceMonths' => array_values(array_filter(array_map('intval', is_array($metadata['recurrenceMonths'] ?? null) ? $metadata['recurrenceMonths'] : []), static fn(int $month): bool => $month >= 1 && $month <= 72)),
        'recurrencePyatas' => array_values(array_filter(array_map('intval', is_array($metadata['recurrencePyatas'] ?? null) ? $metadata['recurrencePyatas'] : []), static fn(int $pyata): bool => $pyata >= 1 && $pyata <= 6)),
        'recurrenceExcludedDates' => [],
        'recurrenceSeriesId' => ($metadata['recurrenceSeriesId'] ?? '') !== '' ? mb_substr((string)$metadata['recurrenceSeriesId'], 0, 100) : null,
        'calendarMode' => in_array($metadata['calendarMode'] ?? '', ['profane', 'sacred', 'lunar'], true) ? (string)$metadata['calendarMode'] : 'profane',
        'calendarNote' => mb_substr(trim((string)($metadata['calendarNote'] ?? '')), 0, 1200),
        'syncToGoogle' => true,
        'createdIn' => $createdIn,
        'googleEventId' => null,
        'googleTaskId' => $googleTaskId,
        'googleTaskListId' => $taskListId,
        'googleTaskListTitle' => mb_substr($taskListTitle, 0, 300),
        'googleReadOnly' => false,
        'updatedAt' => $updatedAt !== false ? $updatedAt * 1000 : (int)(microtime(true) * 1000),
    ];
}

/** Keep GENESIS-only fields; native Google owns title, notes, status and deadline. */
function genesisPersonalNativeMetadata(array $clientTask, array $metadata): array
{
    foreach (['project','projectId','categoryId','tags','dependsOnIds','priority','calendarMode'] as $field) {
        if (array_key_exists($field, $metadata)) $clientTask[$field] = $metadata[$field];
    }
    if ($clientTask['dueDate'] !== '') {
        $clientTask['time'] = $metadata['time'] ?? $clientTask['time'];
        // A single-day task follows a changed Google deadline. Preserve a
        // GENESIS range start only while it still precedes the native deadline.
        if (!empty($metadata['dueDate']) && $metadata['dueDate'] !== ($metadata['endDate'] ?? $metadata['dueDate'])
            && $metadata['dueDate'] <= $clientTask['endDate']) $clientTask['dueDate'] = $metadata['dueDate'];
        $sacred = genesisSacredFromDate($clientTask['dueDate']);
        foreach (['sacredYear','monthIndex','day'] as $field) $clientTask[$field] = $sacred[$field];
    } else $clientTask['time'] = '';
    return $clientTask;
}

function genesisDefaultGoogleTaskListId(array $user): string
{
    try {
        $taskList = genesisGoogleTasksApi('GET', '/users/@me/lists/@default', $user);
        return trim((string)($taskList['id'] ?? ''));
    } catch (RuntimeException) {
        return '';
    }
}

function genesisListGoogleTaskLists(array $user, ?string $knownDefault = null): array
{
    if (!genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        return [];
    }
    $taskLists = [];
    // Shared-project copies have their own lists and must not re-enter the private workspace.
    $projectionLists = genesisDb()->prepare('SELECT google_task_list_id FROM shared_google_preferences
        WHERE user_id = :user AND google_task_list_id IS NOT NULL');
    $projectionLists->execute(['user' => $user['id']]);
    $excludedListIds = array_fill_keys($projectionLists->fetchAll(PDO::FETCH_COLUMN), true);
    $defaultTaskListId = $knownDefault ?? genesisDefaultGoogleTaskListId($user);
    $pageToken = null;
    do {
        $query = ['maxResults' => 100];
        if (is_string($pageToken) && $pageToken !== '') {
            $query['pageToken'] = $pageToken;
        }
        $result = genesisGoogleTasksApi('GET', '/users/@me/lists?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986), $user);
        foreach ($result['items'] ?? [] as $taskList) {
            if (is_array($taskList) && !empty($taskList['id']) && !isset($excludedListIds[(string)$taskList['id']])) {
                $taskLists[] = [
                    'id' => (string)$taskList['id'],
                    'title' => mb_substr(trim((string)($taskList['title'] ?? 'Google Tasks')) ?: 'Google Tasks', 0, 300),
                    'updatedAt' => !empty($taskList['updated']) ? (string)$taskList['updated'] : null,
                    'isDefault' => $defaultTaskListId !== '' && hash_equals($defaultTaskListId, (string)$taskList['id']),
                ];
            }
            if (count($taskLists) >= 100) {
                break 2;
            }
        }
        $pageToken = $result['nextPageToken'] ?? null;
    } while (is_string($pageToken) && $pageToken !== '');

    return $taskLists;
}

function genesisGoogleTaskListsForClient(): array
{
    $taskLists = $GLOBALS['GENESIS_GOOGLE_TASK_LISTS'] ?? [];
    return is_array($taskLists) ? $taskLists : [];
}

function genesisListGoogleNativeTasks(array $user, array $taskLists, array $previous = [], ?string $since = null, array $knownLists = [], ?callable $fetch = null): array
{
    if (!genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        return [];
    }

    $fetch ??= 'genesisGoogleTasksApi';
    $tasks = [];
    $allowedLists = array_fill_keys(array_column($taskLists, 'id'), true);
    foreach ($previous as $task) {
        if (isset($allowedLists[$task['googleTaskListId'] ?? ''])) $tasks[$task['googleTaskListId'] . ':' . $task['googleTaskId']] = $task;
    }
    $knownListIds = array_fill_keys(array_column($knownLists, 'id'), true);
    $legacyNotesToClean = [];
    foreach ($taskLists as $taskList) {
        $taskListId = (string)$taskList['id'];
        $taskListTitle = trim((string)($taskList['title'] ?? 'Google Tasks')) ?: 'Google Tasks';
        $pageToken = null;
        do {
            $query = [
                'maxResults' => 100,
                'showCompleted' => 'true',
                'showDeleted' => $since !== null ? 'true' : 'false',
                'showHidden' => 'true',
                'showAssigned' => 'true',
            ];
            if ($since !== null && isset($knownListIds[$taskListId])) $query['updatedMin'] = $since;
            if (is_string($pageToken) && $pageToken !== '') {
                $query['pageToken'] = $pageToken;
            }
            $result = $fetch('GET', '/lists/' . rawurlencode($taskListId) . '/tasks?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986), $user);
            foreach ($result['items'] ?? [] as $task) {
                if (!is_array($task)) {
                    continue;
                }
                $previousTask = $tasks[$taskListId . ':' . ($task['id'] ?? '')] ?? null;
                if (!empty($task['id'])) unset($tasks[$taskListId . ':' . $task['id']]);
                $clientTask = genesisGoogleNativeTaskForClient($task, $taskListId, $taskListTitle);
                if ($clientTask !== null) {
                    $identity = function_exists('genesisPersonalNativeIdentity') ? genesisPersonalNativeIdentity($user, $taskListId, $task) : null;
                    if ($identity !== null) {
                        $clientTask['id'] = $identity;
                        $clientTask['createdIn'] = 'genesis';
                        // Retain GENESIS-only metadata in the existing encrypted snapshot.
                        if ($previousTask !== null && $previousTask['id'] === $identity) {
                            $clientTask = genesisPersonalNativeMetadata($clientTask, $previousTask);
                        }
                    }
                    $tasks[$taskListId . ':' . $clientTask['googleTaskId']] = $clientTask;
                }
                if (
                    count($legacyNotesToClean) < 50
                    && !empty($task['id'])
                    && genesisHasLegacyTaskDescriptionMetadata($task['notes'] ?? '')
                ) {
                    $legacyNotesToClean[] = [
                        'taskListId' => $taskListId,
                        'taskId' => (string)$task['id'],
                        'notes' => genesisCleanTaskDescription($task['notes'] ?? ''),
                    ];
                }
                if (count($tasks) > 5000) throw new RuntimeException('Google Tasks snapshot limit reached.');
            }
            $pageToken = $result['nextPageToken'] ?? null;
        } while (is_string($pageToken) && $pageToken !== '');
    }
    foreach ($legacyNotesToClean as $legacyTask) {
        try {
            $fetch(
                'PATCH',
                '/lists/' . rawurlencode($legacyTask['taskListId']) . '/tasks/' . rawurlencode($legacyTask['taskId']),
                $user,
                ['notes' => $legacyTask['notes']],
            );
        } catch (Throwable $cleanupError) {
            genesisLogError('[GoogleTasksMetadataCleanup] ' . $cleanupError->getMessage(), $cleanupError);
        }
    }
    $titles = array_column($taskLists, 'title', 'id');
    foreach ($tasks as &$task) $task['googleTaskListTitle'] = $titles[$task['googleTaskListId']] ?? $task['googleTaskListTitle'];
    unset($task);
    return array_values($tasks);
}

function genesisGoogleTasksSyncWarning(): ?string
{
    $warning = $GLOBALS['GENESIS_GOOGLE_TASKS_WARNING'] ?? null;
    return is_string($warning) && $warning !== '' ? $warning : null;
}

function genesisDecorateTaskForGoogleAccount(array $task, array $account): array
{
    $accountId = (string)$account['id'];
    if (($task['createdIn'] ?? 'genesis') !== 'genesis') {
        $task['id'] = 'account-' . substr(hash('sha256', $accountId), 0, 10) . '-' . (string)$task['id'];
    }
    $task['syncAccountIds'] = [$accountId];
    $task['googleAccountId'] = $accountId;
    $task['googleAccountEmail'] = (string)$account['email'];
    $task['googleLinks'] = [
        $accountId => [
            'eventId' => $task['googleEventId'] ?? null,
            'taskId' => $task['googleTaskId'] ?? null,
            'taskListId' => $task['googleTaskListId'] ?? null,
            'taskListTitle' => $task['googleTaskListTitle'] ?? '',
        ],
    ];
    return $task;
}

function genesisDecorateTaskListForGoogleAccount(array $taskList, array $account): array
{
    $taskList['accountId'] = (string)$account['id'];
    $taskList['accountEmail'] = (string)$account['email'];
    return $taskList;
}

function genesisListAllGoogleTasks(array $owner): array
{
    $allTasks = [];
    $allTaskLists = [];
    $warnings = [];
    $deleted = array_fill_keys(genesisDeletedTaskIds((string)$owner['id']), true);
    foreach (genesisGoogleAccountsForUser($owner) as $account) {
        if (empty($account['refresh_token_enc'])) {
            $warnings[] = 'Для обновления задач подключите Google Calendar и Tasks.';
            continue;
        }
        try {
            $accountTasks = genesisListGoogleTasks($account);
            foreach ($accountTasks as $task) {
                $decorated = genesisDecorateTaskForGoogleAccount($task, $account);
                $id = (string)$decorated['id'];
                if (isset($deleted[$id])) {
                    // Retry any copy left behind by an interrupted multi-account delete.
                    try {
                        genesisDeleteGoogleTaskFromAccount($account, (string)$owner['id'], (string)$task['id'], $task);
                    } catch (Throwable $error) {
                        $warnings[] = 'Удаление копии задачи в Google будет повторено при синхронизации.';
                        genesisLogError('[GoogleTaskDeletion] ' . $error->getMessage(), $error);
                    }
                    continue;
                }
                if (!isset($allTasks[$id])) {
                    $allTasks[$id] = $decorated;
                    continue;
                }
                $existing = $allTasks[$id];
                $existing['syncAccountIds'] = array_values(array_unique(array_merge($existing['syncAccountIds'] ?? [], [$account['id']])));
                $existing['googleLinks'] = array_merge($existing['googleLinks'] ?? [], $decorated['googleLinks'] ?? []);
                if ((int)($decorated['updatedAt'] ?? 0) > (int)($existing['updatedAt'] ?? 0)) {
                    $links = $existing['googleLinks'];
                    $accountIds = $existing['syncAccountIds'];
                    $existing = $decorated;
                    $existing['googleLinks'] = $links;
                    $existing['syncAccountIds'] = $accountIds;
                }
                $allTasks[$id] = $existing;
            }
            foreach (genesisGoogleTaskListsForClient() as $taskList) {
                $allTaskLists[] = genesisDecorateTaskListForGoogleAccount($taskList, $account);
            }
            $warning = genesisGoogleTasksSyncWarning();
            if ($warning) $warnings[] = (string)$account['email'] . ': ' . $warning;
        } catch (Throwable $error) {
            $warnings[] = (string)$account['email'] . ': синхронизация временно недоступна.';
            genesisLogError('[GoogleAccountSync] ' . $error->getMessage(), $error);
        }
    }
    // A deletion can finish while a different device is enumerating Google.
    $deleted = array_fill_keys(genesisDeletedTaskIds((string)$owner['id']), true);
    $tasks = array_values(array_filter($allTasks, static fn(array $task): bool => !isset($deleted[(string)$task['id']])));
    usort($tasks, static fn(array $left, array $right): int => [
        (string)($left['dueDate'] ?? ''),
        (string)($left['time'] ?? ''),
        (string)($left['title'] ?? ''),
    ] <=> [
        (string)($right['dueDate'] ?? ''),
        (string)($right['time'] ?? ''),
        (string)($right['title'] ?? ''),
    ]);
    $GLOBALS['GENESIS_GOOGLE_TASK_LISTS'] = $allTaskLists;
    $GLOBALS['GENESIS_GOOGLE_TASKS_WARNING'] = $warnings ? implode(' ', $warnings) : null;
    genesisTouchUser((string)$owner['id']);
    return $tasks;
}

function genesisFindGoogleEvent(array $user, string $taskId): ?array
{
    return genesisFindGoogleEvents($user, $taskId)[0] ?? null;
}

function genesisFindGoogleEvents(array $user, string $taskId): array
{
    $user = genesisEnsureGoogleCalendar($user);
    $parameters = [
        'privateExtendedProperty' => 'genesisTaskId=' . $taskId,
        'showDeleted' => 'false',
        'maxResults' => 2500,
    ];
    $events = [];
    do {
        $result = genesisGoogleApi('GET', '/calendars/' . rawurlencode((string)$user['google_calendar_id']) . '/events?'
            . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986), $user);
        foreach ($result['items'] ?? [] as $event) {
            if (is_array($event) && ($event['extendedProperties']['private']['genesisTaskId'] ?? null) === $taskId) {
                $events[] = $event;
            }
        }
        $parameters['pageToken'] = $result['nextPageToken'] ?? '';
    } while ($parameters['pageToken'] !== '');
    return $events;
}

function genesisTaskDeletionId(string $taskId, array $task): string
{
    $accountId = trim((string)($task['googleAccountId'] ?? ''));
    if (($task['createdIn'] ?? 'genesis') !== 'genesis' && $accountId !== '') {
        $prefix = 'account-' . substr(hash('sha256', $accountId), 0, 10) . '-';
        return str_starts_with($taskId, $prefix) ? $taskId : $prefix . $taskId;
    }
    return $taskId;
}

function genesisDeletedTaskIds(string $userId): array
{
    $statement = genesisDb()->prepare('SELECT task_id FROM task_deletions WHERE user_id = :user_id');
    $statement->execute(['user_id' => $userId]);
    return $statement->fetchAll(PDO::FETCH_COLUMN);
}

function genesisTaskWasDeleted(string $userId, string $taskId, array $task): bool
{
    $statement = genesisDb()->prepare('SELECT 1 FROM task_deletions WHERE user_id = :user_id AND task_id = :task_id');
    $statement->execute(['user_id' => $userId, 'task_id' => genesisTaskDeletionId($taskId, $task)]);
    return $statement->fetchColumn() !== false;
}

function genesisRecordTaskDeletion(string $userId, string $taskId, array $task): void
{
    genesisDb()->prepare('INSERT OR IGNORE INTO task_deletions (user_id, task_id, deleted_at) VALUES (:user_id, :task_id, :deleted_at)')
        ->execute(['user_id' => $userId, 'task_id' => genesisTaskDeletionId($taskId, $task), 'deleted_at' => genesisNow()]);
}

function genesisGoogleNativeTaskPayload(string $taskId, array $task): array
{
    $title = mb_substr(trim((string)($task['title'] ?? '')), 0, 500);
    if ($title === '') {
        throw new InvalidArgumentException('Название задачи обязательно.');
    }
    $dueDate = (string)($task['dueDate'] ?? '');
    if ($dueDate !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
        throw new InvalidArgumentException('Дата задачи указана неверно.');
    }
    $endDate = (string)($task['endDate'] ?? $dueDate);
    if (($dueDate === '' && $endDate !== '') || ($dueDate !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate) || $endDate < $dueDate))) {
        throw new InvalidArgumentException('Срок выполнения задачи указан неверно.');
    }
    $done = !empty($task['done']);
    $payload = [
        'title' => $title,
        'notes' => genesisTaskNotesForGoogle($taskId, $task),
        'status' => $done ? 'completed' : 'needsAction',
        // null explicitly removes an existing due date on PATCH.
        'due' => $endDate !== '' ? $endDate . 'T00:00:00.000Z' : null,
    ];
    if ($done) {
        $completed = trim((string)($task['completedAt'] ?? ''));
        $payload['completed'] = $completed !== '' ? $completed : gmdate('c');
    }
    return $payload;
}

function genesisNativeGoogleTaskAfterSave(array $clientTask, array $sourceTask, string $taskId): array
{
    return array_merge($clientTask, $sourceTask, [
        'id' => $taskId,
        'description' => genesisCleanTaskDescription($sourceTask['description'] ?? ''),
        'googleEventId' => null,
        'googleTaskId' => $clientTask['googleTaskId'] ?? null,
        'googleTaskListId' => $clientTask['googleTaskListId'] ?? null,
        'googleTaskListTitle' => $clientTask['googleTaskListTitle'] ?? '',
        'done' => $clientTask['done'] ?? !empty($sourceTask['done']),
        'completedAt' => $clientTask['completedAt'] ?? ($sourceTask['completedAt'] ?? null),
        'updatedAt' => $clientTask['updatedAt'] ?? (int)(microtime(true) * 1000),
    ]);
}

function genesisSyncNativeGoogleTask(array $user, string $userId, array $task): array
{
    if (!genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        throw new RuntimeException('Обновите доступ Google, чтобы синхронизировать списки Google Tasks.');
    }
    $taskId = trim((string)($task['googleTaskId'] ?? ''));
    $taskListId = trim((string)($task['googleTaskListId'] ?? ''));
    if ($taskId === '' || $taskListId === '') {
        throw new InvalidArgumentException('Google Task identifier is required.');
    }
    $saved = genesisGoogleTasksApi(
        'PATCH',
        '/lists/' . rawurlencode($taskListId) . '/tasks/' . rawurlencode($taskId),
        $user,
        genesisGoogleNativeTaskPayload((string)($task['id'] ?? ''), $task),
    );
    $listTitle = trim((string)($task['googleTaskListTitle'] ?? 'Google Tasks')) ?: 'Google Tasks';
    $clientTask = genesisGoogleNativeTaskForClient($saved, $taskListId, $listTitle);
    if ($clientTask === null) {
        throw new RuntimeException('Google Tasks did not return the saved task.');
    }
    genesisTouchUser($userId);
    $result = genesisNativeGoogleTaskAfterSave($clientTask, $task, (string)($task['id'] ?? $clientTask['id']));
    genesisGoogleSnapshotTaskSaved($user, $result);
    return $result;
}

function genesisCreateNativeGoogleTask(array $user, string $userId, string $taskId, array $task): array
{
    if (!genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        throw new RuntimeException('Обновите доступ Google, чтобы синхронизировать списки Google Tasks.');
    }
    $taskListId = trim((string)($task['googleTaskListId'] ?? ''));
    if ($taskListId === '') {
        throw new InvalidArgumentException('Выберите список Google Tasks.');
    }
    $saved = genesisGoogleTasksApi(
        'POST',
        '/lists/' . rawurlencode($taskListId) . '/tasks',
        $user,
        genesisGoogleNativeTaskPayload($taskId, $task),
    );
    $listTitle = trim((string)($task['googleTaskListTitle'] ?? 'Google Tasks')) ?: 'Google Tasks';
    $clientTask = genesisGoogleNativeTaskForClient($saved, $taskListId, $listTitle);
    if ($clientTask === null) {
        throw new RuntimeException('Google Tasks did not return the created task.');
    }
    genesisTouchUser($userId);
    $result = genesisNativeGoogleTaskAfterSave($clientTask, $task, $taskId);
    genesisGoogleSnapshotTaskSaved($user, $result);
    return $result;
}

function genesisTaskListAccount(string $userId, ?string $accountId): array
{
    $owner = genesisFindUser($userId);
    if ($owner === null) throw new RuntimeException('Пользователь не найден.');
    $requestedId = trim((string)$accountId);
    $account = $requestedId !== '' ? genesisGoogleAccountForUser($userId, $requestedId) : $owner;
    if ($account === null) throw new InvalidArgumentException('Google-аккаунт для списка не найден.');
    return $account;
}

function genesisCreateGoogleTaskList(string $userId, string $title, ?string $accountId = null): array
{
    $cleanTitle = mb_substr(trim($title), 0, 300);
    if ($cleanTitle === '') {
        throw new InvalidArgumentException('Название списка обязательно.');
    }
    $user = genesisTaskListAccount($userId, $accountId);
    if ($user === null || empty($user['refresh_token_enc']) || !genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        throw new RuntimeException('Обновите доступ Google, чтобы создавать списки Google Tasks.');
    }
    $saved = genesisGoogleTasksApi('POST', '/users/@me/lists', $user, ['title' => $cleanTitle]);
    if (empty($saved['id'])) {
        throw new RuntimeException('Google Tasks did not return the created list.');
    }
    genesisTouchUser($userId);
    $list = [
        'id' => (string)$saved['id'],
        'title' => mb_substr(trim((string)($saved['title'] ?? $cleanTitle)), 0, 300),
        'updatedAt' => !empty($saved['updated']) ? (string)$saved['updated'] : null,
        'isDefault' => false,
    ];
    genesisGoogleSnapshotListSaved($user, $list);
    return genesisDecorateTaskListForGoogleAccount($list, $user);
}

function genesisUpdateGoogleTaskList(string $userId, string $taskListId, string $title, ?string $accountId = null): array
{
    $cleanTaskListId = trim($taskListId);
    $cleanTitle = mb_substr(trim($title), 0, 300);
    if ($cleanTaskListId === '') {
        throw new InvalidArgumentException('Идентификатор списка обязателен.');
    }
    if ($cleanTitle === '') {
        throw new InvalidArgumentException('Название списка обязательно.');
    }
    $user = genesisTaskListAccount($userId, $accountId);
    if ($user === null || empty($user['refresh_token_enc']) || !genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        throw new RuntimeException('Обновите доступ Google, чтобы переименовывать списки Google Tasks.');
    }
    $saved = genesisGoogleTasksApi(
        'PATCH',
        '/users/@me/lists/' . rawurlencode($cleanTaskListId),
        $user,
        ['title' => $cleanTitle],
    );
    if (empty($saved['id'])) {
        throw new RuntimeException('Google Tasks did not return the updated list.');
    }
    $defaultTaskListId = genesisDefaultGoogleTaskListId($user);
    genesisTouchUser($userId);
    $list = [
        'id' => (string)$saved['id'],
        'title' => mb_substr(trim((string)($saved['title'] ?? $cleanTitle)), 0, 300),
        'updatedAt' => !empty($saved['updated']) ? (string)$saved['updated'] : null,
        'isDefault' => $defaultTaskListId !== '' && hash_equals($defaultTaskListId, (string)$saved['id']),
    ];
    genesisGoogleSnapshotListSaved($user, $list);
    return genesisDecorateTaskListForGoogleAccount($list, $user);
}

function genesisDeleteGoogleTaskList(string $userId, string $taskListId, ?string $accountId = null): void
{
    $cleanTaskListId = trim($taskListId);
    if ($cleanTaskListId === '') {
        throw new InvalidArgumentException('Идентификатор списка обязателен.');
    }
    $user = genesisTaskListAccount($userId, $accountId);
    if ($user === null || empty($user['refresh_token_enc']) || !genesisGoogleScopeGranted($user, GENESIS_GOOGLE_TASKS_SCOPE)) {
        throw new RuntimeException('Обновите доступ Google, чтобы удалять списки Google Tasks.');
    }
    $defaultTaskListId = genesisDefaultGoogleTaskListId($user);
    if ($defaultTaskListId !== '' && hash_equals($defaultTaskListId, $cleanTaskListId)) {
        throw new DomainException('Основной список Google Tasks нельзя удалить. Пустой основной список автоматически скрывается в GENESIS.');
    }
    try {
        genesisGoogleTasksApi(
            'DELETE',
            '/users/@me/lists/' . rawurlencode($cleanTaskListId),
            $user,
        );
    } catch (RuntimeException $error) {
        if (!str_contains($error->getMessage(), '(404)') && !str_contains($error->getMessage(), '(410)')) {
            throw $error;
        }
    }
    genesisGoogleSnapshotListSaved($user, ['id' => $cleanTaskListId], true);
    genesisTouchUser($userId);
}

function genesisResolveTaskTargetAccounts(array $owner, array $task): array
{
    $accounts = genesisGoogleAccountsForUser($owner);
    $byId = [];
    foreach ($accounts as $account) $byId[(string)$account['id']] = $account;

    $requestedIds = genesisDecodeStringListJson($task['syncAccountIds'] ?? []);
    $taskAccountId = trim((string)($task['googleAccountId'] ?? ''));
    if (!empty($task['googleTaskListId']) && $taskAccountId !== '') {
        $requestedIds = [$taskAccountId];
    }
    if ($requestedIds === []) {
        $mode = in_array($owner['sync_routing_mode'] ?? '', ['fixed', 'choose', 'category'], true)
            ? (string)$owner['sync_routing_mode']
            : 'fixed';
        if ($mode === 'category') {
            $categoryMap = genesisCategorySyncMap($owner['category_sync_map'] ?? '{}');
            $categoryId = trim((string)($task['categoryId'] ?? ''));
            $requestedIds = $categoryId !== '' ? ($categoryMap[$categoryId] ?? []) : [];
        }
        if ($requestedIds === []) {
            $requestedIds = genesisDecodeStringListJson($owner['sync_target_account_ids'] ?? '[]');
        }
    }
    if ($requestedIds === []) $requestedIds = [(string)$owner['id']];
    $resolved = [];
    foreach (array_values(array_unique($requestedIds)) as $accountId) {
        if (isset($byId[$accountId]) && !empty($byId[$accountId]['refresh_token_enc'])) {
            $resolved[] = $byId[$accountId];
        }
    }
    if ($resolved === [] && !empty($owner['refresh_token_enc'])) $resolved[] = $owner;
    return $resolved;
}

function genesisSyncTaskToGoogleAccount(array $user, string $ownerUserId, string $taskId, array $task): array
{
    if (empty($user['refresh_token_enc'])) {
        throw new RuntimeException('Google Calendar не подключён.');
    }
    if (!empty($task['googleTaskListId'])) {
        return !empty($task['googleTaskId'])
            ? genesisSyncNativeGoogleTask($user, $ownerUserId, $task)
            : genesisCreateNativeGoogleTask($user, $ownerUserId, $taskId, $task);
    }
    $user = genesisEnsureGoogleCalendar($user);
    $eventPayload = genesisTaskPayloadForGoogle($taskId, $task);
    $eventId = trim((string)($task['googleEventId'] ?? ''));
    if ($eventId === '') {
        $existing = genesisFindGoogleEvent($user, $taskId);
        $eventId = is_array($existing) ? (string)($existing['id'] ?? '') : '';
    }
    $calendarPath = '/calendars/' . rawurlencode((string)$user['google_calendar_id']) . '/events';
    $event = $eventId !== ''
        ? genesisGoogleApi('PUT', $calendarPath . '/' . rawurlencode($eventId), $user, $eventPayload)
        : genesisGoogleApi('POST', $calendarPath, $user, $eventPayload);
    $clientTask = genesisGoogleEventForClient($event);
    if ($clientTask === null) {
        throw new RuntimeException('Google Calendar did not return the saved task.');
    }
    genesisTouchUser($ownerUserId);
    genesisGoogleSnapshotTaskSaved($user, $clientTask);
    return $clientTask;
}

function genesisSyncTaskToGoogle(string $userId, string $taskId, array $task): array
{
    if (genesisTaskWasDeleted($userId, $taskId, $task)) throw new DomainException('TASK_DELETED');
    $owner = genesisFindUser($userId);
    if ($owner === null) throw new RuntimeException('Пользователь не найден.');
    $targets = genesisResolveTaskTargetAccounts($owner, $task);
    if ($targets === []) throw new RuntimeException('Подключённый Google-аккаунт для синхронизации не найден.');
    $links = is_array($task['googleLinks'] ?? null) ? $task['googleLinks'] : [];
    $savedTask = $task;
    $savedAccountIds = [];
    foreach ($targets as $account) {
        $account['_language'] = genesisGoogleLanguage($owner);
        $accountId = (string)$account['id'];
        $existingLink = is_array($links[$accountId] ?? null) ? $links[$accountId] : [];
        $accountTask = array_merge($task, [
            '_language' => genesisGoogleLanguage($owner),
            'googleEventId' => $existingLink['eventId'] ?? ($accountId === (string)$owner['id'] ? ($task['googleEventId'] ?? null) : null),
            'googleTaskId' => $existingLink['taskId'] ?? ($accountId === (string)$owner['id'] ? ($task['googleTaskId'] ?? null) : null),
            'googleTaskListId' => $existingLink['taskListId'] ?? ($task['googleTaskListId'] ?? null),
            'googleTaskListTitle' => $existingLink['taskListTitle'] ?? ($task['googleTaskListTitle'] ?? ''),
        ]);
        $saved = genesisSyncTaskToGoogleAccount($account, $userId, $taskId, $accountTask);
        $links[$accountId] = [
            'eventId' => $saved['googleEventId'] ?? null,
            'taskId' => $saved['googleTaskId'] ?? null,
            'taskListId' => $saved['googleTaskListId'] ?? null,
            'taskListTitle' => $saved['googleTaskListTitle'] ?? '',
        ];
        $savedAccountIds[] = $accountId;
        $savedTask = array_merge($savedTask, $saved);
    }
    foreach (array_keys($links) as $accountId) {
        if (in_array((string)$accountId, $savedAccountIds, true)) continue;
        $oldAccount = genesisGoogleAccountForUser($userId, (string)$accountId);
        $oldLink = is_array($links[$accountId] ?? null) ? $links[$accountId] : [];
        if ($oldAccount !== null && $oldLink !== []) {
            genesisDeleteGoogleTaskFromAccount($oldAccount, $userId, $taskId, [
                'googleEventId' => $oldLink['eventId'] ?? null,
                'googleTaskId' => $oldLink['taskId'] ?? null,
                'googleTaskListId' => $oldLink['taskListId'] ?? null,
            ]);
        }
        unset($links[$accountId]);
    }
    $savedTask['syncAccountIds'] = $savedAccountIds;
    $savedTask['googleLinks'] = $links;
    $savedTask['googleAccountId'] = count($savedAccountIds) === 1 ? $savedAccountIds[0] : null;
    $savedTask['googleAccountEmail'] = count($targets) === 1 ? (string)$targets[0]['email'] : '';
    $compatibilityId = in_array((string)$owner['id'], $savedAccountIds, true) ? (string)$owner['id'] : $savedAccountIds[0];
    $compatibilityLink = $links[$compatibilityId] ?? [];
    $savedTask['googleEventId'] = $compatibilityLink['eventId'] ?? null;
    $savedTask['googleTaskId'] = $compatibilityLink['taskId'] ?? null;
    $savedTask['googleTaskListId'] = $compatibilityLink['taskListId'] ?? null;
    $savedTask['googleTaskListTitle'] = $compatibilityLink['taskListTitle'] ?? '';
    if (genesisTaskWasDeleted($userId, $taskId, $task)) {
        // A concurrent stale PUT must not recreate a copy after DELETE completed.
        genesisDeleteGoogleTaskEvent($userId, $taskId, $savedTask);
        throw new DomainException('TASK_DELETED');
    }
    return $savedTask;
}

function genesisDeleteGoogleTaskFromAccount(array $user, string $ownerUserId, string $taskId, array $task): void
{
    if (empty($user['refresh_token_enc'])) return;
    $googleTaskId = trim((string)($task['googleTaskId'] ?? ''));
    $googleTaskListId = trim((string)($task['googleTaskListId'] ?? ''));
    if ($googleTaskId !== '' && $googleTaskListId !== '') {
        try {
            genesisGoogleTasksApi(
                'DELETE',
                '/lists/' . rawurlencode($googleTaskListId) . '/tasks/' . rawurlencode($googleTaskId),
                $user,
            );
        } catch (RuntimeException $error) {
            if (!str_contains($error->getMessage(), '(404)') && !str_contains($error->getMessage(), '(410)')) throw $error;
        }
        genesisGoogleSnapshotTaskDeleted($user, $task, $taskId);
        genesisTouchUser($ownerUserId);
        return;
    }
    if (empty($user['google_calendar_id'])) {
        return;
    }
    $eventId = trim((string)($task['googleEventId'] ?? ''));
    $eventIds = $eventId !== '' ? [$eventId] : [];
    if (genesisGoogleScopeGranted($user, GENESIS_GOOGLE_CALENDAR_SCOPE)) {
        foreach (genesisFindGoogleEvents($user, $taskId) as $event) $eventIds[] = (string)$event['id'];
    }
    foreach (array_unique($eventIds) as $id) {
        try {
            genesisGoogleApi('DELETE', '/calendars/' . rawurlencode((string)$user['google_calendar_id']) . '/events/' . rawurlencode($id), $user);
        } catch (GenesisGoogleHttpException $error) {
            if (!in_array($error->status, [404, 410], true)) throw $error;
        }
    }
    genesisGoogleSnapshotTaskDeleted($user, $task, $taskId);
    genesisTouchUser($ownerUserId);
}

function genesisDeleteGoogleTaskEvent(string $userId, string $taskId, array $task = []): void
{
    $owner = genesisFindUser($userId);
    if ($owner === null) return;
    genesisRecordTaskDeletion($userId, $taskId, $task);
    genesisDeleteGoogleTaskCopies(genesisGoogleAccountsForUser($owner), $userId, $taskId, $task);
}

function genesisDeleteGoogleTaskCopies(array $accounts, string $userId, string $taskId, array $task, ?callable $delete = null): void
{
    $delete ??= 'genesisDeleteGoogleTaskFromAccount';
    $links = is_array($task['googleLinks'] ?? null) ? $task['googleLinks'] : [];
    $errors = [];
    foreach ($accounts as $account) {
        $accountId = (string)$account['id'];
        $link = is_array($links[$accountId] ?? null) ? $links[$accountId] : [];
        $compatibilityAccountId = (string)($task['googleAccountId'] ?? $userId);
        $accountTask = $link !== [] ? [
            'googleEventId' => $link['eventId'] ?? null, 'googleTaskId' => $link['taskId'] ?? null,
            'googleTaskListId' => $link['taskListId'] ?? null,
        ] : ($accountId === $compatibilityAccountId ? $task : []);
        try {
            $delete($account, $userId, $taskId, $accountTask);
        } catch (Throwable $error) {
            $errors[] = $error;
        }
    }
    if ($errors !== []) throw $errors[0];
}

function genesisLoadGoogleCalendarSnapshot(array $user, array $previous, bool $full, ?callable $fetch = null): array
{
    $fetch ??= 'genesisGoogleApi';
    $syncToken = !$full ? (string)($previous['syncToken'] ?? '') : '';
    $tasks = [];
    if ($syncToken !== '') foreach ($previous['items'] ?? [] as $task) $tasks[(string)$task['googleEventId']] = $task;
    $legacyDescriptionsToClean = [];
    $nextSyncToken = '';
    try {
        $user = genesisEnsureGoogleCalendar($user);
        $pageToken = null;
        do {
            $query = [
                'singleEvents' => 'false',
                'showDeleted' => $syncToken !== '' ? 'true' : 'false',
                'maxResults' => 2500,
            ];
            if ($syncToken !== '') $query['syncToken'] = $syncToken;
            if (is_string($pageToken) && $pageToken !== '') {
                $query['pageToken'] = $pageToken;
            }
            $result = $fetch('GET', '/calendars/' . rawurlencode((string)$user['google_calendar_id']) . '/events?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986), $user);
            foreach ($result['items'] ?? [] as $event) {
                if (!is_array($event)) continue;
                if (count($legacyDescriptionsToClean) < 50 && !empty($event['id'])
                    && empty($event['recurringEventId'])
                    && genesisHasLegacyTaskDescriptionMetadata($event['description'] ?? '')) {
                    $legacyDescriptionsToClean[] = [
                        'eventId' => (string)$event['id'],
                        'description' => genesisCleanTaskDescription($event['description'] ?? ''),
                    ];
                }
                if (!empty($event['id'])) unset($tasks[(string)$event['id']]);
                $task = genesisGoogleEventForClient($event);
                if ($task !== null) $tasks[(string)$event['id']] = $task;
            }
            $pageToken = $result['nextPageToken'] ?? null;
            $nextSyncToken = (string)($result['nextSyncToken'] ?? '');
        } while (is_string($pageToken) && $pageToken !== '' && count($tasks) < 10_000);
        foreach ($legacyDescriptionsToClean as $legacyEvent) {
            try {
                $fetch(
                    'PATCH',
                    '/calendars/' . rawurlencode((string)$user['google_calendar_id']) . '/events/' . rawurlencode($legacyEvent['eventId']),
                    $user,
                    ['description' => $legacyEvent['description']],
                );
            } catch (Throwable $cleanupError) {
                genesisLogError('[GoogleCalendarMetadataCleanup] ' . $cleanupError->getMessage(), $cleanupError);
            }
        }
    } catch (GenesisGoogleHttpException $error) {
        if ($error->status === 410 && $syncToken !== '') return genesisLoadGoogleCalendarSnapshot($user, [], true, $fetch);
        throw $error;
    }
    if ($nextSyncToken === '') throw new RuntimeException('Incomplete Google Calendar snapshot.');
    return ['items' => array_values($tasks), 'syncToken' => $nextSyncToken, 'fullRead' => $syncToken === ''];
}

function genesisListGoogleTasks(array $user): array
{
    $GLOBALS['GENESIS_GOOGLE_TASKS_WARNING'] = null;
    $GLOBALS['GENESIS_GOOGLE_TASK_LISTS'] = [];
    $user = (!empty($user['_linked_account']) ? genesisFindLinkedGoogleAccount((string)$user['id']) : genesisFindUser((string)$user['id'])) ?? $user;
    if (empty($user['refresh_token_enc'])) return [];
    $snapshot = genesisGoogleReadSnapshot($user,
        static fn(array $state, bool $full): array => genesisLoadGoogleCalendarSnapshot($user, $state, $full),
        static function (array $state, bool $full) use ($user): array {
            $lists = $state['lists'] ?? [];
            $defaultId = array_values(array_filter($lists, static fn(array $list): bool => !empty($list['isDefault'])))[0]['id'] ?? null;
            $freshLists = genesisListGoogleTaskLists($user, $defaultId);
            // Overlap the cursor to avoid losing changes at a timestamp boundary.
            $since = !$full && !empty($state['checkedAt']) ? gmdate('c', max(0, (int)$state['checkedAt'] - 120)) : null;
            $items = genesisListGoogleNativeTasks($user, $freshLists, $since !== null ? ($state['items'] ?? []) : [], $since, $lists);
            return ['items' => $items, 'lists' => $freshLists];
        });
    // Recheck grants after a failed request. Revocation must never serve a previous private snapshot.
    $freshUser = (!empty($user['_linked_account']) ? genesisFindLinkedGoogleAccount((string)$user['id']) : genesisFindUser((string)$user['id'])) ?? $user;
    $tasks = []; $warnings = [];
    foreach (['calendar' => GENESIS_GOOGLE_CALENDAR_SCOPE, 'tasks' => GENESIS_GOOGLE_TASKS_SCOPE] as $service => $scope) {
        $state = $snapshot[$service] ?? [];
        if (!empty($state['warning'])) $warnings[] = $state['warning'];
        if (empty($freshUser['refresh_token_enc']) || !genesisGoogleScopeGranted($freshUser, $scope)) continue;
        $tasks = array_merge($tasks, $state['items'] ?? []);
        if ($service === 'tasks') $GLOBALS['GENESIS_GOOGLE_TASK_LISTS'] = $state['lists'] ?? [];
    }
    $GLOBALS['GENESIS_GOOGLE_TASKS_WARNING'] = $warnings ? implode(' ', array_unique($warnings)) : null;
    usort($tasks, static fn(array $a, array $b): int => [(string)($a['dueDate'] ?? ''), (string)($a['time'] ?? ''), (string)($a['title'] ?? '')]
        <=> [(string)($b['dueDate'] ?? ''), (string)($b['time'] ?? ''), (string)($b['title'] ?? '')]);
    if ($warnings === []) genesisDb()->prepare('UPDATE users SET last_calendar_sync_at = :at WHERE id = :id')
        ->execute(['at' => genesisNow(), 'id' => (string)$user['id']]);
    return $tasks;
}
