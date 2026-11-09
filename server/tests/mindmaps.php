<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('GENESIS_MINDMAPS_TEST') !== 'isolated') {
    fwrite(STDERR, "Explicit isolated test environment required.\n"); exit(1);
}
require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/../src/repository.php';
require __DIR__ . '/../src/shared-projects.php';
require __DIR__ . '/../src/mindmaps.php';
function mapExpect(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$testRoot = realpath(__DIR__ . '/../../output');
$dbPath = realpath((string)genesisConfig()['db_path']);
if (!$testRoot || !$dbPath || !str_starts_with(str_replace('\\', '/', $dbPath), str_replace('\\', '/', $testRoot) . '/') || basename($dbPath) !== 'mindmaps-test.sqlite') {
    throw new RuntimeException('This suite requires output/mindmaps-test.sqlite; refusing any other database.');
}
$db=genesisDb();
$ids=['mindmaps-test-owner-a','mindmaps-test-owner-b','mindmaps-test-free'];
// Existing lifetime members exercise storage/CAS independently of the Free map quota.
foreach($ids as $index=>$id) $db->prepare('INSERT INTO users(id,google_sub,email,subscription_plan,created_at,updated_at) VALUES(?,?,?,?,?,?)')->execute([$id,$id,$id.'@example.invalid',$index===2?'free':'premium4life',genesisNow(),genesisNow()]);
try {
 $payload=['schemaVersion'=>1,'expectedRevision'=>0,'operationId'=>'first','iv'=>base64_encode(random_bytes(12)),'ciphertext'=>base64_encode(random_bytes(64))];
 // Free allows one map and edits of that map, while rejecting a second creation.
 genesisSaveMindmap($ids[2],'free-map',$payload);
 try {genesisSaveMindmap($ids[2],'free-over-quota',$payload);throw new RuntimeException('Free second map accepted');}
 catch(GenesisResourceLimitException $e){mapExpect($e->status===403 && $e->getMessage()==='SUBSCRIPTION_QUOTA_mindmaps','Wrong Free quota rejection');}
 mapExpect(genesisSaveMindmap($ids[2],'free-map',[...$payload,'expectedRevision'=>1,'operationId'=>'free-edit'])['revision']===2,'Free quota blocked an existing-map edit');
 $saved=genesisSaveMindmap($ids[0],'map-one',$payload);mapExpect($saved['revision']===1,'Creation revision');
 mapExpect(genesisSaveMindmap($ids[0],'map-one',$payload)['revision']===1,'Lost-response retry created a revision');
 mapExpect(genesisMindmaps($ids[1])===[] && genesisMindmapHistory($ids[1],'map-one')===[],'Second account read first account');
 try {genesisSaveMindmap($ids[1],'map-one',[...$payload,'expectedRevision'=>1]);throw new RuntimeException('Foreign revision accepted');}catch(GenesisResourceLimitException $e){mapExpect($e->status===409,'Wrong owner conflict status');}
 try {genesisSaveMindmap($ids[0],'map-one',[...$payload,'operationId'=>'stale']);throw new RuntimeException('Stale revision accepted');}catch(GenesisResourceLimitException $e){mapExpect($e->getMessage()==='MAP_REVISION_CONFLICT','Wrong conflict');}
 foreach([['schemaVersion'=>0],['schemaVersion'=>3],['schemaVersion'=>'2'],['iv'=>'bad'],['ciphertext'=>'plaintext title'],['expectedRevision'=>-1]] as $invalid){try{genesisSaveMindmap($ids[0],'bad',[...$payload,...$invalid]);throw new RuntimeException('Invalid envelope accepted');}catch(InvalidArgumentException $expected){}}
 for($i=1;$i<=24;$i++) genesisSaveMindmap($ids[0],'map-one',[...$payload,'expectedRevision'=>$i,'operationId'=>'operation-'.$i]);
 mapExpect(count(genesisMindmapHistory($ids[0],'map-one'))===20,'History retention');
 $before=genesisMindmaps($ids[0]);
 $db->prepare('INSERT INTO workspace_blobs(user_id,ciphertext,iv,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext')->execute([$ids[0],base64_encode('old-client-workspace'),base64_encode(random_bytes(12)),1,genesisNow()]);
 mapExpect(genesisMindmaps($ids[0])===$before,'Old workspace erased maps');
 // A receipt is retained even after its snapshot leaves the 20-version window.
 mapExpect(genesisSaveMindmap($ids[0],'map-one',$payload)['revision']===1,'Old receipt lost');
 // A near-full history can rotate; an actual increase beyond the quota cannot.
 $large=[...$payload,'ciphertext'=>str_repeat('A',1_995_000)];
 for($i=0;$i<21;$i++) genesisSaveMindmap($ids[0],'large',[...$large,'expectedRevision'=>$i,'operationId'=>'large-'.$i]);
 mapExpect(count(genesisMindmapHistory($ids[0],'large'))===20,'Near-quota retention did not rotate');
 try {genesisSaveMindmap($ids[0],'over-quota',[...$payload,'ciphertext'=>str_repeat('A',200_000)]);throw new RuntimeException('Quota increase accepted');}
 catch(GenesisResourceLimitException $e){mapExpect($e->status===413 && $e->getMessage()==='MAP_STORAGE_LIMIT','Wrong quota rejection');}
 try {genesisDeleteMindmap($ids[1],'map-one',['expectedRevision'=>25]);throw new RuntimeException('Foreign deletion accepted');}catch(GenesisResourceLimitException $e){mapExpect($e->status===409,'Wrong deletion owner status');}
 try {genesisDeleteMindmap($ids[0],'map-one',['expectedRevision'=>24]);throw new RuntimeException('Stale deletion accepted');}catch(GenesisResourceLimitException $e){mapExpect($e->status===409,'Wrong deletion revision status');}
 $db->prepare('INSERT INTO personal_task_creations(user_id,task_id,state) VALUES(?,?,?)')->execute([$ids[0],'source-task','created']);
 mapExpect(genesisDeleteMindmap($ids[0],'map-one',['expectedRevision'=>25])['deleted']===true,'Deletion failed');
 mapExpect(genesisDeleteMindmap($ids[0],'map-one',['expectedRevision'=>25])['deleted']===true,'Lost deletion response was not idempotent');
 mapExpect(genesisMindmapHistory($ids[0],'map-one')===[],'Deleted history remains');
 mapExpect(count(genesisMindmaps($ids[0]))===1,'Deletion changed another map');
 mapExpect($db->query("SELECT state FROM personal_task_creations WHERE task_id='source-task'")->fetchColumn()==='created','Deletion erased source task creation state');
 try {genesisSaveMindmap($ids[0],'map-one',$payload);throw new RuntimeException('Delayed creation resurrected deleted map');}catch(GenesisResourceLimitException $e){mapExpect($e->status===409,'Wrong deleted-map save status');}
 mapExpect($db->query("SELECT ciphertext FROM workspace_blobs WHERE user_id='mindmaps-test-owner-a'")->fetchColumn()===base64_encode('old-client-workspace'),'Deletion changed personal tasks');
 echo "PASS: envelope validation, account isolation, CAS, retry receipt, 20-version retention, quota rotation, old-workspace compatibility, deletion isolation, source preservation, delayed-save protection\n";
} finally { foreach($ids as $id) $db->prepare('DELETE FROM users WHERE id=?')->execute([$id]); }
