<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('existing');
    CREATE TABLE opaque_workspace(body TEXT);INSERT INTO opaque_workspace VALUES('unchanged encrypted content')");
foreach(['093_billing_infrastructure','096_billing_upgrade_credit','099_billing_refund_amount','100_billing_settlement','101_billing_pending_order_deletion_guard']as$name)
    $db->exec(file_get_contents(dirname(__DIR__).'/migrations/'.$name.'.sql'));
$insert="INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period_months,amount_minor,currency,product_id,created_at,updated_at)
    VALUES('old','existing','old','yookassa','premium',1,55500,'RUB','old','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')";
$db->exec($insert);$before=$db->query('SELECT * FROM billing_orders')->fetchAll();
$backupPath=tempnam(sys_get_temp_dir(),'yoo105-');unlink($backupPath);
try{
    $db->exec('VACUUM INTO '.$db->quote($backupPath));$backup=new PDO('sqlite:'.$backupPath);
    if($backup->query('PRAGMA integrity_check')->fetchColumn()!=='ok')throw new RuntimeException('Inconsistent backup');
    $sql=file_get_contents(dirname(__DIR__).'/migrations/105_billing_yookassa_recovery.sql');
    $db->beginTransaction();$db->exec($sql);$db->rollBack();
    if($db->query("SELECT COUNT(*) FROM sqlite_master WHERE name='billing_yookassa_recovery'")->fetchColumn()!=0)throw new RuntimeException('Failed migration left partial state');
    $db->beginTransaction();$db->exec($sql);$db->commit();
    if($db->query('SELECT * FROM billing_orders')->fetchAll()!==$before||$db->query('SELECT body FROM opaque_workspace')->fetchColumn()!=='unchanged encrypted content'
        ||$db->query('SELECT COUNT(*) FROM billing_yookassa_recovery')->fetchColumn()!=0)throw new RuntimeException('Additive migration changed historical state');
    // A rolled-back old writer can still create/update orders; no recovery data is invented automatically.
    $db->exec(str_replace("'old'","'legacy-after-rollback'",$insert));
    $db->prepare('INSERT INTO billing_yookassa_recovery(order_id,encrypted_request,started_at,next_check_at) VALUES(?,?,?,?)')->execute(['old','encrypted-synthetic','now','later']);
    try{$db->exec("DELETE FROM users WHERE id='existing'");throw new LogicException('Pending data lost');}catch(PDOException $error){
        if(!str_contains($error->getMessage(),'BILLING_SETTLEMENT_REQUIRED'))throw $error;
    }
    $db->exec("UPDATE billing_orders SET status='cancelled';DELETE FROM users WHERE id='existing'");
    if($db->query('SELECT COUNT(*) FROM billing_yookassa_recovery')->fetchColumn()!=0||$backup->query('SELECT COUNT(*) FROM billing_orders')->fetchColumn()!=1)
        throw new RuntimeException('Terminal cleanup changed backup or left private recovery data');
    echo "PASS migration105: consistent SQLite backup; transactional rollback; unchanged old orders/encrypted workspace; old-code writes; pending deletion backstop; terminal cascade cleanup. No production data read.\n";
}finally{$backup=null;if(is_file($backupPath))unlink($backupPath);}
