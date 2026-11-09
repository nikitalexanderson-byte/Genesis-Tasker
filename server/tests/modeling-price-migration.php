<?php
declare(strict_types=1);
// Standalone in-memory database only; no application config or payment network.
if (PHP_SAPI !== 'cli') exit(1);
$checks = 0;
function priceExpect(bool $ok, string $message): void {
    global $checks;
    if (!$ok) throw new RuntimeException($message);
    $checks++;
}
function priceReject(callable $operation, string $message): void {
    try { $operation(); } catch (PDOException) { priceExpect(true, $message); return; }
    throw new RuntimeException($message);
}
function priceDatabase(): PDO {
    $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('synthetic-owner');");
    $db->exec(file_get_contents(dirname(__DIR__) . '/migrations/110_modeling_service.sql'));
    for ($i = 0; $i < 12; $i++) $db->prepare('INSERT INTO future_modeling_results VALUES(?,?,?,?,?,?)')
        ->execute(['result-' . $i, 'synthetic-owner', 'test', 'opaque-result', 'hash-' . $i, '2026-11-05T00:00:00Z']);
    return $db;
}
function priceOrder(PDO $db, int $i, int $amount, string $provider = 'yookassa', string $currency = 'RUB', string $status = 'pending', ?string $result = null, ?string $key = null, ?string $secret = null): void {
    $db->prepare('INSERT INTO future_modeling_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([
        'order-' . $i, 'synthetic-owner', $result ?? 'result-' . $i, $provider, $amount, $currency, 'synthetic-product', $key ?? 'key-' . $i, $status,
        'https://localhost.invalid/' . $i, $secret ?? 'provider-' . $i, 'opaque-request-' . $i, '2026-11-05T01:00:00Z', '2026-11-05T02:00:00Z',
        'lease-' . $i, '2026-11-05T03:00:00Z', 'cursor-' . $i, $status === 'paid' ? '2026-11-05T04:00:00Z' : null, 'evidence-' . $i,
    ]);
}
$migration = file_get_contents(dirname(__DIR__) . '/migrations/119_modeling_service_prices.sql');
$db = priceDatabase();
foreach (['pending', 'paid', 'refunded', 'cancelled'] as $i => $status) priceOrder($db, $i, $i % 2 ? 2200 : 222200, $i % 2 ? 'lemon-squeezy' : 'yookassa', $i % 2 ? 'USD' : 'RUB', $status);
$before = $db->query('SELECT * FROM future_modeling_orders ORDER BY id')->fetchAll();
$db->beginTransaction(); $db->exec($migration); $db->rollBack();
priceExpect($db->query('SELECT * FROM future_modeling_orders ORDER BY id')->fetchAll() === $before, 'Rollback changed historical invoices');
priceReject(fn() => priceOrder($db, 4, 2000000), 'Rolled-back schema admitted a new price');
priceReject(fn() => $db->exec("DELETE FROM future_modeling_orders WHERE id='order-0'"), 'Rollback lost pending deletion guard');
$db->beginTransaction(); $db->exec($migration); $db->commit();
priceExpect($db->query('SELECT * FROM future_modeling_orders ORDER BY id')->fetchAll() === $before, 'Migration changed frozen invoice fields');
priceOrder($db, 4, 2000000); priceOrder($db, 5, 20000, 'lemon-squeezy', 'USD');
priceExpect((int)$db->query('SELECT count(*) FROM future_modeling_orders')->fetchColumn() === 6, 'New invoices not admitted');
priceReject(fn() => priceOrder($db, 6, 1), 'Arbitrary RUB price accepted');
priceReject(fn() => priceOrder($db, 6, 20000, 'yookassa', 'USD'), 'Provider/currency mismatch accepted');
priceReject(fn() => priceOrder($db, 6, 2000000, result: 'result-0'), 'Duplicate active order accepted');
priceReject(fn() => priceOrder($db, 6, 2000000, key: 'key-0'), 'Owner idempotency uniqueness lost');
priceReject(fn() => priceOrder($db, 6, 2000000, secret: 'provider-0'), 'Provider receipt uniqueness lost');
priceReject(fn() => priceOrder($db, 6, 2000000, result: 'missing'), 'Foreign result reference accepted');
priceReject(fn() => $db->exec("DELETE FROM future_modeling_orders WHERE id='order-0'"), 'Pending deletion guard lost');
priceReject(fn() => $db->exec("DELETE FROM users WHERE id='synthetic-owner'"), 'Owner cascade deleted pending payment');
priceExpect($db->query('PRAGMA foreign_key_check')->fetchAll() === [], 'Foreign keys damaged');
priceExpect($db->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Integrity check failed');
$fresh = priceDatabase(); $fresh->beginTransaction(); $fresh->exec($migration); $fresh->commit();
priceOrder($fresh, 0, 2000000); priceOrder($fresh, 1, 20000, 'lemon-squeezy', 'USD');
priceExpect((int)$fresh->query('SELECT count(*) FROM future_modeling_orders')->fetchColumn() === 2, 'Fresh migration failed');
echo "Modeling price migration: $checks checks passed (legacy fields, rollback, constraints, integrity).\n";
