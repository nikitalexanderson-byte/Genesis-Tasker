<?php
declare(strict_types=1);

/** Today advertisements are disabled by default; no user identifier is sent to the ad API. */
function genesisAdList(): array
{
    $rows = genesisDb()->query('SELECT * FROM today_ads ORDER BY priority DESC, updated_at DESC')->fetchAll(PDO::FETCH_ASSOC);
    return array_map('genesisAdForClient', $rows);
}

function genesisAdForClient(array $row): array
{
    return [
        'id' => (string)$row['id'],
        'title' => (string)$row['title'],
        'description' => (string)$row['description'],
        'imageUrl' => $row['image_data'] !== '' ? (string)$row['image_data'] : (string)$row['image_url'],
        'linkUrl' => (string)$row['link_url'],
        'languages' => json_decode((string)$row['languages'], true, 512, JSON_THROW_ON_ERROR),
        'countries' => json_decode((string)$row['countries'], true, 512, JSON_THROW_ON_ERROR),
        'platforms' => json_decode((string)$row['platforms'], true, 512, JSON_THROW_ON_ERROR),
        'startsAt' => $row['starts_at'],
        'endsAt' => $row['ends_at'],
        'repeatHours' => (int)$row['repeat_hours'],
        'priority' => (int)$row['priority'],
        'enabled' => (int)$row['enabled'] === 1,
    ];
}

function genesisAdAudienceList(mixed $value, array $allowed, string $field): array
{
    if (!is_array($value) || count($value) > 30) {
        throw new InvalidArgumentException("Invalid $field.");
    }
    $items = array_values(array_unique(array_map(static fn($item): string => is_string($item) ? trim($item) : '', $value)));
    if (in_array('', $items, true) || array_diff($items, $allowed) !== []) {
        throw new InvalidArgumentException("Invalid $field.");
    }
    return $items;
}

function genesisAdDate(mixed $value): ?string
{
    if ($value === null || $value === '') return null;
    if (!is_string($value) || strlen($value) > 40) throw new InvalidArgumentException('Invalid ad date.');
    try { $date = new DateTimeImmutable($value); }
    catch (Throwable) { throw new InvalidArgumentException('Invalid ad date.'); }
    return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

function genesisAdHttpsUrl(mixed $value, bool $required): string
{
    $url = is_string($value) ? trim($value) : '';
    if ($url === '' && !$required) return '';
    if (strlen($url) > 2048 || !filter_var($url, FILTER_VALIDATE_URL)
        || strtolower((string)parse_url($url, PHP_URL_SCHEME)) !== 'https') {
        throw new InvalidArgumentException('Only HTTPS links are allowed in advertisements.');
    }
    return $url;
}

function genesisAdImageData(mixed $value): string
{
    if ($value === null || $value === '') return '';
    if (!is_string($value) || strlen($value) > 700000
        || !preg_match('~^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$~D', $value, $matches)) {
        throw new InvalidArgumentException('Invalid advertisement image.');
    }
    $bytes = base64_decode($matches[2], true);
    if ($bytes === false || strlen($bytes) > 500000) {
        throw new InvalidArgumentException('Advertisement image exceeds 500 KB.');
    }
    $info = getimagesizefromstring($bytes);
    $expected = ['png' => 'image/png', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp'][$matches[1]];
    if ($info === false || ($info['mime'] ?? '') !== $expected || $info[0] > 3000 || $info[1] > 3000) {
        throw new InvalidArgumentException('Invalid advertisement image format or size.');
    }
    return $value;
}

function genesisSaveAd(array $payload, ?string $id = null): array
{
    $title = trim((string)($payload['title'] ?? ''));
    $description = trim((string)($payload['description'] ?? ''));
    if (mb_strlen($title) < 1 || mb_strlen($title) > 120 || mb_strlen($description) < 1
        || mb_strlen($description) > 2000) {
        throw new InvalidArgumentException('Advertisement title or description has invalid length.');
    }
    $imageData = genesisAdImageData($payload['imageData'] ?? '');
    $imageUrl = genesisAdHttpsUrl($payload['imageUrl'] ?? '', false);
    if ($imageData === '' && $imageUrl === '') throw new InvalidArgumentException('Advertisement image is required.');
    $linkUrl = genesisAdHttpsUrl($payload['linkUrl'] ?? '', true);
    $languages = genesisAdAudienceList($payload['languages'] ?? [],
        ['ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja'], 'languages');
    $countries = genesisAdAudienceList($payload['countries'] ?? [],
        array_map(static fn($number): string => chr(65 + intdiv($number, 26)) . chr(65 + $number % 26), range(0, 675)), 'countries');
    $platforms = genesisAdAudienceList($payload['platforms'] ?? [], ['web', 'android'], 'platforms');
    $startsAt = genesisAdDate($payload['startsAt'] ?? null);
    $endsAt = genesisAdDate($payload['endsAt'] ?? null);
    if ($startsAt !== null && $endsAt !== null && $endsAt <= $startsAt) {
        throw new InvalidArgumentException('Advertisement end must follow its start.');
    }
    $repeatHours = filter_var($payload['repeatHours'] ?? 24, FILTER_VALIDATE_INT);
    $priority = filter_var($payload['priority'] ?? 0, FILTER_VALIDATE_INT);
    if ($repeatHours === false || $repeatHours < 1 || $repeatHours > 720
        || $priority === false || $priority < 0 || $priority > 10) {
        throw new InvalidArgumentException('Invalid advertisement frequency or priority.');
    }
    $enabled = ($payload['enabled'] ?? false) === true ? 1 : 0;
    $adId = $id ?? genesisUuid();
    $now = genesisNow();
    $values = [
        'id' => $adId, 'title' => $title, 'description' => $description,
        'image_data' => $imageData, 'image_url' => $imageUrl, 'link_url' => $linkUrl,
        'languages' => json_encode($languages, JSON_THROW_ON_ERROR),
        'countries' => json_encode($countries, JSON_THROW_ON_ERROR),
        'platforms' => json_encode($platforms, JSON_THROW_ON_ERROR),
        'starts_at' => $startsAt, 'ends_at' => $endsAt,
        'repeat_hours' => $repeatHours, 'priority' => $priority,
        'enabled' => $enabled, 'updated_at' => $now,
    ];
    if ($id === null) {
        $values['created_at'] = $now;
        genesisDb()->prepare('INSERT INTO today_ads (id,title,description,image_data,image_url,link_url,languages,countries,platforms,starts_at,ends_at,repeat_hours,priority,enabled,created_at,updated_at) VALUES (:id,:title,:description,:image_data,:image_url,:link_url,:languages,:countries,:platforms,:starts_at,:ends_at,:repeat_hours,:priority,:enabled,:created_at,:updated_at)')->execute($values);
    } else {
        $exists = genesisDb()->prepare('SELECT 1 FROM today_ads WHERE id = :id');
        $exists->execute(['id' => $id]);
        if ($exists->fetchColumn() === false) throw new InvalidArgumentException('Advertisement not found.');
        $statement = genesisDb()->prepare('UPDATE today_ads SET title=:title,description=:description,image_data=:image_data,image_url=:image_url,link_url=:link_url,languages=:languages,countries=:countries,platforms=:platforms,starts_at=:starts_at,ends_at=:ends_at,repeat_hours=:repeat_hours,priority=:priority,enabled=:enabled,updated_at=:updated_at WHERE id=:id');
        $statement->execute($values);
    }
    $statement = genesisDb()->prepare('SELECT * FROM today_ads WHERE id = :id');
    $statement->execute(['id' => $adId]);
    return genesisAdForClient($statement->fetch(PDO::FETCH_ASSOC));
}

function genesisDeleteAd(string $id): void
{
    $statement = genesisDb()->prepare('DELETE FROM today_ads WHERE id = :id');
    $statement->execute(['id' => $id]);
}

function genesisTodayAds(string $language, string $country, string $platform): array
{
    $now = gmdate('Y-m-d\TH:i:s\Z');
    $statement = genesisDb()->prepare('SELECT * FROM today_ads WHERE enabled = 1 AND (starts_at IS NULL OR starts_at <= :start_now) AND (ends_at IS NULL OR ends_at > :end_now) ORDER BY priority DESC, updated_at DESC LIMIT 30');
    $statement->execute(['start_now' => $now, 'end_now' => $now]);
    $matching = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $ad = genesisAdForClient($row);
        if (($ad['languages'] !== [] && !in_array($language, $ad['languages'], true))
            || ($ad['countries'] !== [] && !in_array($country, $ad['countries'], true))
            || ($ad['platforms'] !== [] && !in_array($platform, $ad['platforms'], true))) continue;
        unset($ad['languages'], $ad['countries'], $ad['platforms'], $ad['startsAt'], $ad['endsAt'], $ad['priority'], $ad['enabled']);
        $matching[] = $ad;
        if (count($matching) >= 5) break;
    }
    return $matching;
}

/** Existing APKs can receive a support notice through their shipped Today API.
 * Their compiled Close/Later controls cannot be removed by this server response.
 * Keep sync available while users move to the published release.
 */
function genesisAndroidSupportNotice(string $language, string $installedVersion, ?array $release): ?array
{
    $minimum = $release['minimumSupportedVersionName'] ?? null;
    $published = $release['versionName'] ?? null;
    if (!is_string($minimum) || !is_string($published)
        || !preg_match('/\A[0-9]+(?:\.[0-9]+){1,3}\z/', $minimum)
        || !preg_match('/\A[0-9]+(?:\.[0-9]+){1,3}\z/', $published)
        || !preg_match('/\A[0-9]+(?:\.[0-9]+){1,3}\z/', $installedVersion)
        || version_compare($minimum, $published, '>')
        || !version_compare($installedVersion, $minimum, '<')) return null;
    $russian = $language === 'ru';
    return [
        'id' => 'android-support-' . $minimum,
        'title' => $russian ? 'Обновите GENESIS до ' . $published : 'Update GENESIS to ' . $published,
        'description' => $russian
            ? 'Поддержка версий ниже ' . $minimum . ' завершена. Синхронизируйте сохранённые данные и установите актуальную версию. Ваш аккаунт и данные сохранятся.'
            : 'Support for versions below ' . $minimum . ' has ended. Sync your saved data and install the current release. Your account and data will be preserved.',
        'imageUrl' => 'https://genesiscalendar.com/genesis-hero.png',
        'linkUrl' => 'https://genesiscalendar.com/api/android/download',
        'repeatHours' => 1,
    ];
}

/** Announce only a published newer APK, independently of the support policy.
 * Installed clients identify their version; the same ad disappears after upgrading.
 * New clients keep this notice visible instead of applying commercial ad frequency.
 */
function genesisAndroidUpdateNotice(string $language, string $installedVersion, ?array $release): ?array
{
    $published = $release['versionName'] ?? null;
    $code = $release['versionCode'] ?? null;
    if (!is_string($published) || !is_int($code) || $code < 1
        || !preg_match('/\A[0-9]+(?:\.[0-9]+){1,3}\z/', $published)
        || !preg_match('/\A[0-9]+(?:\.[0-9]+){1,3}\z/', $installedVersion)
        || !version_compare($installedVersion, $published, '<')) return null;
    $copy = [
        'ru' => ['Доступна новая версия', 'Скачайте обновление: улучшенный интерфейс и исправления. Установите поверх приложения, чтобы сохранить данные.'],
        'en' => ['A new version is available', 'Download the update for interface improvements and fixes. Install over the existing app to keep your data.'],
        'el' => ['Διατίθεται νέα έκδοση', 'Κατεβάστε την ενημέρωση με βελτιώσεις και διορθώσεις. Εγκαταστήστε την πάνω από την υπάρχουσα εφαρμογή για να διατηρήσετε τα δεδομένα σας.'],
        'de' => ['Eine neue Version ist verfügbar', 'Laden Sie das Update mit Verbesserungen und Fehlerbehebungen herunter. Installieren Sie es über die bestehende App, um Ihre Daten zu behalten.'],
        'fr' => ['Une nouvelle version est disponible', 'Téléchargez la mise à jour avec ses améliorations et correctifs. Installez-la sur l’application existante pour conserver vos données.'],
        'es' => ['Hay una nueva versión disponible', 'Descarga la actualización con mejoras y correcciones. Instálala sobre la aplicación existente para conservar tus datos.'],
        'it' => ['È disponibile una nuova versione', 'Scarica l’aggiornamento con miglioramenti e correzioni. Installalo sull’app esistente per conservare i tuoi dati.'],
        'pt' => ['Está disponível uma nova versão', 'Transfira a atualização com melhorias e correções. Instale sobre a aplicação existente para manter os seus dados.'],
        'pl' => ['Dostępna jest nowa wersja', 'Pobierz aktualizację z ulepszeniami i poprawkami. Zainstaluj ją na istniejącej aplikacji, aby zachować dane.'],
        'sr' => ['Доступна је нова верзија', 'Преузмите ажурирање са побољшањима и исправкама. Инсталирајте преко постојеће апликације да сачувате податке.'],
        'uk' => ['Доступна нова версія', 'Завантажте оновлення з покращеннями та виправленнями. Встановіть поверх наявного застосунку, щоб зберегти дані.'],
        'zh' => ['新版本已发布', '下载更新，获取界面改进和问题修复。请覆盖安装现有应用以保留数据。'],
        'tr' => ['Yeni bir sürüm mevcut', 'Arayüz iyileştirmeleri ve düzeltmeler için güncellemeyi indirin. Verilerinizi korumak için mevcut uygulamanın üzerine yükleyin.'],
        'ja' => ['新しいバージョンがあります', '画面の改善と不具合修正を含む更新をダウンロードしてください。データを保持するため、既存のアプリに上書きインストールしてください。'],
    ];
    [$title, $description] = $copy[$language] ?? $copy['en'];
    return [
        'id' => 'android-update-' . $code,
        'kind' => 'android-update',
        'targetVersionCode' => $code,
        'title' => $title . ' · ' . $published,
        'description' => $description,
        'imageUrl' => 'https://genesiscalendar.com/genesis-hero.png',
        'linkUrl' => 'https://genesiscalendar.com/api/android/download',
        'repeatHours' => 0,
    ];
}
