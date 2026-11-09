<?php
declare(strict_types=1);
$backup = tempnam(sys_get_temp_dir(), 'genesis-client-');
if ($backup === false) throw new RuntimeException('Cannot allocate isolated backup');
try {
    $db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $db->exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,last_login_at TEXT,last_seen_at TEXT);
        INSERT INTO users VALUES('synthetic','2026-10-12T12:00:00Z','2026-10-16T12:00:00Z')");
    $original=$db->query('SELECT * FROM users')->fetch(PDO::FETCH_ASSOC);
    $db->exec('VACUUM INTO '.$db->quote($backup));
    $db->exec(file_get_contents(dirname(__DIR__).'/migrations/066_user_client_activity.sql'));
    if($db->query('SELECT * FROM users')->fetch(PDO::FETCH_ASSOC)!==$original)throw new RuntimeException('Migration rewrote legacy dates');
    if((int)$db->query('SELECT COUNT(*) FROM user_client_activity')->fetchColumn()!==0)throw new RuntimeException('Migration inferred past devices');
    // A code rollback keeps reading the original users schema and leaves new metadata intact.
    $db->exec("INSERT INTO user_client_activity VALUES('synthetic','android_app','2026-10-16T12:01:00Z',NULL)");
    if($db->query('SELECT last_login_at FROM users')->fetchColumn()!==$original['last_login_at'])throw new RuntimeException('Legacy read changed');
    $snapshot=new PDO('sqlite:'.$backup);
    if($snapshot->query('SELECT * FROM users')->fetch(PDO::FETCH_ASSOC)!==$original)throw new RuntimeException('Pre-migration backup changed');
    if($snapshot->query("SELECT name FROM sqlite_master WHERE name='user_client_activity'")->fetchColumn()!==false)throw new RuntimeException('Backup contains later writes');
    $snapshot=null;
    echo "Client activity migration: consistent backup, untouched historical dates, no inferred devices and old-code reads passed.\n";
} finally { if(is_file($backup))unlink($backup); }
