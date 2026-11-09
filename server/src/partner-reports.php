<?php
declare(strict_types=1);

function genesisPartnerFilters(array $query): array
{
    if (array_diff(array_keys($query), ['path', 'from', 'to', 'offset'])) throw new InvalidArgumentException('PARTNER_FILTER_INVALID');
    $dates = [];
    foreach (['from', 'to'] as $key) {
        $value = $query[$key] ?? '';
        if (!is_string($value) || ($value !== '' && !genesisPartnerValidDate($value))) throw new InvalidArgumentException('PARTNER_FILTER_INVALID');
        $dates[$key] = $value;
    }
    if ($dates['from'] !== '' && $dates['to'] !== '' && $dates['from'] > $dates['to']) throw new InvalidArgumentException('PARTNER_FILTER_INVALID');
    $offset = $query['offset'] ?? '0';
    if (!is_string($offset) || preg_match('/\A[0-9]{1,7}\z/D', $offset) !== 1 || (int)$offset > 1000000) throw new InvalidArgumentException('PARTNER_FILTER_INVALID');
    return [...$dates, 'offset' => (int)$offset];
}

function genesisPartnerDateWhere(string $column, array $filters, array &$parameters): string
{
    $where = '';
    if ($filters['from'] !== '') { $where .= " AND $column>=?"; $parameters[] = $filters['from'] . 'T00:00:00Z'; }
    if ($filters['to'] !== '') { $where .= " AND $column<?"; $parameters[] = (new DateTimeImmutable($filters['to'] . 'T00:00:00Z'))->modify('+1 day')->format('Y-m-d\TH:i:s\Z'); }
    return $where;
}

function genesisPartnerPublic(array $row): array
{
    return ['id' => $row['id'], 'label' => $row['label'], 'code' => $row['code'],
        'link' => rtrim(genesisConfig()['app_url'], '/') . '/?ref=' . rawurlencode($row['code']) . '#today',
        'acceptsInvitations' => (bool)$row['accepts_invitations'], 'panelEnabled' => (bool)$row['panel_enabled'],
        'accountAvailable' => $row['user_id'] !== null, 'revision' => (int)$row['revision'], 'shareBps' => GENESIS_PARTNER_SHARE_BPS];
}

function genesisPartnerTotals(PDO $db, string $partnerId): array
{
    $q = $db->prepare("SELECT COALESCE(SUM(p.amount_minor),0) gross,COALESCE(SUM(p.refunded_minor),0) refunds,
        COALESCE(SUM(COALESCE(confirmed.share_minor,0)),0) confirmed,
        COALESCE(SUM(CASE WHEN latest.state='preliminary' THEN COALESCE(latest.share_minor,0) ELSE 0 END),0) preliminary,
        COALESCE(SUM(CASE WHEN latest.state='preliminary' AND latest.share_minor IS NULL THEN 1 ELSE 0 END),0) unknown_count,
        COALESCE(SUM(CASE WHEN latest.state='preliminary' THEN MAX(0,COALESCE(confirmed.share_minor,0)) ELSE 0 END),0) held,
        COALESCE(SUM(CASE WHEN latest.state='preliminary' AND latest.share_minor IS NOT NULL THEN latest.share_minor-COALESCE(confirmed.share_minor,0) ELSE 0 END),0) pending_change,
        COUNT(*) payments,COUNT(DISTINCT p.client_id) paying_clients
        FROM partner_payments p JOIN partner_calculations latest ON latest.payment_id=p.id AND latest.revision=p.revision
        LEFT JOIN partner_calculations confirmed ON confirmed.payment_id=p.id AND confirmed.revision=(SELECT MAX(c.revision) FROM partner_calculations c WHERE c.payment_id=p.id AND c.state='confirmed')
        WHERE p.partner_id=?");
    $q->execute([$partnerId]); $r = $q->fetch();
    $q = $db->prepare('SELECT COALESCE(SUM(amount_minor),0) FROM partner_payouts WHERE partner_id=?'); $q->execute([$partnerId]); $paid = (int)$q->fetchColumn();
    $q = $db->prepare('SELECT COALESCE(SUM(c.delta_minor),0) FROM partner_payout_corrections c JOIN partner_payouts p ON p.id=c.payout_id WHERE p.partner_id=?'); $q->execute([$partnerId]); $paid += (int)$q->fetchColumn();
    $q = $db->prepare("SELECT COUNT(*) clients,COALESCE(SUM(CASE WHEN source='google-registration' THEN 1 ELSE 0 END),0) registrations FROM partner_clients WHERE partner_id=?"); $q->execute([$partnerId]); $clientCounts = $q->fetch();
    $q = $db->prepare('SELECT COALESCE(SUM(visits),0) FROM partner_visit_days WHERE partner_id=?'); $q->execute([$partnerId]); $visits = (int)$q->fetchColumn();
    $confirmed = (int)$r['confirmed']; $held = (int)$r['held'];
    return ['visits' => $visits, 'registrations' => (int)$clientCounts['registrations'], 'assignedClients' => (int)$clientCounts['clients'], 'payingClients' => (int)$r['paying_clients'], 'payments' => (int)$r['payments'],
        'receivedMinor' => (int)$r['gross'], 'refundedMinor' => (int)$r['refunds'], 'preliminaryShareMinor' => (int)$r['preliminary'],
        'unknownPreliminaryCount' => (int)$r['unknown_count'], 'confirmedShareMinor' => $confirmed, 'paidMinor' => $paid,
        'confirmedBalanceMinor' => $confirmed - $paid, 'heldMinor' => $held, 'pendingAdjustmentMinor' => (int)$r['pending_change'],
        'payableMinor' => max(0, $confirmed - $paid - $held), 'currency' => 'RUB'];
}

function genesisPartnerAlias(string $clientId): string
{
    return 'C-' . strtoupper(substr(str_replace('-', '', $clientId), -8));
}

function genesisPartnerPaymentPublic(array $row): array
{
    $nullable = static fn(string $field): ?int => $row[$field] === null ? null : (int)$row[$field];
    return ['id' => $row['id'], 'clientAlias' => genesisPartnerAlias($row['client_id']), 'plan' => $row['plan'],
        'periodMonths' => (int)$row['period_months'], 'amountMinor' => (int)$row['amount_minor'], 'refundedMinor' => (int)$row['refunded_minor'],
        'feeMinor' => $nullable('fee_minor'), 'taxMinor' => $nullable('tax_minor'), 'baseMinor' => $nullable('base_minor'), 'shareMinor' => $nullable('share_minor'),
        'state' => $row['state'], 'kind' => $row['kind'], 'revision' => (int)$row['revision'], 'confirmedAt' => $row['confirmed_at'], 'calculatedAt' => $row['calculated_at'],
        'shareBps' => GENESIS_PARTNER_SHARE_BPS, 'currency' => 'RUB'];
}

/** Every query is anchored to the server-selected partner, including all pages and date filters. */
function genesisPartnerDashboard(string $userId, array $query, ?string $adminPartnerId = null): array
{
    genesisPartnersRequireEnabled(); $filters = genesisPartnerFilters($query); $db = genesisDb();
    if ($adminPartnerId !== null) {
        genesisPartnerOwner($userId); $partner = genesisPartnerRow($db, $adminPartnerId);
    } else {
        $q = $db->prepare('SELECT * FROM partners WHERE user_id=? AND panel_enabled=1'); $q->execute([$userId]);
        $partner = $q->fetch() ?: throw new GenesisResourceLimitException(403, 'PARTNER_ACCESS_DENIED');
    }
    $id = $partner['id']; $parameters = [$id]; $dates = genesisPartnerDateWhere('p.confirmed_at', $filters, $parameters);
    $sql = 'FROM partner_payments p JOIN partner_calculations c ON c.payment_id=p.id AND c.revision=p.revision WHERE p.partner_id=?' . $dates;
    $q = $db->prepare('SELECT COUNT(*) ' . $sql); $q->execute($parameters); $total = (int)$q->fetchColumn();
    $q = $db->prepare('SELECT p.*,c.fee_minor,c.tax_minor,c.base_minor,c.share_minor,c.state,c.kind,c.created_at AS calculated_at ' . $sql . ' ORDER BY p.confirmed_at DESC,p.id DESC LIMIT 25 OFFSET ?');
    foreach ([...$parameters, $filters['offset']] as $index => $parameter) $q->bindValue($index + 1, $parameter, is_int($parameter) ? PDO::PARAM_INT : PDO::PARAM_STR);
    $q->execute(); $payments = array_map('genesisPartnerPaymentPublic', $q->fetchAll());
    $parameters = [$id]; $dates = genesisPartnerDateWhere('c.created_at', $filters, $parameters);
    $q = $db->prepare('SELECT c.id,c.payment_id,c.kind,c.state,c.revision,c.fee_minor,c.tax_minor,c.refunded_minor,c.base_minor,c.share_minor,c.reason,c.created_at,c.actor_id,p.client_id,p.plan,p.confirmed_at
        FROM partner_calculations c JOIN partner_payments p ON p.id=c.payment_id WHERE p.partner_id=?' . $dates . ' ORDER BY c.created_at DESC,c.id DESC LIMIT 25 OFFSET ?');
    foreach ([...$parameters, $filters['offset']] as $index => $parameter) $q->bindValue($index + 1, $parameter, is_int($parameter) ? PDO::PARAM_INT : PDO::PARAM_STR);
    $q->execute(); $history = array_map(static fn(array $r): array => ['id' => $r['id'], 'paymentId' => $r['payment_id'], 'clientAlias' => genesisPartnerAlias($r['client_id']), 'plan' => $r['plan'], 'paymentConfirmedAt' => $r['confirmed_at'], 'kind' => $r['kind'], 'state' => $r['state'],
        'revision' => (int)$r['revision'], 'feeMinor' => $r['fee_minor'] === null ? null : (int)$r['fee_minor'], 'taxMinor' => $r['tax_minor'] === null ? null : (int)$r['tax_minor'],
        'refundedMinor' => (int)$r['refunded_minor'], 'baseMinor' => $r['base_minor'] === null ? null : (int)$r['base_minor'], 'shareMinor' => $r['share_minor'] === null ? null : (int)$r['share_minor'],
        'reason' => $adminPartnerId !== null ? $r['reason'] : '', 'systemReason' => $r['actor_id'] === null, 'createdAt' => $r['created_at']], $q->fetchAll());
    $parameters = [$id]; $dates = '';
    if ($filters['from'] !== '') { $dates .= ' AND p.paid_on>=?'; $parameters[] = $filters['from']; }
    if ($filters['to'] !== '') { $dates .= ' AND p.paid_on<=?'; $parameters[] = $filters['to']; }
    $q = $db->prepare('SELECT p.*,p.amount_minor+COALESCE((SELECT SUM(c.delta_minor) FROM partner_payout_corrections c WHERE c.payout_id=p.id),0) corrected_minor
        FROM partner_payouts p WHERE p.partner_id=?' . $dates . ' ORDER BY p.paid_on DESC,p.id DESC LIMIT 25 OFFSET ?');
    foreach ([...$parameters, $filters['offset']] as $index => $parameter) $q->bindValue($index + 1, $parameter, is_int($parameter) ? PDO::PARAM_INT : PDO::PARAM_STR);
    $q->execute(); $payouts = [];
    foreach ($q->fetchAll() as $row) {
        $q2 = $db->prepare('SELECT id,delta_minor,reason,created_at FROM partner_payout_corrections WHERE payout_id=? ORDER BY created_at,id'); $q2->execute([$row['id']]);
        $payouts[] = ['id' => $row['id'], 'paidOn' => $row['paid_on'], 'amountMinor' => (int)$row['amount_minor'], 'correctedMinor' => (int)$row['corrected_minor'],
            'note' => $adminPartnerId !== null ? $row['note'] : '', 'createdAt' => $row['created_at'], 'corrections' => array_map(static fn(array $c): array => ['id' => $c['id'], 'deltaMinor' => (int)$c['delta_minor'], 'reason' => $adminPartnerId !== null ? $c['reason'] : '', 'createdAt' => $c['created_at']], $q2->fetchAll())];
    }
    $parameters = [$id]; $dates = genesisPartnerDateWhere('c.bound_at', $filters, $parameters);
    $q = $db->prepare('SELECT c.id,c.bound_at,c.ended_at,c.user_id,COUNT(p.id) payments,MAX(p.confirmed_at) last_payment
        FROM partner_clients c LEFT JOIN partner_payments p ON p.client_id=c.id WHERE c.partner_id=?' . $dates . ' GROUP BY c.id ORDER BY c.bound_at DESC,c.id DESC LIMIT 25 OFFSET ?');
    foreach ([...$parameters, $filters['offset']] as $index => $parameter) $q->bindValue($index + 1, $parameter, is_int($parameter) ? PDO::PARAM_INT : PDO::PARAM_STR);
    $q->execute(); $clients = array_map(static fn(array $r): array => ['id' => $r['id'], 'alias' => genesisPartnerAlias($r['id']), 'boundAt' => $r['bound_at'],
        'endedAt' => $r['ended_at'], 'accountDeleted' => $r['user_id'] === null, 'payments' => (int)$r['payments'], 'lastPaymentAt' => $r['last_payment']], $q->fetchAll());
    $audit = [];
    if ($adminPartnerId !== null) {
        $parameters = [$id]; $dates = genesisPartnerDateWhere('a.created_at', $filters, $parameters);
        $q = $db->prepare('SELECT a.id,a.action,a.reason,a.created_at FROM partner_audit a WHERE a.partner_id=?' . $dates . ' ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET ?');
        foreach ([...$parameters, $filters['offset']] as $index => $parameter) $q->bindValue($index + 1, $parameter, is_int($parameter) ? PDO::PARAM_INT : PDO::PARAM_STR);
        $q->execute(); $audit = array_map(static fn(array $r): array => ['id' => $r['id'], 'action' => $r['action'], 'reason' => $r['reason'], 'createdAt' => $r['created_at']], $q->fetchAll());
    }
    return ['partner' => genesisPartnerPublic($partner), 'totals' => genesisPartnerTotals($db, $id), 'payments' => $payments, 'history' => $history, 'audit' => $audit,
        'clients' => $clients, 'payouts' => $payouts, 'page' => ['offset' => $filters['offset'], 'limit' => 25, 'paymentTotal' => $total,
        'hasMore' => count($payments) === 25 || count($history) === 25 || count($clients) === 25 || count($payouts) === 25 || count($audit) === 25], 'supportedProviders' => ['yookassa']];
}

function genesisPartnerAdminList(string $actorId): array
{
    genesisPartnerOwner($actorId); $db = genesisDb(); $partners = [];
    foreach ($db->query('SELECT * FROM partners ORDER BY created_at,id')->fetchAll() as $row)
        $partners[] = [...genesisPartnerPublic($row), 'totals' => genesisPartnerTotals($db, $row['id'])];
    $policy = genesisPartnerPolicy($db); $settings = $db->query('SELECT revision FROM partner_settings WHERE singleton=1')->fetch();
    return ['partners' => $partners, 'settings' => ['revision' => (int)$settings['revision'], 'confirmed' => $policy !== null,
        'invitationDays' => $policy ? (int)$policy['invitation_days'] : 30, 'retentionDays' => null,
        'shareBps' => GENESIS_PARTNER_SHARE_BPS], 'approvedEmails' => array_values(genesisConfig()['partners']['allowed_emails'] ?? [])];
}
