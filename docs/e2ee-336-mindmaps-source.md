# Personal mindmaps: signed complete historical source

19 November 2026. Server source reads all four owner tables: maps, versions,
write receipts and deletions. It preserves exact ciphertext/schema/revision/
timestamps and opaque historical operation/payload hashes. It never invokes
ordinary mindmap helpers, which limit the history screen to twenty versions,
provider task creation or receipt acknowledgement. Current signed personal
owner/device/directory/session/lease/source bindings and file/SQLite gates apply.
Existing legacy key is returned only when encrypted map/version rows exist.

`mindmaps-source-server-01/`: four PHP suites PASS, including complete actual-schema
history with 25 versions, own/foreign separation, signature/revocation/lease/source
errors, all four write fences, missing/corrupt keys, no-source mutation and count
limits. `mindmaps-source-transport-server-02/`: five suites PASS, adding the real
18-packet WebCrypto/JCA fixture and oversized Unicode source rejection. Web signed
port 52/52 migration tests and native migration JVM 13/13 PASS, skipped 0. Full
JS `key-lifecycle-full-js-01.log`: 1543/1543 PASS. Types/scoped transport lint PASS.
`scripts/qa/collect-e2ee-migration-fixtures.mjs` collects actual platform emitter
output, refuses missing/misbound packets and never synthesizes new signatures.

This is not a finished client adapter. Source coverage remains 6/20 until actual map/local/view/conversion/
request/draft/history capture, reconciliation, new-root readback and native
lifecycle integration are accepted. No production flag or release version changes.
