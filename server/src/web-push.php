<?php
declare(strict_types=1);

/** Web Push (RFC 8291 / 8292), without exposing task content to the push provider. */
function genesisPushBase64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function genesisPushDecode(string $value): string
{
    if (!preg_match('/\A[A-Za-z0-9_-]+\z/D', $value)) throw new InvalidArgumentException('INVALID_PUSH_SUBSCRIPTION');
    $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
    if ($decoded === false) throw new InvalidArgumentException('INVALID_PUSH_SUBSCRIPTION');
    return $decoded;
}

function genesisPushPublicPem(string $point): string
{
    if (strlen($point) !== 65 || $point[0] !== "\x04") throw new InvalidArgumentException('INVALID_PUSH_SUBSCRIPTION');
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $point;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function genesisPushEndpoint(string $endpoint): string
{
    $url = parse_url($endpoint); $host = strtolower((string)($url['host'] ?? ''));
    $allowed = in_array($host, ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'], true)
        || str_ends_with($host, '.push.apple.com') || str_ends_with($host, '.notify.windows.com') || str_ends_with($host, '.notify.live.net');
    if (!$allowed || strlen($endpoint) > 4096 || ($url['scheme'] ?? '') !== 'https' || ($url['port'] ?? 443) !== 443
        || isset($url['user']) || isset($url['pass']) || isset($url['fragment']) || !str_starts_with($url['path'] ?? '', '/')) {
        throw new InvalidArgumentException('INVALID_PUSH_SUBSCRIPTION');
    }
    return 'https://' . $host;
}

function genesisPushSubscription(array $input): array
{
    $endpoint = $input['endpoint'] ?? null; $key = $input['keys']['p256dh'] ?? null; $auth = $input['keys']['auth'] ?? null;
    if (!is_string($endpoint) || !is_string($key) || !is_string($auth)) throw new InvalidArgumentException('INVALID_PUSH_SUBSCRIPTION');
    genesisPushEndpoint($endpoint); $point = genesisPushDecode($key); $secret = genesisPushDecode($auth);
    if (strlen($secret) !== 16 || !openssl_pkey_get_public(genesisPushPublicPem($point))) throw new InvalidArgumentException('INVALID_PUSH_SUBSCRIPTION');
    return ['endpoint' => $endpoint, 'keys' => ['p256dh' => $key, 'auth' => $auth]];
}

/** The private key stays in server-only config. Public readiness contains no credentials. */
function genesisPushConfiguration(): array
{
    $config = genesisConfig()['notifications']['web_push'] ?? [];
    if (!is_array($config) || !is_string($config['private_key'] ?? null) || trim($config['private_key']) === '') return ['available' => false, 'blocker' => 'PUSH_KEYS_UNCONFIGURED'];
    if (!extension_loaded('openssl') || !extension_loaded('curl') || !function_exists('openssl_pkey_derive')) return ['available' => false, 'blocker' => 'PUSH_RUNTIME_UNAVAILABLE'];
    $private = openssl_pkey_get_private($config['private_key']);
    $details = $private ? openssl_pkey_get_details($private) : false;
    if (!$details || ($details['ec']['curve_name'] ?? '') !== 'prime256v1') return ['available' => false, 'blocker' => 'PUSH_KEYS_INVALID'];
    $subject = $config['subject'] ?? genesisConfig()['app_url'];
    if (!is_string($subject) || (!str_starts_with($subject, 'https://') && !(str_starts_with($subject, 'mailto:') && filter_var(substr($subject, 7), FILTER_VALIDATE_EMAIL)))) return ['available' => false, 'blocker' => 'PUSH_SUBJECT_INVALID'];
    return ['available' => true, 'publicKey' => genesisPushBase64("\x04" . $details['ec']['x'] . $details['ec']['y']), 'private' => $private, 'subject' => $subject];
}

function genesisPushExpand(string $prk, string $info, int $length): string { return substr(hash_hmac('sha256', $info . "\x01", $prk, true), 0, $length); }

function genesisPushEncrypt(array $subscription, string $payload, ?OpenSSLAsymmetricKey $ephemeral = null, ?string $salt = null): string
{
    if (strlen($payload) > 3072) throw new InvalidArgumentException('PUSH_PAYLOAD_TOO_LARGE');
    $client = genesisPushDecode($subscription['keys']['p256dh']); $auth = genesisPushDecode($subscription['keys']['auth']);
    $key = $ephemeral ?? openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
    $details = $key ? openssl_pkey_get_details($key) : false;
    if (!$details) throw new RuntimeException('PUSH_CRYPTO_FAILED');
    $server = "\x04" . $details['ec']['x'] . $details['ec']['y'];
    $peer = openssl_pkey_get_public(genesisPushPublicPem($client));
    $shared = $peer ? openssl_pkey_derive($peer, $key, 32) : false;
    if ($shared === false) throw new RuntimeException('PUSH_CRYPTO_FAILED');
    $ikm = genesisPushExpand(hash_hmac('sha256', $shared, $auth, true), "WebPush: info\x00" . $client . $server, 32);
    $salt ??= random_bytes(16); if (strlen($salt) !== 16) throw new InvalidArgumentException('PUSH_CRYPTO_FAILED'); $prk = hash_hmac('sha256', $ikm, $salt, true);
    $cek = genesisPushExpand($prk, "Content-Encoding: aes128gcm\x00", 16); $nonce = genesisPushExpand($prk, "Content-Encoding: nonce\x00", 12);
    $tag = ''; $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
    if ($cipher === false) throw new RuntimeException('PUSH_CRYPTO_FAILED');
    return $salt . pack('N', 4096) . chr(65) . $server . $cipher . $tag;
}

/** Convert OpenSSL's ECDSA ASN.1 signature to the JWT fixed-width R || S form. */
function genesisPushJwtSignature(string $signature): string
{
    $offset = 0;
    $byte = static function () use (&$offset, $signature): int { if ($offset >= strlen($signature)) throw new RuntimeException('PUSH_CRYPTO_FAILED'); return ord($signature[$offset++]); };
    $length = static function () use ($byte): int { $n = $byte(); if ($n < 128) return $n; if ($n !== 129) throw new RuntimeException('PUSH_CRYPTO_FAILED'); return $byte(); };
    if ($byte() !== 48) throw new RuntimeException('PUSH_CRYPTO_FAILED'); $sequenceLength = $length();
    if ($sequenceLength !== strlen($signature) - $offset) throw new RuntimeException('PUSH_CRYPTO_FAILED');
    $result = '';
    for ($i = 0; $i < 2; $i++) {
        if ($byte() !== 2) throw new RuntimeException('PUSH_CRYPTO_FAILED'); $size = $length();
        if ($size < 1 || $offset + $size > strlen($signature)) throw new RuntimeException('PUSH_CRYPTO_FAILED');
        $integer = ltrim(substr($signature, $offset, $size), "\x00"); $offset += $size;
        if (strlen($integer) > 32) throw new RuntimeException('PUSH_CRYPTO_FAILED'); $result .= str_pad($integer, 32, "\x00", STR_PAD_LEFT);
    }
    if ($offset !== strlen($signature)) throw new RuntimeException('PUSH_CRYPTO_FAILED'); return $result;
}

/** Return provider acceptance, permanent expiry, or a retry. Acceptance is not a device-delivery claim. */
function genesisPushSend(array $subscription, array $message): string
{
    $config = genesisPushConfiguration();
    if (!$config['available']) throw new RuntimeException($config['blocker']);
    $audience = genesisPushEndpoint($subscription['endpoint']);
    $header = genesisPushBase64('{"typ":"JWT","alg":"ES256"}');
    $claims = genesisPushBase64(json_encode(['aud' => $audience, 'exp' => time() + 43200, 'sub' => $config['subject']], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    $jwt = $header . '.' . $claims; $signature = '';
    if (!openssl_sign($jwt, $signature, $config['private'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('PUSH_CRYPTO_FAILED');
    $jwt .= '.' . genesisPushBase64(genesisPushJwtSignature($signature));
    $body = genesisPushEncrypt($subscription, json_encode($message, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    $handle = curl_init($subscription['endpoint']);
    if (!$handle) throw new RuntimeException('PUSH_RETRY');
    curl_setopt_array($handle, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Authorization: vapid t=' . $jwt . ', k=' . $config['publicKey'], 'TTL: 86400', 'Urgency: normal',
            'Content-Encoding: aes128gcm', 'Content-Type: application/octet-stream']]);
    try { curl_exec($handle); $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE); }
    finally { curl_close($handle); }
    if ($status >= 200 && $status < 300) return 'accepted';
    if (in_array($status, [404, 410], true)) return 'expired';
    if (in_array($status, [400, 401, 403, 413], true)) throw new RuntimeException('PUSH_REJECTED');
    throw new RuntimeException('PUSH_RETRY');
}
