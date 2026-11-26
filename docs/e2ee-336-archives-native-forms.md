# Native archives: acknowledged forms and detached file inventory

20 November2026. Selected small-data acceptance completed; this is protected source input,
not the complete `personal.archives` adapter or a release. Coverage remains9/20.
Large-data/product acceptance remains a release gate as detailed below.

Follow-up20 November: `e2ee-336-archives-form-spool.md` replaces the ordinary
native form-memory path with bounded encrypted spill and documents its actual
failed/fixed large-data attempts. The memory-only/32MiB adoption description below
records this earlier accepted increment; it is not the current implementation's
ordinary form-storage limit. Binary inventory and aggregate migration gates remain.

## Input lifetime and operation boundary

`BackupPanel` mirrors each accepted setter value synchronously before scheduling
its React update. Functional updates use the latest accepted input, rather than
an older rendered closure. Exact key text, section/conflict choices, preview,
uncertain stage/operation IDs, false/zero and selected File references survive
disposal before another layout effect. A retention failure changes neither the
accepted mirror nor React state. The initial complete form is published in its
layout effect; a partially initialized mounted view cannot become empty input.

The native renderer sends bounded ordered UTF16 chunks and waits for a native
acknowledgement before accepting a state update. Selected files are opaque IDs:
the native bridge independently retains original bytes and original provider
metadata before the transient import transfer is cleared. Failed/cancelled
replacement cannot discard the preceding selected file. Unselected candidates
remain explicit input, including a picker whose result was never adopted.

`BackupMigrationInventory` owns every mounted/detached branch in the current app
account epoch. View close releases bridge permits/transfers but retains its last
acknowledged form and file candidates. An account transition clears references
and wipes owned binary arrays; stale views cannot republish even after login to
the same UID. JVM strings cannot be reliably erased; they are never written to
unencrypted disk by this inventory. This is process/session memory until the
complete migration coordinator protects the source under the new root. It is
not a promise of durable recovery from process death before that protection.

Native memory publication uses a dedicated monitor coordinated with the owner
migration fence. Migration freezes it after acquiring the whole-job scope mutex
and before installing its durable Room deny/capturing sources. Ordinary admitted
legacy IO does not freeze input. Publication also checks the persistent Room
marker for process restart; only verified cancellation releases the memory deny.
It refuses instead of waiting behind migration on a renderer bridge thread. A
partial publication blocks capture of a mounted form. Disposal retains the
preceding acknowledged version; its rejected update never became accepted UI
state. A mounted busy form also refuses capture; a detached uncertain form stays
explicit history. Final action result/error and settled state are acknowledged
inside the admitted backup job before its permit closes. Action errors still
propagate through that job, so they cannot accidentally authorize restart. The
admitted verified reset may retain only its final form after retiring its own
HTTP generation, under the original account epoch and still-live capability.
That exception grants no further HTTP/crypto/file operation or reuse after end.

`AuthController.e2eeArchivesLocalCapture` captures exact original history, current
protected-state JSON, every retained safety/chunk row and native form inventory.
It checks the original account/transport epoch and memory revision/history again
after the Room capture. It exposes no HTTP, restore, pruning or activation port.
It is not registered as a complete category adapter.

## Shared source validation

`archives-native-forms.ts` parses ORIGINAL form JSON with duplicate-name checks
before any nested old-key capability can exist. All views/candidates are distinct;
full canonical Base64url bytes, actual length and SHA256 are verified. The selected
reference must match those bytes and the exact File display normalization, while
the original provider metadata remains separate, including explicit nulls.
Empty/binary/invalid-UTF8 files stay byte exact. Plans, receipts and imported
subscription/identity/ACL values are inert source input, never executed authority.

The capture normalizer also checks owner binding of protected-state/safety groups
and parses original history. It deliberately retains pending generation for
review. Existing LocalCipher/account ciphertext still requires authenticated
opening and complete nested reconciliation; wrapping those ciphers again is not
portable recovery. Neither reader returns `complete=true`.

Bounds:1000 views,1000 files per view/10000 total,24MiB per selected file,32MiB
UTF8 per form,48MiB aggregate retained raw forms/binary memory and48MiB encoded
capture. Encoding overhead can hit the capture limit earlier and explicitly
refuses; there is no truncation, pruning or empty fallback. The composed source
coordinator/runtime limits still apply and need large-data acceptance.
These form-memory limits also apply to ordinary native input adoption while
migration is disabled. The full24MiB file -> decoded payload -> encrypted preview
plan combination is NOT accepted by the selected small-data tests: payload/plan
duplication can hit a form/memory bound earlier. Preserve the existing file-size
support with bounded storage/streaming and verify that composed path before
release; a safe refusal is not proof of full functional compatibility.

## Verified scope so far

- Full JS1778/1778 PASS,0 fail/skip with explicit owned PHP runtime after the
  final File display-normalization case (previous iteration1777/1777). Initial
  focused fixture incorrectly expected3 UTF16 chunks from140000 Greek characters;
  it was corrected to a300000-code-unit Greek/emoji string that actually spans3
  chunks and exercises a surrogate boundary. No product framing was weakened.
- Focused52/52 PASS before the final empty-file/display cases; full1778 includes
  both. Types03 PASS. Scoped app/public/tests/scripts lint04:0 errors,4 existing img
  warnings. Root lint and the protected `demo-output/` were not accessed.
- Web build01 PASS:98 public HTML/14 languages, exact dictionaries,280 gallery
  screenshots and offline precache. This is not new semantic/visual acceptance
  of all security screens.
- Actual Chromium157/React/File/WebCrypto/IDB/Web Locks:27/27 PASS, console0
  in final02 (initial01:26/26). The additional real File case verifies lone
  surrogate display normalization and unchanged original provider text/BOM.
  Real setters, file selection/check/decrypt/preview and navigation were used.
  Final forms were acknowledged before each synthetic job ended. Exact native
  mirror input and binary bytes passed the shared parser after encrypted IDB
  persistence, original-memory clearing and cold unlock with the new root.
  Separate whole-web-job/durable deny/binary provenance regressions also passed.
  HTTP ports/picker were synthetic and CSP blocked external connections.

Evidence under `output/release-3.3.6/runtime/`:
`archives-native-forms-{js-02,full-js-02,types-03,scoped-lint-04,web-build-01}.log`.
Browser: `output/playwright/security336-archives-capture/results-forms-02.json`,
`before-detach-forms-02.png`, `after-cold-unlock-forms-02.png` (both inspected).
Bundle SHA256:
`ab602f798cec89764199a45053664a302ae9a3e8998e2f829e3041b352ec2933`.
The owned browser and loopback server were closed after acceptance.

Initial native build01 assembled both APKs and passed13/13 selected JVM tests;
its lint was intentionally stopped after a real race was discovered. API34-01
passed25/25. API26-01 passed22/25, with3 immediate form publication failures:
ordinary background IO briefly held the shared mutex. Both real SAF/journal
flows passed, but these failures are not accepted as environment-only. The
memory monitor/freeze handshake above replaces that overly broad immediate
mutex refusal. Self-review also added the intentional-reset final-form case.
Final native build02 SUCCESS27m16s. Selected JVM15/15 PASS,0 fail/skip;
native lint0 errors/208 existing warnings/8 hints, with no new warning/file
combinations relative to the accepted native-file03 baseline.

Actual API34 and API26/provider113:26/26 PASS each,0 fail/skip:16 whole-job and
memory publication cases,6 operation fences,2 reconciliation and2 real SAF/journal
flows. The actual WebView acknowledges input through the production bridge;
the SAF test closes that view and captures its exact settled form and file.
Each native fixture subsequently passes5 common-parser/WebCrypto checks on the
host: original bytes/metadata, exact decrypted owner/backup ID/payload and no
restore/rights/HTTP authority. On API26 the runner closed only the observed
stock statementservice crash dialog; verifier/permissions/AppOps were unchanged.
API35 was not repeated. API34 light journal/API26 dark SAF PNGs were inspected;
this is not the full visual/provider/product matrix.

Native input SHA256:
`D4F1A5F9F306B1E10515DBA73B0970071CB234874CD3786809A041412F789CE8`.
Main APK:
`8795C27989DBD3333DB410C1213F4851F5CA8B162C61A95009F0E5D85FAEFD81`;
test APK:
`E1A2F45C2475B8FD2AF03608488D25D7B90B0A1ACD8DE4E2A4B7B2428D74219B`.
Evidence: `runtime/archives-native-forms-{build-02.log,identity-02.json,jvm-02.json,lint-02.xml,lint-delta-02.json}`,
`runtime/archives-native-forms-cross-api{26,34}-02.json` under
`output/release-3.3.6/`; both
`output/qa/security336-archives-forms-api{26,34}-02/results.json`.

No full nested archive recovery, all-category product routing, clean-device/direct
upgrade, independent human crypto review or full visual/provider matrix is claimed.
Production3.3.5/149, floors0/pilot/cutover off, release package/certificate and
GENESIS_DEPLOY_ANDROID=false are unchanged. No deploy/Play/personal-device work.
