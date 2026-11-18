<?php
declare(strict_types=1);

/** Inactive 3.3.6 parser/signature contract. No key unwrap or production routing here. */
const GENESIS_E2EE_SUITE = 'A256KW-A256GCM-ES256';
const GENESIS_E2EE_MAX_PLAINTEXT = 4 * 1024 * 1024;
const GENESIS_E2EE_CONTEXT_FIELDS = [
    'cryptoProtocol', 'suite', 'ownerId', 'scopeId', 'domain', 'objectId', 'schemaVersion',
    'dataGeneration', 'writerProtocol', 'cryptoEpoch', 'securityEpoch', 'revision',
    'keyId', 'deviceId', 'operationId',
];
const GENESIS_E2EE_NUMBER_FIELDS = [
    'cryptoProtocol', 'schemaVersion', 'dataGeneration', 'writerProtocol', 'cryptoEpoch', 'securityEpoch', 'revision',
];
const GENESIS_E2EE_DOMAINS = [
    'workspace', 'diary', 'dream-journal', 'mindmap', 'physis', 'aurora', 'stoicheion',
    'shared-project', 'attachment', 'local-snapshot', 'outbox', 'draft', 'key-check',
];

function genesisE2eeInvalid(): never
{
    throw new InvalidArgumentException('E2EE_INVALID_ENVELOPE');
}

function genesisE2eeExactFields(mixed $value, array $fields): array
{
    if (!is_array($value) || count($value) !== count($fields)
        || array_diff(array_keys($value), $fields) !== []) genesisE2eeInvalid();
    return $value;
}

function genesisE2eeValidateContext(mixed $value): array
{
    $value = genesisE2eeExactFields($value, GENESIS_E2EE_CONTEXT_FIELDS);
    $context = [];
    foreach (GENESIS_E2EE_CONTEXT_FIELDS as $name) {
        $item = $value[$name];
        if (in_array($name, GENESIS_E2EE_NUMBER_FIELDS, true)) {
            // Match JSON/Web Crypto number semantics, including 7.0 / 7e0.
            if ((!is_int($item) && !is_float($item)) || !is_finite((float)$item)
                || $item < 1 || $item > 9007199254740991 || floor((float)$item) !== (float)$item) genesisE2eeInvalid();
            $item = (int)$item;
        } elseif (!is_string($item) || !preg_match('~^[A-Za-z0-9][A-Za-z0-9._:@/\-]{0,127}$~D', $item)) {
            genesisE2eeInvalid();
        }
        $context[$name] = $item;
    }
    if ($context['cryptoProtocol'] !== 1 || $context['suite'] !== GENESIS_E2EE_SUITE
        || $context['writerProtocol'] !== 9 || !in_array($context['domain'], GENESIS_E2EE_DOMAINS, true)) {
        genesisE2eeInvalid();
    }
    return $context;
}

function genesisE2eeDecode(mixed $value, int $minimum, ?int $maximum = null): string
{
    $maximum ??= $minimum;
    if (!is_string($value) || strlen($value) < intdiv($minimum * 4 + 2, 3)
        || strlen($value) > intdiv($maximum * 4 + 2, 3)
        || !preg_match('~^[A-Za-z0-9_\-]+$~D', $value)) genesisE2eeInvalid();
    $bytes = base64_decode(strtr($value, '-_', '+/'), true);
    if (!is_string($bytes) || strlen($bytes) < $minimum || strlen($bytes) > $maximum
        || rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=') !== $value) genesisE2eeInvalid();
    return $bytes;
}

function genesisE2eeValidateEnvelope(mixed $value): array
{
    $value = genesisE2eeExactFields($value, ['context', 'wrappedKey', 'nonce', 'ciphertext', 'signature']);
    $context = genesisE2eeValidateContext($value['context']);
    genesisE2eeDecode($value['wrappedKey'], 40);
    genesisE2eeDecode($value['nonce'], 12);
    genesisE2eeDecode($value['ciphertext'], 16, GENESIS_E2EE_MAX_PLAINTEXT + 16);
    genesisE2eeDecode($value['signature'], 64);
    return ['context' => $context, 'wrappedKey' => $value['wrappedKey'], 'nonce' => $value['nonce'],
        'ciphertext' => $value['ciphertext'], 'signature' => $value['signature']];
}

function genesisE2eeAdditionalData(array $source): string
{
    $context = genesisE2eeValidateContext($source);
    $bytes = "GENESIS-E2EE-AAD\0v1\0";
    foreach (GENESIS_E2EE_CONTEXT_FIELDS as $name) {
        $value = $context[$name];
        $bytes .= is_int($value) ? pack('N2', intdiv($value, 4294967296), $value % 4294967296)
            : pack('N', strlen($value)) . $value;
    }
    return $bytes;
}

function genesisE2eeSignatureData(array $envelope): string
{
    return "GENESIS-E2EE-SIGNATURE\0v1\0" . genesisE2eeAdditionalData($envelope['context'])
        . genesisE2eeDecode($envelope['wrappedKey'], 40) . genesisE2eeDecode($envelope['nonce'], 12)
        . hash('sha256', genesisE2eeDecode($envelope['ciphertext'], 16, GENESIS_E2EE_MAX_PLAINTEXT + 16), true);
}

/** P1363 -> minimal DER encoding only. OpenSSL performs all ECDSA arithmetic. */
function genesisE2eeSignatureDer(string $signature): string
{
    if (strlen($signature) !== 64) genesisE2eeInvalid();
    $integers = '';
    foreach ([substr($signature, 0, 32), substr($signature, 32, 32)] as $part) {
        $part = ltrim($part, "\0");
        if ($part === '') $part = "\0";
        if (ord($part[0]) >= 128) $part = "\0" . $part;
        $integers .= "\x02" . chr(strlen($part)) . $part;
    }
    return "\x30" . chr(strlen($integers)) . $integers;
}

/**
 * expectedContext and key MUST be loaded from trusted authorization/device state.
 * This check alone does not authorize enrollment, ACL, epochs, CAS or idempotency.
 */
function genesisE2eeVerifyEnvelope(mixed $source, array $expectedContext, string $trustedPublicKeyPem): array
{
    $envelope = genesisE2eeValidateEnvelope($source);
    if (!hash_equals(genesisE2eeAdditionalData($expectedContext), genesisE2eeAdditionalData($envelope['context']))) {
        throw new DomainException('E2EE_CONTEXT_MISMATCH');
    }
    if (strlen($trustedPublicKeyPem) > 1024) genesisE2eeInvalid();
    $key = openssl_pkey_get_public($trustedPublicKeyPem);
    $details = $key === false ? false : openssl_pkey_get_details($key);
    if (!is_array($details) || $details['type'] !== OPENSSL_KEYTYPE_EC
        || ($details['ec']['curve_oid'] ?? '') !== '1.2.840.10045.3.1.7') genesisE2eeInvalid();
    $valid = openssl_verify(genesisE2eeSignatureData($envelope),
        genesisE2eeSignatureDer(genesisE2eeDecode($envelope['signature'], 64)), $key, OPENSSL_ALGO_SHA256);
    if ($valid !== 1) throw new DomainException('E2EE_CORRUPT_ENVELOPE');
    return $envelope;
}
