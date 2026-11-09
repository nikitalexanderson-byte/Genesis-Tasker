<?php
// Used only by php -S 127.0.0.1:4320; never deploy this fixture router.
if (PHP_SAPI !== 'cli-server' || getenv('GENESIS_MINDMAPS_TEST') !== 'isolated'
    || !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1','::1'], true)) { http_response_code(403); exit; }
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($uri, '/api/')) { $_GET['path']=substr($uri,5); require dirname(__DIR__,2).'/server/public/api/index.php'; return; }
http_response_code(404);
