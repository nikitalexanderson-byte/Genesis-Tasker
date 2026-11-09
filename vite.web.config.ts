import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { LEGAL_UPDATED, legalPages } from "./app/legal-content";
import { BACKUP_LEGAL_READY, BACKUP_LEGAL_VERSION } from './app/backup-legal';
import feedbackAudioManifest from "./public/feedback-audio/manifest.json";
import mindmapIconCatalog from "./app/mindmap-icon-catalog.json";
import moodFaces from "./app/mood-faces.json";
import { SERVICE_IDENTITY } from "./app/public-service";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const configuredBase = process.env.GENESIS_BASE_PATH?.trim() || "/";
const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
const apiUrl = process.env.GENESIS_API_URL?.trim() || `${base.replace(/\/$/, "")}/api`;
const PRECACHE_STATIC_REVISION = "lunar-cool-calendar-art-v8";

/** Source phrases are identical across locales; ship them once instead of in every UI dictionary. */
function compactUiLocaleTransport(): Plugin {
  const languages = ["en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
  const catalogs = new Map(languages.map(language => [language, JSON.parse(readFileSync(path.join(projectRoot, "app/ui-translations", `${language}.json`), "utf8")) as Record<string, string>]));
  const keys = [...new Set([...catalogs.values()].flatMap(Object.keys))];
  const prefix = "\0genesis-ui-translations/";
  return {
    name: "genesis-compact-ui-locale-transport", apply: "build", enforce: "pre",
    resolveId(source) {
      if (source === "genesis-ui-source-phrases") return "\0genesis-ui-source-phrases";
      const language = source.match(/(?:^|[\\/])ui-translations[\\/]([a-z]{2})\.json$/)?.[1];
      if (language && catalogs.has(language)) return `${prefix}${language}.json.js`;
    },
    load(id) {
      if (id === "\0genesis-ui-source-phrases") return `const keys=${JSON.stringify(keys)};export function restore(values){return Object.fromEntries(keys.flatMap((key,i)=>values[i]===null?[]:[[key,values[i]]]))}`;
      if (id.startsWith(prefix)) {
        const catalog = catalogs.get(id.slice(prefix.length, -8));
        if (catalog) return `import {restore} from 'genesis-ui-source-phrases';export default restore(${JSON.stringify(keys.map(key => catalog[key] ?? null))});`;
      }
    },
  };
}

function publicLegalDocuments(): Plugin {
  const escape = (text: string) => text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
  return {
    name: "genesis-public-legal-documents",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace("%GENESIS_SERVICE_IDENTITY%", escape(SERVICE_IDENTITY.ru));
    },
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset" || typeof index.source !== "string") {
        this.error("The public homepage must be built before legal documents.");
      }
      const template = index.source;
      const root = /<div id="root">[\s\S]*<\/div>/;
      if (!root.test(template)) this.error("Public homepage root is missing.");
      for (const [slug, document] of Object.entries(legalPages)) {
        const sections = document.sections.map(([title, body]) =>
          `<section><h2>${escape(title)}</h2><p>${escape(body)}</p></section>`).join("\n");
        const markup = `<div id="root"><main class="legal-shell">
          <header class="legal-header"><a class="welcome-brand" href="/"><span class="solar-mark"><i></i></span><span><strong>GENESIS</strong><small>доверие и ясность</small></span></a><a href="/">← На главную</a></header>
          <article class="legal-document"><span class="welcome-kicker">ОФИЦИАЛЬНЫЙ ДОКУМЕНТ</span><h1>${escape(document.title)}</h1><p class="legal-intro">${escape(document.intro)}</p><p class="legal-date">Редакция от ${escape(LEGAL_UPDATED)}</p>${!BACKUP_LEGAL_READY && (slug==='privacy'||slug==='terms')?`<p role="note">Проект редакции ${escape(BACKUP_LEGAL_VERSION)}. Дополнения для 3.2.2 ещё не готовы к публикации: требуются подтверждение юридических фактов и приёмка отключённых функций.</p>`:''}${sections}
          ${slug === "privacy" ? '<p class="legal-policy-link"><a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a></p>' : ""}</article>
          <footer class="legal-footer"><a href="/privacy">Конфиденциальность</a><a href="/terms">Соглашение</a><a href="/support">Поддержка</a><a href="/delete-account">Удаление аккаунта</a></footer>
        </main></div>`;
        const source = template.replace(root, markup)
          .replace(/<title>[^<]*<\/title>/, `<title>${escape(document.title)} · GENESIS</title>`)
          .replace(/(<meta name="description" content=")[^"]*("\s*\/?\s*>)/, `$1${escape(document.intro)}$2`)
          .replace('href="https://genesiscalendar.com/"', `href="https://genesiscalendar.com/${slug}"`);
        this.emitFile({ type: "asset", fileName: `${slug}.html`, source });
      }
    },
  };
}

function offlinePrecacheManifest(basePath: string): Plugin {
  return {
    name: "genesis-offline-precache-manifest",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const requiredFiles = Object.values(bundle)
        .map((output) => output.fileName)
        .filter((fileName) => /\.(?:js|css)$/i.test(fileName))
        .sort();
      if (!requiredFiles.length) this.error("Offline precache manifest has no JavaScript or CSS assets.");
      const fonts = ["fonts/SourceSans3.woff2", "fonts/Literata.woff2",
        "fonts/experimental/Inter-cyrillic-ext.woff2",
        "fonts/experimental/Inter-cyrillic.woff2",
        "fonts/experimental/Inter-greek-ext.woff2",
        "fonts/experimental/Inter-greek.woff2",
        "fonts/experimental/Inter-vietnamese.woff2",
        "fonts/experimental/Inter-latin-ext.woff2",
        "fonts/experimental/Inter-latin.woff2",
        "fonts/experimental/SourceSerif4-cyrillic-ext.woff2",
        "fonts/experimental/SourceSerif4-cyrillic.woff2",
        "fonts/experimental/SourceSerif4-greek.woff2",
        "fonts/experimental/SourceSerif4-vietnamese.woff2",
        "fonts/experimental/SourceSerif4-latin-ext.woff2",
        "fonts/experimental/SourceSerif4-latin.woff2"];
      const iconFiles = mindmapIconCatalog.map(icon => `mindmap-icons/${icon.id}.png`);
      const moodFiles = moodFaces.faces.map(face => `tracker-art/moods/mood-${face.value + 5}.svg`);
      const staticFiles = [...feedbackAudioManifest.files.map(cue => `feedback-audio/${cue.file}`), ...fonts, ...iconFiles, ...moodFiles, "habit-reminder-worker.js", "icons/icon-round-v2.png", "mindmap-icons/LICENSE.txt", "mindmap-icons/SOURCE.txt", "mindmap-icons/GENESIS-100-PNG.zip", "sounds/task.wav", "sounds/habit.wav"];
      const fingerprint = createHash("sha256").update(`${PRECACHE_STATIC_REVISION}\n${requiredFiles.join("\n")}`);
      staticFiles.forEach((file) => fingerprint.update(readFileSync(path.join(projectRoot, "public", file))));
      const version = fingerprint.digest("hex").slice(0, 16);
      const publicUrls = requiredFiles.map((fileName) => `${basePath}${fileName}`);
      staticFiles.forEach((file) => publicUrls.push(`${basePath}${file}`));
      this.emitFile({
        type: "asset",
        fileName: "precache-manifest.js",
        source: `self.__GENESIS_PRECACHE_VERSION=${JSON.stringify(version)};self.__GENESIS_PRECACHE=${JSON.stringify(publicUrls)};\n`,
      });
      // Also change the top-level worker when its imported resource list changes.
      // Browsers can then detect a new build without relying on a cached import.
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `// GENESIS precache build: ${version}\n${readFileSync(path.join(projectRoot, "public", "sw.js"), "utf8")}`,
      });
    },
  };
}

export default defineConfig({
  root: path.join(projectRoot, "web"),
  base,
  publicDir: path.join(projectRoot, "public"),
  plugins: [compactUiLocaleTransport(), react(), offlinePrecacheManifest(base), publicLegalDocuments()],
  define: {
    "process.env.NEXT_PUBLIC_GENESIS_MINDMAPS": JSON.stringify(process.env.GENESIS_MINDMAPS === "true" ? "true" : "false"),
    "process.env.NEXT_PUBLIC_GENESIS_API_URL": JSON.stringify(apiUrl),
    "process.env.NEXT_PUBLIC_GENESIS_BASE_PATH": JSON.stringify(base),
  },
  build: {
    outDir: path.join(projectRoot, "dist-web", "public_html"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2020",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Preserve the eagerly mounted controls while keeping their independent
            // tooltip/dialog services out of the entry with production mindmaps enabled.
            { name: "dialog-chrome", test: /app[\\/](?:ButtonTooltips|DialogDismissal|DialogHeaderActions)\.tsx$/, priority: 14 },
            // Shared by the welcome page and toolbar; keep installation UI out
            // of the main entry, also when production enables mindmaps.
            { name: "android-install", test: /app[\\/](?:AndroidDownload\.tsx|android-install\.ts)$/, priority: 14 },
            {
              // Default recurrence values are created during module initialization.
              // Keep their dependency-free context out of cyclic UI/engine groups.
              name: "calendar-context",
              test: /app[\\/]calendar-context\.ts$/,
              priority: 50,
            },
            { name: "view-recovery", test: /app[\\/]DeferredViews\.tsx$/, priority: 14 },
            { name: "shared-updates-state", test: /app[\\/]SharedUpdatesProvider\.tsx$/, priority: 14 },
            { name: "task-display", test: /app[\\/](?:task-list-order|use-personal-task-display)\.ts$/, priority: 45 },
            { name: "mindmap-launch", test: /app[\\/]MindmapLaunchButton\.tsx$/, priority: 14 },
            { name: "diary-core", test: /app[\\/](?:DiaryProvider|DiaryLaunchButton|diary-(?:model|storage|copy))\.(?:tsx?|json)$/, priority: 14 },
            // Account notices grew with email verification. Keep verification
            // and workspace recovery out of the entry when mindmaps are enabled.
            { name: "account-notices", test: /app[\\/](?:EmailVerificationNotice|WorkspaceRecoveryDialog)\.tsx$/, priority: 14 },
            // Keep account settings (including the Physis entry) outside the main
            // application chunk, including production builds with mindmaps enabled.
            { name: "account-settings", test: /app[\\/]AccountPanel\.tsx$/, priority: 14 },
            { name: "backup-ui", test: /app[\\/](?:BackupPanel|AccountSecurityPanels)\.tsx$/, maxSize: 280_000, priority: 16 },
            { name: "backup-transfer", test: /app[\\/]backup-(?:format|device|sources|drive)\.ts$/, maxSize: 280_000, priority: 17 },
            { name: "backup-restore", test: /app[\\/]backup-restore\.ts$/, maxSize: 280_000, priority: 17 },
            { name: "backup-habits", test: /app[\\/]habit-backup(?:-restore)?\.ts$/, maxSize: 280_000, priority: 18 },
            { name: "backup-legal", test: /app[\\/]backup-legal\.ts$/, priority: 48 },
            { name: "locale-backup", test: /app[\\/]backup-copy\.en\.json$/, priority: 48 },
            { name: "affairs-copy", test: /app[\\/]native-affairs-translations\.json$/, priority: 46 },
            { name: "physis-monitoring", test: /app[\\/]physis[\\/](?:measurements\.tsx|metric-navigation\.tsx|metric-definition-dialog\.tsx|custom-metric-domain\.ts|health-icons\.tsx|health-icon-data\.json|health-icon-names\.ts)$/, maxSize: 280_000, priority: 14 },
            { name: "physis-food-seed", test: /app[\\/]physis[\\/]nutrition-seed\.json$/, priority: 46 },
            { name: "physis-reference-data", test: /app[\\/]physis[\\/](?:exercise-library-data\.ts|exercise-expansion-data\.ts|exercise-media-data\.json|food-reference-data\.json|supplement-reference-data\.ts)$/, priority: 46 },
            { name: "physis-reference-catalog", test: /app[\\/]physis[\\/]reference-catalog-(?:domain\.ts|controls\.tsx|store\.ts)$/, maxSize: 280_000, priority: 14 },
            { name: "physis-care", test: /app[\\/]physis[\\/](?:care|supplement-reference)\.tsx$/, maxSize: 280_000, priority: 14 },
            // The growing web-only pilot dictionary must not inflate locale-core.
            { name: "locale-physis", test: /app[\\/]physis[\\/]copy\.en\.json$/, priority: 46 },
            { name: "locale-refinements", test: /app[\\/]ui-refinement-copy\.json$/, priority: 46 },
            { name: "locale-trial", test: /app[\\/]billing-trial-copy\.json$/, priority: 46 },
            { name: "public-documents", test: /app[\\/](?:LegalPage\.tsx|legal-content\.ts)$/, priority: 14 },
            ...["el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"].map(locale => ({
              name: `locale-restoration-${locale}`,
              test: new RegExp(`stoicheion-restoration-locales[\\\\/]${locale}\\.json$`),
              priority: 46,
            })),
            {
              name: "shared-task-controls",
              test: /app[\\/](?:SharedTaskPageControls|SharedDependencyPicker|SharedArchivedTasks|SharedTaskDetailsEditor|SharedEntityPreview|SharedEntityComments)\.tsx$/,
              priority: 14,
            },
            ...["en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"].map((locale) => ({
              name: `locale-work-${locale}`,
              test: new RegExp(`shared-work-translations[\\\\/]${locale}\\.json$`),
              priority: 46,
            })),
            ...["en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"].map((locale) => ({
              name: `locale-ui-${locale}`,
              test: new RegExp(`ui-translations[\\\\/]${locale}\\.json(?:\\.js)?$`),
              priority: 46,
            })),
            { name: "locale-ui-source-phrases", test: /genesis-ui-source-phrases$/, priority: 47 },
            ...["el.a", "el.b", "de", "de.b", "fr", "fr.b", "es", "es.b", "it", "it.b", "pt", "pl", "pl.b", "sr.a", "sr.b", "uk.a", "uk.b", "zh", "tr", "ja", "ja.b"].map((locale) => ({
              name: `locale-${locale}`,
              test: new RegExp(`translations\\.${locale}\\.json$`),
              priority: 45,
            })),
            {
              name: "locale-english",
              test: /app[\\/](?:translations\.en|curated-translations\.en)\.json$/,
              maxSize: 280_000,
              priority: 45,
            },
            {
              name: "locale-years",
              test: /app[\\/]year-translations[\\/][^\\/]+\.json$/,
              maxSize: 280_000,
              priority: 45,
            },
            {
              name: "static-data",
              test: /(?:\.json$|[\\/]references[\\/]days\.txt\?raw$)/,
              maxSize: 280_000,
              priority: 44,
            },
            {
              name: "locale-core",
              test: /app[\\/](?:i18n|region-language)\.ts$/,
              priority: 45,
            },
            {
              name: "device-access",
              test: /app[\\/](?:local-sign-out|private-message-vault)\.ts$/,
              priority: 45,
            },
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: "astronomy-engine",
              test: /node_modules[\\/]astronomy-engine[\\/]/,
              priority: 20,
            },
            {
              name: "sync-engine",
              test: /app[\\/](?:cloud-sync|workspace-sync-state|tracker-cache|use-shared-task-page|shared-task-details)\.ts$/,
              maxSize: 300_000,
              priority: 15,
            },
            {
              name: "interface-icons",
              test: /app[\\/](?:ExperimentalIcon|NavigationIcon|CalendarModeIcon)\.tsx$/,
              priority: 14,
            },
            {
              name: "calendar-display",
              test: /app[\\/](?:CalendarTaskCounts|MoonPhaseIcon|WeekdaySymbol|TodaySolarTimes)\.tsx$/,
              priority: 14,
            },
            {
              name: "task-form-controls",
              test: /app[\\/](?:TimeClockPicker|CalendarDatePicker|TaskReminderPicker|RecurrenceBuilder|ProjectCompletionDialog|EntryTypeChoice|RecordCalendarChoice|RecordDateTimeRow)\.tsx$/,
              priority: 14,
            },
            {
              name: "tracker-engine",
              test: /app[\\/](?:habits|habit-[^\\/]+|tracker-(?:analytics|core|math)|daily-goal|rewards|achievements|streak-(?:protection|rewards)|mood-tracker|sleep-tracker|addiction-tracker|sacred-practices)\.ts$/,
              priority: 14,
            },
            {
              name: "workspace-layout",
              test: /app[\\/](?:(?:InboxToolbar|WorkspaceHeader|CategorySection|PersonalCategoryPanel|ProjectsHeroMark|TodayBlocks)\.tsx|(?:ui-visibility|use-account-layout|use-sidebar-collapse|use-affair-drag|use-inbox-drag|use-mobile-layout|use-header-control-size|task-count-i18n|today-block-order)\.ts)$/,
              priority: 14,
            },
            {
              name: "web-reminder-ui",
              test: /app[\\/](?:ReminderNotices\.tsx|web-reminder-presentation\.ts)$/,
              priority: 14,
            },
            {
              name: "calendar-engine",
              test: /app[\\/](?:calendar-data|calendar-context|calendar-astronomy|solar-times|day-rhythm|personal-task-schedule|task-recurrence|task-reminders|time-format)\.ts$/,
              priority: 13,
            },
          ],
        },
      },
    },
  },
});
