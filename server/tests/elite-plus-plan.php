<?php
declare(strict_types=1);
// Additive migration rehearsal, using only a newly-created in-memory database.
if(PHP_SAPI!=='cli')exit(1);
$db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$db->exec("CREATE TABLE users(id TEXT PRIMARY KEY,subscription_plan TEXT NOT NULL CHECK(subscription_plan IN ('free','standart','premium','business','premium4life')),subscription_valid_until TEXT,forecast_elite_plus INTEGER NOT NULL,forecast_privilege_revision INTEGER NOT NULL);
CREATE TABLE subscription_access_state(user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,materialized_billing INTEGER NOT NULL);
CREATE TABLE receipts(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
INSERT INTO users VALUES('legacy-free','free',NULL,1,3),('legacy-expired','premium','2020-01-01',1,4),('ordinary','premium','2030-01-01',0,0);
INSERT INTO subscription_access_state VALUES('legacy-expired',7,1),('ordinary',2,1);
INSERT INTO receipts VALUES('paid','unchanged-receipt');");
$backup=tempnam(sys_get_temp_dir(),'genesis-elite-migration-');
try {
 $db->exec('VACUUM INTO '.$db->quote($backup));
 $db->beginTransaction();$db->exec(file_get_contents(__DIR__.'/../migrations/118_elite_plus_combined_plan.sql'));$db->commit();
 foreach(['legacy-free','legacy-expired']as$id){
  $row=$db->query('SELECT * FROM users WHERE id='.$db->quote($id))->fetch();
  if($row['subscription_plan']!=='premium4life'||$row['subscription_valid_until']!==null||$row['forecast_elite_plus']!==1)throw new RuntimeException('Legacy grant was not preserved as a permanent plan');
 }
 if($db->query("SELECT subscription_plan FROM users WHERE id='ordinary'")->fetchColumn()!=='premium'||$db->query("SELECT revision FROM subscription_access_state WHERE user_id='ordinary'")->fetchColumn()!==2)throw new RuntimeException('Ordinary plan changed');
 if($db->query("SELECT revision FROM subscription_access_state WHERE user_id='legacy-expired'")->fetchColumn()!==8||$db->query("SELECT materialized_billing FROM subscription_access_state WHERE user_id='legacy-expired'")->fetchColumn()!==0)throw new RuntimeException('Manual plan ownership/revision was not recorded');
 if($db->query('SELECT COUNT(*) FROM elite_plus_plan_migration')->fetchColumn()!==2||$db->query("SELECT previous_plan FROM elite_plus_plan_migration WHERE user_id='legacy-expired'")->fetchColumn()!=='premium')throw new RuntimeException('Previous state not retained');
 if($db->query('SELECT payload FROM receipts')->fetchColumn()!=='unchanged-receipt')throw new RuntimeException('Billing history changed');
 $old=new PDO('sqlite:'.$backup,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
 if($old->query("SELECT subscription_plan FROM users WHERE id='legacy-free'")->fetchColumn()!=='free'||$old->query('SELECT payload FROM receipts')->fetchColumn()!=='unchanged-receipt')throw new RuntimeException('Backup rehearsal failed');
 $old=null;
 echo "Elite+ legacy grants, manual ownership, old-client storage, ordinary plans, retained migration state and backup passed.\n";
}finally{unlink($backup);}
