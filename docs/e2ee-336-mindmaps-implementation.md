# Personal mindmap migration implementation and acceptance

19 November 2026. Source increment accepted with the explicit limits below;
product integration and large-source acceptance remain pending. Production
remains 3.3.5/149, update floors zero, pilot/cutover off, Android deploy false.

## Capture and reconciliation

The owner web source captures every `genesis-mindmaps:<owner>:` cache, draft,
uncertain request, view and conversion journal, including closed-tab slots. The
repository exposes registered mounted editor capture; the current map, forms,
pending notes, import preview, versions and undo/redo state are retained. Capture
does not list/refresh maps, upload, acknowledge, convert a thought into a task or
rewrite old storage. The authenticated factory captures the account session and
reads all four signed server tables through the bounded page collector.

Native capture retains the exact encrypted Room documents and raw authenticated
JSON for maps, saved views and conversion draft, old account-key wrapper and
mounted editor state. It never projects raw JSON through the normalizing map
model before duplicate-name validation. Pending request plaintext is opened
only by a native capability for the exact captured envelope and map purpose;
no old account key enters the network-disabled WebView. Unknown/missing/corrupt
sources, failed decryption and generation/history mismatch refuse, preserving
every original and protected local snapshot.

Every retained server version is authenticated and re-encrypted, without the
ordinary history screen's twenty-version limit. Graph identities/references,
recurring-task dates, optional empty fields, styles, descriptions and images are
preserved. Validation is not normalization; unknown formats refuse rather than
silently dropping private fields. Inconsistent same-revision/future server
history requires review. Historical receipt hashes are retained as inert data.

Clean older caches remain history. Divergent current copies and unexplained
orphan caches require an exact explicit review choice. An authoritative deletion
does not resurrect a cached map. Choosing absence/deletion does not upload that
old cache plaintext again; its full original stays device-local. Dirty maps,
uncertain pending requests, conversion task payloads and all unfinished editor
state remain in `localContent`, without replay or automatic cloud consent.

Embedded remote images become separate attachment objects with random logical
IDs; the existing file protocol gives each file an independent key and signed
chunk/manifest binding. Image data/alt text, graph names, task references and
historical logical IDs stay inside ciphertext. Current-generation reading
hydrates the exact original bytes; missing/swapped files, missing local work,
owner/object substitutions or inconsistent selections refuse without a fallback
to old keys or HTTP routes. Local-only recovery still needs retained device-vault
ciphertext; a saved secret cannot recreate bytes never backed up off the device.

All personal native suspend repository operations acquire the owner permit before
the repository mutex and retain it through decrypt, HTTP, journal writes and
acknowledgement adoption. The auth transport also binds the original session
generation and workspace epoch, including A→B→A changes. Shared repositories
retain their existing transport boundary; this increment does not claim shared
map migration or rotation is complete.

## Evidence

Evidence under `output/release-3.3.6/runtime/`:

- `mindmaps-full-js-01.log`: 1583/1583 PASS. Focused real web repository,
  lossless source/reader, native JSON normalization, diary parser and coordinator
  regressions passed. `mindmaps-project-lint-01.log`: 0 errors / 4 existing image
  warnings; scoped/QA lint passed. Typecheck 05 passed, including browser harness.
- `mindmaps-browser-report-01.json`: Chromium 157, 86 checks PASS, console zero
  errors/warnings. Real WebCrypto/IndexedDB; protected snapshot precedes all seven
  source pages, independent saved recovery unwrap, ambiguous commit retry without
  recapture/reconciliation, cold normal scope reading of 25 versions and exact
  images after old-key removal. New vault/transport inspection found no private
  canaries, recovery secret or old key. Screenshot:
  `output/playwright/mindmaps-migration-336.png`.
- Three earlier browser harness attempts stopped before acceptance because
  Vite library mode did not substitute Node environment constants imported by
  the shared graph validator. The loopback harness now explicitly uses the
  production constants. Actual packaged native JS was separately checked for
  remaining `process.env` expressions (none). Those failed console artifacts
  remain under `.playwright-cli/`; they were not counted as successful runs.
- `mindmaps-source-server-05/`: 7/7 PHP suites PASS, including actual table
  schemas, bounded large histories/Physis pages, local output, signed transport,
  schema and owner/file IO gate. The collected fixture has 22 actual WebCrypto /
  JCA packets; PHP checks those and four tampered offsets in 26 assertions.
- `native-mindmaps-jvm-summary-01.json`: 1174 JVM tests / 214 suites,
  1166 passed, 8 opt-in real-PHP HTTP cases skipped, failures/errors zero. New
  native source 4/4 and page collector 3/3 passed. Full build/lint completion is
  recorded separately; APK/JVM success does not replace the final exit status.
- First actual API34/API35 instrumentation: 72/73 each, with exactly the same
  new fixture failure. The permit-drain test encrypted its initial Room row with
  the fixture alias, then constructed the real repository using its default QA
  field key. Decryption correctly refused that mismatch. The other four actual
  mindmap cases and prior 68 regressions passed. Corrected fixture acceptance is
  mandatory; `native-mindmaps-instrumentation-summary-01.json` preserves the
  failure rather than counting the shell's zero exit code as a pass.
- Corrected `native-mindmaps-source-build-02.log`: BUILD SUCCESSFUL in 2m2s;
  unchanged main/JVM/lint inputs reused their successful results, and the corrected
  test APK / Android-test lint completed. The fixture re-seeds only its own unique
  synthetic account row with the actual repository field cipher; the default QA
  alias is neither replaced nor deleted. `native-mindmaps-source-api34-02.log`
  and `native-mindmaps-source-api35-02.log`: 73/73 each PASS, failures/skips zero,
  including five actual map cases and all prior 68 regressions.
- `native-mindmaps-source-api26-02.log`: 17/17 PASS, comprising 14 key-lifecycle,
  two real JCA envelope-vector/provider tests and one old-provider UI gate. The
  original API26 image still has Chromium69, below the supported minimum111;
  this is **not** a successful map migration on API26. The fallback asserts all
  14 languages × two schemes × three modules, with zero IO/source changes.
  84 PNGs and hashes are retained under
  `output/qa/security336-mindmaps-api26-runtime-02/` and its artifact manifest.
  Actual API26 migration after a supported WebView update remains unverified.
- Final parsed results: `native-mindmaps-instrumentation-summary-02.json` and
  `native-mindmaps-jvm-summary-02.json`; native lint 0 errors / 206 existing
  warnings / 8 hints. `mindmaps-web-build-01.log` and
  `mindmaps-i18n-audit-01.log` passed. Automated 14-language audit is not a claim
  that the still-unimplemented security UI has undergone semantic acceptance.
  All browser servers/sessions and all three emulators were stopped afterwards.

## Still required

This source increment does not implement the full product bootstrap/unlock,
explicit source-review UI, editor freeze/OS saveable protection, new-generation
normal writes or full background routing. Ordinary mindmap UI import/export is
still the legacy product route until those changes are accepted. All 20 registry
paths remain mandatory; a standalone one-category QA coordinator is not a claim
that the product registry is complete. Implemented source adapters are now 7/20;
this count does not mean seven fully activated product categories.

Server paging and web collection can read valid histories above 16 MiB. Native
result streaming now passes an actual 17,644,546-byte, 25-version history on
API34/35 with the normal 192 MiB Java heap; see
`e2ee-336-native-source-stream.md`. Native capture still has a 16 MiB snapshot cap,
remote/input aggregation remains, and the legacy single Room document is subject
to CursorWindow limits. This is not full large-account acceptance. Room saved-map
normalization still needs older-format acceptance. New native diary/map captures
now independently retain the old account key under the new-root-protected
snapshot, with key removal before the JS bridge; actual API34/35 late-alias-loss
source cases pass. See `e2ee-336-retained-native-old-keys.md`. Older captures
without retained key material still need their original field key. Full product
and clean-device recovery remain separate gates.

Shared maps/ACL rotations, files/automation, independent Physis sources, archives /
Drive and local-only backup, clean-device recovery, signed direct upgrades, the
original 48 whole-system scenarios, 14-language semantics and independent crypto
review remain release/activation gates. No personal device or Play track changed.
