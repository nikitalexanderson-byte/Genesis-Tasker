<?php
declare(strict_types=1);
// Inherited by CLI race workers through PHPRC; never enabled by production configuration.
if (!in_array(PHP_SAPI, ['cli', 'cli-server'], true) || getenv('GENESIS_FULL_QA') !== 'isolated') throw new RuntimeException('Isolated QA CLI required');
if (getenv('GENESIS_QA_SELF_CONFIG') === '1' || PHP_SAPI === 'cli-server') return;
$directory = str_replace('\\', '/', (string)getenv('GENESIS_QA_TEST_DIR'));
$path = $directory . '/config.php';
if (!is_file($directory . '/owner.json') || !is_file($path)) throw new RuntimeException('Missing owned fixture');
$owner = json_decode((string)file_get_contents($directory . '/owner.json'), true, 16, JSON_THROW_ON_ERROR);
if (($owner['directory'] ?? '') !== $directory || !hash_equals((string)$owner['configSha256'], (string)hash_file('sha256', $path))) throw new RuntimeException('Fixture ownership mismatch');
if (!defined('GENESIS_LOCAL_TEST_CONFIG')) define('GENESIS_LOCAL_TEST_CONFIG', $path);
