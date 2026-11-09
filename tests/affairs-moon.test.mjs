import assert from "node:assert/strict";
import test from "node:test";
import { matchesAffair } from "../app/affairs-search.ts";
import { restoredSharedProject, sharedProjectTree, sharedProjectDestinations } from "../app/shared-expansion.ts";
import { createMessagingIdentity, conversationKey, encryptPrivateMessage, decryptPrivateMessage, exportMessagingBackup, importMessagingBackup, securityCode, encryptPrivateFile, decryptPrivateFile, decodePrivateContent, PRIVATE_FILE_LIMIT } from "../app/private-message-crypto.ts";
import { collaborationCopy, collaborationText } from "../app/collaboration-copy.ts";

test("private messages authenticate both peers, context, revisions and encrypted key recovery", async () => {
  const [alice,bob,eve]=await Promise.all([createMessagingIdentity(),createMessagingIdentity(),createMessagingIdentity()]);
  const [a,b,e]=await Promise.all([conversationKey(alice,bob.publicKey,'conversation','space'),conversationKey(bob,alice.publicKey,'conversation','space'),conversationKey(eve,alice.publicKey,'conversation','space')]);
  const context={conversationId:'conversation',spaceId:'space',id:'message',senderId:'alice',revision:1},ids={alice:alice.keyId,bob:bob.keyId};
  const payload=await encryptPrivateMessage(a,context,'Только двое · 私信 · Ελληνικά',ids);
  assert.equal(await decryptPrivateMessage(b,context,payload,ids),'Только двое · 私信 · Ελληνικά');
  assert.equal(await decryptPrivateMessage(a,context,payload,ids),'Только двое · 私信 · Ελληνικά');
  await assert.rejects(()=>decryptPrivateMessage(e,context,payload,ids));
  for(const change of [{spaceId:'other'},{conversationId:'other'},{id:'other'},{senderId:'bob'},{revision:2}])await assert.rejects(()=>decryptPrivateMessage(b,{...context,...change},payload,ids));
  await assert.rejects(()=>decryptPrivateMessage(b,context,{...payload,ciphertext:(payload.ciphertext[0]==='A'?'B':'A')+payload.ciphertext.slice(1)},ids));
  const revised=await encryptPrivateMessage(a,{...context,revision:2},'Исправлено',ids);assert.notEqual(revised.iv,payload.iv);
  assert.equal(await decryptPrivateMessage(b,{...context,revision:2},revised,ids),'Исправлено');
  assert.equal(await securityCode([alice.keyId,bob.keyId]),await securityCode([bob.keyId,alice.keyId]));
  const backup=await exportMessagingBackup(alice,'correct horse battery staple');
  assert.ok(!backup.includes('"d"'));await assert.rejects(()=>importMessagingBackup(backup,'wrong password longer than 12'));
  const restored=await importMessagingBackup(backup,'correct horse battery staple');assert.equal(restored.keyId,alice.keyId);
  const recovered=await conversationKey(restored,bob.publicKey,'conversation','space');assert.equal(await decryptPrivateMessage(recovered,context,payload,ids),'Только двое · 私信 · Ελληνικά');
});
test("collaboration copy explicitly covers all fourteen supported languages", () => {
  const locales=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
  for(const [key,rows] of Object.entries(collaborationCopy)){
    assert.equal(rows.length,14,key);
    for(const [index,locale] of locales.entries()){assert.ok(rows[index].trim(),`${locale}/${key}`);assert.equal(collaborationText(key,locale),rows[index]);if(!['ru','sr','uk'].includes(locale))assert.doesNotMatch(rows[index],/[А-Яа-яЁё]/u,`${locale}/${key}`);}
  }
});

test("private files authenticate content and conversation, keep names encrypted and survive message edits", async () => {
  const [alice,bob,eve]=await Promise.all([createMessagingIdentity(),createMessagingIdentity(),createMessagingIdentity()]);
  const [a,b,e]=await Promise.all([conversationKey(alice,bob.publicKey,'chat','space'),conversationKey(bob,alice.publicKey,'chat','space'),conversationKey(eve,alice.publicKey,'chat','space')]);
  const context={conversationId:'chat',spaceId:'space',id:'message',senderId:'alice',revision:1};
  const source=crypto.getRandomValues(new Uint8Array(65536)),file=new File([source,source,source,source,source],'Приватный документ.bin');
  const encrypted=await encryptPrivateFile(a,context,file);
  assert.equal(encrypted.chunks.length,2);
  assert.deepEqual(new Uint8Array(await (await decryptPrivateFile(b,{...context,revision:2},encrypted.metadata,encrypted.chunks)).arrayBuffer()),new Uint8Array(await file.arrayBuffer()));
  for(const changes of [{id:'other'},{senderId:'bob'},{conversationId:'other'},{spaceId:'other'}])await assert.rejects(()=>decryptPrivateFile(b,{...context,...changes},encrypted.metadata,encrypted.chunks));
  await assert.rejects(()=>decryptPrivateFile(e,context,encrypted.metadata,encrypted.chunks));
  await assert.rejects(()=>decryptPrivateFile(b,context,encrypted.metadata,[encrypted.chunks[1],encrypted.chunks[0]]));
  const ids={alice:alice.keyId,bob:bob.keyId},body=JSON.stringify({format:'genesis-private-content',text:'Файл',files:[encrypted.metadata]}),payload=await encryptPrivateMessage(a,context,body,ids);
  assert.ok(!JSON.stringify(payload).includes(file.name));
  assert.equal(decodePrivateContent(await decryptPrivateMessage(b,context,payload,ids)).files[0].name,file.name);
  assert.equal(decodePrivateContent('old text').text,'old text');
  const empty=await encryptPrivateFile(a,context,new File([],'empty.txt'));assert.equal((await decryptPrivateFile(b,context,empty.metadata,empty.chunks)).size,0);
  await assert.rejects(()=>encryptPrivateFile(a,context,new File([new Uint8Array(PRIVATE_FILE_LIMIT+1)],'oversized')));
});

test("project picker keeps descendants with parents and includes orphaned or cyclic projects once", () => {
  const projects = [{ id: "grandchild", parentId: "child", taskCount: 2 }, { id: "root", taskCount: 3 },
    { id: "other" }, { id: "child", parentId: "root", taskCount: 1 }, { id: "inbox", isInbox: 1 },
    { id: "orphan", parentId: "missing" }, { id: "a", parentId: "b" }, { id: "b", parentId: "a" }];
  const tree = sharedProjectTree(projects);
  assert.deepEqual(tree.map(({project, depth}) => [project.id, depth]),
    [["root", 0], ["child", 1], ["grandchild", 2], ["other", 0], ["orphan", 0], ["a", 0], ["b", 1]]);
  assert.equal(tree[2].project.taskCount, 2);
  assert.equal(projects.length, 8);
});

test("transfer destinations retain the full ancestry after filtering writable rows", () => {
  const projects = [{ id: "leaf", title: "Stage", parentId: "child", role: "member" },
    { id: "root", title: "Project", role: "viewer" }, { id: "child", title: "Subproject", parentId: "root", role: "member" },
    { id: "inbox", title: "Inbox", isInbox: 1, role: "member" }];
  const rows = sharedProjectDestinations(projects).filter(row => row.project.role !== "viewer");
  assert.deepEqual(rows.map(row => [row.project.id, row.depth, row.path]),
    [["inbox", 0, "Inbox"], ["child", 1, "Project › Subproject"], ["leaf", 2, "Project › Subproject › Stage"]]);
  assert.equal(projects[0].parentId, "child");
});

test("transfer paths handle missing ancestors and cycles without duplicating destinations", () => {
  const projects = [{ id: "orphan", title: "Orphan", parentId: "missing" },
    { id: "a", title: "A", parentId: "b" }, { id: "b", title: "B", parentId: "a" }];
  const rows = sharedProjectDestinations(projects);
  assert.equal(new Set(rows.map(row => row.project.id)).size, 3);
  assert.equal(rows[0].path, "Orphan");
  assert.ok(rows.every(row => row.path.split(" › ").length <= 2));
});
import { normalizeMoonReminderSettings, planMoonReminders } from "../app/moon-reminders.ts";
import "./shared-gantt-reading.test.mjs";
import "./habit-quality.test.mjs";

test("shared tree restores visible paths and skips hidden children, inboxes and deleted projects", () => {
  const projects = [{ id: "root" }, { id: "child", parentId: "root" }, { id: "inbox", isInbox: true }];
  assert.equal(restoredSharedProject(projects, []), "");
  assert.equal(restoredSharedProject(projects, ["child"]), "");
  assert.equal(restoredSharedProject(projects, ["root", "child", "inbox", "deleted"]), "child");
  assert.equal(restoredSharedProject([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], ["a", "b"]), "");
});

test("live affair search combines partial names and tags, with explicit #tag semantics", () => {
  const project = { title: "Разработка сайта", tags: ["Генезис", "работа"] };
  assert.equal(matchesAffair(project, "разр"), true);
  assert.equal(matchesAffair(project, "РАЗР #ген"), true);
  assert.equal(matchesAffair(project, "#разработка"), false);
  assert.equal(matchesAffair(project, "разр #дом"), false);
  assert.equal(matchesAffair({ title: "Всё готово" }, "все"), true);
});
test("moon settings validate, deduplicate and keep independent choices", () => {
  assert.deepEqual(normalizeMoonReminderSettings({ full: [3, 1, 3, 0, 9], new: [2] }), { full: [1, 3], new: [2] });
  assert.deepEqual(normalizeMoonReminderSettings(null), { full: [], new: [] });
});
test("October phases produce individual reminders at 09:00 local, with no past entries", () => {
  const after = new Date(2026, 9, 7, 0);
  const plans = planMoonReminders(after, { full: [1, 2, 3], new: [1, 2, 3] }, 30);
  assert.equal(plans.length, 6);
  assert.deepEqual(plans.map((plan) => plan.eventDate), ["2026-10-10", "2026-10-10", "2026-10-10", "2026-10-26", "2026-10-26", "2026-10-26"]);
  assert.ok(plans.every((plan) => plan.at.getHours() === 9 && plan.at.getMinutes() === 0 && plan.at > after));
  assert.equal(new Set(plans.map((plan) => plan.key)).size, 6);
  assert.deepEqual(planMoonReminders(after, { full: [], new: [] }), []);
  assert.ok(planMoonReminders(new Date(2026, 9, 9, 10), { full: [], new: [1, 2, 3] }, 2).length === 0);
});
