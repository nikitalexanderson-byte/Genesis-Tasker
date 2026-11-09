import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertPublicDocumentReferences } from "./public-document-references.mjs";

const output = new URL("../dist-web/public_html/", import.meta.url);
const legalSource = await readFile(new URL("../app/legal-content.ts", import.meta.url), "utf8");
const revision = legalSource.match(/export const LEGAL_UPDATED = "([^"]+)"/)?.[1];
assert.ok(revision, "legal source revision is required");
const pages = {
  privacy: "Политика конфиденциальности",
  terms: "Пользовательское соглашение",
  support: "Поддержка GENESIS",
  "delete-account": "Удаление аккаунта и данных",
};
for (const [slug, title] of Object.entries(pages)) {
  const html = await readFile(new URL(`${slug}.html`, output), "utf8");
  const body = html.split("<body>")[1]?.split("</body>")[0];
  assert.ok(body, `${slug}: HTML body is required`);
  assert.ok(body.includes(`<h1>${title}</h1>`), `${slug}: document must be readable without JavaScript`);
  assert.ok(body.includes(revision), `${slug}: current revision is required`);
  assert.ok(body.includes("<section><h2>"), `${slug}: substantive sections are required`);
  assert.ok(body.includes('href="/privacy"') && body.includes('href="/terms"'), `${slug}: navigation is required`);
  assert.ok(html.includes(`rel="canonical" href="https://genesiscalendar.com/${slug}"`), `${slug}: canonical URL is required`);
  assert.match(html, /<script type="module"[^>]*src="[^"]+\.js"/, `${slug}: interactive client must remain available`);
  assertPublicDocumentReferences(html, slug);
  assert.doesNotMatch(body, /Логвинов|Logvinov|jurijjlogvinov@gmail\.com/i, `${slug}: retired personal identity must be absent`);
  if (slug === "privacy" || slug === "delete-account") {
    const retention = body.match(/<h2>Общие задачи и вложения после удаления аккаунта<\/h2><p>([\s\S]*?)<\/p>/)?.[1];
    assert.ok(retention, `${slug}: shared-data retention must be readable without JavaScript`);
    assert.match(retention, /после удаления аккаунта[\s\S]*вложения[\s\S]*сохраняться для других участников/i,
      `${slug}: account deletion must not promise deletion of other participants' shared files`);
    assert.match(retention, /передаче владения проектом/, `${slug}: ownership transfer must be explained`);
    assert.match(retention, /право редактирования задачи/, `${slug}: removing a file requires task edit rights`);
    for (const label of ["Редактировать", "Убрать файл", "Сохранить задачу", "Файлы задачи", "Убрать", "Сохранить"])
      assert.ok(retention.includes(`«${label}»`), `${slug}: existing file-removal action ${label} must be identified`);
    assert.match(retention, /резервные копии[\s\S]*ротации/, `${slug}: backup rotation must be explained`);
    assert.match(retention, /мгновенное стирание[\s\S]*не гарантируется/, `${slug}: instant backup erasure must not be promised`);
  }
  if (slug === "terms") {
    assert.ok(body.includes("ИНН 772495179010") && body.includes("Мой налог"), "terms: identify the NPD performer and receipts");
  }
  if (slug === "privacy") {
    assert.ok(body.includes("Hostinger") && body.includes("Google API Services User Data Policy"));
    assert.ok(body.length > 10000, "privacy: complete policy must be served in the initial response");
    assert.match(body, /Исполнитель услуг и оператор персональных данных GENESIS — Ляпин Никита Александрович[\s\S]*?nikitalexanderson@gmail\.com/, "privacy: identify the actual controller and service contact");
    assert.match(body, /Сайт, домен и хостинг принадлежат другому лицу; контакт по инфраструктуре: demiurge\.soft@gmail\.com/, "privacy: identify the separate infrastructure contact");
    assert.ok(body.includes("Дневник снов и диктовка") && body.includes("без аудиозаписи"), "privacy: dream storage and speech processing must be disclosed");
    assert.ok(body.includes("Платежи ЮKassa") && body.includes("Добровольные чаевые CloudTips"), "privacy: payment services must be disclosed");
  }
}
const homepage = await readFile(new URL("index.html", output), "utf8");
assert.match(homepage, /GENESIS[\s\S]*Календарь задач и проектов/);
assert.doesNotMatch(homepage, /mc\.yandex|yandex\.ru|яндекс/i);
assert.ok(homepage.includes("demiurge.soft@gmail.com") && homepage.includes("nikitalexanderson@gmail.com"));
assert.ok(homepage.includes("AI NCII") && homepage.includes("Google Calendar") && homepage.includes("Google Tasks"));
assert.doesNotMatch(homepage, /%GENESIS_SERVICE_IDENTITY%/, "public identity must resolve at build time");
console.log("Public homepage and four legal documents are readable without JavaScript; Google-only .com references verified.");
