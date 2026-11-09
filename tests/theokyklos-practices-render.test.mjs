import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";

test("real Oracle practices distinguish restore from resume and show one shared deadline warning", async () => {
  const root = fileURLToPath(new URL("../app/", import.meta.url)).replaceAll("\\", "/");
  const entry = "virtual:theokyklos-practices-render";
  const bundle = await build({
    configFile: false, logLevel: "silent",
    plugins: [react(), {
      name: "theokyklos-practices-render-entry",
      resolveId: id => id === entry ? entry : undefined,
      load: id => id === entry ? `
        export { TheokyklosDetailsDialog } from ${JSON.stringify(root + "TheokyklosDetailsDialog.tsx")};
        export { THEOKYKLOS_SEGMENTS } from ${JSON.stringify(root + "theokyklos-data.ts")};
        export { SACRED_PRACTICES } from ${JSON.stringify(root + "sacred-practices.ts")};
        export { EMPTY_HABIT_WORKSPACE, createHabitFromSacredPractice, applyHabitLifecycleToWorkspace, habitDateKey } from ${JSON.stringify(root + "habits.ts")};
        export { habitLifecycleState, projectHabitLifecycle } from ${JSON.stringify(root + "habit-lifecycle.ts")};
        export { setRuntimeLanguage } from ${JSON.stringify(root + "i18n.ts")};
      ` : undefined,
    }],
    build: { ssr: true, write: false, rolldownOptions: {
      input: entry, external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"], output: { codeSplitting: false },
    } },
  });
  const directory = new URL("../node_modules/.cache/genesis-tests/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`theokyklos-practices-${randomUUID()}.mjs`, directory);
  await writeFile(file, bundle.output.find(item => item.isEntry).code);
  try {
    const api = await import(pathToFileURL(fileURLToPath(file)).href);
    const segment = api.THEOKYKLOS_SEGMENTS.find(row => row.id === "north");
    const practices = api.SACRED_PRACTICES.filter(row => row.sectorId === segment.id);
    assert.equal(practices.length, 2, "the fixture must exercise two suggested cards");
    const date = api.habitDateKey(new Date());
    const render = (workspace, language) => {
      api.setRuntimeLanguage(language);
      const before = JSON.stringify(workspace);
      const html = renderToStaticMarkup(createElement(api.TheokyklosDetailsDialog, {
        segment, language, workspace, date, calendarMode: "profane", onChange() {}, onClose() {},
      }));
      assert.equal(JSON.stringify(workspace), before, "rendering must not change stored practice data");
      return html;
    };
    for (const language of ["ru", "en"]) {
      const empty = structuredClone(api.EMPTY_HABIT_WORKSPACE);
      const suggestions = render(empty, language);
      assert.equal((suggestions.match(/<article\b/g) ?? []).length, 2);
      assert.equal((suggestions.match(/class="theokyklos-practice-notice"/g) ?? []).length, 1,
        `${language}: one deadline warning belongs to the whole suggested list`);
      assert.equal((suggestions.match(new RegExp(`>${language === "ru" ? "Начать" : "Begin"}</button>`, "g")) ?? []).length, 2);

      const habit = api.createHabitFromSacredPractice(practices[0], date, "profane", language);
      const workspace = { ...structuredClone(empty), habits: [habit] };
      const change = (value, action, id) => api.applyHabitLifecycleToWorkspace(value, {
        id, habitId: habit.id, action, at: new Date().toISOString(),
        heads: api.habitLifecycleState(value.habits[0]).heads.map(row => row.id),
      });
      for (const [action, expected] of [["archive", "archived"], ["delete", "deleted"], ["pause", "paused"]]) {
        const inactive = change(workspace, action, `${language}:${action}`);
        assert.equal(api.habitLifecycleState(inactive.habits[0]).status, expected);
        const html = render(inactive, language);
        const label = expected === "paused" ? language === "ru" ? "Включить снова" : "Enable again"
          : language === "ru" ? "Восстановить" : "Restore";
        assert.ok(html.includes(`>${label}</button>`), `${language}/${expected}: the available action must match the lifecycle`);
        assert.doesNotMatch(html, /class="theokyklos-practice-notice"/);
        const restored = change(inactive, expected === "paused" ? "resume" : "restore", `${language}:${action}:return`);
        assert.equal(api.habitLifecycleState(restored.habits[0]).status, expected === "paused" ? "active" : "paused",
          "restore must preserve the separate consent to resume scheduling");
        assert.equal(restored.habits[0].id, habit.id, "restore must retain the original practice identity");
      }

      const paused = change(workspace, "pause", `${language}:conflict-pause`);
      const archived = change(workspace, "archive", `${language}:conflict-archive`);
      const conflict = { ...workspace, habits: [api.projectHabitLifecycle({ ...habit,
        lifecycleHistory: [...paused.habits[0].lifecycleHistory, ...archived.habits[0].lifecycleHistory] })] };
      assert.equal(api.habitLifecycleState(conflict.habits[0]).conflict, true);
      const label = language === "ru" ? "Восстановить" : "Restore";
      assert.match(render(conflict, language), new RegExp(`<button\\b[^>]*disabled=""[^>]*>${label}</button>`),
        "a conflicting lifecycle must be resolved before restoration");
    }
  } finally {
    await rm(file);
  }
});
