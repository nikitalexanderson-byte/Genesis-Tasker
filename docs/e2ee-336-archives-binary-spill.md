# 3.3.6: native binary source retention

Work in progress,20 November2026. This increment follows accepted value transport
at98db50e4. It does not turn archives into a complete migration adapter, increase
coverage beyond9/20, or enable any production protocol/floor/pilot/cutover.

## Retained input and ownership

`BackupMigrationInventory.File` moves its original provider descriptor and
original bytes to the existing authenticated `BackupFormSpool` before native
adoption. The owned ByteArray is wiped and released after successful persistence;
the original descriptor then lives in encrypted spill. A separate binary spool
cannot cancel an incomplete value transfer from the same view. `BackupImportFile`
still owns the currently selected, bounded file while the renderer requests its
chunks; clearing that transfer does not erase earlier acknowledged source input.

The stored value is an inert JSON wrapper with the ORIGINAL descriptor text and
standard Base64 of the original binary. No UTF8 decode/re-encode of binary is
used. AAD includes the original owner, process epoch, view, file role and blob ID.
Existing frame index/footer/hash/EOF and encrypted restart locators are reused;
no AEAD or cryptographic primitive was reimplemented. Small descriptors use the
strict Android JSON reader, reject duplicate/escaped names, unknown properties,
wrong types, unsafe numbers and trailing input, and retain original UTF16 text
separately. Native-generated provider metadata may contain lone surrogates.

`open()` is a source-only bounded stream. Complete consumers must reach EOF:
length, SHA256, canonical Base64/padding/unused bits, wrapper suffix and the
underlying authenticated footer/EOF are verified before `bytes()` returns.
Closing after reading only a prefix proves no complete file. Descriptor-only
readback authenticates bounded header frames and also proves no completeness.

The inventory reserves a candidate before IO, including pending memory/count
budgets. Bulk encryption runs outside the global inventory monitor. Each bounded
write checks the original opaque session incarnation, mounted view and native
operation permit; all are checked again before adoption. Clearing changes that
incarnation even if the same UID and numeric process epoch are reused. A late
candidate cannot enter the new session. A failed reserved candidate is cleared
without touching acknowledged input. Duplicate rejection before reservation
cannot retire an existing accepted File. Capture refuses while a reservation is
still draining, including one from a detached view.

The physical768MiB quota is shared across native sessions. Check+flush of each
bounded frame/footer/locator uses one process-wide quota monitor; encryption and
full metadata readback stay outside it. The first buffered file magic is counted.
This covers the existing one-process app/worker model, not a new multi-process
storage protocol. Binary reuses UTF16/Base64 framing, so disk amplification is
approximately128/27 (4.74x) plus fixed frame/metadata overhead. This is bounded,
not an optimized binary container.

Confirmed manifest history no longer retains a redundant plaintext String list:
only encrypted stored values and small counts remain. Bounded legacy capture
materializes authenticated history on demand. Its active rawManifest is the last
authenticated original history entry.

## Acceptance and remaining gates

The first draft JVM run completed19/20, with one failure in the pre-integration
File-clear test. It started before the corresponding integration edits; its
original log remains `output/release-3.3.6/runtime/archives-binary-jvm-01.log`.
It is not acceptance of the working sources. Draft02 also began before later
strict-metadata/quota edits and failed test compilation against the older main
class signatures. It did not execute tests of the final candidate.

Targeted tests now include exact binary/metadata roundtrip, ciphertext truncation,
session interruption, more than48MiB selected/unselected retention, view detach
while IO is paused, duplicate/late adoption, same-UID/same-epoch relogin and quota
failure without accepted-data loss. A deterministic concurrent-session quota
test checks atomic physical admission. Native probes use real Keystore and the
strict reader for a24MiB non-text stream,51MiB retained candidates, and malformed
descriptors. Actual SAF and large preview fixtures assert zero retained File
ByteArray/descriptor memory after spill. Final frozen build/API26/API34 results
must be recorded separately from value-transport native04 evidence.

Frozen binary03 input is
`760365F01A7331E7730426023BDC1C9653B7C05F4E3C4E8556159141EC528704`.
Its selected JVM33/33 passed with no skip/failure. Both APK assembly tasks
completed and their identity was recorded in `archives-binary-assembled-03.json`
before running the isolated three-case binary suite. Full Gradle03 subsequently
completed SUCCESS18m21s with the SAME source hash. Selected JVM33/33; lint0 errors,
208 warnings and8 hints, no new issue/file pairs against value-transport04.
Final build identity remains separate from the earlier assembly identity.
Actual API26/API34 each passed all three binary cases, no skip/failure. The24MiB
non-text readback took23,288/25,491ms respectively; retaining51MiB in three files
took35,495/30,525ms. These are emulator fixture measurements, not product latency
promises. API26 used512MiB heap, API34 used192MiB. The host independently recomputed
the original deterministic24MiB SHA256 and verified both runner-bound report
hashes and retention metrics on each platform. This does not prove API26/192MiB,
API35/OEM, a complete source adapter, or recovery of all51MiB through a new root.

Reports: `output/qa/security336-archives-binary-api{26,34}-03/results.json`;
host evidence: `output/release-3.3.6/runtime/archives-binary-cross-api{26,34}-03.json`.
Focused JS77/77, owned types01 and scoped JS lint01 passed. During source review,
bulk File persistence was found inside the bridge import monitor, and final
streamed metadata readback still lacked per-read cancellation. Those remain a
following integration gate: window disposal must not wait for bulk IO, and a
retired session must interrupt final metadata readback. Neither is claimed fixed
by the three binary-provider cases. The integration follow-up now serializes
file selections with a coroutine mutex separate from the short window monitor,
and checks the original session before/after every bounded metadata read and
before locator publication. New paused-IO native cases exercise prompt window
disposal and job-end invalidation while migration must still wait for actual IO.
A new JVM case retires a candidate during final metadata readback and preserves
the earlier accepted source. Frozen build04 has separate evidence; binary03
results are not relabeled as those new cases.

This guard is currently wired to binary retention. The existing synchronous
form/value ports and whole aggregate capture still have broader monitor/session
lifetimes to resolve before complete archive acceptance. In particular, disposal
must be able to invalidate during a large value publication, and account epoch
retirement must be observable before waiting for inventory cleanup. A passing
file-selection close/end case does not establish those other port lifetimes.

## Selected binary04 acceptance

Input `5AE5744ED2647F4283F8401C5650C582E754A5901B46B5B8E9402214E1F5A07E`.
Full build04 SUCCESS19m; selected JVM40/40,0 failure/skip. Lint0 errors/208 warnings/
8 hints, no new issue/file pairs against value-transport04. The added test-resource
directory no longer contributes its previous configuration deprecation; the
older main/androidTest asset-source deprecations remain outside this change.
Both APK assembly tasks completed before platform runs; the assembly identity
and final completed-build identity retain their separate timestamps, same source
hash and APK hashes. The build never changed its inputs to absorb a test result.

Actual API26/API34 each passed58 selected cases,0 failure/skip. The20 whole-job
cases include prompt Main-thread disposal during paused file retention and
prompt job-end invalidation, with the migration still waiting for borrowed IO.
The run includes Keystore/witness loss,40MiB raw forms, strict value/manifest
retention, both portable AAD histories, actual historical WebView import,
large preview, six operation fences, reconciliation, real SAF and journal UI.
The unchanged DataImportBlobStore suite was not repeated; its prior opt-in20MiB
evidence remains in value04 and is not added to these58 cases.

The24MiB non-text readback took22,716ms(API26)/24,702ms(API34);51MiB history
retention took34,121/29,217ms. The actual20,615,080-byte encrypted file and eight
valid maps passed preview without restore in60,236/53,725ms. The small confirmation
submitted one4-code-unit value plus the manifest,247/335ms. The large File's
retained native array/descriptor memory is0 after spill and closure; this does
not say the active SAF/renderer transfer has no bounded transient buffers.

Per platform,21 independent host checks passed:6 values/source/new-root,5 real
SAF,4 portable native-export/canonical-AAD and6 binary/runner-bound checks.
The24MiB digest is recomputed independently by the host. As before, the new-root
roundtrip uses the bounded small captured input, not all51MiB through the still
blocked complete aggregate coordinator. API26 heap512MiB, API34 heap192MiB;
API26/192MiB, API35/OEM and full product/visual/provider acceptance remain open.
The native dark screenshots were inspected: API26 shows the final eight-map
preview; API34's captured viewport shows the upper form despite the scroll
request. Both preview states were functionally asserted, but the API34 preview
viewport itself is not visually accepted by that screenshot. A subsequent
capture must wait for the actual scroll position before labeling it a preview.

Evidence under `output/release-3.3.6/runtime/`:
`archives-binary-{input-04,assembled-04,identity-04,jvm-04,lint-delta-04,
native-summary-04}.json`, `archives-binary-build-04.log`,
`archives-binary-lint-04.xml` and the four `*-cross-api{26,34}-04.json` reports.
Native source artifacts are in `output/qa/security336-archives-binary-api{26,34}-04/`.
Focused JS77/77, owned types01 and scoped JS lint02 passed. Previous saved
commit98db50e4 passed Source checks44672125329 web/API+Android; that earlier CI
does not verify this following unpushed increment.

Main QA APK `C335F42B734565C9EEDEB444237F0DF0C1A8A51B4324FD64BBA47F4F3A760CE8`;
test APK `3FEFC004EF96690371221B360DDF14BE02699F9F2D9215E230A852988A52C5BE`.

The current aggregate collector still refuses the32/48MiB bounds before reading
oversized spilled input; it has not become streaming. Whole24MiB input can still
exist during its bounded original SAF transfer and migration copy. Complete
source/coordinator snapshot streaming, old process remnants and opening all
nested old ciphers before protected source publication remain release gates.
So do the remaining11 categories, normal writers/recovery/enrollment/shared
ACL/files/Drive/direct upgrades,48 system scenarios,14-language semantic review
and independent human cryptographic review. No restore, Deploy, Play, personal
device, version bump or activation is authorized by these synthetic probes.
