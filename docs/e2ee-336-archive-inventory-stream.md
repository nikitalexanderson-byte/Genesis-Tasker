# Retained native inventory: original-source stream

20 November2026. Selected component acceptance. This is this process's
retained-view producer, not the personal.archives adapter or a complete
coordinator snapshot. Coverage remains9/20 and activation stays off.

`BackupMigrationInventory.source()` captures a small immutable reference
catalog under its monitor. `BackupInventorySource.writeTo()` opens and reads
forms, every accepted value/manifest and selected/unselected files after that
monitor is released. File readers also run outside the File monitor. Original
actor, inventory revision and opaque incarnation checks run around bounded IO;
clearing/reopening the same UID/epoch cannot rebind an old source. A retired
File is visible before its arrays/storage are cleared.

The producer uses `BackupSourceJson`, bounded UTF16/UTF8 and platform Base64URL
blocks, and real source EOF/footer verification. It preserves raw private text
and provider metadata, including BOMs/lone surrogates, without an aggregate
JSONObject/Base64 tree. The caller owns its output and must supply encrypted
quarantine staging. An exception may leave even syntactically complete output;
valid JSON alone is never a snapshot commit. This producer has no HTTP,
restore, replay, identity, billing or ACL operation.

## Local source format3

This number versions the local retained-form wire only. It does not raise the
crypto protocol, writer protocol, key epochs or mandatory update floors.

The envelope keeps original owner/sessionEpoch and per-view identity/mounted
state, rawForm, valueForm and files. The original raw form and each raw value
remain strings. Existing value-form2 manifests/history retain their original
text. Files now carry `{rawDescriptor,bytes}`: the original descriptor JSON
string and streamed unpadded Base64URL bytes. The shared strict reader validates
that original JSON before projecting a typed descriptor, and retains both.
Duplicate/escaped names, wrong types/length/hash and trailing data refuse.

The common reader still accepts the old1/2 formats. Its existing aggregate and
per-field limits remain in place. The legacy capture and coordinator paths have
not been replaced by this producer; passing the large output back into their
whole JSON/ByteArray APIs is not streaming acceptance.

## Validation inputs

The early-origin increment and SDK compatibility repair are in the same final
input03. Failed origin01 compilation and origin02 lint reports/results remain
preserved separately; see `e2ee-336-archive-origins.md`.

Frozen input03:
`64E65B7F5F4E7DA1CEABB384F3A473CDA9D487CD74D74B60E007A62F58F75962`.
Main APK:
`F770CD2CE099F19E97B97AFA53D14162024B6A4D531AD50B4B7D706FFD8D68CE`.
Test APK:
`AFFE55D8C069F2ED6BC61D69D5287FFB41171818B4299D8D6A01228000CF15E8`.

Related JS75/75, scoped ESLint and owned typecheck PASS. Selected JVM51/51,
0 failure/skip across9 suites, including original-unit/source ownership,
stale catalog, same-UID/epoch retirement and mid-output actor failure.
Build03 SUCCESS20m36s, lint0 errors/208 warnings/8 hints, no new issue/file pairs
against source-wire01. Actual native03 passed67/67 onAPI34 and66/67 onAPI26.
Both platforms passed the64 unchanged functional/source/crypto cases and the
new real-input/large-source cases. API26 failed only the new paused-output test:
its pause predicate assumed a write array larger than1024 bytes. The actual
platform encoder emits single bytes; the large fixture's maximum array write
was277 bytes onAPI26, compared with8124 onAPI34. The failed report is retained.

The androidTest-only repair pauses by total stream position instead of provider
write size, with no timeout increase or action retry. App/JVM sources are
unchanged. Final input04:
`8D019006D15FD53A698B7D076749C0D3AD6AB295D546AF1CE767539B7310C528`.
Build04 SUCCESS2m19s, same Main APK byte-for-byte, new test APK
`A6BA15A2B3737145DF03F1FA89126C0EDA74BAE8E62ED9E376DBA78E373DD49A`.
Lint XML is identical to03. JVM51/51 above belongs to03; no new JVM run is
claimed for the androidTest-only repair.

Actual04 API26/API34 each passed18/18 focused cases,0 failure/skip, including
all3 inventory-source and3 early-origin cases. The unchanged64-case functional
group is explicitly03 evidence, not a repeated04 run. Each04 platform passed31
independent host checks (values6/SAF5/portability4/binary6/source-wire5/inventory5),
and all15 extracted artifact hashes match their runner records.

The actual24/17/10MiB history totaled51MiB of original bytes and71,304,915 wire
bytes. A bounded host construction independently matched the whole wire digest
and all three binary digests. Full synthetic fixture time, including retention
and streaming, was75,108/61,300ms(API26/API34); Java max heap512/192MiB. These are
not peak-heap, all-account capacity or throughput/SLA measurements. Account
clear completed while binary output was paused in7/2ms, then the original
writer refused with E2EE_ACCOUNT_CHANGED. Platform write granularity remains
different and is no longer a test precondition.

This result is not a protected new-root stage or a large native/WebView common
reader journey. The small actual wire reached the strict shared reader; large
wire went to a digest sink. Both03 dark eight-map preview PNGs were inspected;
light journal evidence remains separately02. Full visual/provider/API35/OEM,
API26/192MiB and14-language semantics remain open.

Evidence: runtime `archives-inventory-stream-{input-03,identity-03,assembled-03,
jvm-03,lint-delta-03,pause-diagnostic-03,input-04,identity-04,assembled-04,
native-summary-04,lint-delta-04}.json`, six host cross-check reports per04
platform, JS/lint/types/build logs and
`output/qa/security336-archives-inventory-stream-api{26,34}-{03,04}/`.

Full process-remnant enumeration/materialization, all nested old ciphers,
encrypted stage journals and coordinator/common-reader streaming remain required.
Integration plan: `e2ee-336-snapshot-stream-plan.md`; acceptance requirements:
`e2ee-336-archive-stream-requirements.md`. Full20-path/48-scenario/direct-upgrade/
14-language acceptance and independent human crypto review are still open.
