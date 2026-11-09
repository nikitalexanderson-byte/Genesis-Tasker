<?php
declare(strict_types=1);

/** Exercise the real router: binary downloads must never invoke logout. */
function attachmentHttpDownloads(string $userId, string $taskId, array $file, string $fileBytes, string $imageBytes): void
{
    $fixture = getenv('GENESIS_MINDMAPS_TEST') === 'isolated'
        && (genesisConfig()['app_url'] ?? '') === 'http://127.0.0.1:4319'
        && realpath(genesisConfig()['db_path']) === realpath(dirname(__DIR__,2).'/output/mindmaps-test.sqlite');
    if ((genesisConfig()['app_url'] ?? '') !== 'https://localhost.invalid' && !$fixture) {
        throw new RuntimeException('HTTP regression requires the isolated smoke configuration.');
    }
    $listener = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
    attachmentExpect($listener !== false, 'Cannot reserve a local HTTP test port.');
    $address = stream_socket_get_name($listener, false);
    fclose($listener);
    $command = [PHP_BINARY];
    $ini = php_ini_loaded_file();
    if ($ini !== false) {
        array_push($command, '-c', $ini);
    } else {
        // Portable Windows PHP has no ini; reproduce the parent's test extensions.
        array_push($command, '-n', '-d', 'extension_dir=' . ini_get('extension_dir'));
        foreach (['pdo_sqlite', 'sodium', 'mbstring'] as $extension) {
            $library = ini_get('extension_dir') . '/' . (PHP_OS_FAMILY === 'Windows' ? 'php_' : '') . $extension . '.' . PHP_SHLIB_SUFFIX;
            if (is_file($library)) array_push($command, '-d', 'extension=' . $extension);
        }
    }
    $router = null;
    $routerPath = 'server/public/api/index.php';
    if (defined('GENESIS_LOCAL_TEST_CONFIG') && is_file((string)GENESIS_LOCAL_TEST_CONFIG)) {
        $router = tempnam(sys_get_temp_dir(), 'genesis-download-router-');
        attachmentExpect($router !== false, 'Cannot create an isolated download router.');
        file_put_contents($router, '<?php define("GENESIS_LOCAL_TEST_CONFIG", ' . var_export((string)GENESIS_LOCAL_TEST_CONFIG, true)
            . '); require ' . var_export(dirname(__DIR__) . '/public/api/index.php', true) . ';');
        $routerPath = $router;
    }
    array_push($command, '-S', $address, $routerPath);
    $log = tempnam(sys_get_temp_dir(), 'genesis-download-http-');
    attachmentExpect($log !== false, 'Cannot create HTTP test log.');
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, dirname(__DIR__, 2));
    attachmentExpect(is_resource($process), 'Cannot start HTTP test server.');
    fclose($pipes[0]);
    $sessionId = session_id();
    $sessionUser = genesisFindUser($userId);
    genesisEstablishGoogleSession($sessionUser, (string)$sessionUser['google_sub']);
    unset($_SESSION['cookie_renewed_at']);
    $csrf=$_SESSION['csrf'];$loginId=$_SESSION['auth_login_id'];
    $cookie = session_name() . '=' . $sessionId;
    session_write_close(); // Release the lock so HTTP requests can read the session.
    $request = static function (string $path, bool $authenticated = true) use ($address, $cookie): array {
        $context = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 5,
            'header' => $authenticated ? 'Cookie: ' . $cookie . "\r\n" : '']]);
        $bytes = file_get_contents('http://' . $address . '/?path=' . rawurlencode($path), false, $context);
        $headers = $http_response_header ?? [];
        attachmentExpect($bytes !== false && count($headers) > 0, 'HTTP request failed.');
        preg_match('/^HTTP\/\S+ (\d+)/', $headers[0], $status);
        $values = [];
        foreach (array_slice($headers, 1) as $header) {
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) $values[strtolower($parts[0])] = trim($parts[1]);
        }
        return ['status' => (int)($status[1] ?? 0), 'headers' => $values, 'bytes' => $bytes];
    };
    try {
        $ready = false;
        for ($attempt = 0; $attempt < 50; $attempt++) {
            $socket = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
            if ($socket !== false) { fclose($socket); $ready = true; break; }
            usleep(100000);
        }
        attachmentExpect($ready, 'HTTP test server did not start.');
        $paths = [
            ['shared/tasks/' . $taskId . '/image', $imageBytes, 'image/png'],
            ['shared/tasks/' . $taskId . '/attachments/' . $file['id'], $fileBytes, $file['type']],
        ];
        foreach ($paths as $index => [$path, $expected, $type]) {
            $response = $request($path);
            attachmentExpect($response['status'] === 200 && $response['bytes'] === $expected, 'Download returned JSON or corrupted binary bytes (HTTP ' . $response['status'] . ', ' . strlen($response['bytes']) . ' bytes).');
            attachmentExpect(($response['headers']['content-type'] ?? '') === $type
                && (int)($response['headers']['content-length'] ?? -1) === strlen($expected)
                && ($response['headers']['x-content-type-options'] ?? '') === 'nosniff'
                && str_contains($response['headers']['cache-control'] ?? '', 'no-store'), 'Download headers lost protection or binary metadata.');
            attachmentExpect(!isset($response['headers']['set-cookie']), 'Download unexpectedly changed the session cookie.');
            if (str_contains($path, '/attachments/')) {
                attachmentExpect(str_contains($response['headers']['content-disposition'] ?? '', "filename*=UTF-8''" . rawurlencode($file['name'])), 'Download lost its UTF-8 filename.');
            }
            $session = $request('session');
            $payload = json_decode($session['bytes'], true, 512, JSON_THROW_ON_ERROR);
            attachmentExpect($session['status'] === 200 && ($payload['user']['uid'] ?? null) === $userId, 'Download signed the user out.');
            attachmentExpect(($payload['csrf']??null)===$csrf&&($payload['loginId']??null)===$loginId,'Heartbeat changed CSRF or login identity.');
            $renewal=$session['headers']['set-cookie']??'';
            if($index===0){
                attachmentExpect(str_starts_with($renewal,$cookie.';')&&stripos($renewal,'httponly')!==false&&stripos($renewal,'samesite=lax')!==false,'Heartbeat did not renew the protected cookie with the same session ID.');
                preg_match('/max-age=(\d+)/i',$renewal,$age);
                attachmentExpect(isset($age[1])&&(int)$age[1]>=2591990&&(int)$age[1]<=2592000,'Heartbeat cookie lifetime changed.');
            }else attachmentExpect($renewal==='','Heartbeat renewed the cookie within its cooldown.');
            attachmentExpect($request($path, false)['status'] === 401, 'Anonymous binary download succeeded.');
        }
    } finally {
        proc_terminate($process);
        proc_close($process);
        unlink($log);
        if ($router !== null && is_file($router)) unlink($router);
        $sessionFile = genesisConfig()['session_path'] . '/sess_' . $sessionId;
        if (is_file($sessionFile)) unlink($sessionFile);
        $_SESSION = [];
    }
    echo "Shared HTTP downloads: binary bytes, headers, authentication and retained session passed.\n";
}
