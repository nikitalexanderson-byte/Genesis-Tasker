# Mindmap cold-link bootstrap regression — 19 November 2026

The new migration editor registration ran the full workspace-key check from a
layout effect. A fresh authenticated browser can mount a direct mindmap URL
before account bootstrap restores that key. The synchronous error reached the
view boundary before the existing asynchronous load/retry could finish, leaving
an otherwise valid saved map unavailable on the second client.

Registration now only records a callback and rejects a disposed repository. It
does not open data, run IO or grant access. `captureMigration()` still checks the
current unlocked owner before invoking any callback; all normal encryption,
transport and migration fences remain in place.

Evidence under `output/release-3.3.6/runtime/`:

- `mindmaps-cold-registration-before-01.log`: the new regression failed before
  the fix (19/20), with `SYNTHETIC_UNLOCK_REQUIRED` during registration.
- The actual pre-fix Chromium cold link reached the view error boundary with
  the same stack (`registerMigrationEditor` → workspace unlock check).
  `output/playwright/mindmap-cold-before-336.png` retains the failure.
- `mindmaps-cold-registration-after-02.log`: 33/33 focused source/operation
  cases PASS. Registration performs no key check or IO; locked/foreign captures
  invoke zero callbacks; disposed registration and capture still refuse.
- `mindmaps-cold-full-js-01.log`: 1588/1588 PASS; typecheck, scoped lint and web
  build passed. The build used `GENESIS_MINDMAPS=true`, matching CI.
- `mindmaps-cold-native-assembly-01.log`: BUILD SUCCESSFUL in 24s. The main and
  test APKs are byte-identical to the already accepted retained-key revision;
  `mindmaps-cold-native-artifact-comparison-01.json` records both SHA-256 pairs.
  The web repository registration is absent from those packaged native assets.
  Repeating the unchanged native instrumentation is not substituted for this
  explicit artifact comparison.
- Local `security336-legacy-business-03`: cold second-client map reading,
  description persistence, map import/export and all four widths/two schemes
  passed. Its broader report is 120/121, with one separate habit-import
  readiness failure. It is not a clean full-browser acceptance.
- `security336-legacy-business-04`: 121/121 PASS plus startup 4/4 and observer
  control PASS. The QA habit importer now waits for the actual picker to become
  enabled: `setInputFiles` previously bypassed the disabled control before its
  encrypted journal had opened. The run observed that wait, then verified preview,
  apply, success text and a workspace write. No result assertion was removed.
  The original and modified backup also independently passed the actual parser.
  The bundle hash stayed unchanged through the run; isolated backend cleanup
  passed. This is Business workflows plus global trial/header cases, not a claim
  that all five complete plan suites ran locally. See
  `legacy-business-web-summary-04.json`.
- After-fix map settings and the 360px dark map screenshot were visually inspected.
  All width/scheme checks retain their own screenshots. The earlier startup reload
  failure in run02 remains recorded; run03 and run04 each passed all four startup
  cases without weakening the startup gate.

CI44515254641 on 9ec5d59b failed the cold-map scenarios; that result is preserved.
Its separate Android job failed before compilation while resolving the pinned
KSP plugin, which had succeeded in the previous CI and current local builds.
No dependency/workflow change is inferred from that resolver failure. Fresh
remote source checks remain required for the corrected head.

The first local business run used a pre-existing bundle with mindmaps disabled
and was stopped as invalid configuration. The second reproduced the actual cold
failure with the correct flag. Both task-owned child runs were stopped while
their parent runners completed isolated backend cleanup; they are not passes.
The CLI browser used for the cold-link reproduction was closed.

This fixes current legacy UI behavior during preparation. It does not activate
E2EE or change release/update/Paddle settings. Full source coverage, product
routing/recovery/upgrades and independent crypto review remain release gates.
