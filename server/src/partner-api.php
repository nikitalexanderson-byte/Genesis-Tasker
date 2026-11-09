<?php
declare(strict_types=1);
require_once __DIR__ . '/partners.php';

function genesisPartnerRoute(string $method, array $segments): never
{
    header('Cache-Control: no-store');
    $path = implode('/', $segments);
    if ($path === 'partners/invitation') {
        if ($method === 'GET') {
            $enabled = genesisPartnersEnabled();
            $policy = $enabled ? genesisPartnerPolicy(genesisDb()) : null;
            $invite = $enabled ? genesisPartnerInvite(genesisDb(), genesisPartnerInviteHash($_COOKIE['genesis_referral'] ?? null)) : null;
            genesisJson(['enabled' => $enabled && $policy !== null, 'invitationDays' => $policy ? (int)$policy['invitation_days'] : null,
                'invitation' => $invite ? ['label' => $invite['label'], 'expiresAt' => $invite['expires_at']] : null]);
        }
        if ($method === 'POST') {
            genesisPartnersRequireEnabled(); genesisRequireCsrf();
            genesisConsumeApiBudget('ip:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 'partner-invitations', 60, 65536, (int)($_SERVER['CONTENT_LENGTH'] ?? 0));
            $input = genesisReadJson();
            if (array_diff(array_keys($input), ['code']) || !is_string($input['code'] ?? null)) throw new InvalidArgumentException('PARTNER_CODE_INVALID');
            $result = genesisPartnerCapture(genesisDb(), $input['code'], is_string($_COOKIE['genesis_referral'] ?? null) ? $_COOKIE['genesis_referral'] : null);
            genesisPartnerSetInviteCookie($result['token'], $result['expiresAt']);
            genesisJson(['invitation' => ['label' => $result['label'], 'expiresAt' => $result['expiresAt']], 'preserved' => $result['preserved']]);
        }
        genesisJson(['error' => 'METHOD_NOT_ALLOWED'], 405);
    }
    $userId = genesisRequireUserId(); genesisPartnersRequireEnabled();
    if ($method === 'GET' && $path === 'partners/me') genesisJson(genesisPartnerDashboard($userId, $_GET));
    if (($segments[0] ?? '') !== 'admin' || ($segments[1] ?? '') !== 'partners') genesisJson(['error' => 'NOT_FOUND'], 404);
    genesisPartnerOwner($userId);
    if ($method === 'GET') {
        if (count($segments) === 2) genesisJson(genesisPartnerAdminList($userId));
        if (count($segments) === 3) genesisJson(genesisPartnerDashboard($userId, $_GET, $segments[2]));
    }
    if ($method !== 'POST') genesisJson(['error' => 'METHOD_NOT_ALLOWED'], 405);
    genesisRequireCsrf();
    genesisConsumeApiBudget('user:' . $userId, 'partner-mutations', 120, 512 * 1024, (int)($_SERVER['CONTENT_LENGTH'] ?? 0));
    $input = genesisReadJson();
    if ($path === 'admin/partners/lookup') {
        if (array_diff(array_keys($input), ['email'])) throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
        genesisJson(['user' => genesisPartnerLookup($userId, $input['email'] ?? null)]);
    }
    if ($path === 'admin/partners/clients/lookup') {
        if (array_diff(array_keys($input), ['email'])) throw new InvalidArgumentException('PARTNER_INPUT_INVALID');
        genesisJson(['user' => genesisPartnerClientLookup($userId, $input['email'] ?? null)]);
    }
    if ($path === 'admin/partners/policy') genesisJson(genesisPartnerConfigure($userId, $input));
    if (count($segments) === 2) genesisJson(genesisPartnerAssign($userId, $input), 201);
    if (count($segments) === 4 && $segments[3] === 'availability') genesisJson(genesisPartnerUpdate($userId, $segments[2], $input));
    if (count($segments) === 4 && $segments[3] === 'clients') genesisJson(genesisPartnerManualBind($userId, $segments[2], $input), 201);
    if (count($segments) === 4 && $segments[3] === 'payouts') genesisJson(genesisPartnerRecordPayout($userId, $segments[2], $input), 201);
    if (count($segments) === 6 && $segments[3] === 'payments' && $segments[5] === 'calculation')
        genesisJson(genesisPartnerConfirmCalculation($userId, $segments[2], $segments[4], $input));
    if (count($segments) === 6 && $segments[3] === 'payouts' && $segments[5] === 'corrections')
        genesisJson(genesisPartnerCorrectPayout($userId, $segments[2], $segments[4], $input), 201);
    genesisJson(['error' => 'NOT_FOUND'], 404);
}
