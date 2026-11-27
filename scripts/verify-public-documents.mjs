import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertPublicDocumentReferences } from "./public-document-references.mjs";
import {verifyPublicLocales} from './verify-public-locales.mjs';

const output = new URL("../dist-web/public_html/", import.meta.url);
const legalSource = await readFile(new URL("../app/legal-content.ts", import.meta.url), "utf8");
const revision = legalSource.match(/export const LEGAL_UPDATED = "([^"]+)"/)?.[1];
assert.ok(revision, "legal source revision is required");
const publicCopy=JSON.parse(await readFile(new URL('../app/public-product-copy.json',import.meta.url),'utf8'));
const refundCopy=JSON.parse(await readFile(new URL('../app/refund-contact-copy.json',import.meta.url),'utf8'));
const pages = {
  privacy: "Политика конфиденциальности",
  terms: "Пользовательское соглашение",
  refund: publicCopy.ru.refund,
  support: "Поддержка GENESIS",
  "delete-account": "Удаление аккаунта и данных",
};
for (const [slug, title] of Object.entries(pages)) {
  const html = await readFile(new URL(`_public-locales/ru/${slug}.html`, output), "utf8");
  const body = html.split("<body>")[1]?.split("</body>")[0];
  assert.ok(body, `${slug}: HTML body is required`);
  assert.ok(body.includes(`<h1>${title}</h1>`), `${slug}: document must be readable without JavaScript`);
  assert.ok(body.includes(revision), `${slug}: current revision is required`);
  assert.ok(body.includes("<section><h2>"), `${slug}: substantive sections are required`);
  assert.ok(body.includes('href="/privacy?lang=ru"') && body.includes('href="/terms?lang=ru"'), `${slug}: navigation is required`);
  assert.ok(html.includes(`rel="canonical" href="https://genesiscalendar.com/${slug}?lang=ru"`), `${slug}: canonical URL is required`);
  assert.match(html, /<script type="module"[^>]*src="[^"]+\.js"/, `${slug}: interactive client must remain available`);
  assertPublicDocumentReferences(html, slug);
  assert.match(body, /Владелец домена и хостинга — Юрий Логвинов/, `${slug}: infrastructure owner must be named accurately`);
  assert.match(body, /Создатель сайта и приложения, основатель GENESIS — Ляпин Никита Александрович/, `${slug}: creator must be named separately`);
  assert.doesNotMatch(body, /для США отвечает Юрий Логвинов/, `${slug}: retired split seller role`);
  assert.doesNotMatch(body, /Owned and operated by|GENESIS is owned by|Сайт, домен и хостинг принадлежат другому лицу/, `${slug}: obsolete ownership claims must be absent`);
  assert.match(body, /demiurge\.soft@gmail\.com/, `${slug}: infrastructure contact is required`);
  assert.doesNotMatch(body, /jurijjlogvinov@gmail\.com/i, `${slug}: retired contact must be absent`);
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
    assert.match(body, /Владелец домена и хостинга — Юрий Логвинов \(Iurii Logvinov\)\. Контакт по инфраструктуре: demiurge\.soft@gmail\.com/, "privacy: identify the separate infrastructure owner and contact");
    assert.ok(body.includes("Дневник снов и диктовка") && body.includes("без аудиозаписи"), "privacy: dream storage and speech processing must be disclosed");
    assert.ok(body.includes("Платежи ЮKassa") && body.includes("Добровольные чаевые CloudTips"), "privacy: payment services must be disclosed");
  }
}
const homepage = await readFile(new URL("index.html", output), "utf8");
assert.match(homepage, /GENESIS[\s\S]*Task and project calendar/);
assert.doesNotMatch(homepage, /mc\.yandex|yandex\.ru|яндекс/i);
assert.ok(homepage.includes("demiurge.soft@gmail.com") && homepage.includes('href="/support"'));
assert.ok(homepage.includes("AI NCII") && homepage.includes("Google Calendar") && homepage.includes("Google Tasks"));
assert.doesNotMatch(homepage, /%GENESIS_SERVICE_IDENTITY%/, "public identity must resolve at build time");
const hostingRules=await readFile(new URL(".htaccess",output),"utf8");
const checkoutRules=hostingRules.match(/<Files "pay-paddle\.html">([\s\S]*?)<\/Files>/)?.[1];
assert.ok(checkoutRules,"Paddle checkout policy must match the served file even when the URL has a query");
const checkoutPolicy=checkoutRules.match(/^\s*Header always set Content-Security-Policy "([^"\n]+)"\s*$/m)?.[1];
assert.ok(checkoutPolicy,"Paddle checkout policy must apply to every request for its file");
assert.match(checkoutPolicy,/script-src [^;]*https:\/\/cdn\.paddle\.com;/);
assert.match(checkoutPolicy,/style-src [^;]*https:\/\/cdn\.paddle\.com;/);
assert.match(checkoutPolicy,/frame-src https:\/\/\*\.paddle\.com$/);
assert.doesNotMatch(hostingRules.replace(checkoutRules,""),/paddle\.com/,"Paddle origins must stay scoped to checkout");
await verifyPublicLocales(output);
assert.deepEqual(Object.keys(refundCopy).sort(),Object.keys(publicCopy).sort());
for(const language of Object.keys(refundCopy)){
  const html=await readFile(new URL(language==='en'?'refund.html':`_public-locales/${language}/refund.html`,output),'utf8');
  const contact=html.match(/<div data-refund-contacts>(.*?)<\/div>/s)?.[1];
  const encodedContact = refundCopy[language].replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
  assert.ok(contact?.includes(encodedContact),`${language}: localized refund instructions are required`);
  for(const address of ['nikitalexanderson@gmail.com','demiurge.soft@gmail.com'])
    assert.ok(contact.includes(`href="mailto:${address}"`),`${language}: refund contact ${address} is required`);
}
console.log("Unified Russian documents and English homepage preserve all existing disclosures; localized public HTML and Google-only .com references verified.");
