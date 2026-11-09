<?php
declare(strict_types=1);

function securityHttpLifecycle(array $admin, string $secondarySub): void
{
    if ((genesisConfig()['app_url'] ?? '') !== 'https://localhost.invalid') {
        throw new RuntimeException('Security HTTP checks require isolated synthetic configuration.');
    }
    $saved = $_SESSION;
    $files = [];
    $makeCookie = static function (string $sub) use ($admin, &$files): array {
        genesisEstablishGoogleSession($admin, $sub);
        $csrf = $_SESSION['csrf'];
        $id = bin2hex(random_bytes(24));
        $encoded = '';
        foreach ($_SESSION as $key => $value) $encoded .= $key . '|' . serialize($value);
        $file = genesisConfig()['session_path'] . '/sess_' . $id;
        file_put_contents($file, $encoded, LOCK_EX); $files[] = $file;
        return [session_name() . '=' . $id, $csrf];
    };
    [$linkedCookie, $linkedCsrf] = $makeCookie($secondarySub);
    [$primaryCookie, $primaryCsrf] = $makeCookie($admin['google_sub']);
    $_SESSION = $saved;
    $listener = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
    if ($listener === false) throw new RuntimeException('Cannot reserve HTTP test port.');
    $address = stream_socket_get_name($listener, false); fclose($listener);
    $command = [PHP_BINARY];
    if (($ini = php_ini_loaded_file()) !== false) array_push($command, '-c', $ini);
    if (!defined('GENESIS_LOCAL_TEST_CONFIG') || !is_file((string)GENESIS_LOCAL_TEST_CONFIG)) {
        throw new RuntimeException('HTTP harness requires an explicit synthetic configuration.');
    }
    $router = tempnam(sys_get_temp_dir(), 'genesis-security-router-');
    file_put_contents($router, '<?php define("GENESIS_LOCAL_TEST_CONFIG", ' . var_export((string)GENESIS_LOCAL_TEST_CONFIG, true)
        . '); require ' . var_export(dirname(__DIR__) . '/public/api/index.php', true) . ';');
    $files[] = $router;
    array_push($command, '-S', $address, $router);
    $log = tempnam(sys_get_temp_dir(), 'genesis-security-http-');
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['file', $log, 'a'], 2 => ['file', $log, 'a']], $pipes, dirname(__DIR__, 2));
    if (!is_resource($process)) throw new RuntimeException('Cannot start security HTTP server.');
    fclose($pipes[0]);
    $request = static function (string $path, string $cookie, string $csrf, string $method = 'GET', ?string $body = null) use ($address): array {
        $context = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10, 'method' => $method,
            'header' => "Cookie: $cookie\r\nX-CSRF-Token: $csrf\r\nContent-Type: application/json\r\n", 'content' => $body ?? '']]);
        $bytes = file_get_contents('http://' . $address . '/?path=' . rawurlencode($path), false, $context);
        preg_match('/^HTTP\/\S+ (\d+)/', ($http_response_header ?? [])[0] ?? '', $status);
        return ['status' => (int)($status[1] ?? 0), 'data' => json_decode($bytes ?: '{}', true)];
    };
    try {
        for ($attempt = 0; $attempt < 50; $attempt++) {
            $socket = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
            if ($socket !== false) { fclose($socket); break; }
            usleep(100000);
        }
        sharedExpect($request('admin/stats', $linkedCookie, $linkedCsrf)['status'] === 200, 'Verified linked cookie lost its account admin API.');
        $linkedBootstrap=$request('bootstrap', $linkedCookie, $linkedCsrf);
        sharedExpect(($linkedBootstrap['data']['user']['uid']??'') === $admin['id'], 'Linked bootstrap changed the canonical user ID.');
        sharedExpect($request('admin/stats', $primaryCookie, $primaryCsrf)['status'] === 200, 'Primary cookie lost admin API.');
        sharedExpect($request('bootstrap', $linkedCookie, $linkedCsrf)['status'] === 200, 'Valid linked cookie lost workspace access.');
        $oversized = '{"padding":"' . str_repeat('x', 256 * 1024) . '"}';
        sharedExpect($request('metrics', $primaryCookie, $primaryCsrf, 'POST', $oversized)['status'] === 413, 'Real router did not bound input.');
        $query = genesisDb()->prepare('SELECT id FROM linked_google_accounts WHERE owner_user_id=:owner AND google_sub=:sub');
        $query->execute(['owner' => $admin['id'], 'sub' => $secondarySub]);
        genesisRemoveLinkedGoogleAccount($admin['id'], (string)$query->fetchColumn());
        foreach (['workspace', 'bootstrap', 'admin/stats'] as $path) {
            $response = $request($path, $linkedCookie, $linkedCsrf);
            sharedExpect($response['status'] === 401 && !isset($response['data']['workspace']), 'Revoked cookie retained protected data/key.');
        }
        sharedExpect($request('workspace', $linkedCookie, $linkedCsrf, 'PUT', '{}')['status'] === 401, 'Revoked cookie retained write access.');
        sharedExpect($request('bootstrap', $primaryCookie, $primaryCsrf)['status'] === 200, 'Unlink revoked the primary cookie.');
        sharedExpect($request('auth/logout', $primaryCookie, $primaryCsrf, 'POST', '{}')['status'] === 200, 'Server logout failed.');
        sharedExpect($request('bootstrap', $primaryCookie, $primaryCsrf)['status'] === 401, 'Logout cookie was restored.');
    } finally {
        proc_terminate($process); proc_close($process);
        if (is_file($log)) unlink($log);
        foreach ($files as $file) if (is_file($file)) unlink($file);
        $_SESSION = $saved;
    }
    echo "Security HTTP: linked account privileges, unlink read/write revoked, primary preserved, bounded body and logout passed.\n";
}
