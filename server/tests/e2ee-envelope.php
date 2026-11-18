<?php
declare(strict_types=1);

// Pure synthetic parser/OpenSSL contract test; no bootstrap, database or production config.
require dirname(__DIR__) . '/src/e2ee-envelope.php';
$fixture = json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/tests/fixtures/e2ee/v1.json'), true, 32, JSON_THROW_ON_ERROR);
$envelope = $fixture['envelope'];
$context = $envelope['context'];
$checks = 0;
function e2eeCheck(bool $value): void
{
    global $checks;
    if (!$value) throw new RuntimeException('Synthetic E2EE assertion failed.');
    ++$checks;
}
function e2eeReject(callable $operation, string $code): void
{
    try { $operation(); } catch (InvalidArgumentException | DomainException $error) {
        e2eeCheck($error->getMessage() === $code);
        return;
    }
    throw new RuntimeException('Invalid synthetic E2EE input was accepted.');
}
function e2eeEncode(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }

e2eeCheck(e2eeEncode(genesisE2eeAdditionalData($context)) === $fixture['aad']);
e2eeCheck(e2eeEncode(genesisE2eeAdditionalData(array_replace($context, ['revision' => 9007199254740991]))) === $fixture['maxIntegerAad']);
e2eeCheck(e2eeEncode(genesisE2eeSignatureData($envelope)) === $fixture['signatureData']);
e2eeCheck(genesisE2eeVerifyEnvelope($envelope, $context, $fixture['publicKeyPem']) === $envelope);
$jcaFixture = json_decode((string)file_get_contents(dirname(__DIR__, 2) . '/tests/fixtures/e2ee/v1-jca.json'), true, 32, JSON_THROW_ON_ERROR);
e2eeCheck($jcaFixture['rootFixture'] === 'v1.json');
e2eeCheck(genesisE2eeVerifyEnvelope($jcaFixture['envelope'], $context, $fixture['publicKeyPem'])
    === genesisE2eeValidateEnvelope($jcaFixture['envelope']));
foreach (['7.0', '7e0'] as $spelling) {
    $source = str_replace('"revision":7', '"revision":' . $spelling, json_encode($envelope, JSON_THROW_ON_ERROR));
    $parsed = genesisE2eeValidateEnvelope(json_decode($source, true, 32, JSON_THROW_ON_ERROR));
    e2eeCheck(genesisE2eeAdditionalData($parsed['context']) === genesisE2eeAdditionalData($context));
    e2eeCheck(genesisE2eeVerifyEnvelope($parsed, $context, $fixture['publicKeyPem']) === $envelope);
}

foreach (['ownerId', 'scopeId', 'domain', 'objectId', 'schemaVersion', 'dataGeneration', 'cryptoEpoch',
    'securityEpoch', 'revision', 'keyId', 'deviceId', 'operationId'] as $name) {
    $changed = $context;
    $changed[$name] = is_int($changed[$name]) ? $changed[$name] + 1 : ($name === 'domain' ? 'diary' : 'changed-id');
    e2eeReject(fn() => genesisE2eeVerifyEnvelope($envelope, $changed, $fixture['publicKeyPem']), 'E2EE_CONTEXT_MISMATCH');
    $packet = array_replace($envelope, ['context' => $changed]);
    e2eeReject(fn() => genesisE2eeVerifyEnvelope($packet, $changed, $fixture['publicKeyPem']), 'E2EE_CORRUPT_ENVELOPE');
}
foreach (['wrappedKey', 'nonce', 'ciphertext', 'signature'] as $name) {
    $packet = $envelope;
    $data = genesisE2eeDecode($packet[$name], $name === 'wrappedKey' ? 40 : ($name === 'nonce' ? 12 : ($name === 'signature' ? 64 : 16)), GENESIS_E2EE_MAX_PLAINTEXT + 16);
    $data[0] = chr(ord($data[0]) ^ 1);
    $packet[$name] = e2eeEncode($data);
    e2eeReject(fn() => genesisE2eeVerifyEnvelope($packet, $context, $fixture['publicKeyPem']), 'E2EE_CORRUPT_ENVELOPE');
}
foreach (['suite' => 'unknown', 'cryptoProtocol' => 2, 'writerProtocol' => 10, 'domain' => 'billing',
    'revision' => '7', 'ownerId' => "bad\n", 'objectId' => 'Секретное название', 'keyId' => str_repeat('a', 129)] as $name => $value) {
    $packet = $envelope; $packet['context'][$name] = $value;
    e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
}
foreach ([0, -1, 1.5, 9007199254740992, null, true, INF, NAN] as $value) {
    $packet = $envelope; $packet['context']['revision'] = $value;
    e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
}
foreach (['wrappedKey', 'nonce', 'ciphertext', 'signature'] as $name) {
    foreach ([null, [], 123, '', '!', $envelope[$name] . '='] as $value) {
        $packet = $envelope; $packet[$name] = $value;
        e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
    }
    $packet = $envelope; unset($packet[$name]);
    e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
}
$packet = $envelope; $packet['context']['rawKey'] = 'not-allowed';
e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
$packet = $envelope; $packet['key'] = 'not-allowed';
e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
$packet = $envelope; $packet['ciphertext'] = str_repeat('A', (int)ceil((GENESIS_E2EE_MAX_PLAINTEXT + 17) * 4 / 3));
e2eeReject(fn() => genesisE2eeValidateEnvelope($packet), 'E2EE_INVALID_ENVELOPE');
e2eeReject(fn() => genesisE2eeDecode('AB', 1), 'E2EE_INVALID_ENVELOPE');
foreach (GENESIS_E2EE_DOMAINS as $domain) {
    e2eeCheck(genesisE2eeValidateContext(array_replace($context, ['domain' => $domain]))['domain'] === $domain);
}
$wrongSigner = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
$wrongPublic = openssl_pkey_get_details($wrongSigner)['key'];
e2eeReject(fn() => genesisE2eeVerifyEnvelope($envelope, $context, $wrongPublic), 'E2EE_CORRUPT_ENVELOPE');
$wrongCurve = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp384r1']);
e2eeReject(fn() => genesisE2eeVerifyEnvelope($envelope, $context, openssl_pkey_get_details($wrongCurve)['key']), 'E2EE_INVALID_ENVELOPE');
echo "PASS E2EE envelope: {$checks} synthetic assertions, no database/config access.\n";
