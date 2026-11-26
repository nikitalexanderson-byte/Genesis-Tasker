# Per-value archive form transport — local candidate

20 November2026. The local candidate connects the native renderer, bridge,
encrypted registry and composed source collector. Candidate04 passed the selected
actual API26/API34 paths described below. It is not a complete archive migration
or release. Coverage remains9/20; the complete streaming/old-key collector and
the remaining product gates are still required.

## Renderer and source contract

`nativeBackupValueRetainer` serializes current state values independently and
reuses only byte-for-byte equal JSON strings from the last acknowledged form.
Object identity alone is insufficient: an in-place edit must not be missed.
Unchanged large payload/plan values are not sent again for a small key/choice/
settled update. The cache retains original raw JSON in the current view's memory;
it does not write plaintext storage or HTTP. Clear closes it permanently, and
all submissions use the original captured operation token and current-session
checks. Failed value or manifest acknowledgements cannot advance this cache.

All values/manifest bounds and serialization are checked before the first native
submission. Transport chunks remain131072 UTF16 code units; logical form96Mi
code units,64 fields and32768 manifest code units. Exact false/zero, original
input whitespace, ordering and uncertain operation IDs remain data. Files are
opaque references to independently retained native bytes/provenance.

The native value port receives the field name BEFORE the first chunk,
not only in a later manifest. A crash can leave an uploaded value without an
acknowledged manifest; the source must still know which field it was. The native
binding and encrypted locator must include original owner/epoch/view/field and
blob/index. A manifest cannot rename a blob from another field or view.

`normalizeNativeArchiveValues` verifies original expected owner/view/epoch, parses
the ORIGINAL raw manifest and EVERY raw candidate with the shared strict parser,
including unreferenced candidates, and requires matching field names/IDs. A missing
manifest remains explicit pending input. Unknown references, duplicates, forbidden
names or foreign contexts refuse rather than becoming metadata-only success.
Every original acknowledged manifest is retained and checked against the same
value inventory, including file references selected only by older manifests.
The current raw manifest must match the last history entry. It returns
`execution:source-input`, never complete/replay/restore authority.
Independent backup keys remain source input and must not be copied into output
content. Binary/file-origin validation still belongs to the enclosing collector.

## Native framing component

`BackupValueTransfer` wraps each original JSON value inside a small fixed existing
protocol1 form shell, then re-frames it into the already tested encrypted spill.
Its StringBuilder remains bounded by transport chunks plus that fixed shell;
there is no full value builder or JSONObject projection of the value. The native
factory must pass an owner/epoch/view/FIELD-bound binding and account for the
fixed wrapper overhead in the physical spool bound while retaining the logical
96Mi form limit. The current standalone constructor is not a scope authority.

`BackupStoredValue.reader` removes only the exact fixed prefix/suffix, preserves
original UTF16, and consumes the underlying authenticated footer/EOF. Closing a
partial reader is not proof of a complete source. New-root publication must wait
for complete authenticated readback. Old accepted values are not evicted when
another candidate fails or is interrupted.

## Current integration and remaining gates

1. The two native methods use the existing whole-job and memory-write/session
   guards. The registry binds owner/epoch/view/field before accepting chunks;
   small manifests have a strict duplicate-name reader and referenced values and
   original file metadata are checked before publication. Existing APK/view and
   verified-reset/session-retirement tests still need to pass on this candidate.
2. `BackupValueInventory` retains all acknowledged values and encrypted manifest
   history. Field bindings and manifest ordinals stay in encrypted restart
   locators. The physical spool accounts for fixed wrapper overhead while the
   logical form remains96Mi UTF16 units. Global count10,000 and shared768MiB
   disk quotas remain bounded. An incomplete unacknowledged transfer can be
   cancelled; previous accepted values/manifests are not replaced by its failure.
   Full process-remnant collection/materialization is still outstanding.
3. Actual local capture now emits v2 values/history plus every binary candidate.
   The composed shared normalizer accepts mixed v1/v2 views, preserves all raw
   inputs and validates historical as well as current file references. Aggregate
   capture is still bounded/refusing at48MiB; this is not snapshot streaming.
4. `backupJsonUtf8` escapes surrogate code units before native bridge/capture
   UTF8 encoding, so ORIGINAL provider strings and raw JSON cannot silently turn
   into replacement question marks. File display's separate USV normalization
   remains explicit. Original raw form strings and escaped sequences stay exact.
5. Selected actual API26/API34 large-file/decrypt/preview, small-choice editing,
   field/manifest rejection, file origin, owner changes, view disposal and native
   source/new-root host readback passed. This does not close all device/OEM,
   full-product recovery or every text-edit latency condition.

Global aggregate snapshot streaming, binary lifetime, all nested old-key opening,
complete archives/source registration, normal product writers/recovery, remaining
11 categories and all broader release gates still apply. A small manifest alone
does not make a large snapshot portable or recover an unreadable device ciphertext.

## Evidence so far

Renderer/source focused14/14 PASS in `archives-values-js-05.log`; a multi-MiB
payload/plan updates one tiny field without resending either large value. Tests
also cover in-place edits, failed receipts, unreferenced values, original context
capture, file provenance and field-identity substitution. This is a synthetic
port test, not native UI acceptance. The original staged full run was1804/1804;
the integrated composed-reader run is1809/1809,0 fail/skip in
`archives-values-full-js-integration-01.log`. Focused composed cases26/26 PASS,
owned types05 and scoped lint04 PASS. No final native result is inferred from
those counts.

The first JVM run passed10/11: its metadata fixture used newer JVM org.json,
which rejects nested duplicates instead of native JsonReader's state skip. The
test-only projection now explicitly permits them, while asserting the ORIGINAL
value is unchanged for the strict common source parser. Attempt02 could not
compile the JVM-only constructor against Android's JSONObject stub. Attempt03
uses that constructor only through reflection in the JVM fixture. Production
metadata validation was not relaxed. Original staged JVM03:11/11 PASS. For the
new integrated build, attempts01/02 failed configuration before compilation
(unquoted PowerShell Gradle property; then missing SDK environment). Attempt03
uses the standard quoted QA arguments, explicit SDK/JDK and frozen input
`61584A3CECB4FA8E115673D99D80CB750EF0C71621F3F5B1A11F3C77540C28A0`.
Integrated03 completed SUCCESS18m39s, JVM22/22, lint0 errors/208 warnings/8 hints.
Actual API26/API34 each passed3 new value-registry/provider cases and6 independent
host common-parser/WebCrypto checks. Its large API34 fixture passed43,000ms,
small choice259ms. API26 rejected its generated backup with a key/integrity
message. The platform-dependent legacy JSON AAD defect was independently
reproduced and repaired in `backup-336-portable-aad.md`; failure03 is preserved.
Two additional shared-reader regressions initially failed before pinning the
original protocol/epoch and enforcing the global10,000-candidate bound before
cloning. Final04 includes those fixes and the stronger interoperability probes.

Actual Chromium157:34/34 PASS, console errors/warnings0. The actual React form
was mirrored through both v1 and v2 for comparison, including earlier key values,
manifest history, every selected binary byte and an unchanged-form no-op. Both
inputs survived encrypted IDB storage, source-cache disposal and a cold unlock
under the independent new root. Both fixture PNGs were inspected. Evidence:
`output/playwright/security336-archives-capture/results-values-01.json` and
`{before-detach,after-cold-unlock}-values-01.png`; entry SHA256
`a2902483f50523ab56e4123353d3b68377eb6d4f889e3c5be98a74eddabdfb30`.
This is a desktop/light synthetic browser fixture, not the visual/provider matrix.
The owned browser and loopback listener were closed.

## Selected native04 acceptance

Frozen input `ADECE99F52C96CAD98452E21EFB20339B142E9F351DC0A273AF6DFE04A862EDD`.
Build04 SUCCESS21m18s; selected JVM25/25,0 fail/skip. Lint0 errors/208 warnings/
8 hints; no new issue/file pairs against03. The shared test-resource directory
uses the existing Gradle source-set API and adds one configuration deprecation;
this is distinct from the product lint report. Owned types07/scoped lint06 and
web build with GENESIS_MINDMAPS=true PASS. Final full JS1814/1814,0 fail/skip.

Actual API26/API34:57 unique cases PASS each. Base reports retain56 PASS and one
explicit opt-in skip; the exact20MiB source case then passed separately with
`genesisImportLargeBlob=true`. `archives-values-native-summary-04.json` combines
the evidence without relabeling the original `INCOMPLETE` base reports. Cases
include the actual Keystore six-size matrix,15 old-key lifecycle cases, streaming
forms, the new registry/UTF8/manifest paths, both fixed backup AAD histories,
native export/canonical readback, the actual production WebView's historical
import, large UI,18 whole-job cases including both new ports, six fences,
reconciliation, real SAF and journal-choice UI. Independent host checks per
platform:6 source/new-root,4 portable native-export and5 real-SAF checks PASS.

The actual20,615,080-byte file with15,461,065-byte plaintext and8 valid maps
passed decrypt/preview and retained input after closing. Total fixture time:
42,946ms API34 and49,919ms API26, compared with185,287/257,242ms in the previous
v1 fixture. The small `confirmed` change took329/198ms and submitted one value
chunk containing4 code units plus its small manifest. The unchanged payload
and plan were not resubmitted. These are synthetic emulator measurements,
not a latency promise for every field or OEM. Both dark PNGs were inspected.
API26 used its normal512MiB Java heap; API34 used192MiB. API26/192MiB, API35/OEM,
full visual/provider coverage and full-product recovery were not accepted here.

Actual Chromium157 final36/36 PASS, console0, including both authenticated v1
AAD vectors and complete v2 protected IDB/cold readback. Evidence:
`results-values-02.json`, `{before-detach,after-cold-unlock}-values-02.png`.
Both PNGs inspected, owned browser/listener closed. Final entry SHA256
`231baaccee483facd1ea1e2b0d1001eaaf6a7a7f4ba125fed407f8f5122daf6e`.
The existing selected premium feature run92/92 plus4 startup checks also passed;
this is separate from the complete security product matrix.

Native evidence: `output/qa/security336-archives-values-api{26,34}-04/` and runtime
`archives-values-{build-04.log,input-04,identity-04,jvm-04,lint-delta-04,
native-summary-04,import20-api26-04,import20-api34-04,cross-api26-04,
cross-api34-04,saf-cross-api26-04,saf-cross-api34-04}.json` (lint XML is separate).
Main APK `36AB9DF670E97CA0F41DC56ADAC29C2F457ED0B48BE20446783B5906B81A9335`;
test APK `4E46BA44FA17CEC660FB226E3D3728147A163C82AD6C9A1F3A1A26A5B5CE3DD6`.

Remaining release work includes moving binary retention off whole-file memory,
reading older manifest text from encrypted spill instead of retaining redundant
raw-string history, complete aggregate source/snapshot streaming and process
remnants/old-key opening before source publication. Capture still explicitly
refuses the large composed fixture with E2EE_SNAPSHOT_TOO_LARGE; it is not portable
or complete merely because ordinary preview now succeeds faster. All other
11 categories, normal writers/recovery/ACL/Drive/upgrades,48 system scenarios,
14-language semantic acceptance and independent human crypto review remain.
No Deploy, Play, personal-device action, version bump or activation occurred.
