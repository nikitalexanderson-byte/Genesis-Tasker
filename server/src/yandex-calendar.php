<?php
declare(strict_types=1);

/** Existing app-password connections remain readable; new connections use Yandex OAuth. */
function genesisYandexCalendarConnection(string $userId): ?array
{
    $query = genesisDb()->prepare('SELECT * FROM yandex_calendar_connections WHERE user_id = :id');
    $query->execute(['id' => $userId]);
    $row = $query->fetch();
    return is_array($row) ? $row : null;
}

function genesisYandexCalendarPath(string $login): string
{
    $login = trim($login);
    if ($login === '' || strlen($login) > 254 || !preg_match('/^[A-Za-z0-9._+@-]+$/D', $login)) {
        throw new InvalidArgumentException('Укажите логин Яндекса или адрес почты.');
    }
    return '/calendars/' . str_replace('%40', '@', rawurlencode($login)) . '/events-default/';
}

/** @return array{status:int, body:string, etag:?string} */
function genesisYandexDavRequest(string $login, string $credential, string $method, string $path,
    ?string $body = null, array $extraHeaders = [], bool $oauth = false): array
{
    if (!preg_match('~^/calendars/[A-Za-z0-9._%+@-]+/events-default/(?:genesis-[a-f0-9]{40}\.ics)?$~D', $path)
        || str_contains($path, '..') || !in_array($method, ['PROPFIND', 'REPORT', 'GET', 'PUT', 'DELETE'], true)) {
        throw new InvalidArgumentException('Недопустимый адрес календаря.');
    }
    $handle = curl_init('https://caldav.yandex.ru' . $path);
    if ($handle === false) throw new RuntimeException('Не удалось открыть соединение с календарём.');
    $headers = array_merge(['Accept: application/xml, text/calendar', 'Expect:'], $extraHeaders);
    if ($oauth) $headers[] = 'Authorization: OAuth ' . $credential;
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'GENESIS-Calendar/2.4.9',
    ];
    if (!$oauth) {
        $options[CURLOPT_USERPWD] = $login . ':' . $credential;
        $options[CURLOPT_HTTPAUTH] = CURLAUTH_BASIC;
    }
    curl_setopt_array($handle, $options);
    if ($body !== null) curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    try {
        $raw = curl_exec($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $headerSize = (int)curl_getinfo($handle, CURLINFO_HEADER_SIZE);
    } finally {
        curl_close($handle);
    }
    if (!is_string($raw) || strlen($raw) > 8_000_000) {
        throw new RuntimeException('Яндекс.Календарь временно недоступен.');
    }
    $responseHeaders = substr($raw, 0, $headerSize);
    $etag = preg_match('/^ETag:\s*(.+)$/mi', $responseHeaders, $match) ? trim($match[1]) : null;
    return ['status' => $status, 'body' => substr($raw, $headerSize), 'etag' => $etag];
}

/** @return array{credential:string,oauth:bool} */
function genesisYandexCalendarCredential(array $connection): array
{
    $access = genesisDecrypt((string)($connection['access_token_enc'] ?? ''));
    if (is_string($access) && $access !== '') {
        $expires = (int)($connection['token_expires_at'] ?? 0);
        $refresh = genesisDecrypt((string)($connection['refresh_token_enc'] ?? ''));
        $stale = (int)strtotime((string)$connection['updated_at']) < time() - 90 * 86400;
        if (is_string($refresh) && $refresh !== '' && (($expires > 0 && $expires < time() + 300) || $stale)) {
            $tokens = genesisRefreshYandexToken($refresh);
            $access = trim((string)($tokens['access_token'] ?? ''));
            $refresh = trim((string)($tokens['refresh_token'] ?? $refresh));
            if ($access === '' || $refresh === '') throw new RuntimeException('Повторно подключите Яндекс.Календарь.');
            $lifetime = max(0, (int)($tokens['expires_in'] ?? 0));
            genesisDb()->prepare('UPDATE yandex_calendar_connections SET access_token_enc = :access,
                refresh_token_enc = :refresh, token_expires_at = :expires, updated_at = :now WHERE user_id = :id')
                ->execute(['access' => genesisEncrypt($access), 'refresh' => genesisEncrypt($refresh),
                    'expires' => $lifetime > 0 ? time() + $lifetime : null,
                    'now' => genesisNow(), 'id' => $connection['user_id']]);
        } elseif ($expires > 0 && $expires < time() + 300) {
            throw new RuntimeException('Повторно подключите Яндекс.Календарь.');
        }
        return ['credential' => $access, 'oauth' => true];
    }
    $password = genesisDecrypt((string)$connection['app_password_enc']);
    if (!is_string($password) || $password === '') throw new RuntimeException('Подключение календаря повреждено.');
    return ['credential' => $password, 'oauth' => false];
}

/** @param array<string,mixed> $tokens */
function genesisYandexCalendarConnectOauth(string $userId, array $tokens): void
{
    $user = genesisFindUser($userId);
    if ($user === null || genesisUserProvider($user) !== 'yandex') throw new DomainException('YANDEX_ACCOUNT_REQUIRED');
    $access = trim((string)($tokens['access_token'] ?? ''));
    if ($access === '' || strlen($access) > 16384) throw new InvalidArgumentException('Некорректный токен Яндекса.');
    $profile = genesisYandexUserInfo($access);
    if (!hash_equals((string)$user['yandex_uid'], (string)$profile['id'])) {
        throw new DomainException('Подтвердите доступ для выбранного Яндекс-аккаунта.');
    }
    $login = (string)$profile['email'];
    $path = genesisYandexCalendarPath($login);
    $result = genesisYandexDavRequest($login, $access, 'PROPFIND', $path,
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
        ['Depth: 0', 'Content-Type: application/xml; charset=utf-8'], true);
    if ($result['status'] !== 207) throw new DomainException('Яндекс не подтвердил доступ к календарю. Разрешите доступ к Календарю в Яндекс ID.');
    $refresh = trim((string)($tokens['refresh_token'] ?? ''));
    $lifetime = max(0, (int)($tokens['expires_in'] ?? 0));
    $now = genesisNow();
    genesisDb()->prepare('INSERT INTO yandex_calendar_connections
        (user_id, login_enc, app_password_enc, calendar_path_enc, access_token_enc, refresh_token_enc,
         token_expires_at, connected_at, updated_at)
        VALUES (:id, :login, :password, :path, :access, :refresh, :expires, :now, :now)
        ON CONFLICT(user_id) DO UPDATE SET login_enc = excluded.login_enc, app_password_enc = excluded.app_password_enc,
        calendar_path_enc = excluded.calendar_path_enc, access_token_enc = excluded.access_token_enc,
        refresh_token_enc = excluded.refresh_token_enc, token_expires_at = excluded.token_expires_at,
        last_checked_at = NULL, updated_at = excluded.updated_at')->execute([
        'id' => $userId, 'login' => genesisEncrypt($login), 'password' => '', 'path' => genesisEncrypt($path),
        'access' => genesisEncrypt($access), 'refresh' => genesisEncrypt($refresh),
        'expires' => $lifetime > 0 ? time() + $lifetime : null, 'now' => $now,
    ]);
}

function genesisYandexCalendarConnect(string $userId, string $login, string $appPassword): void
{
    $user = genesisFindUser($userId);
    if ($user === null || genesisUserProvider($user) !== 'yandex') {
        throw new DomainException('YANDEX_ACCOUNT_REQUIRED');
    }
    $path = genesisYandexCalendarPath($login);
    if (strlen($appPassword) < 8 || strlen($appPassword) > 256) {
        throw new InvalidArgumentException('Введите пароль приложения для Яндекс.Календаря.');
    }
    $result = genesisYandexDavRequest($login, $appPassword, 'PROPFIND', $path,
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
        ['Depth: 0', 'Content-Type: application/xml; charset=utf-8']);
    if ($result['status'] === 401 || $result['status'] === 403) {
        throw new DomainException('Неверный логин или пароль приложения Яндекс.Календаря.');
    }
    if ($result['status'] !== 207) {
        throw new DomainException('Не удалось найти основной Яндекс.Календарь. Проверьте логин.');
    }
    $now = genesisNow();
    genesisDb()->prepare('INSERT INTO yandex_calendar_connections
        (user_id, login_enc, app_password_enc, calendar_path_enc, connected_at, updated_at)
        VALUES (:user_id, :login, :password, :path, :now, :now)
        ON CONFLICT(user_id) DO UPDATE SET login_enc = excluded.login_enc,
        app_password_enc = excluded.app_password_enc, calendar_path_enc = excluded.calendar_path_enc,
        last_checked_at = NULL, updated_at = excluded.updated_at')->execute([
        'user_id' => $userId,
        'login' => genesisEncrypt($login),
        'password' => genesisEncrypt($appPassword),
        'path' => genesisEncrypt($path),
        'now' => $now,
    ]);
}

function genesisYandexCalendarDisconnect(string $userId): void
{
    genesisDb()->prepare('DELETE FROM yandex_calendar_connections WHERE user_id = :id')->execute(['id' => $userId]);
    // Existing Yandex events remain in the user's own calendar; reconnecting can update them.
}

function genesisYandexIcsEscape(string $value): string
{
    return str_replace(["\\", "\r\n", "\r", "\n", ',', ';'],
        ["\\\\", '\\n', '\\n', '\\n', '\\,', '\\;'], $value);
}

/** @return list<string> */
function genesisYandexIcsLines(string $taskId, array $task, string $organizer = ''): array
{
    $event = genesisTaskPayloadForGoogle($taskId, $task);
    $start = $event['start'];
    $end = $event['end'];
    $meeting = ($task['yandexEntryType'] ?? 'task') === 'meeting';
    $allDay = !isset($start['dateTime']);
    if ($meeting && !$allDay) {
        $endTime = (string)($task['yandexEndTime'] ?? '');
        if (preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $endTime)) {
            $endDate = (string)($task['endDate'] ?? $task['dueDate']);
            $candidate = new DateTimeImmutable($endDate . ' ' . $endTime, genesisClientTimeZone());
            $startDate = new DateTimeImmutable((string)$start['dateTime']);
            if ($candidate > $startDate && $candidate <= $startDate->modify('+30 days')) {
                $end['dateTime'] = $candidate->format(DATE_RFC3339);
            }
        }
    }
    $telemost = trim((string)($task['yandexTelemostUrl'] ?? ''));
    $telemost = preg_match('~^https://telemost\.yandex\.[a-z.]+/[A-Za-z0-9/_?=&%-]+$~D', $telemost)
        ? mb_substr($telemost, 0, 500) : '';
    $description = (string)$event['description'];
    if ($telemost !== '') $description .= ($description !== '' ? "\n\n" : '') . $telemost;
    $lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GENESIS//Calendar Tasks//RU',
        'BEGIN:VEVENT', 'UID:genesis-' . $taskId . '@genesiscalendar.ru',
        'DTSTAMP:' . gmdate('Ymd\THis\Z'),
        'SUMMARY:' . genesisYandexIcsEscape((string)$event['summary']),
        'DESCRIPTION:' . genesisYandexIcsEscape($description),
        'X-GENESIS-TASK-ID:' . genesisYandexIcsEscape($taskId),
        'X-GENESIS-DONE:' . (!empty($task['done']) ? '1' : '0'),
        'X-GENESIS-ENTRY-TYPE:' . ($meeting ? 'MEETING' : 'TASK'),
    ];
    $location = mb_substr(trim((string)($task['yandexLocation'] ?? '')), 0, 500);
    if ($location !== '') $lines[] = 'LOCATION:' . genesisYandexIcsEscape($location);
    if ($telemost !== '') $lines[] = 'URL:' . $telemost;
    $visibility = ($task['yandexVisibility'] ?? 'private') === 'public' ? 'PUBLIC' : 'PRIVATE';
    $lines[] = 'CLASS:' . $visibility;
    $lines[] = 'TRANSP:' . (!empty($task['yandexBusy']) ? 'OPAQUE' : 'TRANSPARENT');
    if ($meeting) {
        if (filter_var($organizer, FILTER_VALIDATE_EMAIL)) $lines[] = 'ORGANIZER:mailto:' . $organizer;
        $attendeeGroups = ['yandexAttendees' => 'REQ-PARTICIPANT',
            'yandexOptionalAttendees' => 'OPT-PARTICIPANT'];
        foreach ($attendeeGroups as $field => $role) {
            $emails = is_array($task[$field] ?? null) ? array_slice($task[$field], 0, 30) : [];
            foreach ($emails as $email) {
                $email = trim((string)$email);
                if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $lines[] = 'ATTENDEE;ROLE=' . $role . ';PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:' . $email;
                }
            }
        }
    }
    if (isset($start['date'], $end['date'])) {
        $lines[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', (string)$start['date']);
        $lines[] = 'DTEND;VALUE=DATE:' . str_replace('-', '', (string)$end['date']);
    } else {
        $lines[] = 'DTSTART:' . (new DateTimeImmutable((string)$start['dateTime']))
            ->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
        $lines[] = 'DTEND:' . (new DateTimeImmutable((string)$end['dateTime']))
            ->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
    }
    // Non-Gregorian repetitions use the explicit dates already computed by GENESIS.
    foreach (($event['recurrence'] ?? []) as $recurrence) $lines[] = (string)$recurrence;
    $alarms = is_array($task['yandexReminders'] ?? null) ? array_slice($task['yandexReminders'], 0, 5) : [];
    foreach ($alarms as $minutes) {
        $minutes = filter_var($minutes, FILTER_VALIDATE_INT);
        if ($minutes === false || $minutes < 0 || $minutes > 40_320) continue;
        $lines[] = 'BEGIN:VALARM';
        $lines[] = 'ACTION:DISPLAY';
        $lines[] = 'DESCRIPTION:' . genesisYandexIcsEscape((string)$event['summary']);
        $lines[] = 'TRIGGER:' . ($minutes === 0 ? 'PT0M' : '-PT' . $minutes . 'M');
        $lines[] = 'END:VALARM';
    }
    $lines[] = 'END:VEVENT';
    $lines[] = 'END:VCALENDAR';
    return $lines;
}

function genesisYandexIcsDocument(string $taskId, array $task, string $organizer = ''): string
{
    $folded = [];
    foreach (genesisYandexIcsLines($taskId, $task, $organizer) as $line) {
        while (strlen($line) > 73) {
            $part = mb_strcut($line, 0, 73, 'UTF-8');
            $folded[] = $part;
            $line = ' ' . substr($line, strlen($part));
        }
        $folded[] = $line;
    }
    return implode("\r\n", $folded) . "\r\n";
}

function genesisYandexIcsValue(string $document, string $name): ?string
{
    $unfolded = preg_replace('/\r?\n[ \t]/', '', $document);
    if (!is_string($unfolded) || !preg_match('/^' . preg_quote($name, '/') . '(?:;[^:\r\n]*)?:(.*)$/mi',
        $unfolded, $match)) return null;
    return str_replace(['\\n', '\\N', '\\,', '\\;', '\\\\'], ["\n", "\n", ',', ';', '\\'], trim($match[1]));
}

/** @return array{date:string,time:string}|null */
function genesisYandexIcsDateTime(string $document, string $name): ?array
{
    $unfolded = preg_replace('/\r?\n[ \t]/', '', $document);
    if (!is_string($unfolded) || !preg_match('/^' . preg_quote($name, '/')
        . '((?:;[^:\r\n]*)?):(\d{8}(?:T\d{6}Z?)?)\r?$/mi', $unfolded, $match)) return null;
    $value = $match[2];
    if (strlen($value) === 8) {
        $date = DateTimeImmutable::createFromFormat('!Ymd', $value, genesisClientTimeZone());
        return $date === false ? null : ['date' => $date->format('Y-m-d'), 'time' => ''];
    }
    $timezone = genesisClientTimeZone();
    if (str_ends_with($value, 'Z')) {
        $timezone = new DateTimeZone('UTC');
        $value = substr($value, 0, -1);
    } elseif (preg_match('/;TZID=(?:"([^"]+)"|([^;:]+))/i', $match[1], $zone)) {
        try { $timezone = new DateTimeZone($zone[1] ?: $zone[2]); } catch (Throwable) { /* Device zone remains. */ }
    }
    $date = DateTimeImmutable::createFromFormat('!Ymd\THis', $value, $timezone);
    if ($date === false) return null;
    $local = $date->setTimezone(genesisClientTimeZone());
    return ['date' => $local->format('Y-m-d'), 'time' => $local->format('H:i')];
}

/** Read only events previously created by GENESIS. A failed pull never erases cached tasks. */
function genesisRefreshYandexCalendarTasks(string $userId): void
{
    $connection = genesisYandexCalendarConnection($userId);
    if ($connection === null || (!empty($connection['last_checked_at'])
        && strtotime((string)$connection['last_checked_at']) > time() - 120)) return;
    $login = genesisDecrypt((string)$connection['login_enc']);
    $auth = genesisYandexCalendarCredential($connection);
    $calendarPath = genesisDecrypt((string)$connection['calendar_path_enc']);
    if (!$login || !$calendarPath) return;
    $query = genesisDb()->prepare('SELECT task_id, payload_enc, event_path_enc, event_etag
        FROM yandex_calendar_tasks WHERE user_id = :id');
    $query->execute(['id' => $userId]);
    $rows = $query->fetchAll();
    try {
        foreach (array_chunk($rows, 40) as $batch) {
            $xml = '<?xml version="1.0" encoding="utf-8"?>'
                . '<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
                . '<d:prop><d:getetag/><c:calendar-data/></d:prop>';
            foreach ($batch as $row) {
                $eventPath = genesisDecrypt((string)$row['event_path_enc']);
                if (!is_string($eventPath)) continue;
                $xml .= '<d:href>' . htmlspecialchars($eventPath, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</d:href>';
            }
            $xml .= '</c:calendar-multiget>';
            $response = genesisYandexDavRequest($login, $auth['credential'], 'REPORT', $calendarPath, $xml,
                ['Depth: 1', 'Content-Type: application/xml; charset=utf-8'], $auth['oauth']);
            if ($response['status'] !== 207) throw new RuntimeException('YANDEX_CALDAV_REPORT_FAILED');
            $document = new DOMDocument();
            if (!@$document->loadXML($response['body'], LIBXML_NONET)) {
                throw new RuntimeException('YANDEX_CALDAV_RESPONSE_INVALID');
            }
            $xpath = new DOMXPath($document);
            $xpath->registerNamespace('d', 'DAV:');
            $xpath->registerNamespace('c', 'urn:ietf:params:xml:ns:caldav');
            $byPath = [];
            foreach ($batch as $row) {
                $eventPath = genesisDecrypt((string)$row['event_path_enc']);
                if (is_string($eventPath)) $byPath[rawurldecode($eventPath)] = $row;
            }
            foreach ($xpath->query('//d:response') as $item) {
                $href = rawurldecode((string)$xpath->evaluate('string(d:href)', $item));
                $path = parse_url($href, PHP_URL_PATH);
                $row = $byPath[$path] ?? null;
                if ($row === null) continue;
                $status = (string)$xpath->evaluate('string(d:status)', $item);
                $etag = trim((string)$xpath->evaluate('string(d:propstat[d:status[contains(., " 200 ")]]/d:prop/d:getetag)', $item));
                if ($etag === '' && (str_contains($status, ' 404 ')
                    || str_contains((string)$xpath->evaluate('string(d:propstat/d:status)', $item), ' 404 '))) {
                    // Keep the encrypted GENESIS copy when a remote event is absent.
                    // It may be a temporarily unavailable or changed calendar.
                    genesisDb()->prepare('UPDATE yandex_calendar_tasks SET event_etag = NULL
                        WHERE user_id = :uid AND task_id = :tid')
                        ->execute(['uid' => $userId, 'tid' => $row['task_id']]);
                    continue;
                }
                if ($etag === '' || $etag === $row['event_etag']) continue;
                $ics = (string)$xpath->evaluate('string(d:propstat[d:status[contains(., " 200 ")]]/d:prop/c:calendar-data)', $item);
                if ($ics === '') continue;
                $task = json_decode((string)genesisDecrypt((string)$row['payload_enc']), true);
                if (!is_array($task)) continue;
                $title = genesisYandexIcsValue($ics, 'SUMMARY');
                if ($title !== null && $title !== '') {
                    $task['done'] = str_starts_with($title, '✓ ');
                    $task['title'] = mb_substr(preg_replace('/^✓ /u', '', $title), 0, 500);
                }
                $description = genesisYandexIcsValue($ics, 'DESCRIPTION');
                if ($description !== null) $task['description'] = mb_substr($description, 0, 5000);
                $location = genesisYandexIcsValue($ics, 'LOCATION');
                if ($location !== null) $task['yandexLocation'] = mb_substr($location, 0, 500);
                $url = genesisYandexIcsValue($ics, 'URL');
                if ($url !== null && str_starts_with($url, 'https://telemost.yandex.')) {
                    $task['yandexTelemostUrl'] = mb_substr($url, 0, 500);
                }
                $busy = genesisYandexIcsValue($ics, 'TRANSP');
                if ($busy !== null) $task['yandexBusy'] = strtoupper($busy) !== 'TRANSPARENT';
                $visibility = genesisYandexIcsValue($ics, 'CLASS');
                if ($visibility !== null) $task['yandexVisibility'] = strtoupper($visibility) === 'PUBLIC' ? 'public' : 'private';
                $start = genesisYandexIcsDateTime($ics, 'DTSTART');
                $end = genesisYandexIcsDateTime($ics, 'DTEND');
                if ($start !== null) {
                    $task['dueDate'] = $start['date'];
                    $task['time'] = $start['time'];
                }
                if ($end !== null) {
                    $task['endDate'] = $end['time'] === '' && $start !== null && $end['date'] > $start['date']
                        ? (new DateTimeImmutable($end['date']))->modify('-1 day')->format('Y-m-d')
                        : $end['date'];
                    $task['yandexEndTime'] = $end['time'];
                }
                $unfolded = preg_replace('/\r?\n[ \t]/', '', $ics);
                if (is_string($unfolded)) {
                    preg_match_all('/^ATTENDEE([^:\r\n]*):mailto:([^\r\n]+)$/mi', $unfolded, $guests, PREG_SET_ORDER);
                    $requiredGuests = [];
                    $optionalGuests = [];
                    foreach (array_slice($guests, 0, 30) as $guest) {
                        $email = trim($guest[2]);
                        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
                        if (str_contains(strtoupper($guest[1]), 'ROLE=OPT-PARTICIPANT')) $optionalGuests[] = $email;
                        else $requiredGuests[] = $email;
                    }
                    $task['yandexAttendees'] = $requiredGuests;
                    $task['yandexOptionalAttendees'] = $optionalGuests;
                    preg_match_all('/BEGIN:VALARM\r?\n(.*?)\r?\nEND:VALARM/si', $unfolded, $alarmBlocks);
                    $alarms = [];
                    foreach (array_slice($alarmBlocks[1] ?? [], 0, 5) as $alarm) {
                        if (preg_match('/^TRIGGER:(?:-PT(\d+)([MHD])|PT0M)$/mi', $alarm, $trigger)) {
                            $alarms[] = isset($trigger[1]) && $trigger[1] !== ''
                                ? (int)$trigger[1] * match ($trigger[2]) { 'H' => 60, 'D' => 1440, default => 1 }
                                : 0;
                        }
                    }
                    $task['yandexReminders'] = array_values(array_unique($alarms));
                }
                $task['updatedAt'] = (int)round(microtime(true) * 1000);
                genesisDb()->prepare('UPDATE yandex_calendar_tasks SET payload_enc = :payload,
                    event_etag = :etag, updated_at = :now WHERE user_id = :uid AND task_id = :tid')
                    ->execute(['payload' => genesisEncrypt(json_encode($task, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
                        'etag' => $etag, 'now' => genesisNow(), 'uid' => $userId, 'tid' => $row['task_id']]);
            }
        }
        genesisDb()->prepare('UPDATE yandex_calendar_connections SET last_checked_at = :now WHERE user_id = :id')
            ->execute(['now' => genesisNow(), 'id' => $userId]);
    } catch (Throwable $error) {
        genesisLogError('[YandexCalendar] Read failed', $error);
    }
}

/** The server's encrypted task mirror lets web and Android see the same calendar tasks. */
function genesisYandexCalendarTasksForClient(string $userId): array
{
    genesisRefreshYandexCalendarTasks($userId);
    $query = genesisDb()->prepare('SELECT payload_enc FROM yandex_calendar_tasks WHERE user_id = :id ORDER BY updated_at');
    $query->execute(['id' => $userId]);
    $tasks = [];
    foreach ($query->fetchAll() as $row) {
        $plain = genesisDecrypt((string)$row['payload_enc']);
        $task = is_string($plain) ? json_decode($plain, true) : null;
        if (is_array($task)) $tasks[] = $task;
    }
    return $tasks;
}

function genesisSyncTaskToYandex(string $userId, string $taskId, array $task): array
{
    $connection = genesisYandexCalendarConnection($userId);
    if ($connection === null) throw new DomainException('Сначала подключите Яндекс.Календарь в аккаунте.');
    if (!preg_match('/^[A-Za-z0-9_-]{1,100}$/D', $taskId)) throw new InvalidArgumentException('Неверный ID задачи.');
    if (($task['yandexEntryType'] ?? 'task') === 'meeting') {
        $startDate = (string)($task['dueDate'] ?? '');
        $endDate = (string)($task['endDate'] ?? $startDate);
        $startTime = (string)($task['time'] ?? '');
        $endTime = (string)($task['yandexEndTime'] ?? '');
        if ($startTime !== '') {
            if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $endTime)
                || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $endDate)
                || new DateTimeImmutable($endDate . ' ' . $endTime, genesisClientTimeZone())
                    <= new DateTimeImmutable($startDate . ' ' . $startTime, genesisClientTimeZone())) {
                throw new InvalidArgumentException('Окончание встречи должно быть позже её начала.');
            }
        }
        foreach (['yandexAttendees', 'yandexOptionalAttendees'] as $field) {
            foreach ((array)($task[$field] ?? []) as $email) {
                if (!is_string($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    throw new InvalidArgumentException('Проверьте адреса участников встречи.');
                }
            }
        }
    }
    $telemost = trim((string)($task['yandexTelemostUrl'] ?? ''));
    if ($telemost !== '' && !preg_match('~^https://telemost\.yandex\.[a-z.]+/[A-Za-z0-9/_?=&%-]+$~D', $telemost)) {
        throw new InvalidArgumentException('Укажите корректную ссылку Яндекс Телемоста.');
    }
    $task['id'] = $taskId;
    $task['syncToGoogle'] = false;
    $task['createdIn'] = 'genesis';
    $task['updatedAt'] = max((int)($task['updatedAt'] ?? 0), (int)round(microtime(true) * 1000));
    $login = genesisDecrypt((string)$connection['login_enc']);
    $auth = genesisYandexCalendarCredential($connection);
    $calendarPath = genesisDecrypt((string)$connection['calendar_path_enc']);
    if (!$login || !$calendarPath) throw new RuntimeException('Подключение календаря повреждено.');
    $document = genesisYandexIcsDocument($taskId, $task, $login);
    $eventPath = $calendarPath . 'genesis-' . hash('sha1', $userId . ':' . $taskId) . '.ics';
    $prior = genesisDb()->prepare('SELECT event_etag FROM yandex_calendar_tasks WHERE user_id = :user_id AND task_id = :task_id');
    $prior->execute(['user_id' => $userId, 'task_id' => $taskId]);
    $priorRow = $prior->fetch();
    $headers = ['Content-Type: text/calendar; charset=utf-8'];
    if (is_array($priorRow)) {
        if (!empty($priorRow['event_etag'])) $headers[] = 'If-Match: ' . $priorRow['event_etag'];
    } else $headers[] = 'If-None-Match: *';
    $result = genesisYandexDavRequest($login, $auth['credential'], 'PUT', $eventPath, $document, $headers, $auth['oauth']);
    if ($result['status'] === 412) throw new DomainException('Событие изменилось в Яндекс.Календаре. Обновите данные перед сохранением.');
    if (!in_array($result['status'], [200, 201, 204], true)) throw new RuntimeException('Яндекс.Календарь не сохранил событие.');
    $etag = $result['etag'];
    if ($etag === null) {
        $confirmed = genesisYandexDavRequest($login, $auth['credential'], 'GET', $eventPath, null, [], $auth['oauth']);
        if ($confirmed['status'] === 200) $etag = $confirmed['etag'];
    }
    genesisDb()->prepare('INSERT INTO yandex_calendar_tasks
        (user_id, task_id, payload_enc, event_path_enc, event_etag, updated_at)
        VALUES (:user_id, :task_id, :payload, :path, :etag, :updated_at)
        ON CONFLICT(user_id, task_id) DO UPDATE SET payload_enc = excluded.payload_enc,
        event_path_enc = excluded.event_path_enc, event_etag = excluded.event_etag, updated_at = excluded.updated_at')->execute([
        'user_id' => $userId, 'task_id' => $taskId,
        'payload' => genesisEncrypt(json_encode($task, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
        'path' => genesisEncrypt($eventPath), 'etag' => $etag, 'updated_at' => genesisNow(),
    ]);
    return $task;
}

function genesisDeleteYandexCalendarTask(string $userId, string $taskId): void
{
    $query = genesisDb()->prepare('SELECT event_path_enc, event_etag FROM yandex_calendar_tasks WHERE user_id = :user_id AND task_id = :task_id');
    $query->execute(['user_id' => $userId, 'task_id' => $taskId]);
    $row = $query->fetch();
    if (!is_array($row)) return;
    $connection = genesisYandexCalendarConnection($userId);
    if ($connection !== null) {
        $login = genesisDecrypt((string)$connection['login_enc']);
        $auth = genesisYandexCalendarCredential($connection);
        if (!$login) throw new RuntimeException('Подключение календаря повреждено.');
        $headers = !empty($row['event_etag']) ? ['If-Match: ' . $row['event_etag']] : [];
        $eventPath = genesisDecrypt((string)$row['event_path_enc']);
        if (!is_string($eventPath)) throw new RuntimeException('Адрес события повреждён.');
        $result = genesisYandexDavRequest($login, $auth['credential'], 'DELETE', $eventPath, null, $headers, $auth['oauth']);
        if (!in_array($result['status'], [200, 204, 404], true)) {
            throw new RuntimeException('Не удалось удалить событие из Яндекс.Календаря.');
        }
    }
    genesisDb()->prepare('DELETE FROM yandex_calendar_tasks WHERE user_id = :user_id AND task_id = :task_id')
        ->execute(['user_id' => $userId, 'task_id' => $taskId]);
}
