<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/ads.php';

$release = ['versionName' => '2.7.0', 'minimumSupportedVersionName' => '2.7.0'];
$notice = genesisAndroidSupportNotice('ru', '2.6.9', $release);
if ($notice === null || $notice['linkUrl'] !== 'https://genesiscalendar.com/api/android/download')
    throw new RuntimeException('Older installed clients must receive the current release notice.');
foreach (['2.7.0', '2.8.0', '', 'unknown', '../2.6.9'] as $version) {
    if (genesisAndroidSupportNotice('ru', $version, $release) !== null)
        throw new RuntimeException('Supported, web or malformed clients must not receive a support notice.');
}
if (genesisAndroidSupportNotice('en', '2.6.9', null) !== null
    || genesisAndroidSupportNotice('en', '2.6.9', ['versionName' => '2.6.9', 'minimumSupportedVersionName' => '2.7.0']) !== null)
    throw new RuntimeException('Never require an unpublished release.');
echo "Android support notice tests passed.\n";

$update = ['versionName' => '3.0.5', 'versionCode' => 112, 'minimumSupportedVersionName' => '2.7.0'];
foreach (['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'] as $language) {
    $notice = genesisAndroidUpdateNotice($language, '3.0.4', $update);
    if ($notice === null || $notice['kind'] !== 'android-update' || $notice['targetVersionCode'] !== 112
        || !str_contains($notice['title'], '3.0.5') || $notice['description'] === '')
        throw new RuntimeException('Every supported language must announce the published update.');
}
foreach (['3.0.5', '3.0.6', '', 'unknown', '../3.0.4'] as $version) {
    if (genesisAndroidUpdateNotice('ru', $version, $update) !== null)
        throw new RuntimeException('Current, newer, missing and invalid versions must not receive update ads.');
}
if (genesisAndroidUpdateNotice('ru', '3.0.4', null) !== null
    || genesisAndroidUpdateNotice('ru', '3.0.4', ['versionName' => '../3.0.5', 'versionCode' => 112]) !== null)
    throw new RuntimeException('An update ad must never point to a missing or malformed release.');
echo "Android update campaign: all locales, older/current/newer versions and invalid manifests passed.\n";
