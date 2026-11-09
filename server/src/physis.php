<?php
declare(strict_types=1);
require_once __DIR__ . '/physis-catalog.php';

/** Physis records stay encrypted under the owner's shared GENESIS account. */
final class GenesisPhysisException extends RuntimeException
{
    public function __construct(public readonly int $status, string $code) { parent::__construct($code); }
}

const GENESIS_PHYSIS_EMAILS = ['nikitalexanderson@gmail.com', 'jurijjlogvinov@gmail.com', 'picishina@gmail.com', 'maybenextime86@gmail.com', 'shamrinandy@gmail.com', 'eagbread@gmail.com'];
// The historical pilot address list above is no longer an entitlement.
// Premium4Life uses the shared canonical account on the website and future mobile client.
const GENESIS_PHYSIS_WEB_ENABLED = true;
const GENESIS_PHYSIS_MAX_RECORDS = 10000;
const GENESIS_PHYSIS_MAX_STORAGE = 32 * 1024 * 1024;
const GENESIS_PHYSIS_RETENTION_DAYS = 90;

function genesisPhysisRequireOwner(): string
{
    // Reuse the canonical account through either its primary or a live linked login.
    $config = genesisConfig();
    $enabled = array_key_exists('physis_enabled', $config) ? $config['physis_enabled'] : GENESIS_PHYSIS_WEB_ENABLED;
    if ($enabled !== true) throw new GenesisPhysisException(403, 'PHYSIS_UNAVAILABLE');
    $id = genesisCurrentUserId();
    $identity = $_SESSION['auth_identity'] ?? [];
    if ($id === null || !is_array($identity)
        || !in_array($identity['channel'] ?? 'unknown', ['web', 'native', 'unknown'], true)) {
        throw new GenesisPhysisException(403, 'PHYSIS_UNAVAILABLE');
    }
    $user = genesisFindUser($id);
    if ($user === null || genesisUserProvider($user) !== 'google'
        || !genesisSessionOwnsGoogleAccount($user)) {
        throw new GenesisPhysisException(403, 'PHYSIS_UNAVAILABLE');
    }
    if (($user['subscription_plan']??'free')!=='premium4life') throw new GenesisPhysisException(403,'PHYSIS_PREMIUM4LIFE_REQUIRED');
    return $id;
}

function genesisPhysisRoute(string $method, string $path): never
{
    header('Cache-Control: private, no-store');
    header('Vary: Cookie');
    $owner = genesisPhysisRequireOwner();
    genesisEnforceApiBudget($method, $path, $owner);
    $csrf = (string)($_SESSION['csrf'] ?? '');
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        genesisRequireCsrf();
        if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json') {
            throw new GenesisPhysisException(415, 'PHYSIS_JSON_REQUIRED');
        }
    }
    // Session authorization is now fixed for this request; allow simultaneous devices.
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    if ($method === 'GET' && $path === 'physis/v1/access') genesisJson(['available' => true, 'ownerId' => $owner, 'csrf' => $csrf]);
    if ($method === 'GET' && $path === 'physis/v1/catalog') genesisJson(genesisPhysisCatalog($owner));
    if ($method === 'PUT' && $path === 'physis/v1/catalog') genesisJson(genesisPhysisCatalogSave($owner, genesisReadJson()));
    if ($method === 'GET' && $path === 'physis/v1/vault') genesisJson(genesisPhysisVault($owner));
    if ($method === 'PUT' && $path === 'physis/v1/vault') genesisJson(genesisPhysisSaveVault($owner, genesisReadJson()));
    if ($method === 'GET' && $path === 'physis/v1/records') genesisJson(genesisPhysisRecords($owner, $_GET));
    if ($method === 'POST' && $path === 'physis/v1/records') genesisJson(genesisPhysisSaveRecords($owner, genesisReadJson()));
    if ($method === 'POST' && $path === 'physis/v1/rotate') genesisJson(genesisPhysisRotate($owner, genesisReadJson()));
    throw new GenesisPhysisException(404, 'NOT_FOUND');
}

function genesisPhysisKeys(array $value, array $keys): void
{
    $actual = array_keys($value); sort($actual); sort($keys);
    if ($actual !== $keys) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
}

function genesisPhysisInteger(mixed $value, int $minimum = 0, int $maximum = 9007199254740991): int
{
    if (!is_int($value) || $value < $minimum || $value > $maximum) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    return $value;
}

function genesisPhysisId(mixed $value): string
{
    if (!is_string($value) || !preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $value)) {
        throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    }
    return $value;
}

function genesisPhysisBase64(mixed $value, int $minimum, int $maximum): string
{
    if (!is_string($value) || strlen($value) > (int)ceil($maximum / 3) * 4) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_ENVELOPE');
    $bytes = base64_decode($value, true);
    if (!is_string($bytes) || strlen($bytes) < $minimum || strlen($bytes) > $maximum || base64_encode($bytes) !== $value) {
        throw new GenesisPhysisException(400, 'PHYSIS_INVALID_ENVELOPE');
    }
    return $value;
}

function genesisPhysisEnvelope(mixed $value, int $keyVersion): array
{
    if (!is_array($value)) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_ENVELOPE');
    genesisPhysisKeys($value, ['version', 'schemaVersion', 'keyVersion', 'iv', 'ciphertext']);
    if ($value['version'] !== 1 || $value['schemaVersion'] !== 1 || $value['keyVersion'] !== $keyVersion) {
        throw new GenesisPhysisException(409, 'PHYSIS_KEY_VERSION_CONFLICT');
    }
    return ['version' => 1, 'schemaVersion' => 1, 'keyVersion' => $keyVersion,
        'iv' => genesisPhysisBase64($value['iv'], 12, 12),
        'ciphertext' => genesisPhysisBase64($value['ciphertext'], 17, 256 * 1024)];
}

function genesisPhysisValidateVault(mixed $value, int $keyVersion): array
{
    if (!is_array($value)) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_VAULT');
    if (($value['version'] ?? null) === 2) {
        genesisPhysisKeys($value, ['version', 'keyVersion', 'account']);
        if ($value['keyVersion'] !== $keyVersion) throw new GenesisPhysisException(409, 'PHYSIS_KEY_VERSION_CONFLICT');
        if (!is_array($value['account'])) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_VAULT');
        genesisPhysisKeys($value['account'], ['iv', 'ciphertext']);
        return ['version' => 2, 'keyVersion' => $keyVersion, 'account' => [
            'iv' => genesisPhysisBase64($value['account']['iv'], 12, 12),
            'ciphertext' => genesisPhysisBase64($value['account']['ciphertext'], 62, 62)]];
    }
    genesisPhysisKeys($value, ['version', 'keyVersion', 'password', 'recovery']);
    if ($value['version'] !== 1 || $value['keyVersion'] !== $keyVersion || !is_array($value['password']) || !is_array($value['recovery'])) {
        throw new GenesisPhysisException(409, 'PHYSIS_KEY_VERSION_CONFLICT');
    }
    genesisPhysisKeys($value['password'], ['salt', 'iterations', 'iv', 'ciphertext']);
    genesisPhysisKeys($value['recovery'], ['iv', 'ciphertext']);
    if ($value['password']['iterations'] !== 600000) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_VAULT');
    return ['version' => 1, 'keyVersion' => $keyVersion,
        'password' => ['salt' => genesisPhysisBase64($value['password']['salt'], 16, 16), 'iterations' => 600000,
            'iv' => genesisPhysisBase64($value['password']['iv'], 12, 12), 'ciphertext' => genesisPhysisBase64($value['password']['ciphertext'], 48, 48)],
        'recovery' => ['iv' => genesisPhysisBase64($value['recovery']['iv'], 12, 12), 'ciphertext' => genesisPhysisBase64($value['recovery']['ciphertext'], 48, 48)]];
}

function genesisPhysisEncode(array $value): string
{
    return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

/** Object key order is irrelevant for replay; array order remains significant. */
function genesisPhysisCanonical(mixed $value): mixed
{
    if (!is_array($value)) return $value;
    if (!array_is_list($value)) ksort($value, SORT_STRING);
    foreach ($value as $key => $child) $value[$key] = genesisPhysisCanonical($child);
    return $value;
}

function genesisPhysisOwnerState(PDO $db, string $owner): array
{
    $query = $db->prepare('SELECT * FROM physis_owners WHERE owner_id=:owner');
    $query->execute(['owner' => $owner]);
    return $query->fetch() ?: ['owner_id' => $owner, 'current_cursor' => 0, 'min_cursor' => 0, 'vault_json' => null, 'vault_revision' => 0, 'key_version' => 0];
}

function genesisPhysisVault(string $owner): array
{
    $state = genesisPhysisOwnerState(genesisDb(), $owner);
    return ['vault' => $state['vault_json'] === null ? null : json_decode($state['vault_json'], true, 16, JSON_THROW_ON_ERROR),
        'revision' => (int)$state['vault_revision']];
}

/** Called under the writer lock. The durable random-ID registry prevents resurrection
 * even after the 90-day content-free tombstone has expired. */
function genesisPhysisPrune(PDO $db, string $owner, ?string $cutoff = null): void
{
    $cutoff ??= gmdate('Y-m-d\TH:i:s\Z', time() - GENESIS_PHYSIS_RETENTION_DAYS * 86400);
    $query = $db->prepare('SELECT MAX(sequence) FROM physis_records WHERE owner_id=:owner AND deleted_at < :cutoff');
    $query->execute(['owner' => $owner, 'cutoff' => $cutoff]);
    $cursor = (int)$query->fetchColumn();
    if ($cursor > 0) {
        $db->prepare('UPDATE physis_owners SET min_cursor=MAX(min_cursor,:cursor) WHERE owner_id=:owner')->execute(['owner' => $owner, 'cursor' => $cursor]);
        $db->prepare('DELETE FROM physis_records WHERE owner_id=:owner AND deleted_at < :cutoff')->execute(['owner' => $owner, 'cutoff' => $cutoff]);
    }
    $db->prepare('DELETE FROM physis_receipts WHERE owner_id=:owner AND created_at < :cutoff')->execute(['owner' => $owner, 'cutoff' => $cutoff]);
}

/** CAS, receipt, quota checks and changes share one SQLite write transaction. */
function genesisPhysisMutation(string $owner, string $operation, array $body, callable $apply): array
{
    $requestId = genesisPhysisId($body['requestId'] ?? null);
    $hash = hash('sha256', $operation . "\0" . genesisPhysisEncode(genesisPhysisCanonical($body)));
    $db = genesisDb();
    $db->beginTransaction();
    try {
        // First statement obtains the write lock before any read/CAS, including replay.
        $db->prepare('INSERT OR IGNORE INTO physis_owners(owner_id) VALUES(:owner)')->execute(['owner' => $owner]);
        genesisPhysisPrune($db, $owner);
        $query = $db->prepare('SELECT payload_hash,response_json FROM physis_receipts WHERE owner_id=:owner AND request_id=:request');
        $query->execute(['owner' => $owner, 'request' => $requestId]);
        $receipt = $query->fetch();
        if ($receipt) {
            if (!hash_equals($receipt['payload_hash'], $hash)) throw new GenesisPhysisException(409, 'PHYSIS_REQUEST_CONFLICT');
            $response = json_decode($receipt['response_json'], true, 32, JSON_THROW_ON_ERROR);
            $db->commit();
            return $response;
        }
        $response = $apply($db, genesisPhysisOwnerState($db, $owner));
        $query = $db->prepare('SELECT COUNT(*), COALESCE(SUM(LENGTH(envelope_json)),0) FROM physis_records WHERE owner_id=:owner AND deleted_at IS NULL');
        $query->execute(['owner' => $owner]);
        [$count, $bytes] = $query->fetch(PDO::FETCH_NUM);
        if ((int)$count > GENESIS_PHYSIS_MAX_RECORDS || (int)$bytes > GENESIS_PHYSIS_MAX_STORAGE) {
            throw new GenesisPhysisException(409, 'PHYSIS_STORAGE_LIMIT');
        }
        $db->prepare('INSERT INTO physis_receipts(owner_id,request_id,payload_hash,response_json,created_at) VALUES(:owner,:request,:hash,:response,:now)')
            ->execute(['owner' => $owner, 'request' => $requestId, 'hash' => $hash, 'response' => genesisPhysisEncode($response), 'now' => genesisNow()]);
        $db->commit();
        return $response;
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function genesisPhysisSaveVault(string $owner, array $body): array
{
    genesisPhysisKeys($body, ['expectedRevision', 'requestId', 'vault']);
    $expected = genesisPhysisInteger($body['expectedRevision']);
    return genesisPhysisMutation($owner, 'vault', $body, static function (PDO $db, array $state) use ($owner, $body, $expected): array {
        if ((int)$state['vault_revision'] !== $expected) throw new GenesisPhysisException(409, 'PHYSIS_CONFLICT');
        $keyVersion = max(1, (int)$state['key_version']);
        $vault = genesisPhysisValidateVault($body['vault'], $keyVersion);
        $db->prepare('UPDATE physis_owners SET vault_json=:vault,vault_revision=:revision,key_version=:key WHERE owner_id=:owner')
            ->execute(['vault' => genesisPhysisEncode($vault), 'revision' => $expected + 1, 'key' => $keyVersion, 'owner' => $owner]);
        return ['revision' => $expected + 1];
    });
}

function genesisPhysisRecordForClient(array $row): array
{
    return ['id' => $row['id'], 'revision' => (int)$row['revision'], 'sequence' => (int)$row['sequence'],
        'updatedAt' => $row['updated_at'], 'deletedAt' => $row['deleted_at'],
        'envelope' => $row['envelope_json'] === null ? null : json_decode($row['envelope_json'], true, 16, JSON_THROW_ON_ERROR)];
}

function genesisPhysisQueryInteger(array $query, string $key, int $fallback): int
{
    if (!array_key_exists($key, $query)) return $fallback;
    if (!is_string($query[$key]) || !preg_match('/\A(?:0|[1-9][0-9]{0,15})\z/', $query[$key])) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    return genesisPhysisInteger((int)$query[$key]);
}

function genesisPhysisRecords(string $owner, array $parameters): array
{
    if (array_diff(array_keys($parameters), ['path', 'after', 'page', 'limit', 'snapshot'])) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    $delta = array_key_exists('after', $parameters);
    if ($delta && array_key_exists('page', $parameters)) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    $cursor = genesisPhysisQueryInteger($parameters, $delta ? 'after' : 'page', 0);
    $limit = genesisPhysisQueryInteger($parameters, 'limit', 100);
    if ($limit < 1 || $limit > 100) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    $db = genesisDb();
    $db->beginTransaction();
    try {
        $state = genesisPhysisOwnerState($db, $owner);
        $current = (int)$state['current_cursor']; $minimum = (int)$state['min_cursor'];
        if ($cursor > $current || ($delta && $cursor < $minimum)
            || (!$delta && $cursor > 0 && !array_key_exists('snapshot', $parameters))
            || (array_key_exists('snapshot', $parameters) && genesisPhysisQueryInteger($parameters, 'snapshot', -1) !== $current)) {
            throw new GenesisPhysisException(409, 'PHYSIS_RESYNC_REQUIRED');
        }
        $query = $db->prepare('SELECT * FROM physis_records WHERE owner_id=:owner AND sequence>:cursor ORDER BY sequence LIMIT :limit');
        $query->bindValue(':owner', $owner); $query->bindValue(':cursor', $cursor, PDO::PARAM_INT); $query->bindValue(':limit', $limit + 1, PDO::PARAM_INT);
        $query->execute();
        $records = []; $bytes = 0; $more = false;
        while ($row = $query->fetch()) {
            $size = strlen((string)$row['envelope_json']);
            if (count($records) === $limit || ($records && $bytes + $size > 2 * 1024 * 1024)) { $more = true; break; }
            $records[] = genesisPhysisRecordForClient($row); $bytes += $size;
        }
        $query->closeCursor();
        $db->commit();
        return ['records' => $records, 'cursor' => $more ? (int)$records[array_key_last($records)]['sequence'] : $current,
            'hasMore' => $more, 'minCursor' => $minimum, 'snapshot' => $current];
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function genesisPhysisSaveRecords(string $owner, array $body): array
{
    genesisPhysisKeys($body, ['requestId', 'changes']);
    if (!is_array($body['changes']) || !array_is_list($body['changes']) || count($body['changes']) < 1 || count($body['changes']) > 100) {
        throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    }
    return genesisPhysisMutation($owner, 'records', $body, static function (PDO $db, array $state) use ($owner, $body): array {
        if ((int)$state['key_version'] < 1) throw new GenesisPhysisException(409, 'PHYSIS_VAULT_REQUIRED');
        $cursor = (int)$state['current_cursor']; $results = []; $seen = []; $now = genesisNow();
        foreach ($body['changes'] as $change) {
            if (!is_array($change)) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
            $operation = $change['operation'] ?? '';
            if (!in_array($operation, ['create', 'update', 'delete'], true)) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
            genesisPhysisKeys($change, $operation === 'delete' ? ['id', 'operation', 'expectedRevision'] : ['id', 'operation', 'expectedRevision', 'envelope']);
            $id = genesisPhysisId($change['id']); $expected = genesisPhysisInteger($change['expectedRevision']);
            if (isset($seen[$id])) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
            $seen[$id] = true;
            $query = $db->prepare('SELECT * FROM physis_records WHERE owner_id=:owner AND id=:id');
            $query->execute(['owner' => $owner, 'id' => $id]); $existing = $query->fetch();
            if ($operation === 'create') {
                $query = $db->prepare('SELECT 1 FROM physis_used_ids WHERE owner_id=:owner AND id=:id');
                $query->execute(['owner' => $owner, 'id' => $id]);
                if ($expected !== 0 || $query->fetchColumn() !== false) throw new GenesisPhysisException(409, 'PHYSIS_CONFLICT');
                $db->prepare('INSERT INTO physis_used_ids(owner_id,id) VALUES(:owner,:id)')->execute(['owner' => $owner, 'id' => $id]);
            } elseif (!$existing || $existing['deleted_at'] !== null || (int)$existing['revision'] !== $expected) {
                // Missing, foreign and deleted IDs deliberately have the same response.
                throw new GenesisPhysisException(409, 'PHYSIS_CONFLICT');
            }
            $row = ['id' => $id, 'revision' => $expected + 1, 'sequence' => ++$cursor, 'updated_at' => $now,
                'deleted_at' => $operation === 'delete' ? $now : null,
                'envelope_json' => $operation === 'delete' ? null : genesisPhysisEncode(genesisPhysisEnvelope($change['envelope'], (int)$state['key_version']))];
            $db->prepare('INSERT INTO physis_records(owner_id,id,revision,sequence,updated_at,deleted_at,envelope_json)
                VALUES(:owner,:id,:revision,:sequence,:updated_at,:deleted_at,:envelope_json)
                ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,sequence=excluded.sequence,
                updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,envelope_json=excluded.envelope_json')->execute(['owner' => $owner] + $row);
            // A mutation acknowledgement contains no ciphertext. The client already
            // retains the exact encrypted request until this acknowledgement arrives;
            // keeping full autosave snapshots in 90-day receipts would amplify storage.
            $acknowledgement = genesisPhysisRecordForClient($row);
            unset($acknowledgement['envelope']);
            $results[] = $acknowledgement;
        }
        $db->prepare('UPDATE physis_owners SET current_cursor=:cursor WHERE owner_id=:owner')->execute(['cursor' => $cursor, 'owner' => $owner]);
        return ['records' => $results, 'cursor' => $cursor];
    });
}

function genesisPhysisRotate(string $owner, array $body): array
{
    genesisPhysisKeys($body, ['requestId', 'expectedRevision', 'expectedCursor', 'vault', 'records']);
    $expected = genesisPhysisInteger($body['expectedRevision'], 1); $expectedCursor = genesisPhysisInteger($body['expectedCursor']);
    if (!is_array($body['records']) || !array_is_list($body['records']) || count($body['records']) > GENESIS_PHYSIS_MAX_RECORDS) {
        throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
    }
    return genesisPhysisMutation($owner, 'rotate', $body, static function (PDO $db, array $state) use ($owner, $body, $expected, $expectedCursor): array {
        if ((int)$state['vault_revision'] !== $expected || (int)$state['current_cursor'] !== $expectedCursor) throw new GenesisPhysisException(409, 'PHYSIS_CONFLICT');
        $keyVersion = (int)$state['key_version'] + 1;
        $vault = genesisPhysisValidateVault($body['vault'], $keyVersion);
        $query = $db->prepare('SELECT id,revision FROM physis_records WHERE owner_id=:owner AND deleted_at IS NULL');
        $query->execute(['owner' => $owner]); $live = $query->fetchAll(PDO::FETCH_KEY_PAIR);
        if (count($live) !== count($body['records'])) throw new GenesisPhysisException(409, 'PHYSIS_CONFLICT');
        $cursor = $expectedCursor; $now = genesisNow();
        foreach ($body['records'] as $record) {
            if (!is_array($record)) throw new GenesisPhysisException(400, 'PHYSIS_INVALID_REQUEST');
            genesisPhysisKeys($record, ['id', 'expectedRevision', 'envelope']);
            $id = genesisPhysisId($record['id']); $revision = genesisPhysisInteger($record['expectedRevision'], 1);
            if (!isset($live[$id]) || (int)$live[$id] !== $revision) throw new GenesisPhysisException(409, 'PHYSIS_CONFLICT');
            unset($live[$id]);
            $envelope = genesisPhysisEnvelope($record['envelope'], $keyVersion);
            $db->prepare('UPDATE physis_records SET revision=:revision,sequence=:sequence,updated_at=:now,envelope_json=:envelope WHERE owner_id=:owner AND id=:id')
                ->execute(['revision' => $revision + 1, 'sequence' => ++$cursor, 'now' => $now, 'envelope' => genesisPhysisEncode($envelope), 'owner' => $owner, 'id' => $id]);
        }
        // Advance even for an empty vault, making the rotation visible to all clients.
        $cursor++;
        $db->prepare('UPDATE physis_owners SET vault_json=:vault,vault_revision=:revision,key_version=:key,current_cursor=:cursor WHERE owner_id=:owner')
            ->execute(['vault' => genesisPhysisEncode($vault), 'revision' => $expected + 1, 'key' => $keyVersion, 'cursor' => $cursor, 'owner' => $owner]);
        return ['revision' => $expected + 1, 'cursor' => $cursor, 'keyVersion' => $keyVersion];
    });
}
