<?php
declare(strict_types=1);

return [
    // Private owner-assigned program. Configure exact existing-account emails only after review.
    'partners' => ['enabled' => false, 'allowed_emails' => []],
    // Public MET terms v2026-11-05 acceptance: authorised operator, 2026-11-07.
    // Defaults come from resources/weather-provider-policy.json; see docs/PROJECT_OVERVIEW.md.
    // No public Open-Meteo free endpoint is used.
    'weather' => [
        'enabled' => true,
        'provider' => 'met-norway', // Or open-meteo with a commercial customer key.
        // 'met_terms_accepted' => false, // Optional explicit opt-out; always overrides public acceptance.
        'open_meteo_commercial_api_key' => '', // Private config/env only.
    ],
    // 3.2.4 preparation only. Reconcile historical donations before activation.
    'account_retention' => ['enabled' => false],
    'cloudtips' => [
        'layout_id' => '4d58d20a',
        'webhook_secret' => '', // Issued by CloudTips; private config.php only.
        'history_reconciled' => false,
    ],
    // 3.2.2 preparation. Activate only after acceptance, legal review and an approved release.
    'backup_v1_enabled' => false,
    'google_identity_management_enabled' => false,
    'account_recovery_enabled' => false,
    'account_recovery_reviewers' => [], // Internal admin user IDs with the separate recovery permission.
    'backup_signing_active_kid' => '',
    'backup_signing_secret_keys' => [], // Base64 Ed25519 secret keys. Never commit actual keys.
    'backup_signing_public_keys' => [], // Trusted active/retired verification registry; never supplied by a file.
    // Configure a separate provider sandbox in private config.php before integration tests.
    // billing.yookassa_live is disabled until the instance operator explicitly enables it.
    // NPD (self-employed) receipts are issued manually in My Tax, not through 54-FZ receipt fields.
    'app_url' => 'https://genesis-test.example.invalid',
    'google_only' => true,
    // Browser pilot only: current native Google sessions remain excluded.
    // Set false to disable without deleting data. Exact tester allowlist: src/physis.php.
    'physis_enabled' => true,
    'google_client_id' => '',
    'google_client_secret' => '',
    // Yandex ID sign-in remains unavailable until both values are configured.
    // Keep the secret only in the private server/config.php file.
    'yandex_client_id' => '',
    'yandex_client_secret' => '',
    // Recommended neural provider for Russian hosting. Create one GigaChat API
    // project, paste its Authorization Key here once, and token renewal will be
    // handled automatically by GENESIS.
    'gigachat_enabled' => false,
    'gigachat_authorization_key' => '',
    'gigachat_scope' => 'GIGACHAT_API_PERS',
    'gigachat_model' => 'GigaChat',
    'gigachat_auth_endpoint' => 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    'gigachat_api_endpoint' => 'https://api.giga.chat/v1',
    // Optional absolute path to a CA bundle containing the Russian Ministry of
    // Digital Development root certificates when the host does not trust them.
    'gigachat_ca_path' => '',
    // Keep the assistant disabled unless the server can reach Gemini from a
    // supported region (or through an explicitly configured relay).
    'gemini_enabled' => false,
    'gemini_api_key' => '',
    'gemini_model' => 'gemini-3.8-flash',
    // Optional HTTPS relay with the same request/response contract. Useful when
    // the hosting region is not supported by the Gemini Developer API.
    'gemini_api_endpoint' => 'https://generativelanguage.googleapis.com/v1beta/interactions',
    'crypto_key' => 'REPLACE_WITH_RANDOM_KEY',
    'db_path' => __DIR__ . '/var/genesis.sqlite',
    'session_path' => __DIR__ . '/var/sessions',
    'cookie_secure' => true,
    'timezone' => 'Europe/Moscow',
    // Optional external channels. Keep disabled until genuine server transport
    // is configured. Neither configuration nor task watching subscribes users.
    'notifications' => [
        'web_push' => [
            // Stable P-256 (prime256v1) VAPID private key, PEM format.
            // Keep only in private server/config.php; never commit the key.
            'private_key' => '',
            'subject' => 'https://genesis-test.example.invalid',
        ],
        'email' => [
            // Keep credentials only in the private server/config.php.
            // Hostinger: smtp.hostinger.com:465 (ssl), or 587 (starttls).
            'transport' => '',
            'from' => 'noreply@example.invalid',
            'from_name' => 'GENESIS',
            'host' => 'smtp.hostinger.com',
            'port' => 465,
            'encryption' => 'ssl',
            'username' => 'noreply@example.invalid',
            'password' => '',
        ],
    ],
    'admin_email' => 'admin@example.invalid',
];
