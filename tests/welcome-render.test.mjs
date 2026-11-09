import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { androidReleaseVersion, canOfferAndroidDownload } from "../app/android-install.ts";

test("Android download is offered to phone browsers without duplicating embedded app updates", () => {
  const phone = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
  assert.equal(canOfferAndroidDownload({ userAgent: phone }), true);
  assert.equal(canOfferAndroidDownload({ userAgent: phone, userAgentData: { platform: "Android", mobile: true } }), true);
  assert.equal(canOfferAndroidDownload({ userAgent: phone.replace("Pixel 9)", "Pixel 9; wv)") }), false);
  assert.equal(canOfferAndroidDownload({ userAgent: `${phone} GENESISNative/3.0.1` }), false);
  assert.equal(canOfferAndroidDownload({ userAgent: phone, userAgentData: { platform: "Android", mobile: false } }), false);
  assert.equal(canOfferAndroidDownload({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari/604.1" }), false);
  assert.equal(canOfferAndroidDownload({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36" }), false);
});

test("download version comes from a valid published stable manifest", () => {
  assert.equal(androidReleaseVersion({ versionName: "3.0.1" }), "3.0.1");
  assert.equal(androidReleaseVersion({ versionName: "2.9.7" }), "2.9.7");
  for (const manifest of [null, {}, "3.0.1", { versionName: "3.0.0-beta.5" }, { versionName: "<script>" }, { versionName: 301 }]) {
    assert.equal(androidReleaseVersion(manifest), null);
  }
});

test("anonymous welcome renders Google-only sign-in in every supported language", async () => {
  const entry = "virtual:welcome-render-test";
  const bundle = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [react(), {
      name: "welcome-render-entry",
      resolveId(id) { if (id === entry) return entry; },
      load(id) {
        if (id === entry) return `export { WelcomeScreen } from ${JSON.stringify(fileURLToPath(new URL("../app/WelcomeScreen.tsx", import.meta.url)).replaceAll("\\", "/"))}; export { LANGUAGES } from ${JSON.stringify(fileURLToPath(new URL("../app/i18n.ts", import.meta.url)).replaceAll("\\", "/"))}; export { AndroidDownload } from ${JSON.stringify(fileURLToPath(new URL("../app/AndroidDownload.tsx", import.meta.url)).replaceAll("\\", "/"))};`;
      },
    }],
    // Bundle the real component without Vite's dev module transport, which can
    // time out on the large locale catalogs on Windows. React stays shared with
    // the renderer, and the assertions below still cover every language.
    build: { ssr: true, write: false, minify: false,
      rolldownOptions: { input: entry, external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"], output: { codeSplitting: false } } },
  });
  const chunk = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((item) => item.output).find((item) => item.type === "chunk" && item.isEntry);
  assert.ok(chunk, "the real welcome component must build");
  const bundleDirectory = fileURLToPath(new URL("../node_modules/.cache/genesis-tests/", import.meta.url));
  await mkdir(bundleDirectory, { recursive: true });
  const bundlePath = path.join(bundleDirectory, `welcome-${randomUUID()}.mjs`);
  await writeFile(bundlePath, chunk.code);
  try {
    const { WelcomeScreen, AndroidDownload, LANGUAGES } = await import(pathToFileURL(bundlePath).href);
    for (const language of LANGUAGES) {
      const html = renderToStaticMarkup(createElement(WelcomeScreen, {
        nativeAndroidApkUrl: null, busy: false, error: "", language,
        onLanguageChange() {}, onGoogle() {},
      }));
      assert.ok(html.includes("GENESIS"), `${language}: public purpose must render`);
      assert.ok(html.includes("google-signin-light-pill.svg"), `${language}: Google sign-in must render`);
      assert.ok(html.includes('href="/privacy"') && html.includes('href="/terms"'), `${language}: public documents must remain linked`);
      assert.doesNotMatch(html, /yandex|яндекс|genesiscalendar\.ru/i, `${language}: obsolete public auth must be absent`);
      assert.doesNotMatch(html, /android-install-welcome/, `${language}: other devices have no Android promotion`);
      const androidWelcome = renderToStaticMarkup(createElement(WelcomeScreen, {
        nativeAndroidApkUrl: "/api/android/download", busy: false, error: "", language,
        onLanguageChange() {}, onGoogle() {},
      }));
      assert.match(androidWelcome, /href="\/api\/android\/download"/, `${language}: download uses the current published release`);
      assert.match(androidWelcome, /android-install-help/, `${language}: installation instructions can be expanded`);
      assert.doesNotMatch(androidWelcome, /TWA|3\.0\.1|удалите TWA|uninstall the TWA/i, `${language}: no obsolete migration or unreleased version`);
      const toolbar = renderToStaticMarkup(createElement(AndroidDownload, { href: "/api/android/download", language, toolbar: true }));
      assert.match(toolbar, /android-install-toolbar/, `${language}: signed-in workspace has the same installer`);
      assert.match(toolbar, /<button[^>]*aria-controls=[^>]*aria-expanded="false"/);
      assert.doesNotMatch(toolbar, /<section|<li>/, `${language}: closed toolbar keeps overlay content outside header layout`);
    }
  } finally {
    await rm(bundlePath);
  }
});
