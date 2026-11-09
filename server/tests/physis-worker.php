<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit(1);
$directory = getenv('GENESIS_PHYSIS_TEST_DIR');
if (!is_string($directory) || !str_starts_with(basename($directory), 'genesis-physis-test-')) exit(1);
define('GENESIS_LOCAL_TEST_CONFIG', $directory . '/config.php');
define('GENESIS_STATELESS_REQUEST', true);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/repository.php';
require dirname(__DIR__) . '/src/physis.php';
try {
    $payload = json_decode(file_get_contents($directory . '/' . basename($argv[1])), true, 32, JSON_THROW_ON_ERROR);
    $result = genesisPhysisSaveRecords('owner-a', $payload);
    echo json_encode(['status' => 200, 'data' => $result], JSON_THROW_ON_ERROR);
} catch (GenesisPhysisException $error) {
    echo json_encode(['status' => $error->status, 'error' => $error->getMessage()], JSON_THROW_ON_ERROR);
}
