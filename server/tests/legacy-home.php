<?php
declare(strict_types=1);
define('GENESIS_LEGACY_HOME_TEST', true);
require dirname(__DIR__, 2) . '/public/legacy-home.php';
$source = '<!doctype html><html lang="ru"><head><title>GENESIS</title><script type="module" src="/assets/app-original.js"></script></head><body class="existing"><div id="root">Existing calendar</div></body></html>';
$result = genesisLegacyHomepage($source);
foreach (['<div id="root">Existing calendar</div>', '/assets/app-original.js', '<body class="existing">', 'genesis-relocation-top', 'genesis-relocation-bottom', 'https://genesiscalendar.com'] as $expected) {
    if (!str_contains($result, $expected)) throw new RuntimeException('Legacy homepage lost required content: ' . $expected);
}
if (substr_count($result, '<aside ') !== 1 || substr_count($result, '<footer ') !== 1) throw new RuntimeException('Expected exactly two public notices.');
if (strpos($result, 'genesis-relocation-top') > strpos($result, 'id="root"') || strpos($result, 'genesis-relocation-bottom') < strpos($result, 'id="root"')) throw new RuntimeException('Notices must surround the working application.');
echo "Legacy homepage preserves the app and adds two notices: PASS\n";
