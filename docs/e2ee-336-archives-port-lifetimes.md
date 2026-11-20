# 3.3.6: native form-publication lifetimes

Work in progress,20 November2026. Accepted binary retention is63b90e17; its
40 JVM/58 native cases and21 host checks per platform do not prove this next
increment. Full migration coverage remains9/20 and production is not changed.

The three synchronous original-form/value/manifest ports now use the existing
owner memory gate and inventory for serialization instead of holding the
window's Java monitor. `stop()` can mark the actor inactive before waiting for
inventory cleanup. Original-owner checks reach the spool through `appendForm`,
`appendValue` and `publishManifest`, including complete metadata readback and
locator publication. A failed terminal value/manifest clears only its newly
stored candidate; earlier acknowledged values and manifests remain source input.
The original field-transfer guard remains pinned across its bounded chunks.

Account scopeEpoch is a process-local actor counter, not dataGeneration,
cryptoEpoch or securityEpoch. `activateAccount` now advances that counter BEFORE
waiting for backup inventory cleanup. A blocked old reader can observe retirement
and abort; a later login with the same UID cannot revive its captured actor.
Scope identity, signed generations, keys and cryptographic protocols are not
modified by that ordering. Generic RPC chunk assembly already has its own
bounded synchronized transfer object, so its JSON parsing no longer needs the
window monitor either. No new JS/HTTP/file/restore capability is exposed.

New JVM cases retire a terminal field or manifest during stored readback and
check preservation of the earlier accepted input. Native cases pause all three
ports while holding the memory gate: Main-thread disposal must return promptly,
late publication must refuse, and migration must still wait for that gate to
drain. Another case holds the real inventory monitor during an account change:
the old actor must be invalid before cleanup can acquire that monitor, including
same-UID reactivation. These are separate from the binary IO close/end cases.

The large-preview fixture also waits for two animation frames and verifies that
the confirmation checkbox is in the viewport before screenshot capture. Earlier
binary04 API34 function checks passed, but its screenshot showed the upper form;
that original evidence remains unchanged and is not a preview viewport proof.

Frozen input01:
`7B948BF1B2184AB7D2C104850D97F4E968EB1534E63C191BAFF5E8CB192D8494`.
The first build/platform results and the following test-helper repair are
recorded below; older native APK identities were not reused for these inputs.
No Deploy, Play, personal device, version bump, floor/pilot/cutover activation
has occurred. Complete local source/coordinator streaming, process remnants,
all nested old-key opening, the full archive adapter and all other release gates
remain mandatory.

## Input01 and the startup-helper failure

Full build01 completed SUCCESS19m38s. Selected JVM46/46,0 failure/skip.
Actual API26 passed60/60. Actual API34 passed59/60: the large fixture failed in
the initial Generate-key phase, before any file selection, because its first
page-body expression did not produce a String result. The original failed
report and screenshot remain unchanged. The screenshot shows the loaded page;
the filtered console separately records `Cannot read properties of null
(reading 'innerText')` at backup.html line1. The QA helper read document.body
before body creation and treated its null evaluation result as an absent
callback, then waited90 seconds. No import/crypto path was reached in that case.
Both platforms passed all22 whole-operation cases, including all three form
ports and retirement before blocked inventory cleanup. API26's new preview PNG
was inspected and shows all eight maps' preview/confirmation. This does not
turn the failed API34 run into a success.

The three related backup UI helpers now tolerate an absent startup body and
distinguish completed callback/null evaluation from an absent callback. Actions
are not automatically retried and no timeout was increased. The large capture
also waits for Android's visual-state callback after the two browser animation
frames and viewport assertion. These are androidTest-only repairs; application
and JVM-test sources are unchanged from input01.

Frozen input02:
`B39709ADA38C5018A155D45CCB07D5929FE8434293B974808A860A0D513ADBB2`.
The Main APK still has SHA256
`660529514F53287706AF9E043958368E3EBB73450E5586F179A2D24E4DAAF281`.
The new test APK is separately identified. The fresh platform result below is
not inferred from the preceding59/60 or60/60 result.
Evidence: `output/qa/security336-archives-ports-api{26,34}-01/`, runtime
`archives-ports-{input-01,identity-01,jvm-01,startup-diagnostic-01,input-02,
assembled-02}.json` and build logs.

## Selected input02 acceptance

Build02 SUCCESS2m26s, lint0 errors/208 warnings/8 hints and no new issue/file pairs
against binary04. Selected JVM46/46 from build01 is retained explicitly as
input01 evidence: only androidTest helpers changed in02, and the application
APK SHA stayed identical. No new JVM run is claimed for02. The exact final test
APK is `FE0B5C8CE00A77E45C46A59317B54F702DF888C4CF78E759D6F0290B9BFE223D`.

Actual API26/API34 each passed60/60 selected cases,0 failure/skip. All22 whole-job
cases passed on both, including the three paused form ports and epoch retirement
before waiting on a held inventory monitor. Each platform also passed21 host
checks:6 values/source/new-root,5 real SAF,4 native export/canonical portable AAD
and6 binary integrity/runner-bound checks. This is not the complete48-scenario
product matrix or all20 sources. The unchanged DataImportBlobStore suite was not
repeated; its earlier opt-in evidence remains separate.

The20,615,080-byte file/eight-map fixture passed without restore in54,123ms(API26)
and50,608ms(API34); small confirmation217/269ms, one4-code-unit value plus
manifest. The viewport/paint assertions passed and both dark preview PNGs were
inspected, with eight added maps and confirmation visible. API26 heap512MiB,
API34 heap192MiB; API26/192MiB, API35/OEM, full visual/provider/14-language
semantics, direct upgrades and independent human review remain open.

Evidence: `output/qa/security336-archives-ports-api{26,34}-02/`, runtime
`archives-ports-{input-02,assembled-02,identity-02,native-summary-02,
lint-delta-02}.json`, `archives-ports-build-02.log`, lint XML and the four
`archives-ports-*-cross-api{26,34}-02.json` reports. Original failure01 and its
console/screenshot are preserved. Snapshot limits and incomplete process
remnants have not been accepted by these tests. The next implementation gate is
documented in `e2ee-336-archive-stream-requirements.md`.
