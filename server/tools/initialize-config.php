<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$path = $argv[1] ?? '';
if ($path === '' || !is_file($path)) {
    fwrite(STDERR, "Usage: php initialize-config.php /absolute/path/config.php\n");
    exit(2);
}

$contents = file_get_contents($path);
if ($contents === false) {
    throw new RuntimeException('Config could not be read.');
}

if (str_contains($contents, 'REPLACE_WITH_RANDOM_KEY')) {
    $contents = str_replace('REPLACE_WITH_RANDOM_KEY', base64_encode(random_bytes(32)), $contents);
    if (file_put_contents($path, $contents, LOCK_EX) === false) {
        throw new RuntimeException('Config could not be initialized.');
    }
}

@chmod($path, 0600);
$config = require $path;
if (!is_array($config) || base64_decode((string)($config['crypto_key'] ?? ''), true) === false) {
    throw new RuntimeException('Initialized config is invalid.');
}

echo "GENESIS config initialized.\n";
