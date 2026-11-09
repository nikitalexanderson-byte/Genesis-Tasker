<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/relocation.php';
function expect(bool $condition): void {
    if (!$condition) throw new RuntimeException('Relocation assertion failed.');
}
expect(genesisRelocationUrl('/api/session') === 'https://genesiscalendar.com/api/session');
expect(genesisRelocationUrl('/api/tasks?revision=2') === 'https://genesiscalendar.com/api/tasks?revision=2');
expect(genesisRelocationWebOrigin(['app_url' => 'https://genesiscalendar.com'], []) === 'https://genesiscalendar.com');
expect(genesisRelocationWebOrigin(['app_url' => 'https://genesiscalendar.com'], ['HTTP_X_GENESIS_LEGACY_ORIGIN' => 'https://genesiscalendar.ru']) === 'https://genesiscalendar.ru');
expect(genesisRelocationWebOrigin(['app_url' => 'https://genesiscalendar.com'], ['HTTP_X_GENESIS_LEGACY_ORIGIN' => 'https://attacker.invalid']) === 'https://genesiscalendar.com');
expect(genesisRelocationWebOrigin(['app_url' => 'https://test.invalid'], ['HTTP_X_GENESIS_LEGACY_ORIGIN' => 'https://genesiscalendar.ru']) === 'https://test.invalid');
foreach (['https://attacker.invalid/api/session', '//attacker.invalid/api/session', '/private/config.php', "/api/session\r\nInjected: yes"] as $invalid) {
    try { genesisRelocationUrl($invalid); throw new RuntimeException('Unsafe path accepted.'); }
    catch (InvalidArgumentException) { /* Expected. */ }
}
$testConfig = ['google_only' => true, 'yandex_client_id' => 'test', 'yandex_client_secret' => 'test'];
function genesisConfig(): array { global $testConfig; return $testConfig; }
require dirname(__DIR__) . '/src/yandex.php';
expect(!genesisYandexConfigured());
$testConfig['google_only'] = false;
expect(genesisYandexConfigured());
echo "Relocation routing and Google-only policy: PASS\n";
