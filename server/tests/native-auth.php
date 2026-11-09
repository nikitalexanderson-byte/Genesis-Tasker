<?php
declare(strict_types=1);

// Standalone: no bootstrap, configuration, sessions on disk, network, or database.
require dirname(__DIR__) . '/src/native-auth.php';

function nativeExpect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function nativeReject(callable $operation, string $name, int $expectedStatus = 401): void
{
    try {
        $operation();
    } catch (GenesisNativeAuthException $error) {
        nativeExpect($error->status === $expectedStatus, $name . ': wrong error status');
        echo 'PASS ' . $name . PHP_EOL;
        return;
    }
    throw new RuntimeException($name . ': unexpectedly accepted');
}

function nativeBase64(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function nativeToken(array $claims, OpenSSLAsymmetricKey $key, array $header = ['alg' => 'RS256', 'kid' => 'test-key', 'typ' => 'JWT']): string
{
    $input = nativeBase64(json_encode($header, JSON_THROW_ON_ERROR)) . '.' . nativeBase64(json_encode($claims, JSON_THROW_ON_ERROR));
    if (!openssl_sign($input, $signature, $key, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Synthetic RSA signing failed');
    }
    return $input . '.' . nativeBase64($signature);
}

$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
nativeExpect($key !== false, 'OpenSSL RSA support is required');
$details = openssl_pkey_get_details($key);
nativeExpect(is_array($details), 'Synthetic public key unavailable');
$certificates = static fn(): array => ['test-key' => $details['key']];
$now = 1_800_000_000;
$audience = 'fixture-server.apps.googleusercontent.com';
$session = [];
$nonce = genesisNativeChallenge($session, $now);
nativeExpect(strlen($nonce) === 43, 'Nonce must encode 256 random bits');
$challenge = genesisNativeConsumeChallenge($session, $now);
$claims = [
    'iss' => 'https://accounts.google.com', 'aud' => $audience,
    'sub' => '123456789012345678901', 'email' => 'fixture@example.invalid',
    'email_verified' => true, 'nonce' => $nonce, 'iat' => $now, 'exp' => $now + 3600,
];
$verify = static fn(array $value): array => genesisVerifyNativeGoogleToken(nativeToken($value, $key), $audience, $challenge, $now, $certificates);
$profile = $verify($claims);
nativeExpect($profile['sub'] === $claims['sub'] && $profile['email'] === $claims['email'], 'Verified identity must preserve the existing Google sub');
nativeExpect(!isset($profile['nonce']) && !isset($profile['aud']), 'Only identity fields are exposed to account binding');
echo "PASS valid RSA signature and verified identity\n";

foreach ([
    'wrong issuer' => ['iss' => 'https://attacker.example'],
    'wrong audience' => ['aud' => 'attacker.apps.googleusercontent.com'],
    'array audience rejected' => ['aud' => [$audience, 'attacker']],
    'expired token' => ['exp' => $now],
    'string expiry rejected' => ['exp' => (string)($now + 3600)],
    'missing issued time' => ['iat' => null],
    'future issued token' => ['iat' => $now + 61],
    'token predates challenge' => ['iat' => $now - 61],
    'future nbf' => ['nbf' => $now + 1],
    'wrong nonce' => ['nonce' => 'different-nonce'],
    'missing nonce' => ['nonce' => null],
    'unverified email' => ['email_verified' => false],
    'string verified email rejected' => ['email_verified' => 'true'],
    'missing sub' => ['sub' => ''],
    'invalid email' => ['email' => 'not-an-address'],
    'invalid authorized party' => ['azp' => 'https://attacker.example'],
] as $name => $override) {
    nativeReject(static fn() => $verify(array_replace($claims, $override)), $name);
}
nativeExpect($verify(array_replace($claims, ['iss' => 'accounts.google.com']))['sub'] === $claims['sub'], 'Legacy Google issuer is valid');
echo "PASS second official Google issuer\n";
nativeReject(static fn() => genesisNativeConsumeChallenge($session, $now), 'challenge replay');

$expiredSession = [];
genesisNativeChallenge($expiredSession, $now - 300);
nativeReject(static fn() => genesisNativeConsumeChallenge($expiredSession, $now), 'challenge expiry');
$futureSession = [];
genesisNativeChallenge($futureSession, $now + 1);
nativeReject(static fn() => genesisNativeConsumeChallenge($futureSession, $now), 'future challenge');
$rateSession = [];
for ($i = 0; $i < 8; $i++) {
    genesisNativeChallenge($rateSession, $now);
}
nativeReject(static fn() => genesisNativeChallenge($rateSession, $now), 'session rate limit', 429);
nativeExpect(strlen(genesisNativeChallenge($rateSession, $now + 61)) === 43, 'Rate window must recover');
echo "PASS rate-limit window recovery\n";

$otherKey = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
nativeExpect($otherKey !== false, 'Second synthetic RSA key unavailable');
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $otherKey), $audience, $challenge, $now, $certificates), 'forged signature');
foreach ([
    'algorithm confusion' => ['alg' => 'HS256', 'kid' => 'test-key'],
    'none algorithm' => ['alg' => 'none', 'kid' => 'test-key'],
    'untrusted key URL' => ['alg' => 'RS256', 'kid' => 'test-key', 'jku' => 'https://attacker.example/keys'],
    'unknown key id' => ['alg' => 'RS256', 'kid' => 'unknown'],
    'unsupported critical header' => ['alg' => 'RS256', 'kid' => 'test-key', 'crit' => ['unknown']],
] as $name => $header) {
    nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $key, $header), $audience, $challenge, $now, $certificates), $name);
}
nativeReject(static fn() => genesisVerifyNativeGoogleToken(str_repeat('a', 16385), $audience, $challenge, $now, $certificates), 'oversized token');
nativeReject(static fn() => genesisVerifyNativeGoogleToken('not.a.jwt', $audience, $challenge, $now, $certificates), 'malformed token');

// A well-formed changed payload must not be accepted with the original valid signature.
$signedParts = explode('.', nativeToken($claims, $key));
$signedParts[1] = nativeBase64(json_encode(array_replace($claims, ['sub' => '999999999999999999999']), JSON_THROW_ON_ERROR));
nativeReject(static fn() => genesisVerifyNativeGoogleToken(implode('.', $signedParts), $audience, $challenge, $now, $certificates), 'payload tamper after signing');
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $key), '', $challenge, $now, $certificates), 'empty configured audience');
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $key), $audience, $challenge, $now, static fn(): array => []), 'missing trusted certificate');
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $key), $audience, $challenge, $now, static fn(): array => ['test-key' => 'invalid-public-key']), 'malformed trusted key');

$weakKey = openssl_pkey_new(['private_key_bits' => 1024, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
nativeExpect($weakKey !== false, 'Synthetic weak RSA key unavailable');
$weakDetails = openssl_pkey_get_details($weakKey);
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $weakKey), $audience, $challenge, $now, static fn(): array => ['test-key' => $weakDetails['key']]), 'weak RSA key rejected');
$ecKey = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
nativeExpect($ecKey !== false, 'Synthetic EC key unavailable');
$ecDetails = openssl_pkey_get_details($ecKey);
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $key), $audience, $challenge, $now, static fn(): array => ['test-key' => $ecDetails['key']]), 'non-RSA trusted key rejected');

// The nonce is scoped to one session; requesting a new challenge invalidates the old one.
$separateSession = [];
genesisNativeChallenge($separateSession, $now);
$separateChallenge = genesisNativeConsumeChallenge($separateSession, $now);
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken($claims, $key), $audience, $separateChallenge, $now, $certificates), 'nonce from another session rejected');
$replacedSession = [];
$oldNonce = genesisNativeChallenge($replacedSession, $now);
$newNonce = genesisNativeChallenge($replacedSession, $now);
nativeExpect($oldNonce !== $newNonce, 'Fresh challenges must differ');
$replacedChallenge = genesisNativeConsumeChallenge($replacedSession, $now);
nativeReject(static fn() => genesisVerifyNativeGoogleToken(nativeToken(array_replace($claims, ['nonce' => $oldNonce]), $key), $audience, $replacedChallenge, $now, $certificates), 'replaced challenge rejected');
nativeExpect(genesisVerifyNativeGoogleToken(nativeToken(array_replace($claims, ['nonce' => $newNonce]), $key), $audience, $replacedChallenge, $now, $certificates)['sub'] === $claims['sub'], 'Newest challenge must be accepted');
echo "PASS latest challenge accepted\n";

// Fresh cached public certificates are reused without touching the network.
$cachedSession = ['native_google_certs' => ['expiresAt' => $now + 60, 'keys' => ['test-key' => $details['key']]]];
nativeExpect(genesisNativeGoogleCertificates($cachedSession, $now) === ['test-key' => $details['key']], 'Fresh cert cache must be reused');
echo "PASS public certificate cache hit without network\n";

// A failed attempt consumes its challenge before any cryptographic check, just as the route does.
$failedSession = [];
genesisNativeChallenge($failedSession, $now);
$failedChallenge = genesisNativeConsumeChallenge($failedSession, $now);
nativeReject(static fn() => genesisVerifyNativeGoogleToken('not.a.jwt', $audience, $failedChallenge, $now, $certificates), 'failed attempt');
nativeReject(static fn() => genesisNativeConsumeChallenge($failedSession, $now), 'failed attempt cannot replay');

// Keep browser flow and CSRF gates explicit. This does not replace end-to-end HTTP/session tests.
$api = file_get_contents(dirname(__DIR__) . '/public/api/index.php');
foreach (['auth/google/native/challenge', 'auth/google/native', 'auth/google/native/services/config', 'auth/google/native/services'] as $route) {
    $escaped = preg_quote($route, '/');
    nativeExpect((bool)preg_match('/\$path === \'' . $escaped . '\'\) \{\s*genesisRequireCsrf\(\);/', $api), $route . ' must call existing CSRF middleware first');
}
nativeExpect(str_contains($api, '$path === \'auth/google/start\'') && str_contains($api, '$path === \'auth/google/callback\''), 'Browser routes must remain present');
nativeExpect(str_contains($api, 'genesisExchangeNativeGoogleCode($code)')
    && str_contains($api, 'genesisPersistPrimaryGoogleAuthorization($userId, $profile, $tokens)'),
    'Native service grants must be exchanged and bound by the backend');
echo "PASS native CSRF gates and browser routes retained (source guard)\n";
echo "Native auth standalone tests passed; HTTP login/device tests are separate.\n";
