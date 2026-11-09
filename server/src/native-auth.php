<?php
declare(strict_types=1);

/** Native login only. No database/configuration is loaded by this independently testable file. */
final class GenesisNativeAuthException extends RuntimeException
{
    public function __construct(public readonly int $status = 401, string $code = 'NATIVE_AUTH_INVALID')
    {
        parent::__construct($code);
    }
}

function genesisNativeChallenge(array &$session, int $now): string
{
    $times = array_values(array_filter(
        is_array($session['native_auth_attempts'] ?? null) ? $session['native_auth_attempts'] : [],
        static fn($value): bool => is_int($value) && $value > $now - 60,
    ));
    if (count($times) >= 8) {
        throw new GenesisNativeAuthException(429, 'NATIVE_AUTH_RATE_LIMIT');
    }
    $times[] = $now;
    $session['native_auth_attempts'] = $times;
    $nonce = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $session['native_auth_challenge'] = ['hash' => hash('sha256', $nonce), 'issuedAt' => $now];
    return $nonce;
}

/** Consume before parsing the token or doing network IO: failed attempts cannot reuse a nonce. */
function genesisNativeConsumeChallenge(array &$session, int $now): array
{
    $challenge = $session['native_auth_challenge'] ?? null;
    unset($session['native_auth_challenge']);
    if (!is_array($challenge) || !is_string($challenge['hash'] ?? null)
        || !is_int($challenge['issuedAt'] ?? null) || $challenge['issuedAt'] > $now
        || $challenge['issuedAt'] <= $now - 300) {
        throw new GenesisNativeAuthException();
    }
    return $challenge;
}

function genesisNativeDecodeSegment(string $segment): string
{
    if ($segment === '' || !preg_match('/^[A-Za-z0-9_-]+$/D', $segment)) {
        throw new GenesisNativeAuthException();
    }
    $decoded = base64_decode(strtr($segment, '-_', '+/'), true);
    if (!is_string($decoded) || rtrim(strtr(base64_encode($decoded), '+/', '-_'), '=') !== $segment) {
        throw new GenesisNativeAuthException();
    }
    return $decoded;
}

/**
 * Narrow RS256 verifier: only trusted Google PEM keys, never token-supplied jku/x5u keys.
 * Google documents both PEM and JWKS formats. OpenSSL performs signature verification.
 * $certificates is injectable solely to test synthetic signed tokens without network or secrets.
 */
function genesisVerifyNativeGoogleToken(
    string $token,
    string $audience,
    array $challenge,
    int $now,
    callable $certificates,
): array {
    if ($audience === '' || strlen($token) > 16384) {
        throw new GenesisNativeAuthException();
    }
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        throw new GenesisNativeAuthException();
    }
    try {
        $header = json_decode(genesisNativeDecodeSegment($parts[0]), true, 8, JSON_THROW_ON_ERROR);
        $claims = json_decode(genesisNativeDecodeSegment($parts[1]), true, 16, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new GenesisNativeAuthException();
    }
    if (!is_array($header) || !is_array($claims) || ($header['alg'] ?? '') !== 'RS256'
        || isset($header['crit']) || isset($header['jku']) || isset($header['x5u'])
        || !is_string($header['kid'] ?? null) || !preg_match('/^[A-Za-z0-9_-]{1,128}$/D', $header['kid'])
        || (isset($header['typ']) && $header['typ'] !== 'JWT')) {
        throw new GenesisNativeAuthException();
    }
    if (!in_array($claims['iss'] ?? null, ['accounts.google.com', 'https://accounts.google.com'], true)
        || !is_string($claims['aud'] ?? null) || !hash_equals($audience, $claims['aud'])
        || !is_int($claims['exp'] ?? null) || $claims['exp'] <= $now
        || !is_int($claims['iat'] ?? null) || $claims['iat'] > $now + 60
        || $claims['iat'] < $challenge['issuedAt'] - 60 || $claims['exp'] <= $claims['iat']
        || (isset($claims['nbf']) && (!is_int($claims['nbf']) || $claims['nbf'] > $now))
        || !is_string($claims['nonce'] ?? null) || strlen($claims['nonce']) > 256
        || !hash_equals($challenge['hash'], hash('sha256', $claims['nonce']))
        || !is_string($claims['sub'] ?? null) || $claims['sub'] === '' || strlen($claims['sub']) > 255
        || ($claims['email_verified'] ?? null) !== true
        || !is_string($claims['email'] ?? null) || strlen($claims['email']) > 254
        || !filter_var($claims['email'], FILTER_VALIDATE_EMAIL)) {
        throw new GenesisNativeAuthException();
    }
    // aud must be the configured server Web client. azp may be an Android OAuth client;
    // it is not a device-attestation claim and is not used to select or merge accounts.
    if (isset($claims['azp']) && (!is_string($claims['azp']) || !preg_match('/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/D', $claims['azp']))) {
        throw new GenesisNativeAuthException();
    }
    $keys = $certificates();
    $pem = is_array($keys) ? ($keys[$header['kid']] ?? null) : null;
    if (!is_string($pem)) {
        throw new GenesisNativeAuthException();
    }
    $publicKey = @openssl_pkey_get_public($pem);
    $details = $publicKey === false ? false : openssl_pkey_get_details($publicKey);
    if (!is_array($details) || $details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 2048
        || openssl_verify($parts[0] . '.' . $parts[1], genesisNativeDecodeSegment($parts[2]), $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
        throw new GenesisNativeAuthException();
    }
    // Only identity fields consumed by the existing Google upsert helper are returned.
    return [
        'sub' => $claims['sub'], 'email' => $claims['email'], 'email_verified' => true,
        'name' => is_string($claims['name'] ?? null) ? $claims['name'] : $claims['email'],
        'picture' => is_string($claims['picture'] ?? null) ? $claims['picture'] : null,
    ];
}

/** Public Google certs cached to their HTTP freshness lifetime within the existing session. */
function genesisNativeGoogleCertificates(array &$session, int $now): array
{
    $cached = $session['native_google_certs'] ?? null;
    if (is_array($cached) && ($cached['expiresAt'] ?? 0) > $now && is_array($cached['keys'] ?? null)) {
        return $cached['keys'];
    }
    $body = '';
    $maxAge = 0;
    $age = 0;
    $handle = curl_init('https://www.googleapis.com/oauth2/v1/certs');
    curl_setopt_array($handle, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$maxAge, &$age): int {
            if (preg_match('/^Cache-Control:.*\bmax-age=(\d+)/i', $line, $match)) {
                $maxAge = min(86400, (int)$match[1]);
            }
            if (preg_match('/^Age:\s*(\d+)/i', $line, $match)) {
                $age = (int)$match[1];
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > 65536) {
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    $ok = curl_exec($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if ($ok === false || $status !== 200) {
        throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_TEMPORARILY_UNAVAILABLE');
    }
    try {
        $keys = json_decode($body, true, 4, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_TEMPORARILY_UNAVAILABLE');
    }
    if (!is_array($keys) || count($keys) < 1 || count($keys) > 10) {
        throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_TEMPORARILY_UNAVAILABLE');
    }
    foreach ($keys as $kid => $pem) {
        if (!is_string($kid) || !is_string($pem) || strlen($pem) > 8192 || !str_starts_with($pem, '-----BEGIN CERTIFICATE-----')) {
            throw new GenesisNativeAuthException(503, 'NATIVE_AUTH_TEMPORARILY_UNAVAILABLE');
        }
    }
    $session['native_google_certs'] = ['expiresAt' => $now + max(0, $maxAge - $age), 'keys' => $keys];
    return $keys;
}
