<?php
declare(strict_types=1);

function genesisYandexConfigured(): bool
{
    $config = genesisConfig();
    if ((bool)($config['google_only'] ?? false)) return false;
    return trim((string)($config['yandex_client_id'] ?? '')) !== ''
        && trim((string)($config['yandex_client_secret'] ?? '')) !== '';
}

function genesisYandexRedirectUri(): string
{
    return rtrim((string)genesisConfig()['app_url'], '/') . '/api/auth/yandex/callback';
}

function genesisYandexAuthUrl(string $state, string $challenge, bool $calendar = false): string
{
    if (!genesisYandexConfigured()) {
        throw new RuntimeException('Yandex sign-in is not configured.');
    }
    return 'https://oauth.yandex.ru/authorize?' . http_build_query([
        'response_type' => 'code',
        'client_id' => (string)genesisConfig()['yandex_client_id'],
        'redirect_uri' => genesisYandexRedirectUri(),
        'scope' => 'login:info login:email login:avatar' . ($calendar ? ' calendar:all' : ''),
        'state' => $state,
        'code_challenge' => $challenge,
        'code_challenge_method' => 'S256',
    ], '', '&', PHP_QUERY_RFC3986);
}

/** @return array<string, mixed> */
function genesisYandexJsonRequest(string $url, ?array $form = null, ?string $accessToken = null): array
{
    $handle = curl_init($url);
    if ($handle === false) {
        throw new RuntimeException('Yandex request could not be initialized.');
    }
    $headers = ['Accept: application/json'];
    if ($accessToken !== null) {
        $headers[] = 'Authorization: OAuth ' . $accessToken;
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($form !== null) {
        curl_setopt($handle, CURLOPT_POST, true);
        curl_setopt($handle, CURLOPT_POSTFIELDS, http_build_query($form, '', '&', PHP_QUERY_RFC3986));
    }
    try {
        $body = curl_exec($handle);
        $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    } finally {
        curl_close($handle);
    }
    if (!is_string($body) || $status !== 200 || strlen($body) > 65536) {
        throw new RuntimeException('Yandex authorization is temporarily unavailable.');
    }
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Yandex returned an invalid response.');
    }
    return $decoded;
}

/** @return array<string, mixed> */
function genesisExchangeYandexCode(string $code, string $verifier): array
{
    if (!genesisYandexConfigured() || $code === '' || $verifier === '') {
        throw new RuntimeException('Yandex sign-in request is invalid.');
    }
    return genesisYandexJsonRequest('https://oauth.yandex.ru/token', [
        'grant_type' => 'authorization_code',
        'code' => $code,
        'client_id' => (string)genesisConfig()['yandex_client_id'],
        'client_secret' => (string)genesisConfig()['yandex_client_secret'],
        'code_verifier' => $verifier,
    ]);
}

/** @return array<string, mixed> */
function genesisRefreshYandexToken(string $refreshToken): array
{
    if (!genesisYandexConfigured() || $refreshToken === '') {
        throw new RuntimeException('Yandex calendar authorization is unavailable.');
    }
    return genesisYandexJsonRequest('https://oauth.yandex.ru/token', [
        'grant_type' => 'refresh_token',
        'refresh_token' => $refreshToken,
        'client_id' => (string)genesisConfig()['yandex_client_id'],
        'client_secret' => (string)genesisConfig()['yandex_client_secret'],
    ]);
}

/** @return array{id: string, email: string, name: string, picture: ?string} */
function genesisYandexUserInfo(string $accessToken): array
{
    if ($accessToken === '') {
        throw new RuntimeException('Yandex access token is missing.');
    }
    $profile = genesisYandexJsonRequest('https://login.yandex.ru/info?format=json', null, $accessToken);
    $id = trim((string)($profile['id'] ?? ''));
    $email = mb_strtolower(trim((string)($profile['default_email'] ?? '')));
    $clientId = trim((string)($profile['client_id'] ?? ''));
    if ($id === '' || strlen($id) > 128 || !genesisIsValidEmail($email)
        || !hash_equals((string)genesisConfig()['yandex_client_id'], $clientId)) {
        throw new RuntimeException('Yandex did not confirm this account.');
    }
    $name = trim((string)($profile['real_name'] ?? $profile['display_name'] ?? $profile['login'] ?? $email));
    $avatar = isset($profile['default_avatar_id']) && is_string($profile['default_avatar_id'])
        ? 'https://avatars.yandex.net/get-yapic/' . rawurlencode($profile['default_avatar_id']) . '/islands-200'
        : null;
    return ['id' => $id, 'email' => $email, 'name' => $name, 'picture' => $avatar];
}
