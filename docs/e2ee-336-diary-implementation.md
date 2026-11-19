# Diary source conversion and private local placement

19 November 2026. Extends `e2ee-336-diary-source.md` and
`e2ee-336-local-output.md`. Preparation only: production is 3.3.5/149,
cutover/pilot off, update floors 0, `GENESIS_DEPLOY_ANDROID=false`.

## Content and reconciliation

The real web adapter enumerates every owner `genesis-diary-v1` entry, including
closed-tab/upload drafts and explicit absent settings/cache slots. Unknown slots
are captured but refuse conversion, never omitted. The authenticated factory
captures the current account key/generation; mounted note/dream editors register
their committed form, including blank text and unfinished voice state. Read-only
capture performs no bootstrap, server request, attribution, cache rewrite or
acknowledgement. The coordinator must durably encrypt the full snapshot first.

Signed `legacy-diary` supplies all six server tables under the owner/lease/source
fence. Legacy AES-GCM authenticates the original owner and exact note purpose.
Strict raw-JSON parsing rejects duplicate decoded names, including escaped names,
before ordinary JSON projection can discard a field. Note validation preserves
unknown optional content, saved advice editions, custom colors, reactions and
dream metadata. Unknown schemas, damaged keys/ciphertexts or unresolved previous
attempts block; no empty replacement or timestamp-only overwrite.

Current-generation records retain selected and historical variants. A clean
cached revision predating its authoritative server revision remains history;
divergent equal revisions, delete/edit conflicts and incompatible local copies
require an exact new review choice. Incomplete/extra/foreign choices refuse.
Deletion markers cannot automatically resurrect an older committed note. Unsent
drafts survive as local work even when their committed note was deleted.

Local-only markers are privacy instructions, not deletions. All affected note
variants/references and local-only history stay in `localContent`. Device privacy
settings cannot upload an edited local copy when another device enables server
sync. Disabled server sync retains historical notes locally. Drafts, mounted
editors, uncertain upload IDs, raw native cache metadata and local history never
enter the remote plan. Old upload/cleanup/acknowledgement commands are inert.
Server settings/command hashes, dream settings and note revision/schema/payload
hash/timestamp history are preserved with the correct placement. All private
logical identities stay inside encrypted indexes; remote record IDs are random.

Normal readback uses the scope reader plus explicit device-local content. Missing
local pieces, owner/object substitutions and inconsistent index selections refuse;
there is no cloud fallback for a missing private local record. Local-only recovery
still needs retained device-vault ciphertext. A saved secret cannot reconstruct
device-only bytes after loss of the device.

## Android

The native factory binds user, session generation, account scope and workspace
epoch. It captures exact Room root/current/dangling diary chunks, old account-key
wrapper and mounted state under a transaction. Every complete retained generation
is authenticated; incomplete/different retained histories require review. The
shared packaged validator receives raw plaintext JSON strings only after native
LocalCipher authentication. No legacy account key enters the WebView. A native
opening capability accepts only the captured envelope and exact note purpose.
Raw native cache history stays device-only.

All suspend repository operations now acquire the owner legacy permit **before**
their repository mutex, through decryption/HTTP/durable write/response adoption.
The gateway captures session generation and workspace epoch to close A→B→A
reuse. Synchronous OS editor savers and full mounted-editor lock/cutover routing
still require product lifecycle integration.

## Evidence and remaining work

Evidence is in `output/release-3.3.6/runtime/`. Chromium report 05 passed 26 checks, including
repeated packet bindings: actual IndexedDB/WebCrypto, complete diary coordinator,
independent saved recovery unwrap, ambiguous commit retry and cold normal scope
read with old keys removed. Console 0 warnings/errors; screenshot
`output/playwright/diary-migration-336.png`.

- `diary-adapter-full-js-05.log`: 1543/1543 JS PASS.
- `diary-adapter-js-04.log`: 96/96 source/diary/coordinator/registry checks PASS.
- `diary-adapter-typecheck-05.log`, `diary-adapter-lint-03.log`: PASS.
- JVM: 1167 tests in 212 suites, 1159 passed, 8 opt-in real-PHP HTTP cases skipped,
  failures/errors 0. New diary source 5/5, repository 19/19, protocol 5/5,
  migration 13/13 and registry 7/7, no skips in those suites.
- `native-diary-source-api34-01.log` and `native-diary-source-api35-01.log`:
  54/54 each PASS with no negative instrumentation status. Six real diary cases
  include native encrypted chunk capture/readback after old-key deletion, pending
  envelopes, private placement, missing/dangling/corrupt sources, owner epoch
  switch and repository permit drain through durable draft storage. These are
  not the original whole-system 48 acceptance scenarios.
- Test packages remain `ru.genesis.calendar.qa1103.debug` and its test runner,
  metadata 3.3.5/149. No personal device, release signing or Play track changed.
- `native-diary-source-build-03.log`: main/test APK, JVM and lintDebug build
  SUCCESS in 12m6s. `diary-adapter-web-build-05.log`: web build, public documents,
  locale chunks and offline precache PASS. Browser/type checks include the final
  note metadata retention and native strict chunk-manifest parser.

Early failures are retained: lint 01 caught render-time refs, corrected to layout
effects and registered capture callbacks; native build 01 caught a missing loop
brace, build 02 a test declaration typo; browser reports 01–03 found QA fixture
mistakes (wrong snapshot property, missing put generation, missing sealed-heads
response). These were not represented as successful product acceptance.

This is a source adapter increment. Full product bootstrap/unlock, editor freeze,
new-generation normal writes, explicit source-review UI, archive/export and
local-only backup integration remain required, along with older-format/direct
upgrade acceptance, the original 48 scenarios, 14-language security UI review and
independent crypto review. Global LocalCipher encrypt-after-lost-key protection
is a separate mandatory blocker; these source readers do not regenerate a key.
No release number or production setting is changed by this work.
