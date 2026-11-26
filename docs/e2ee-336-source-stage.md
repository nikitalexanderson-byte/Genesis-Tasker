# Protected source staging — local, inert boundary

20 November2026. Local module accepted within the scope below. This is neither the full
archives adapter nor an activated migration. Production3.3.5/149, coverage9/20,
legacy32/48/64MiB aggregate gates, update floors0 and pilot/cutover off remain.

`app/e2ee/source-stage.ts` and native `security/E2eeSourceStage.kt` use the existing
signed-AEAD vault and `local-snapshot` domain. No new cipher/KDF/HTTP/restore port
is introduced. The caller supplies actual durable-key confirmation, storage
admission and the original-source fence/current-actor checks. These callbacks
are requirements, not evidence that product lifecycle integration is complete.

## Binding and persisted format

The authenticated target includes content owner/scope/kind, original device
actor, device-vault scope and device ID. A shared content owner may differ from
the actor. Its SHA256 fingerprint selects a target-local encrypted catalogue.
Each attempt has a random UUID. A104-character technical record ID binds that
fingerprint, UUID, role, path index and part index. Private inputs, plaintext
digests, source names and manifests remain inside encrypted records.

Metadata uses the established tagged canonical command-value encoding; it is
not JSON. The new bounded decoder rejects non-ASCII technical strings, unsafe
integers, unknown tags, duplicate/unsorted/invalid object names, trailing data,
truncation and resource-limit violations. New metadata is decoded and
re-encoded before adoption. Explicit cross-platform wire bytes are independently
enumerated in `tests/fixtures/e2ee/canonical-values-v1.json`.

1. Catalogue marker and capturing journal are created in one vault CAS batch
   before the producer is called.
2. Input is coalesced into256KiB parts. Each sealed part and its journal advance
   share one durable transaction. Buffer acceptance is **not** a durable-input
   receipt or a complete snapshot. Originals remain retained by the caller.
3. A path completes only after its producer returns successfully through actual
   authenticated source EOF. A rejected/swallowed/overlapping write poisons the
   attempt. Faulty outstanding producers are drained before owned buffers are
   released; no completed prefix is adopted.
4. Finishing reopens every sealed part, checking exact order/length/digest and
   serial1, then atomically stores manifest, complete journal and catalogue
   marker. The resulting reference is still inert: **no coordinator pointer,
   reconciliation, transport or restore authority exists in this module**.
5. Opening checks context, canonical manifest identity, journal agreement,
   catalogue marker and the exact referenced part-key set. Reading checks every
   part and actual EOF. Early close never certifies completeness. Web chunks are
   borrowed plaintext and wiped on next/return; native closes/wipes its bounded
   private buffer and never retains the consumer's output buffer.

Restart discovery checks incomplete journals and every referenced technical part
as well as complete stages. Missing catalogue/journal, extra/missing parts,
changed actor/context and unknown keys for the selected target refuse. Discovery
does not resume, erase, sweep or rebind input. Metadata serials are re-read to
detect concurrent discovery changes; this does not replace the caller's fence.

## Resource and remaining integration limits

Metadata is bounded to2MiB, paths to20, catalogued attempts to64 and parts to10000.
Both real storage implementations stop key discovery at10000 records rather
than returning a truncated successful list. The account-wide record bound can
be reached before a per-stage capacity allowance; refusal preserves originals
and prior attempts. This is not unlimited account capacity or a retention UI.
Callbacks must admit against actual free/quota/provider/record constraints;
actual storage write failure still remains possible and fails closed.

Next steps remain the versioned coordinator state/reference publication, complete
required-path registry integration, bounded common/native-WebView reader and
per-record content reconciliation. Preserve old snapshot readers and all
cancelled ancestors. Complete process-directory collection and opening **all**
nested old safety/held/Room/archive ciphers with original AAD/keys remain open.
Protecting an opaque device-bound cipher under a new root does not make its
content portable. No crypto/writer/update protocol or activation flag changes.

## Evidence recorded so far

- JS final02:87/87 selected codec/stage/storage/device/directory/migration cases,
  no failures/skips. Stage includes crash-after-commit, capacity/disk refusal,
  poisoned producer, incomplete/unknown inventory, target/actor distinction,
  early close, immutable input/reference snapshots, concurrent creator/finisher
  CAS and outstanding-write draining.
- Scoped ESLint and owned TypeScript checks pass, including the actual browser
  interoperability harness.
- Real Chromium157/WebCrypto/IndexedDB, Playwright CLI:14/14 checks. A9MiB+13-byte
  path and65,543-byte path cold-read exactly through a newly unlocked device
  connection. An incomplete attempt and its original ciphertext survive;
  capacity refusal, actor retirement and borrowed-buffer wiping are explicit.
  This is not a browser process-kill, power-loss or complete product test.
- Final browser02:15/15, including actual API34/JCA stage -> Chromium/WebCrypto/
  IndexedDB readback of both opaque63-byte paths. The14 checks above repeat in
  this final browser run; the new interop check is additional.
- Native input01 `811034B9C6C296E3038B3A7212E20747E93DC250706CA433BCCBAC6897B0E500`:
  build SUCCESS18m20s; selected JVM147/147, no failures/skips. Actual API26/API34
  each3/3, including51MiB original24/17/10MiB files ->71,304,847 source bytes
  stored through actual SQLite. After deleting only the synthetic old spill
  alias and reopening both key custody and SQLite, the entire source matched
  an independent bounded host construction. Java max heaps512/192MiB; elapsed
  112,750/102,014ms(API26/API34). No process kill, power loss or peak-heap claim.
- Input02 `465616425600287ABDEBE573E05CF47E1BCE42B2739631A843F727691F05807C`
  adds only test/fixture changes: stronger fixture durable-key comparison,
  four original/replaced/unselected values with lone UTF16 units, two original
  manifest histories, and actual JS/JCA interoperability. Build SUCCESS2m17s.
  Main APK is byte-identical to01; lint XML is identical too:0 errors/208
  warnings/8 hints, no added issue/file pairs. JVM147 belongs to01; no new JVM
  run is claimed for02. Actual API26/API34 each4/4, zero failures/skips.
- Final mixed native input is71,305,891 bytes. All bytes, three original binary
  digests, four raw values/provider units and both manifests independently
  match after old-alias deletion/cold read. Elapsed95,529/82,304ms(API26/API34),
  max heaps512/192MiB. Each native report's two extracted artifacts were hashed.
- The public JS vector contains both inert incomplete and completed attempts
  with a distinct target owner. Both actual native providers read it. Each native
  provider also produced a new signed stage that Node WebCrypto fully reads:
  two opaque paths/63bytes, including duplicate private JSON names retained as
  bytes and non-UTF8 binary. This is interoperability, not product key custody.

Frozen Main APK SHA256:
`BFFD5AF4E0426447BB999C211F61BD610F8CA97A59B19939E392F5B9DA57AAF9`.
Test APK02:
`427C98397669CCB06D22199EA0DDC22B63950D165D090D2151D68F69B66D808C`.
Input03 only removes a trailing blank line from the public canonical JSON
fixture for `git diff --check`:
`181E3710A28804C37179AAE220DE3E89D1CC0A5828F1D9D7D4FE4239D2FB187E`.
Build SUCCESS1m22s. Main APK is identical; all668 Test APK ZIP entries were
compared and only `assets/e2ee/canonical-values-v1.json` differs. All code entries
are identical to02. Final Test APK03:
`2961C38DECDD4AA4327C56522AE0BF73754F9D13753E0B6875D646B82E976A3A`.
Actual03 API26/API34 each1/1 focused canonical-vector case passes. The4/4 stage
runs remain explicitly02 evidence; no full03 repeat or new JVM run is claimed.
The native test uses separately named synthetic no-auth LocalCipher aliases for
old spill and the independent new-root bundle. It verifies actual filesystem/
Keystore/SQLite reopening, **not** the product user-presence/recovery flow, a
fresh enrolled device, or complete nested-archive portability.

Evidence lives in `output/release-3.3.6/runtime/source-stage-*` and the selected
fresh native QA run directories. Failed drafts and superseded identities must
remain distinguishable. Full20-category/48-scenario/direct-upgrade acceptance,
14-language semantic review and independent human crypto review are separate
release/activation gates and have not been completed by this increment.
