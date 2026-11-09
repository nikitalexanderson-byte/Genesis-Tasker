import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const spelling = JSON.parse(readFileSync(new URL("../app/dictation-copy.json", import.meta.url), "utf8")).ru;
const escape = value => value.replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
const disclosure = `<section><h2>${escape(spelling.legalTitle)}</h2><p>${escape(spelling.legalBody)}</p></section>`;

/** The approved spelling disclosure is the only Yandex reference allowed in the
 * public documents. Old domains/hosting remain prohibited even inside it. */
export function assertPublicDocumentReferences(html, slug) {
  assert.doesNotMatch(html, /genesiscalendar\.ru|beget/i, `${slug}: retired domain/hosting references must be absent`);
  let rest = html;
  if (slug === "privacy" || slug === "terms") {
    assert.ok(html.includes(disclosure), `${slug}: the complete optional spelling disclosure must be readable without JavaScript`);
    rest = html.replace(disclosure, "");
  }
  assert.doesNotMatch(rest, /yandex|яндекс/i, `${slug}: only the exact spelling disclosure may mention Yandex; obsolete public auth must remain absent`);
}
