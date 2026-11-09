<?php
declare(strict_types=1);

/** A retired origin forwards API calls; it never opens its old database. */
function genesisRelocationUrl(string $uri): string
{
    if (!str_starts_with($uri, '/api/') || preg_match('/[\x00-\x20\x7f]/', $uri)) {
        throw new InvalidArgumentException('Invalid legacy API path.');
    }
    return 'https://genesiscalendar.com' . $uri;
}

/** Keep browser cookies and the OAuth callback on the origin where login began. */
function genesisRelocationWebOrigin(array $config, array $headers): string
{
    $origin = rtrim((string)$config['app_url'], '/');
    return $origin === 'https://genesiscalendar.com'
        && ($headers['HTTP_X_GENESIS_LEGACY_ORIGIN'] ?? '') === 'https://genesiscalendar.ru'
        ? 'https://genesiscalendar.ru'
        : $origin;
}

function genesisHandleRelocation(string $serverRoot): void
{
    $marker = $serverRoot . '/var/relocation.json';
    if (!is_file($marker)) return;
    $state = json_decode((string)file_get_contents($marker), true);
    header('Cache-Control: no-store');
    if (($state['mode'] ?? '') !== 'forward') {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        header('Retry-After: 120');
        echo '{"error":"RELOCATION_IN_PROGRESS"}';
        exit;
    }
    if (!preg_match('/^(?:www\.)?genesiscalendar\.ru(?::443)?$/i', (string)($_SERVER['HTTP_HOST'] ?? ''))) {
        http_response_code(503);
        exit;
    }
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($method, ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], true)) {
        http_response_code(405);
        exit;
    }
    try {
        $url = genesisRelocationUrl((string)($_SERVER['REQUEST_URI'] ?? ''));
    } catch (InvalidArgumentException) {
        http_response_code(400);
        exit;
    }
    $headers = ['Accept: application/json', 'X-Genesis-Legacy-Origin: https://genesiscalendar.ru'];
    foreach ([
        'CONTENT_TYPE' => 'Content-Type',
        'HTTP_USER_AGENT' => 'User-Agent',
        'HTTP_X_CSRF_TOKEN' => 'X-CSRF-Token',
        'HTTP_X_GENESIS_TIME_ZONE' => 'X-Genesis-Time-Zone',
        'HTTP_X_GENESIS_APP_VERSION' => 'X-Genesis-App-Version',
        'HTTP_X_GENESIS_INSTALLATION_ID' => 'X-Genesis-Installation-Id',
        'HTTP_X_GENESIS_FOREGROUND' => 'X-Genesis-Foreground',
        'HTTP_X_GENESIS_VISIT' => 'X-Genesis-Visit',
    ] as $source => $name) {
        $value = (string)($_SERVER[$source] ?? '');
        if ($value !== '' && !preg_match('/[\r\n]/', $value)) $headers[] = $name . ': ' . $value;
    }
    $session = (string)($_COOKIE['GENESISSESSID'] ?? '');
    if (preg_match('/^[A-Za-z0-9,-]{16,256}$/', $session)) $headers[] = 'Cookie: GENESISSESSID=' . $session;
    $body = file_get_contents('php://input');
    if ($body === false || strlen($body) > 8 * 1024 * 1024) {
        http_response_code(413);
        exit;
    }
    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line): int {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $match)) {
                http_response_code((int)$match[1]);
            } elseif (preg_match('/^(Content-Type|Set-Cookie|Location|Retry-After|Content-Disposition):/i', $line)) {
                header(trim($line), false);
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk): int {
            echo $chunk;
            return strlen($chunk);
        },
    ]);
    if ($body !== '') curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    if ($method === 'HEAD') curl_setopt($handle, CURLOPT_NOBODY, true);
    if (curl_exec($handle) === false && !headers_sent()) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        echo '{"error":"RELOCATION_UPSTREAM_UNAVAILABLE"}';
    }
    curl_close($handle);
    exit;
}
