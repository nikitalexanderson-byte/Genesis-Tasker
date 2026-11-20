# Bounded reader for original states1/2 path wrappers

20 November2026. Selected component acceptance PASS. Real source coverage
remains9/20 and v3 run remains closed.
Production stays3.3.5/149, floors0/pilot/cutover off/GENESIS_DEPLOY_ANDROID=false.

Old `E2eeMigrationSources.captureLocal` saves a technical JSON object containing
protocol1, ownerId, scopeId and an array of path IDs with Base64URL bytes. This
is different from source-stage-v1. Web `openLegacyMigrationSnapshot` and native
`E2eeLegacySnapshotStream.open` read that ORIGINAL wrapper using its original
migrationId, raw snapshotSize, snapshotParts and SHA-256. They never relabel a
legacy snapshot hash as a new source manifest hash or restore signing authority.

The original read port must already authenticate its protected records/actor;
the reference and target must come from authenticated coordinator history or
read-only custody. This module itself establishes neither. The existing
`openOriginalSourceStage`/`E2eeOriginalSource` handle is still deliberately limited
to its source-stage namespace; the new old-wrapper reader does NOT silently
widen that capability. Real narrow legacy custody/handoff remains required.

Before exposing paths, the reader preflights the full original wrapper and exact
physical source inventory, verifies every original part length/serial, original
SHA-256, target, full required path set and actual EOF. JSON names, structure,
duplicates (including escaped equivalents), numeric protocol, canonical unpadded
Base64URL/unused bits and trailing input are checked by a strict bounded parser.
Both historical serializer field orders and arbitrary valid path order work;
an accepted leading UTF8 BOM remains part of the original raw hash. JSON escapes
are decoded without assembling a huge string. Old64MiB/256-part limits remain.

Each selected path rescans the bounded original and validates its COMPLETE raw
hash and EOF again. This trades repeated IO/CPU for simple original provenance;
no throughput, peak-heap or maximum product capacity claim is made. Only one
protected raw part and one decoded output buffer are live per reader, with one
active path per handle. Metadata remains bounded. A partial selected prefix
does not prove complete input; reconciliation must await assertComplete after
actual EOF. Callback snapshots, original actor checks, close/retirement guards,
exact physical inventory and explicit missing/corrupt refusal prevent treating
an unread tail or unsupported state3 shape as successful empty source data.

Web borrowed output expires after advance/return/failure; the buffer is not
refilled through a previously returned view. Capability close immediately wipes
retained raw wrapper and borrowed decoded buffers and revokes pending reads.
Native SourceInput copies bounded bytes into caller-owned buffers. Close wipes
internal raw/decoded buffers; failed post-read guards wipe the portion written
by that read. Previously returned native caller buffers remain caller-owned.
No general heap/immutable-string/key-object zeroization is claimed.

The reader never writes, drops, normalizes or uploads source records. Existing
state1/2/3 readers remain unchanged. It discovers no omitted old attempt or orphan
outside the exact supplied reference. Full mixed history, incomplete/unknown
prefix handling, authenticated original actor/root/public signer, nested old
LocalCipher/safety/held/provider decoding with original AAD/keys and retained
provenance must still be composed by the coordinator. Raw queues grant no replay,
identity, billing or ACL authority. Container EOF is not semantic completeness.

## Current evidence

- Selected JS106/106,0 failure/skip,
  `legacy-snapshot-stream-js-final-11.log`: thirteen new reader scenarios plus
  content-plan/original/staged/migration component regressions. The earlier103
  result preceded the cleanup repairs and is superseded.
- Final owned TypeScript `legacy-snapshot-stream-types-final-06.log` and
  scoped ESLint `legacy-snapshot-stream-lint-final-06.log` PASS. Full `build:web`
  `legacy-snapshot-stream-web-build-final-02.log` PASS, including worker export,
  public gallery/documents/locales and offline precache.
- Actual Chromium157/WebCrypto/encrypted IndexedDB17/17, console0,
  `legacy-snapshot-stream-browser-final-02.json`: cold original,9MiB+7byte first
  path plus five3-byte paths, every decoded byte/hash, exact raw wrapper hash and
  length independently reconstructed in bounded Node buffers, lifetime/EOF/
  concurrency/retirement/refusal and retained originals. These are six SYNTHETIC
  project paths, not six real adapters or product recovery. Also covers stale
  reader cleanup, pending reservation retention and a raw part arriving after
  revocation. Earlier14-case bundle01 is superseded.
- Diagnostic native JVM21/21, build SUCCESS8m31s. This preceded the final
  strengthened physical-boundary test and APK fixture, so it is diagnostic
  evidence, not final input/provider acceptance.
- Diagnostic native input01:
  `FB2F0CDE59D8343214CA5BE0E2C8DC7505A2ABF378C517645CDB3440927BCF54`.
  Build SUCCESS3m23s and JVM211/211, but superseded before provider acceptance by
  the ownership repairs. Native input02 is also superseded by the last web
  raw-buffer cleanup repair; no02 source/APK acceptance is inferred from a raw
  Gradle success. Its9m16s raw build/JVM213/213 is diagnostic; the source guard
  explicitly refused build identity after that web repair. Final frozen input03:
  `480AA0F4129ACB7061F955CDCEC4BA7D1E752051B1558302B6A4872E2C9F551D`.
  Exact03 build SUCCESS33s, JVM213/213 across30 suites,0 failure/skip.
  Actual API26/API34 each pass2/2 new parser cases plus3/3 complete-plan readback
  regressions,0 failure/skip. No earlier APK proves this final parser.
  Full native lint of the new input was
  not run; final candidate full lint remains mandatory.
- Each provider verifies the complete12,583,247-byte original JSON/Base64 wrapper
  over49 physical protected parts and9,437,206 decoded bytes/six logical paths.
  Independent bounded Node construction matches original hash/size/part count
  and all six logical hashes. A fresh JCA small vector from EACH provider opens
  through a WebCrypto read-only port with a root and PUBLIC signer only:18 bytes,
  six paths/seven original-part reads, no private signing key. Both extracted
  artifacts per provider match their saved hashes. Reports:
  `output/qa/security336-legacy-snapshot-stream-api{26,34}-03/results.json`;
  runtime `legacy-snapshot-stream-host-api{26,34}-03.json`.
- Regression host checks also match each complete9MiB+7byte readback file and
  its3-byte local-only value,38 envelopes/gets and the exact expected inventory.
  Main APK SHA-256:
  `2F06B4772133CAE90A7FFE64EE9A7C59FAEF403371764B6AA1ED48D4DCF0F24A`.
  Test APK:
  `B0E4362CD4A208A10ABDF8026EC4F54E17DF6B4481DC308EA125B803102A6926`.
  Frozen source and APK identities still match after all provider/host execution.

New-provider fixture elapsed10,891/16,192ms(API26/API34), configured max heaps
512/192MiB; these are not peak-memory or product performance/capacity claims.

The initial missing-module run is red evidence. An isolated owned draft kept
the preceding accepted native source frozen during its lint. Draft tests found
two real cleanup defects before the module entered app/: reusing an expired
decoded view and retaining the raw wrapper buffer after close. Red witnesses
`legacy-snapshot-stream-draft-01.log` and
`legacy-snapshot-stream-close-red-04.log` are retained; fixes are covered by
actual app tests/browser above. Initial isolated TypeScript diagnostics included
missing global project declarations and were not accepted type evidence.

Expanded actual-module tests additionally reproduced stale-reader cleanup
closing a later active reader, early reservation release while an original read
was still pending, and a raw buffer arriving after close escaping cleanup.
Red witnesses: `legacy-snapshot-stream-owned-cleanup-red-08.log` and
`legacy-snapshot-stream-late-raw-close-red-10.log`. Per-reader ownership and actual
drain now control cleanup/reservations; close always wipes a newly arrived raw
buffer even when its cursor was already revoked. Final03/JS/browser evidence
above covers the repaired source; diagnostic artifacts are not substituted for it.

This is an inert compatibility reader. Complete source/plan/coordinator
publication, protected remote originals, true bounded native/WebView inputs,
11 remaining real sources, normal writers/unlock/enrollment/recovery/shared
rotation/attachments/Drive, direct signed upgrades,48 product scenarios,
14-language semantics and independent human crypto review remain mandatory.
