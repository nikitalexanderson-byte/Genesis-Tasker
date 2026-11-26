# Native archive forms: bounded encrypted spill

20 November2026. Implementation and selected web acceptance; native build and
large-data acceptance are still in progress. This is not a release or a complete
`personal.archives` adapter. Source coverage remains9/20.

## Problem and boundary

A supported16MiB plaintext backup /24MiB file can produce a decoded payload plus
an encrypted restore preview exceeding the previous32MiB form and48MiB memory
limits. Applying those limits on every ordinary setter blocked existing preview
functionality even with E2EE migration disabled. Increasing the limits around a
native StringBuilder and JSONObject would keep several huge copies in the heap.

The actual renderer now sends exact ordered UTF16 fragments without allocating
another whole-form UTF8 buffer. The native form bridge writes bounded encrypted
frames to its own `noBackupFilesDir/backup-forms-v1/<session UUID>/` directory.
There is no full StringBuilder or JSONObject state tree on the adoption path.
`JsonReader.skipValue` streams the large state; the small protocol/settled/file
header is checked before acknowledgement. Original nested JSON is retained for
the shared strict duplicate-name parser, which still precedes reconciliation.

Each128Ki-code-unit fragment encodes the exact code units, including a surrogate
pair split by transport and lone surrogates, before existing LocalCipher AEAD.
The AAD binds original owner, app activation epoch, view, blob and chunk index.
An authenticated footer binds total characters, frame count and full SHA256;
readback requires exact EOF. Length/order/type/integrity failures refuse the
candidate. The previous acknowledged form remains until successful replacement.
Migration memory freeze, original operation capability and final reset-form
exception remain in force. View disposal cancels incomplete candidates and keeps
its preceding accepted input. Account transition clears references and deletes
owned accepted frames; JVM/renderer strings are not claimed to be securely erased.

The form limit is96Mi UTF16 code units; encrypted spill quota768MiB includes
other retained session directories. No accepted form is evicted to free space.
Original file bytes remain in the separate bounded native file inventory; that
inventory still has its48MiB aggregate memory bound. No file-size limit changed.

## Crash remnants and source obligations

After authenticated complete readback, a small independently encrypted locator
stores the exact AAD binding/count/hash before acknowledgement. A lost process
therefore cannot leave acknowledged ciphertext whose binding existed only in RAM.
The source-only restart reader authenticates the locator and complete stream.
Both old/new candidates after a crash remain inert history; neither a locator nor
its embedded stage/operation/subscription/ACL values authorize replay or restore.
Only current-session referenced files are cleaned up; no other session is swept.

The product does NOT yet reload these crash remnants, recover their independent
selected-file bytes or migrate all of them under the new root. The complete
archive adapter must enumerate every retained session, bind the original owner,
capture/open the old local key, reconcile these sources and prove portable new-root
readback. Missing keys, corrupt locators, unknown files or incomplete candidates
cannot silently become an empty successful archive source.

The current aggregate archive collector still uses its48MiB encoded capture and
shared32MiB raw-form bound. It now refuses a known large form BEFORE materializing
that form in native memory. This is an explicit migration release gate, separate
from ordinary preview compatibility. The coordinator's overall snapshot streaming,
binary source lifetime and composed budgets still need implementation/acceptance.

## Evidence so far

- Full JS1787/1787 PASS,0 fail/skip; focused form6/6 including a38MiB combined
  synthetic state that forbids any whole-form TextEncoder buffer.
- Owned TypeScript check and scoped ESLint PASS. Web build PASS:98 HTML variants,
  14 languages, exact source dictionaries,280 gallery assets and offline precache.
- Actual Chromium157/React/File/WebCrypto/IDB/Web Locks:27/27 PASS, console0.
  Native-style exact form/file references and new-root cold readback retained.
  Before/after PNGs inspected. The provider ports are synthetic and CSP blocks
  external connections. This is desktop/light, not the full visual/provider matrix.

Evidence in `output/release-3.3.6/runtime/`:
`archives-spool-{js-01,types-01,lint-01,full-js-01,web-build-01}.log`.
Browser evidence in `output/playwright/security336-archives-capture/`:
`results-spool-01.json`, `before-detach-spool-01.png`,
`after-cold-unlock-spool-01.png`. Bundle SHA256:
`e181b6ddfb4a413b7e6d620e2858818a6f472ca84b6026a8d7a3e0ae06d9d33a`.
Owned browser/listener closed after acceptance.

Initial native compile01 compiled an earlier main snapshot while the newly added
restart-reader test saw later source, and failed on the absent compiled `retained`
method. It is not accepted build evidence. Build02 freezes all native inputs and
will require matching source/APK identity before device acceptance.

Native02 assembled both APKs and passed selected JVM16/16,0 fail/skip. Lint02
was intentionally stopped after actual failures; it is NOT a successful complete
native build. Original inputs/APK identity:

- input `A0EED18E2D3D2E07368D2DB71D32522B82262325A50C2A113C788DE4765A0B2B`;
- main `FE09D529C0AE5A0CFCA63FC9606039C9B27596E84CF3A6A48D7A7CC36FA068BD`;
- test `6C5C4BAE2A67794018A6D56F0C07BD4B0C298A03341BF580246FAB6AF736E168`.

Actual API34-02:28/29 PASS,1 failure. The40MiB stream/header cases and all26
existing operation/fence/reconciliation/SAF/journal cases passed. Complete
42,074,112-character readback took17,879ms under the normal201,326,592-byte Java
heap limit. Reported heap before/after was4,925,360/7,759,960 bytes; these are NOT
peak measurements. The real large-file UI case timed out after decrypt failed.
Actual API26-02:26/29 PASS,3 failures: the40MiB stream, large-file UI and journal
UI. Small headers and24 existing non-journal cases passed. Large-frame readback
raised a real `AEADBadTagException` in Android Keystore. This is not waived as an
environment-only failure. Failure logs/screenshots remain under the runtime and
`output/qa/security336-archives-spool-api{26,34}-02/`.

A separate host diagnostic reproduced the large UI failure in the shared backup
format: the previous repeated Base64 regexp raises `RangeError: Maximum call stack
size exceeded` for a supported15MiB payload. `backupBytes` now uses a linear
alphabet/padding/unused-bit check without re-encoding the whole buffer. Focused8/8,
full JS1789/1789, owned types/scoped lint PASS. Actual large UI acceptance is still
required after this correction. Assembly03 succeeded in2m1s, with an isolated
Keystore boundary probe and the same still-unfixed native spool implementation.
Its probe/large-UI runs are in progress; no final native acceptance is claimed.

The completed API26 probe03 isolates the Keystore boundary: ordinary calls work
through65,536 bytes; at131,072 bytes bounded decryption succeeds where the ordinary
call fails; at349,528 bytes only bounded encryption AND decryption pass. All six
sizes10,924/21,848/43,692/65,536/131,072/349,528 pass the bounded-both path. The
diagnostic intentionally fails its production-path assertion, with the complete
matrix in `output/qa/security336-archives-keystore-api26-03/`.

LocalCipher now feeds8192-byte updates on both paths, captures the IV before
finalization and authenticates with empty-input doFinal. Format/key/AAD are
unchanged. Provider output stays internal until authentication; partial output
and owned input buffers are wiped on failure. Bad-tag/AAD and cross-path checks
are part of the final native probe. The new spill root also participates in the
actual legacy key-loss inventory; retained form locators cannot authorize a
replacement key if the old witness/key are missing. A separate synthetic context
fixture tests that exact constructor path without touching a real default alias.

API34 large-UI03 moved past the regexp defect but its JS callback's30-second
fixture deadline expired during bulk work. The decoder now avoids the iterable
conversion's multi-million-element temporary array. The fixture separately names
file/decrypt/preview phases, allows90 seconds for a bulk JS callback, fails promptly
on a real product error and saves synthetic failure evidence. Its180-second phase
deadline remains; a raised fixture callback deadline is not product acceptance.
Build04 was stopped to include the missing spill-root key inventory check;
build05 has frozen input
`A718C4795F2F0A27F485F77023E7DBD2F05B73E2DF3E559131BDC8F8C4E5D3F7`.

Final web05: full JS1789/1789, owned typecheck/scoped lint and web build PASS.
Actual Chromium15729/29 PASS, console0, including the full16MiB+tag Base64 limit
and refusal of nonzero unused bits. Both before/after PNGs inspected; browser and
listener closed. Browser evidence `results-spool-05.json`,
`before-detach-spool-05.png`, `after-cold-unlock-spool-05.png`; bundle SHA256
`22b510b5ea17dbc304271552fbb9d30cd697e5b80604c6dc618378922817edcd`.
Native05 device/complete-build acceptance is still pending.

Selected native05 acceptance is now complete on both owned devices:49 unique
cases PASS each,0 failures/unresolved skips. The base runner recorded48 PASS and
one genuine opt-in skip; `genesisImportLargeBlob=true` subsequently ran that exact
20MiB source/boundary case separately and passed. Original skipped reports remain
unchanged. `archives-spool-native-summary-05.json` preserves both runs and the
unique-case disposition, rather than relabeling the initial skip as a base pass.

The49 cases comprise the actual six-size Keystore matrix (including bad tag/AAD),
15 key-loss lifecycle cases including the actual context inventory,2 spool/header
cases, the real large archive UI,4 source-file cases,16 whole-job/memory cases,
6 fences,2 reconciliation cases, real SAF and journal-choice UI. Both native SAF
captures passed5 common strict-parser/WebCrypto checks each. API35, real/OEM
devices, all-source recovery and the full visual/provider matrix were not run.

The40MiB stream readback took34,830ms on API26 (normal512MiB Java heap limit) and
27,007ms on API34 (normal192MiB). Heap before/after was1,509,600/8,753,552 bytes
on API26 and5,204,224/10,156,152 on API34. These are not peak measurements.
The actual archive contained15,461,065 plaintext bytes /20,615,080 file bytes;
the retained decoded payload plus encrypted preview occupied36,077,145 form
characters. All eight valid maps were independently opened by the synthetic
gateway and matched; preview occurred once, restore never ran, and form retention
survived dialog disposal. The aggregate source deliberately refused with
`E2EE_SNAPSHOT_TOO_LARGE` before materializing this large form. Both dark preview
PNGs were inspected. Total fixture durations were257,242ms(API26) and185,287ms(API34).

That latency is an explicit remaining UX/release concern: ordinary setters still
rewrite unchanged large payload/plan values. The next implementation should retain
independent serialized state values and commit a small authenticated manifest;
small input changes must not retransmit/re-encrypt the same multi-MiB values.
Do not replace that work with a longer timeout or claim these selected functional
passes close full-product latency, aggregate streaming or archive portability.

Evidence: runtime `archives-spool-{assembly-identity-05,jvm-05,native-summary-05,
import20-api26-05,import20-api34-05,cross-api26-05,cross-api34-05}.json`,
both `output/qa/security336-archives-spool-api{26,34}-05/` and their unchanged
base reports/opt-in logs. Main APK SHA256
`EEFFDC45B51A0C0714BFCA858D6AF0DD53928F622676585C5973BA312E4C5446`;
test APK `A3EE87F5649AB3DA45665503488A6A52CB4A5CBF238F29DA0FB4497AF697B1A4`.
Final full JS06 is1790/1790 after the additional192-candidate canonical-padding
comparison with independent Node Base64 roundtrips; scoped lint06 PASS. Native05
complete build SUCCESS21m11s, selected JVM16/16,0 fail/skip, lint0 errors/208
warnings/8 hints. No new warning/file combinations relative to native-forms02.
Evidence: `archives-spool-{build-05.log,identity-05.json,lint-05.xml,lint-delta-05.json}`.
Build04 was intentionally stopped before acceptance to include the restored-form
key witness; neither build02 nor04 is represented as a successful final build.

Production3.3.5/149, update floors0, pilot/cutover off and
GENESIS_DEPLOY_ANDROID=false remain unchanged. No Deploy, Play or personal devices.
