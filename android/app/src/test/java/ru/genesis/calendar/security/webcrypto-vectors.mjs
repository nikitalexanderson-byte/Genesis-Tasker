// Synthetic interoperability reference, using the exact WebCrypto primitive in app/cloud-sync.ts.
// Run with Node 22+: node android/app/src/test/java/ru/genesis/calendar/security/webcrypto-vectors.mjs
import { webcrypto } from "node:crypto";
import { strict as assert } from "node:assert";
const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const recovery = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const iv = Uint8Array.from({ length: 12 }, (_, i) => 160 + i);
const plaintext = new TextEncoder().encode(JSON.stringify({ projects: [{ id: "fixture-project", title: "GENESIS — проверка 🔒" }], categories: [], taskListLinks: [], trackerSchemaVersion: 1 }));
const vectors = [
  ["workspace", key, plaintext, "nToMXyqhZ9wWFqXpXAHitxSOYzL03joY6XxDqw/ZGmu3FTPdgwAnVCvwYeozWMS8CV4VATHw+P7VftvhdfBVDmQOVdrhJTRaJFLf6BBaXpiwVoeGpqDtH4kaTPPU6W+u1NkHiXfP/PDSsnUkyeGDQ1dyW/WDGblIXa69z9EnoS6tdN0ehSfyZF42kKkoe+zZKEreyAc4p1y9IJQJqMDr"],
  ["recovery", recovery, key, "0opi4RaSabW86QMDfz6BRo5UdnsG7WMnAlmL+yMFrSgQDotgbJ5o9BTORUuMdKXG"],
];
for (const [name, raw, plain, expected] of vectors) {
  const imported = await webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const cipher = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, imported, plain);
  assert.equal(Buffer.from(cipher).toString("base64"), expected);
  const decoded = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, imported, Buffer.from(expected, "base64"));
  assert.deepEqual(new Uint8Array(decoded), plain);
  console.log(`${name}: WebCrypto encrypt/decrypt fixture PASS`);
}
