<?php
declare(strict_types=1);

/** Shared reference data, separate from encrypted personal records and intake history. */
function genesisPhysisCatalogCanEdit(string $owner): bool
{
    $user = genesisFindUser($owner);
    return $user !== null && genesisIsAdminUser($user) && genesisSessionOwnsGoogleAccount($user);
}
function genesisPhysisCatalogRow(array $row): array
{
    return ['id' => $row['id'], 'entry' => json_decode($row['entry_json'], true, 32, JSON_THROW_ON_ERROR),
        'revision' => (int)$row['revision'], 'updatedAt' => $row['updated_at']];
}
function genesisPhysisCatalog(string $owner): array
{
    $rows = genesisDb()->query('SELECT id,entry_json,revision,updated_at FROM physis_catalog_overrides ORDER BY id')->fetchAll();
    return ['overrides' => array_map('genesisPhysisCatalogRow', $rows), 'canEdit' => genesisPhysisCatalogCanEdit($owner)];
}
function genesisPhysisCatalogText(mixed $value, int $max, bool $required = false): string
{
    if (!is_string($value) || mb_strlen($value) > $max || ($required && trim($value) === '')
        || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) {
        throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    }
    return trim($value);
}
function genesisPhysisCatalogList(mixed $value, int $count, int $length): array
{
    if (!is_array($value) || !array_is_list($value) || count($value) > $count) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    return array_values(array_unique(array_map(static fn($item) => genesisPhysisCatalogText($item, $length, true), $value)));
}
function genesisPhysisCatalogValidate(mixed $entry, string $id): array
{
    if (!is_array($entry)) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    $fields = ['id','kind','nameRu','nameEn','aliases','family','tags','description','uses','evidence','risks','sources','reviewedAt','verification','restricted','hidden','scopeNote','legacyId'];
    foreach (['composition','status','mechanism','contraindications','interactions'] as $optional) {
        if (array_key_exists($optional, $entry)) $fields[] = $optional;
    }
    genesisPhysisKeys($entry, $fields);
    foreach (['status','mechanism','contraindications','interactions'] as $optional) {
        if (array_key_exists($optional, $entry)) $entry[$optional] = genesisPhysisCatalogText($entry[$optional], 10000);
    }
    if (array_key_exists('composition', $entry)) $entry['composition'] = genesisPhysisCatalogComposition($entry['composition']);
    if ($entry['id'] !== $id || !in_array($entry['kind'], ['food','supplement','medicine'], true)
        || !is_bool($entry['restricted']) || !is_bool($entry['hidden'])) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    foreach (['nameRu'=>240,'nameEn'=>500,'family'=>80,'description'=>10000,'uses'=>5000,'evidence'=>10000,'risks'=>10000,'scopeNote'=>5000,'verification'=>240,'legacyId'=>100] as $key=>$length) {
        $entry[$key] = genesisPhysisCatalogText($entry[$key], $length, in_array($key, ['nameRu','family','description'], true));
    }
    $entry['aliases'] = genesisPhysisCatalogList($entry['aliases'], 40, 500);
    $entry['tags'] = genesisPhysisCatalogList($entry['tags'], 32, 80);
    $entry['sources'] = genesisPhysisCatalogList($entry['sources'], 16, 2000);
    foreach ($entry['sources'] as $url) {
        $parts = parse_url($url);
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array($parts['scheme'] ?? '', ['https','http'], true)
            || isset($parts['user']) || isset($parts['pass'])) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    }
    $date = genesisPhysisCatalogText($entry['reviewedAt'], 10, true);
    if (!preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/', $date, $parts)
        || !checkdate((int)$parts[2], (int)$parts[3], (int)$parts[1])) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    return $entry;
}
function genesisPhysisCatalogComposition(mixed $value): array
{
    if (!is_array($value)) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    genesisPhysisKeys($value, ['state','basis','densityGPerMl','descriptionRu','descriptionEn','source','version','license','provider','values','estimated','trace']);
    if (!in_array($value['state'], ['raw','cooked','dry','reconstituted','unknown'], true)
        || !in_array($value['basis'], ['100g','100ml'], true)
        || !in_array($value['provider'], ['USDA','manual','label','recipe'], true)) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    $density = $value['densityGPerMl'];
    if ($density !== null && ((!is_int($density) && !is_float($density)) || !is_finite((float)$density) || $density <= 0 || $density > 30)) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    foreach (['descriptionRu'=>500,'descriptionEn'=>500,'source'=>1000,'version'=>500,'license'=>2000] as $key=>$limit) {
        $value[$key] = genesisPhysisCatalogText($value[$key], $limit, in_array($key, ['descriptionRu','source','version'], true));
    }
    $keys = ['energy','protein','fat','carbohydrate','fiber','sugar','saturatedFat','transFat','sodium','calcium','magnesium','potassium','iron','zinc','selenium','vitaminC','vitaminD','vitaminB12','folate','omega3ALA','omega3EPA','omega3DHA','vitaminA','vitaminE','vitaminK','vitaminB1','vitaminB2','vitaminB3','vitaminB5','vitaminB6','biotin','choline','copper','phosphorus','iodine','manganese','leucine','lysine'];
    if (!is_array($value['values']) || count($value['values']) > count($keys)) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    foreach ($value['values'] as $key=>$amount) {
        if (!in_array($key, $keys, true) || (!is_int($amount) && !is_float($amount)) || !is_finite((float)$amount) || $amount < 0 || $amount > 1e7) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    }
    foreach (['estimated','trace'] as $key) {
        $value[$key] = genesisPhysisCatalogList($value[$key], count($keys), 40);
        foreach ($value[$key] as $nutrient) {
            if (!in_array($nutrient, $keys, true) || ($key === 'estimated' && !array_key_exists($nutrient, $value['values']))
                || ($key === 'trace' && array_key_exists($nutrient, $value['values']))) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
        }
    }
    return $value;
}
function genesisPhysisCatalogSave(string $owner, array $body): array
{
    if (!genesisPhysisCatalogCanEdit($owner)) throw new GenesisPhysisException(403, 'PHYSIS_CATALOG_ADMIN_REQUIRED');
    genesisPhysisKeys($body, ['id','expectedRevision','entry']);
    $id = $body['id'];
    if (!is_string($id) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9:_-]{1,79}$/D', $id)) throw new GenesisPhysisException(400, 'PHYSIS_CATALOG_INVALID');
    $expected = genesisPhysisInteger($body['expectedRevision']);
    $entry = genesisPhysisCatalogValidate($body['entry'], $id);
    $json = genesisPhysisEncode(genesisPhysisCanonical($entry));
    $db = genesisDb();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $query = $db->prepare('SELECT * FROM physis_catalog_overrides WHERE id=:id');
        $query->execute(['id'=>$id]); $current = $query->fetch();
        if ((int)($current['revision'] ?? 0) !== $expected) {
            // A lost successful response can be retried without creating another revision.
            if ($current && (int)$current['revision'] === $expected + 1 && hash_equals($current['entry_json'], $json)) {
                $db->exec('COMMIT'); return genesisPhysisCatalogRow($current);
            }
            throw new GenesisPhysisException(409, 'PHYSIS_CATALOG_CONFLICT');
        }
        if (!$current && (int)$db->query('SELECT COUNT(*) FROM physis_catalog_overrides')->fetchColumn() >= 5000) throw new GenesisPhysisException(409, 'PHYSIS_CATALOG_LIMIT');
        $row = ['id'=>$id,'entry_json'=>$json,'revision'=>$expected+1,'updated_at'=>genesisNow(),'updated_by'=>$owner];
        $db->prepare('INSERT INTO physis_catalog_overrides(id,entry_json,revision,updated_at,updated_by)
            VALUES(:id,:entry_json,:revision,:updated_at,:updated_by)
            ON CONFLICT(id) DO UPDATE SET entry_json=excluded.entry_json,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by')->execute($row);
        $db->exec('COMMIT'); return genesisPhysisCatalogRow($row);
    } catch (Throwable $error) {
        $db->exec('ROLLBACK'); throw $error;
    }
}
