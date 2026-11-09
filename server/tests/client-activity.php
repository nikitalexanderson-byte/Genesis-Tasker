<?php
declare(strict_types=1);
require dirname(__DIR__).'/src/bootstrap.php';
require dirname(__DIR__).'/src/repository.php';
if (!in_array(parse_url(genesisConfig()['app_url'], PHP_URL_HOST), ['127.0.0.1','localhost.invalid'], true)) throw new RuntimeException('Isolated configuration required');
function clientExpect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$db = genesisDb(); $id = 'client-activity-'.bin2hex(random_bytes(8)); $request = $_SERVER;
$db->beginTransaction();
try {
    $db->prepare('INSERT INTO users(id,google_sub,email,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid','Synthetic',genesisNow(),genesisNow()]);
    clientExpect(genesisRequestClientKind([]) === null, 'Cron inferred a device');
    clientExpect(genesisRequestClientKind(['HTTP_USER_AGENT'=>'curl/8']) === null, 'Unknown agent inferred a computer');
    clientExpect(genesisRequestClientKind(['HTTP_USER_AGENT'=>'Mozilla/5.0 (iPad) Mobile']) === 'mobile_browser', 'Tablet not grouped with mobile browsers');
    $_SERVER = ['HTTP_USER_AGENT'=>'Mozilla/5.0 (Windows NT 10.0)'];
    genesisRecordClientActivity($id, true);
    $db->prepare("UPDATE user_client_activity SET last_login_at='2026-01-01T00:00:00Z' WHERE user_id=?")->execute([$id]);
    genesisRecordClientActivity($id);
    $q=$db->prepare('SELECT last_login_at FROM user_client_activity WHERE user_id=? AND client_kind=?');$q->execute([$id,'desktop_browser']);
    clientExpect($q->fetchColumn() === '2026-01-01T00:00:00Z', 'Existing session reset sign-in date');
    $_SERVER=['HTTP_USER_AGENT'=>'Mozilla/5.0 (Linux; Android 15) Mobile']; genesisRecordClientActivity($id);
    $_SERVER=['HTTP_X_GENESIS_APP_VERSION'=>'2.8.7']; genesisRecordClientActivity($id,true);
    $_SERVER=[];genesisRecordClientActivity($id,true);
    $q=$db->prepare('SELECT client_kind,last_login_at FROM user_client_activity WHERE user_id=?');$q->execute([$id]);$rows=$q->fetchAll();
    clientExpect(count($rows)===3,'Client categories merged or cron created history');
    foreach($rows as$row) if($row['client_kind']==='mobile_browser') clientExpect($row['last_login_at']===null,'Activity fabricated a past mobile sign-in');
    clientExpect(genesisFindUser($id)['last_login_at']===null,'Device metadata rewrote legacy sign-in history');
    $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]);
    $q=$db->prepare('SELECT COUNT(*) FROM user_client_activity WHERE user_id=?');$q->execute([$id]);clientExpect((int)$q->fetchColumn()===0,'Account deletion retained client metadata');
    echo "Client activity: distinct app/mobile/desktop, unknown and cron exclusion, session reuse, legacy dates and deletion passed.\n";
} finally { $_SERVER=$request;$db->rollBack(); }
