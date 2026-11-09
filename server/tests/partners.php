<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);
date_default_timezone_set('Europe/Moscow');

function genesisDb(): PDO { return $GLOBALS['partnerFixtureDb']; }
function genesisConfig(): array { return $GLOBALS['partnerFixtureConfig']; }
function genesisNow(): string { return gmdate('Y-m-d\TH:i:s\Z', $GLOBALS['partnerFixtureNow'] ?? time()); }
function genesisUuid(): string { return bin2hex(random_bytes(4)) . '-0000-4000-8000-' . bin2hex(random_bytes(6)); }
function genesisCurrentUserId(): ?string { return $GLOBALS['partnerFixtureSignedIn'] ?? null; }
function genesisFindUser(string $id): ?array { $q = genesisDb()->prepare('SELECT * FROM users WHERE id=?'); $q->execute([$id]); return $q->fetch() ?: null; }
function genesisFindUserByEmail(string $email): ?array { $q = genesisDb()->prepare('SELECT * FROM users WHERE email=?'); $q->execute([$email]); return $q->fetch() ?: null; }
function genesisUserProvider(array $user): string { return $user['auth_provider']; }
function genesisIsAdminUser(array $user): bool { return $user['email'] === 'owner@example.invalid'; }
function genesisSessionIsPrimaryGoogleUser(array $user): bool { return ($GLOBALS['partnerFixturePrimary'] ?? true) && $user['auth_provider'] === 'google'; }
function genesisIdentifierHash(string $namespace, string $value): string { return hash_hmac('sha256', $namespace . "\0" . $value, 'synthetic-partner-fixture'); }
function genesisSharedContentEncrypt(string $value): string { return 'fixture:' . base64_encode($value); }
function genesisSharedContentDecrypt(string $value): string { return (string)base64_decode(substr($value, 8), true); }
require_once dirname(__DIR__) . '/src/resource-limits.php';
require_once dirname(__DIR__) . '/src/feature-access.php';
require_once dirname(__DIR__) . '/src/billing.php';
require_once dirname(__DIR__) . '/src/billing-gateways.php';

$GLOBALS['partnerFixtureConfig'] = ['app_url' => 'https://example.invalid', 'cookie_secure' => false,
    'partners' => ['enabled' => true, 'allowed_emails' => ['dares@example.invalid', 'second@example.invalid']]];
$cases = 0;
function partnerCheck(bool $condition, string $message): void { $GLOBALS['cases']++; if (!$condition) throw new RuntimeException($message); }
function partnerReject(string $code, callable $call): void {
    try { $call(); } catch (GenesisResourceLimitException|DomainException|InvalidArgumentException $error) {
        partnerCheck($error->getMessage() === $code, 'Wrong rejection: ' . $error->getMessage() . ', expected ' . $code); return;
    }
    throw new RuntimeException('Expected rejection ' . $code);
}
function partnerRequest(array $input = []): array { return [...$input, 'requestId' => 'request_' . bin2hex(random_bytes(12))]; }

if (($argv[1] ?? '') === 'payout-race') {
    $GLOBALS['partnerFixtureDb'] = new PDO('sqlite:' . $argv[2], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    genesisDb()->exec('PRAGMA busy_timeout=15000');
    try {
        $result = genesisPartnerRecordPayout('owner', $argv[3], ['requestId' => $argv[5], 'expectedRevision' => (int)$argv[4],
            'amountMinor' => 1, 'paidOn' => gmdate('Y-m-d'), 'note' => 'Synthetic simultaneous tab', 'alreadyPaid' => true]);
        echo json_encode(['status' => 'ok', 'result' => $result], JSON_THROW_ON_ERROR);
    } catch (Throwable $error) { echo json_encode(['status' => $error->getMessage()], JSON_THROW_ON_ERROR); }
    exit;
}

$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$GLOBALS['partnerFixtureDb'] = $db;
$db->exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE,google_sub TEXT,auth_provider TEXT,display_name TEXT,subscription_plan TEXT,subscription_valid_until TEXT);
    INSERT INTO users VALUES('owner','owner@example.invalid','sub-owner','google','Owner','free',NULL),
    ('a','dares@example.invalid','sub-a','google','Dares','free',NULL),('b','second@example.invalid','sub-b','google','Second','free',NULL),
    ('client','private-client@example.invalid','sub-client','google','Private client','free',NULL),
    ('client-b','private-second@example.invalid','sub-client-b','google','Private second','free',NULL),
    ('ordinary','ordinary@example.invalid','sub-ordinary','google','Ordinary','free',NULL)");
foreach (['093_billing_infrastructure', '096_billing_upgrade_credit', '099_billing_refund_amount', '100_billing_settlement', '101_billing_pending_order_deletion_guard', '123_private_partners'] as $name)
    $db->exec((string)file_get_contents(dirname(__DIR__) . '/migrations/' . $name . '.sql'));
$now = time(); $GLOBALS['partnerFixtureNow'] = $now - 300;

partnerReject('FORBIDDEN', fn() => genesisPartnerAssign('ordinary', partnerRequest(['userId' => 'a', 'email' => 'dares@example.invalid', 'label' => 'Dares'])));
partnerReject('PARTNER_TARGET_NOT_APPROVED', fn() => genesisPartnerLookup('owner', 'ordinary@example.invalid'));
$GLOBALS['partnerFixturePrimary'] = false;
partnerReject('FORBIDDEN', fn() => genesisPartnerLookup('owner', 'dares@example.invalid'));
$GLOBALS['partnerFixturePrimary'] = true;
partnerCheck(genesisPartnerLookup('owner', 'dares@example.invalid')['id'] === 'a', 'Exact existing account lookup failed');
partnerReject('PARTNER_POLICY_CONFIRMATION_REQUIRED', fn() => genesisPartnerConfigure('owner', partnerRequest(['expectedRevision' => 0, 'invitationDays' => 30, 'retentionDays' => 365, 'confirmed' => false])));
$policyInput = partnerRequest(['expectedRevision' => 0, 'invitationDays' => 30, 'retentionDays' => null, 'confirmed' => true]);
$policy = genesisPartnerConfigure('owner', $policyInput);
partnerCheck(genesisPartnerPolicy($db)['retention_days'] === null, 'Indefinite financial retention was not preserved');
partnerReject('PARTNER_POLICY_CONFIRMATION_REQUIRED', fn() => genesisPartnerConfigure('owner', partnerRequest(['expectedRevision' => 1, 'invitationDays' => 30, 'retentionDays' => 365, 'confirmed' => true])));
partnerCheck(genesisPartnerConfigure('owner', $policyInput) === $policy && (int)$db->query('SELECT COUNT(*) FROM partner_policies')->fetchColumn() === 1, 'Policy replay duplicated history');
partnerReject('PARTNER_REQUEST_CONFLICT', fn() => genesisPartnerConfigure('owner', [...$policyInput, 'invitationDays' => 20]));
$a = genesisPartnerAssign('owner', partnerRequest(['userId' => 'a', 'email' => 'dares@example.invalid', 'label' => 'Dares']))['id'];
$b = genesisPartnerAssign('owner', partnerRequest(['userId' => 'b', 'email' => 'second@example.invalid', 'label' => 'Second']))['id'];
partnerReject('PARTNER_ALREADY_ASSIGNED', fn() => genesisPartnerAssign('owner', partnerRequest(['userId' => 'a', 'email' => 'dares@example.invalid', 'label' => 'Dares'])));
partnerReject('PARTNER_TARGET_CHANGED', fn() => genesisPartnerAssign('owner', partnerRequest(['userId' => 'b', 'email' => 'dares@example.invalid', 'label' => 'Wrong'])));
foreach ([$a, $b] as $id) genesisPartnerUpdate('owner', $id, partnerRequest(['expectedRevision' => 1, 'acceptsInvitations' => true, 'panelEnabled' => true, 'reason' => 'Synthetic owner approval']));
$codeA = genesisPartnerRow($db, $a)['code']; $codeB = genesisPartnerRow($db, $b)['code'];
partnerReject('PARTNER_CODE_INVALID', fn() => genesisPartnerCapture($db, 'not-a-code', null, $now - 250));
$invite = genesisPartnerCapture($db, $codeA, null, $now - 250);
$preserved = genesisPartnerCapture($db, $codeB, $invite['token'], $now - 245);
partnerCheck($preserved['token'] === $invite['token'] && $preserved['preserved'], 'A second partner overwrote the first invitation');
partnerCheck(genesisPartnerTotals($db, $a)['visits'] === 1 && genesisPartnerTotals($db, $b)['visits'] === 0, 'Repeated link inflated visits or attributed another partner');
partnerCheck(genesisPartnerInvite($db, genesisPartnerInviteHash($invite['token']), $now + 31 * 86400) === null, 'Invitation did not expire');
$db->beginTransaction(); genesisPartnerBindRegistration($db, 'client', genesisPartnerInviteHash($invite['token']), $now - 240); $db->commit();
partnerCheck(genesisPartnerTotals($db, $a)['registrations'] === 1, 'New registration was not attributed');
$db->beginTransaction(); genesisPartnerBindRegistration($db, 'client-b', genesisPartnerInviteHash($invite['token']), $now - 230); $db->commit();
partnerCheck(genesisPartnerTotals($db, $a)['registrations'] === 1, 'One invitation was reused for a different account');
$GLOBALS['partnerFixtureSignedIn'] = 'ordinary';
partnerReject('PARTNER_NEW_ACCOUNT_ONLY', fn() => genesisPartnerCapture($db, $codeA, null));
$GLOBALS['partnerFixtureSignedIn'] = null;
$self = genesisPartnerCapture($db, $codeA, null, $now - 230);
$db->beginTransaction(); genesisPartnerBindRegistration($db, 'a', genesisPartnerInviteHash($self['token']), $now - 225); $db->commit();
partnerCheck((int)$db->query("SELECT COUNT(*) FROM partner_clients WHERE user_id='a'")->fetchColumn() === 0, 'Self referral was accepted');
$crossDevice = genesisPartnerCapture($db, $codeB, null, $now - 220);
$db->beginTransaction(); genesisPartnerBindRegistration($db, 'client-b', genesisPartnerInviteHash($crossDevice['token']), $now - 215); $db->commit();
partnerCheck(genesisPartnerTotals($db, $b)['registrations'] === 1, 'Manual code on a separate browser could not register a new client');
partnerReject('PARTNER_ACCESS_DENIED', fn() => genesisPartnerDashboard('ordinary', []));
partnerReject('FORBIDDEN', fn() => genesisPartnerDashboard('a', [], $b));
partnerReject('PARTNER_FILTER_INVALID', fn() => genesisPartnerDashboard('a', ['partnerId' => $b]));
partnerReject('PARTNER_FILTER_INVALID', fn() => genesisPartnerDashboard('a', ['offset' => '-1']));
partnerReject('PARTNER_FILTER_INVALID', fn() => genesisPartnerDashboard('a', ['from' => '2026-02-31']));
partnerReject('PARTNER_SELF_REFERRAL', fn() => genesisPartnerManualBind('owner', $a, partnerRequest(['userId' => 'a', 'expectedClientId' => null, 'reason' => 'Not allowed', 'noHistoricalAccrual' => true])));

function partnerOrder(string $userId, int $amount, int $at, int $credit = 0, string $provider = 'yookassa'): array {
    $id = genesisUuid(); $stamp = gmdate('Y-m-d\TH:i:s\Z', $at);
    genesisDb()->prepare("INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,provider_secret,created_at,updated_at,list_amount_minor,upgrade_credit_minor)
        VALUES(?,?,?,?,'premium',1,?,'RUB','product-premium',?,?,?,?,?)")
        ->execute([$id, $userId, 'order-' . $id, $provider, $amount, 'pay-' . $id, $stamp, $stamp, $amount + $credit, $credit]);
    $q = genesisDb()->prepare('SELECT * FROM billing_orders WHERE id=?'); $q->execute([$id]); return $q->fetch();
}
function partnerReceipt(array $order, int $at, int $refund = 0, string $state = 'paid'): GenesisVerifiedBillingReceipt {
    return new GenesisVerifiedBillingReceipt($order['provider'], $order['provider_secret'], $order['id'], $state, (int)$order['amount_minor'],
        $order['currency'], $order['product_id'], gmdate('Y-m-d\TH:i:s\Z', $at), hash('sha256', 'verified-' . $order['id'] . '-' . $refund), null, $refund);
}
function partnerPayment(array $order): array { $q = genesisDb()->prepare('SELECT * FROM partner_payments WHERE order_id=?'); $q->execute([$order['id']]); return $q->fetch(); }
function partnerConfirm(string $partnerId, array $order, int $fee, int $tax, string $reason = 'Actual synthetic costs'): array {
    $payment = partnerPayment($order); return genesisPartnerConfirmCalculation('owner', $partnerId, $payment['id'],
        partnerRequest(['expectedRevision' => (int)$payment['revision'], 'feeMinor' => $fee, 'taxMinor' => $tax, 'confirmed' => true, 'reason' => $reason]));
}

$first = partnerOrder('client', 100000, $now - 200); $receipt = partnerReceipt($first, $now - 190);
genesisBillingApplyReceipt($db, $receipt, $now);
partnerCheck(genesisPartnerTotals($db, $a)['unknownPreliminaryCount'] === 1 && genesisPartnerTotals($db, $a)['payableMinor'] === 0, 'Unknown costs became a payable amount');
for ($i = 0; $i < 4; $i++) genesisBillingApplyReceipt($db, $receipt, $now);
partnerCheck((int)$db->query('SELECT COUNT(*) FROM partner_payments')->fetchColumn() === 1 && (int)$db->query('SELECT COUNT(*) FROM partner_calculations')->fetchColumn() === 1, 'Receipt/webhook replay duplicated an accrual');
$partialPayment = partnerPayment($first);
$partial = genesisPartnerConfirmCalculation('owner', $a, $partialPayment['id'], partnerRequest(['expectedRevision' => (int)$partialPayment['revision'], 'feeMinor' => 3000, 'taxMinor' => null, 'confirmed' => false, 'reason' => 'Only actual fee known']));
partnerCheck($partial['shareMinor'] === null && genesisPartnerTotals($db, $a)['payableMinor'] === 0, 'Missing tax was silently treated as zero');
partnerReject('PARTNER_MONEY_INVALID', fn() => genesisPartnerConfirmCalculation('owner', $a, $partialPayment['id'], partnerRequest(['expectedRevision' => $partial['revision'], 'feeMinor' => 3000, 'taxMinor' => null, 'confirmed' => true, 'reason' => 'Unknown tax cannot be final'])));
partnerCheck(partnerConfirm($a, $first, 3000, 4000)['shareMinor'] === 46500, 'First payment profit was not split 50/50');
$renewal = partnerOrder('client', 200000, $now - 180); genesisBillingApplyReceipt($db, partnerReceipt($renewal, $now - 170), $now);
partnerCheck(partnerConfirm($a, $renewal, 6000, 8000)['shareMinor'] === 93000, 'Renewal did not accrue independently');
$upgrade = partnerOrder('client', 60000, $now - 160, 40000);
// The payment observer receives only newly paid cash, never transferred subscription value.
$db->beginTransaction(); genesisPartnerObserveReceipt($db, $upgrade, partnerReceipt($upgrade, $now - 150), $now); $db->commit();
partnerCheck(partnerConfirm($a, $upgrade, 1800, 2400)['shareMinor'] === 27900, 'Upgrade credit was charged a second commission');
partnerCheck(genesisPartnerTotals($db, $a)['confirmedShareMinor'] === 167400, 'Confirmed earnings were summed incorrectly');
$payment = partnerPayment($first);
partnerReject('PARTNER_MONEY_INVALID', fn() => genesisPartnerConfirmCalculation('owner', $a, $payment['id'], partnerRequest(['expectedRevision' => (int)$payment['revision'], 'feeMinor' => 1.5, 'taxMinor' => 4000, 'confirmed' => true, 'reason' => 'Invalid float'])));
partnerReject('PARTNER_PAYMENT_NOT_FOUND', fn() => genesisPartnerConfirmCalculation('owner', $b, $payment['id'], partnerRequest(['expectedRevision' => (int)$payment['revision'], 'feeMinor' => 3000, 'taxMinor' => 4000, 'confirmed' => true, 'reason' => 'Wrong partner'])));
$revisions = genesisPartnerRow($db, $a);
$payoutInput = partnerRequest(['expectedRevision' => (int)$revisions['revision'], 'amountMinor' => 167400, 'paidOn' => gmdate('Y-m-d'), 'note' => 'Private owner note private-client@example.invalid', 'alreadyPaid' => true]);
$payout = genesisPartnerRecordPayout('owner', $a, $payoutInput);
partnerCheck(count(genesisPartnerDashboard('a', ['from' => $payoutInput['paidOn'], 'to' => $payoutInput['paidOn']])['payouts']) === 1, 'Moscow runtime rejected or shifted transfer dates');
partnerReject('PARTNER_PAYOUT_INVALID', fn() => genesisPartnerRecordPayout('owner', $a, partnerRequest([...$payoutInput, 'paidOn' => gmdate('Y-m-d', time() + 2 * 86400)])));
partnerCheck(genesisPartnerRecordPayout('owner', $a, $payoutInput) === $payout && genesisPartnerTotals($db, $a)['paidMinor'] === 167400, 'Double click duplicated a payout');
partnerReject('PARTNER_REVISION_CONFLICT', fn() => genesisPartnerRecordPayout('owner', $a, partnerRequest([...$payoutInput, 'requestId' => 'another-request', 'note' => 'Other tab'])));
genesisBillingApplyReceipt($db, partnerReceipt($renewal, $now - 170, 50000), $now);
$totals = genesisPartnerTotals($db, $a);
partnerCheck($totals['pendingAdjustmentMinor'] === -25000 && $totals['payableMinor'] === 0 && $totals['heldMinor'] === 93000, 'Unconfirmed refund adjustment was treated as payable/settled');
partnerCheck(partnerConfirm($a, $renewal, 5000, 6000)['shareMinor'] === 69500, 'Actual refund costs were assumed to be proportional');
partnerCheck(genesisPartnerTotals($db, $a)['confirmedBalanceMinor'] === -23500, 'Refund after payout did not preserve a negative balance');
$latest = partnerPayment($renewal); $count = (int)$db->query('SELECT COUNT(*) FROM partner_calculations')->fetchColumn();
genesisBillingApplyReceipt($db, partnerReceipt($renewal, $now - 170, 50000), $now);
genesisBillingApplyReceipt($db, partnerReceipt($renewal, $now - 170), $now);
partnerCheck((int)$db->query('SELECT COUNT(*) FROM partner_calculations')->fetchColumn() === $count, 'Duplicate or old refund event repeated/reverted an adjustment');
$dashboard = genesisPartnerDashboard('a', []); $encoded = json_encode($dashboard, JSON_THROW_ON_ERROR);
partnerCheck(!str_contains($encoded, '@') && !str_contains($encoded, 'private-client') && !str_contains($encoded, 'verification_context') && !str_contains($encoded, 'provider_secret'), 'Limited partner response disclosed customer/contact/payment secrets');
partnerCheck(genesisPartnerDashboard('b', [])['payments'] === [] && genesisPartnerDashboard('b', [])['payouts'] === [], 'Partner B received partner A financial rows');
partnerCheck(genesisPartnerDashboard('a', [])['audit'] === [] && count(genesisPartnerDashboard('owner', [], $a)['audit']) > 0, 'Owner audit leaked to a limited partner or disappeared');
partnerCheck(genesisPartnerDashboard('a', ['offset' => '25'])['payments'] === [], 'Out-of-range page ignored its offset');
$configuration = ['shop_id' => 'synthetic-shop', 'test_mode' => false];
$providerPayment = ['id' => $first['provider_secret'], 'status' => 'succeeded', 'paid' => true, 'test' => false,
    'recipient' => ['account_id' => 'synthetic-shop'], 'metadata' => ['genesis_order_id' => $first['id']],
    'amount' => ['value' => '1000.00', 'currency' => 'RUB'], 'captured_at' => gmdate('Y-m-d\TH:i:s\Z', $now - 190)];
partnerReject('BILLING_TEST_PAYMENT_UNSUPPORTED', fn() => genesisBillingYooReceipt([...$providerPayment, 'test' => true], $first, $configuration));
partnerReject('BILLING_RECEIPT_MISMATCH', fn() => genesisBillingYooReceipt([...$providerPayment, 'metadata' => ['genesis_order_id' => 'other']], $first, $configuration));
partnerReject('BILLING_RECEIPT_MISMATCH', fn() => genesisBillingApplyReceipt($db, new GenesisVerifiedBillingReceipt('yookassa', $first['provider_secret'], $first['id'], 'paid', 100001, 'RUB', 'product-premium', $receipt->confirmedAt, hash('sha256', 'bad')), $now));
partnerReject('BILLING_RECEIPT_MISMATCH', fn() => genesisBillingApplyReceipt($db, new GenesisVerifiedBillingReceipt('yookassa', $first['provider_secret'], $first['id'], 'paid', 100000, 'USD', 'product-premium', $receipt->confirmedAt, hash('sha256', 'bad')), $now));
$cancelled = partnerOrder('client-b', 1000, $now - 120); genesisBillingApplyReceipt($db, partnerReceipt($cancelled, $now - 110, 0, 'cancelled'), $now);
partnerCheck(genesisPartnerTotals($db, $b)['payments'] === 0, 'Cancelled/unpaid order earned a commission');
$foreign = partnerOrder('client-b', 1000, $now - 100, 0, 'google-play');
$db->beginTransaction(); genesisPartnerObserveReceipt($db, $foreign, partnerReceipt($foreign, $now - 90), $now); $db->commit();
partnerCheck(genesisPartnerTotals($db, $b)['payments'] === 0, 'Unsupported Play revenue was silently counted');
foreach ([0 => 0, 1 => 1, 3 => 2, 111 => 56, -1 => -1, -3 => -2, -111 => -56] as $base => $expected)
    partnerCheck(genesisPartnerHalf($base) === $expected, 'Signed half-up rounding differs');
$state = genesisPartnerRow($db, $a);
genesisPartnerUpdate('owner', $a, partnerRequest(['expectedRevision' => (int)$state['revision'], 'acceptsInvitations' => false, 'panelEnabled' => false, 'reason' => 'Pause separate permissions']));
partnerReject('PARTNER_CODE_UNAVAILABLE', fn() => genesisPartnerCapture($db, $codeA, null));
partnerReject('PARTNER_ACCESS_DENIED', fn() => genesisPartnerDashboard('a', []));
$continuation = partnerOrder('client', 10000, $now - 80);
genesisBillingApplyReceipt($db, partnerReceipt($continuation, $now - 70), $now);
partnerCheck(partnerPayment($continuation)['partner_id'] === $a, 'Pausing invitations/access cancelled existing-client accruals');
$state = genesisPartnerRow($db, $a);
genesisPartnerUpdate('owner', $a, partnerRequest(['expectedRevision' => (int)$state['revision'], 'acceptsInvitations' => false, 'panelEnabled' => true, 'reason' => 'Restore panel only']));
partnerConfirm($a, $continuation, 300, 400);
$beforeDeletion = (int)$db->query('SELECT COUNT(*) FROM partner_payments')->fetchColumn();
// The outstanding synthetic upgrade is made terminal before testing the existing deletion backstop.
$db->prepare("UPDATE billing_orders SET status='cancelled' WHERE id=?")->execute([$upgrade['id']]);
$db->prepare("DELETE FROM users WHERE id='client'")->execute();
partnerCheck((int)$db->query('SELECT COUNT(*) FROM partner_payments')->fetchColumn() === $beforeDeletion, 'Account cascade deleted financial history');
partnerCheck((int)$db->query("SELECT COUNT(*) FROM partner_clients WHERE user_id='client'")->fetchColumn() === 0, 'Deleted account retained a matching identity');
$refundPayment = [...$providerPayment, 'refunded_amount' => ['value' => '1000.00', 'currency' => 'RUB']];
partnerCheck(genesisPartnerAcceptRetainedYooPayment($db, $refundPayment, $configuration, $now), 'Verified late refund after account deletion was lost');
partnerCheck(partnerConfirm($a, $first, 3000, 0)['shareMinor'] === -1500, 'Full refund incorrectly erased retained actual commission');
$lateCount = (int)$db->query('SELECT COUNT(*) FROM partner_calculations')->fetchColumn();
genesisPartnerAcceptRetainedYooPayment($db, $refundPayment, $configuration, $now);
partnerCheck((int)$db->query('SELECT COUNT(*) FROM partner_calculations')->fetchColumn() === $lateCount, 'Retained refund replay duplicated its adjustment');
partnerReject('BILLING_RECEIPT_MISMATCH', fn() => genesisPartnerAcceptRetainedYooPayment($db, [...$refundPayment, 'amount' => ['value' => '999.00', 'currency' => 'RUB']], $configuration, $now));
$oldClientId = $db->query("SELECT id FROM partner_clients WHERE user_id='client-b' AND ended_at IS NULL")->fetchColumn();
$oldPending = partnerOrder('client-b', 1000, $now - 30);
partnerReject('PARTNER_CLIENT_CONFLICT', fn() => genesisPartnerManualBind('owner', $a, partnerRequest(['userId' => 'client-b', 'expectedClientId' => null, 'reason' => 'Wrong revision', 'noHistoricalAccrual' => true])));
$GLOBALS['partnerFixtureNow'] = $now - 20;
genesisPartnerManualBind('owner', $a, partnerRequest(['userId' => 'client-b', 'expectedClientId' => $oldClientId, 'reason' => 'Owner resolved disputed attribution', 'noHistoricalAccrual' => true]));
genesisBillingApplyReceipt($db, partnerReceipt($oldPending, $now - 10), $now);
partnerCheck((int)$db->query("SELECT COUNT(*) FROM partner_payments WHERE order_id='" . $oldPending['id'] . "'")->fetchColumn() === 1, 'Historical order was not consistently attributed to the pre-existing binding');
// Existing orders may retain their original partner, but can never accrue to a newly assigned partner.
$q = $db->prepare('SELECT partner_id FROM partner_payments WHERE order_id=?'); $q->execute([$oldPending['id']]);
partnerCheck($q->fetchColumn() === $b, 'Manual reassignment retroactively charged an old order to the new partner');
$state = genesisPartnerRow($db, $a);
$correction = genesisPartnerCorrectPayout('owner', $a, $payout['id'], partnerRequest(['expectedRevision' => (int)$state['revision'], 'deltaMinor' => -100, 'reason' => 'Correct recorded external transfer']));
partnerCheck(genesisPartnerTotals($db, $a)['paidMinor'] === 167300 && !empty($correction['id']), 'Payout correction removed or failed to adjust history');
partnerReject('PARTNER_MONEY_INVALID', fn() => genesisPartnerCorrectPayout('owner', $a, $payout['id'], partnerRequest(['expectedRevision' => $correction['revision'], 'deltaMinor' => -167301, 'reason' => 'Cannot create negative external transfer'])));
partnerCheck(genesisPartnerValidDate('2028-02-29') && !genesisPartnerValidDate('2026-02-29'), 'Calendar date validation ignores leap years');
$dateParameters = []; genesisPartnerDateWhere('p.confirmed_at', ['from' => '2026-11-09', 'to' => '2026-11-09'], $dateParameters);
partnerCheck($dateParameters === ['2026-11-09T00:00:00Z', '2026-11-10T00:00:00Z'], 'Report boundaries depend on the server timezone');
try { $db->exec('DELETE FROM partner_payouts'); throw new RuntimeException('History deletion succeeded'); }
catch (PDOException $error) { partnerCheck(str_contains($error->getMessage(), 'PARTNER_HISTORY_IMMUTABLE'), 'Financial history guard missing'); }
$GLOBALS['partnerFixtureConfig']['partners']['enabled'] = false;
partnerCheck(genesisPartnerAccess('a') === null, 'Disabled feature leaked role entry');
partnerReject('PARTNERS_DISABLED', fn() => genesisPartnerDashboard('a', []));
$GLOBALS['partnerFixtureConfig']['partners']['enabled'] = true;

// Independent processes emulate two browser tabs acquiring the same SQLite balance revision.
if (function_exists('proc_open')) {
    $q->closeCursor();
    $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'genesis-partner-race-' . bin2hex(random_bytes(8)) . '.sqlite';
    $db->exec('VACUUM INTO ' . $db->quote($path));
    try {
        $revision = (int)genesisPartnerRow($db, $b)['revision']; $children = [];
        foreach (['race-request-first', 'race-request-second'] as $key) {
            $pipes = []; $process = proc_open([PHP_BINARY, __FILE__, 'payout-race', $path, $b, (string)$revision, $key], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (!is_resource($process)) throw new RuntimeException('Cannot start isolated race process');
            fclose($pipes[0]); $children[] = [$process, $pipes];
        }
        $outcomes = [];
        foreach ($children as [$process, $pipes]) { $raw = stream_get_contents($pipes[1]); $errors = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]); $exit = proc_close($process); partnerCheck($exit === 0, 'Race child failed: ' . $errors); $outcomes[] = json_decode($raw, true, 16, JSON_THROW_ON_ERROR)['status']; }
        sort($outcomes); partnerCheck($outcomes === ['PARTNER_REVISION_CONFLICT', 'ok'], 'Simultaneous tabs recorded the same balance twice');
        $race = new PDO('sqlite:' . $path); partnerCheck((int)$race->query('SELECT COUNT(*) FROM partner_payouts WHERE partner_id=' . $race->quote($b))->fetchColumn() === 1, 'Two payouts persisted from one balance revision'); $race = null;
    } finally { foreach ([$path, $path . '-wal', $path . '-shm', $path . '-journal'] as $file) if (is_file($file)) unlink($file); }
} else { throw new RuntimeException('Isolated simultaneous-process payout acceptance requires proc_open'); }
echo "PASS private partners: $cases money, role, isolation, referral, refund, deletion and simultaneous-tab checks; synthetic providers only.\n";
