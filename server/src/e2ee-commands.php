<?php
declare(strict_types=1);
require_once __DIR__ . '/e2ee-envelope.php';

/** Same bounded tagged encoding as JS/Kotlin; JSON itself is not signed. */
function genesisE2eeCanonical(mixed $value): string
{
    $size = 0;
    $encode = function(mixed $item, int $depth) use (&$encode, &$size): string {
        if ($depth > 16) throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
        if ($item === null) $part = "\0";
        elseif (is_bool($item)) $part = $item ? "\2" : "\1";
        elseif (is_int($item) || is_float($item)) {
            if (!is_finite((float)$item) || $item < 0 || $item > 9007199254740991 || floor((float)$item) !== (float)$item)
                throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
            $integer = (int)$item;
            $part = "\3" . pack('N2', intdiv($integer, 4294967296), $integer % 4294967296);
        } elseif (is_string($item)) {
            if (preg_match('~[^\x20-\x7e]~', $item)) throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
            $part = "\4" . pack('N', strlen($item)) . $item;
        } elseif (is_array($item) || $item instanceof stdClass) {
            $list = is_array($item) && array_is_list($item);
            $items = (array)$item;
            if (count($items) > ($list ? 10000 : 128)) throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
            if (!$list) {
                foreach (array_keys($items) as $key) if (!is_string($key) || !preg_match('~^[A-Za-z][A-Za-z0-9]{0,63}$~D', $key))
                    throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
                ksort($items, SORT_STRING);
            }
            $part = ($list ? "\5" : "\6") . pack('N', count($items));
            foreach ($items as $key => $entry) {
                if (!$list) $part .= $encode($key, $depth + 1);
                $part .= $encode($entry, $depth + 1);
            }
            // Children already contributed to the bound.
            $size += 5;
            if ($size > 6 * 1024 * 1024) throw new InvalidArgumentException('E2EE_COMMAND_TOO_LARGE');
            return $part;
        } else throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
        $size += strlen($part);
        if ($size > 6 * 1024 * 1024) throw new InvalidArgumentException('E2EE_COMMAND_TOO_LARGE');
        return $part;
    };
    return $encode($value, 0);
}
function genesisE2eeIdentifier(mixed $id): string
{
    if (!is_string($id) || !preg_match('~^[A-Za-z0-9][A-Za-z0-9._:@/\-]{0,127}$~D', $id))
        throw new InvalidArgumentException('E2EE_INVALID_IDENTIFIER');
    return $id;
}
function genesisE2eeInteger(mixed $number, int $minimum = 0): int
{
    if ((!is_int($number) && !is_float($number)) || !is_finite((float)$number) || $number < $minimum
        || $number > 9007199254740991 || floor((float)$number) !== (float)$number) throw new InvalidArgumentException('E2EE_INVALID_INTEGER');
    return (int)$number;
}
function genesisE2eeCommand(mixed $source): array
{
    $command = genesisE2eeExactFields($source, ['protocol','ownerId','scopeId','deviceId','action','expectedRevision','checkpointHash','securityEpoch','operationId','payload']);
    if ($command['protocol'] !== 1 || !is_array($command['payload'])) throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
    foreach (['ownerId','scopeId','deviceId','action','operationId'] as $field) genesisE2eeIdentifier($command[$field]);
    if ($command['checkpointHash'] !== 'genesis') genesisE2eeDecode($command['checkpointHash'], 32);
    $command['expectedRevision'] = genesisE2eeInteger($command['expectedRevision']);
    $command['securityEpoch'] = genesisE2eeInteger($command['securityEpoch'], 1);
    // Preserve empty object/list semantics at every boundary; payloads must have fields.
    if (array_is_list($command['payload'])) throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
    return $command;
}
function genesisE2eeCommandBytes(array $command): string
{
    return "GENESIS-E2EE-COMMAND\0v1\0" . genesisE2eeCanonical(genesisE2eeCommand($command));
}
/** Parameterless reads still carry an unambiguous, signed object payload.
 * Empty JSON objects cannot be confused with PHP's empty list representation. */
function genesisE2eeReadPayload(array $payload): void
{
    genesisE2eeExactFields($payload,['protocol']);
    if($payload['protocol']!==1)throw new InvalidArgumentException('E2EE_INVALID_COMMAND');
}
function genesisE2eePublicPem(mixed $source): string
{
    $bytes = genesisE2eeDecode($source, 91);
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($bytes), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $key = openssl_pkey_get_public($pem); $details = $key === false ? false : openssl_pkey_get_details($key);
    if (!is_array($details) || ($details['type'] ?? null) !== OPENSSL_KEYTYPE_EC
        || ($details['ec']['curve_oid'] ?? '') !== '1.2.840.10045.3.1.7') genesisE2eeInvalid();
    return $pem;
}
function genesisE2eeVerifyCommand(mixed $source, string $signingKey): array
{
    $packet = genesisE2eeExactFields($source, ['command','signature']);
    $command = genesisE2eeCommand($packet['command']);
    if (openssl_verify(genesisE2eeCommandBytes($command), genesisE2eeSignatureDer(genesisE2eeDecode($packet['signature'], 64)),
        genesisE2eePublicPem($signingKey), OPENSSL_ALGO_SHA256) !== 1) throw new DomainException('E2EE_UNTRUSTED_COMMAND');
    return $command;
}
function genesisE2eeCommandHash(array $command): string
{
    $withoutProofs = function(mixed $item) use (&$withoutProofs): mixed {
        if (!is_array($item)) return $item;
        if (array_is_list($item)) return array_map($withoutProofs, $item);
        $result = [];
        foreach ($item as $key => $value) if (!in_array($key, ['signature','selfProof'], true)) $result[$key] = $withoutProofs($value);
        return $result === [] ? new stdClass() : $result;
    };
    return rtrim(strtr(base64_encode(hash('sha256', genesisE2eeCanonical($withoutProofs($command)), true)), '+/', '-_'), '=');
}
