import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";

test("real Stoicheion keeps existing seed vectors and the localized modeling entry requires actual saved cards", async () => {
  const root = fileURLToPath(new URL("../app/", import.meta.url)).replaceAll("\\", "/");
  const entry = "virtual:stoicheion-timeline-render";
  const bundle = await build({ configFile: false, logLevel: "silent", define: { "process.env.NEXT_PUBLIC_GENESIS_API_URL": '""' },
    plugins: [react(), { name: "stoicheion-timeline-render", resolveId: id => id === entry ? entry : undefined,
      load: id => id === entry ? `
        export { StoicheionView, buildStoicheionSpreadReading } from ${JSON.stringify(root + "StoicheionView.tsx")};
        export { FutureModelingGuideDialog, FutureModelingGuide } from ${JSON.stringify(root + "FutureModelingGuide.tsx")};
        export { StoicheionTimelineHelp } from ${JSON.stringify(root + "StoicheionTimelineHelp.tsx")};
        export { futureModelingCopy } from ${JSON.stringify(root + "future-modeling.ts")};
        export { stoicheionTimelineCopy } from ${JSON.stringify(root + "stoicheion-timeline.ts")};
        export { setRuntimeLanguage } from ${JSON.stringify(root + "i18n.ts")};
        export { FeatureAccessContext } from ${JSON.stringify(root + "FeatureAccessContext.tsx")};
        export { snapshotFromSavedDraw,expectedSourceDraw } from ${JSON.stringify(root + "aurora/draw-policy.ts")};
        export { REGION_LANGUAGES } from ${JSON.stringify(root + "region-language.ts")};
        export { default as alphabetCopy } from ${JSON.stringify(root + "stoicheion-alphabet-copy.json")};
      ` : undefined }],
    build: { ssr: true, write: false, rolldownOptions: { input: entry,
      external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"], output: { codeSplitting: false } } },
  });
  const directory = new URL("../node_modules/.cache/genesis-tests/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`stoicheion-timeline-${randomUUID()}.mjs`, directory);
  await writeFile(file, bundle.output.find(item => item.isEntry).code);
  try {
    const api = await import(pathToFileURL(fileURLToPath(file)).href);
    const cards = Array.from({ length: 24 }, (_, index) => index);
    const full = api.buildStoicheionSpreadReading(cards, 0x12345678);
    assert.deepEqual(full.map(card => card.letter), [11, 9, 2, 19, 17, 13, 10, 20, 18]);
    assert.deepEqual(full.map(card => card.reversed), [false, true, false, true, false, false, true, true, true]);
    const triple = api.buildStoicheionSpreadReading(cards, 0x12345678, 3);
    assert.deepEqual(triple, full.slice(0, 3));
    assert.deepEqual(api.buildStoicheionSpreadReading(cards, 0xffffffff, 3).map(card => card.letter), [20, 5, 1]);
    for (const seed of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      const result = api.buildStoicheionSpreadReading(cards, seed, 3);
      assert.equal(result.length, 3);
      assert.equal(new Set(result.map(card => card.letter)).size, 3);
      assert.ok(result.every(card => typeof card.reversed === "boolean"));
      assert.deepEqual(api.buildStoicheionSpreadReading(cards, seed, 3), result);
    }
    assert.equal(api.buildStoicheionSpreadReading([], 0, 3).length, 0);
    const primary=api.snapshotFromSavedDraw({id:'saved-nine',seed:2,day:'2026-11-06',createdAt:'2026-11-06T09:00:00Z',cards:api.expectedSourceDraw(2)});
    for(const plan of ['free','standart','premium','business','premium4life']) {
      const entitled=['premium','business','premium4life'].includes(plan);
      const access={schemaVersion:1,policyRevision:'test',enforcementEnabled:true,declaredPlan:plan,effectivePlan:plan,lifetimePremium:plan==='premium4life',validUntil:'2999-01-01T00:00:00Z',evaluatedAt:'2026-11-06T09:00:00Z',allowedFeatures:entitled?['future-modeling']:[],freeFeatures:[]};
      const render=(saved)=>renderToStaticMarkup(createElement(api.FeatureAccessContext.Provider,{value:access},createElement(api.FutureModelingGuide,{language:'en',userId:'synthetic-owner',primary:saved})));
      assert.equal(render(null).includes('future-modeling-open'),false,plan+': no source');
      assert.equal(render(primary).includes('future-modeling-open'),entitled,plan+': Premium+ gate');
    }
    for (const language of api.REGION_LANGUAGES) {
      api.setRuntimeLanguage(language);
      const page = renderToStaticMarkup(createElement(api.StoicheionView));
      const timelineIndex = page.indexOf('aria-labelledby="stoicheion-timeline-title"');
      const guideIndex = page.indexOf('data-testid="future-modeling-open"');
      const alphabetIndex = page.indexOf('data-testid="stoicheion-alphabet-disclosure"');
      assert.ok(timelineIndex > 0 && timelineIndex < alphabetIndex && guideIndex === -1, `${language}: placement`);
      const alphabet = page.match(/<details\b([^>]*data-testid="stoicheion-alphabet-disclosure"[^>]*)>([\s\S]*?)<\/details>/);
      assert.ok(alphabet, `${language}: alphabet uses native disclosure`);
      assert.doesNotMatch(alphabet[1], /\bopen(?:=|\s|$)/, `${language}: alphabet starts collapsed`);
      assert.match(alphabet[2], /<summary\b[^>]*data-testid="stoicheion-alphabet-toggle"/, `${language}: native keyboard toggle`);
      assert.ok(alphabet[2].includes(api.alphabetCopy[language].title), `${language}: disclosure title`);
      assert.equal((alphabet[2].match(/<button\b/g) ?? []).length, 24, `${language}: all alphabet cards retained`);
      const helpIndex = page.indexOf('data-testid="stoicheion-timeline-help"');
      assert.ok(helpIndex > timelineIndex && helpIndex < alphabetIndex, `${language}: instructions follow three face-down cards`);
      assert.equal((page.match(/data-testid="stoicheion-timeline-(past|present|future)"/g)??[]).length,3);
      assert.equal((page.match(/data-revealed="false"/g)??[]).length,3);
      assert.doesNotMatch(page,/data-testid="stoicheion-timeline-reroll"/);
      assert.doesNotMatch(page, /<details class="stoicheion-timeline-method"/, language);
      assert.ok(page.includes(api.stoicheionTimelineCopy(language).title), `${language}: timeline title`);
      const help = renderToStaticMarkup(createElement(api.StoicheionTimelineHelp, { language, onClose() {} }));
      assert.match(help, /role="dialog" aria-modal="true"/, language);
      assert.equal((help.match(/<p>/g) ?? []).length, api.stoicheionTimelineCopy(language).paragraphs.length, language);
      const guide = renderToStaticMarkup(createElement(api.FutureModelingGuideDialog, { language, onClose() {} }));
      assert.match(guide, new RegExp(`lang="${language}"`));
      assert.doesNotMatch(guide, /data-modeling-sector=|data-modeling-goal=/, `${language}: no invented draw`);
      const oriented=renderToStaticMarkup(createElement(api.FutureModelingGuideDialog,{language,onClose(){},orientations:[false,true,false,true,false,false,true,true,true]}));
      assert.equal(oriented,guide,`${language}: anonymous orientation booleans cannot become card instances`);
      assert.doesNotMatch(guide,/1 \+ 20|993|510|isopsephy|κ_K|ScenarioScore|SupportIndex/,`${language}: computation stays internal`);
      assert.doesNotMatch(guide, /1093|undefined|\[object Object\]/, language);
      assert.ok(guide.includes(api.futureModelingCopy(language).title), `${language}: guide title`);
    }
  } finally { await rm(file, { force: true }); }
});
