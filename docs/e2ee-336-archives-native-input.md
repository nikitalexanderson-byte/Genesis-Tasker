# Native archive input: strict protected-state and chunk plans

20 November2026. Common reader primitive, not a category adapter, native capture
integration or release. Source coverage remains9/20.

`app/e2ee/archives-native-input.ts` understands the exact current
`BackupSafetyStore.captureRaw()` shape and its chunked safety manifests. Original
JSON reaches the shared duplicate-name parser before a native old-key opener can
be selected. The reader validates the hashed owner scope, schema, bounded
metadata/collections, distinct document/task IDs and uncertain operation IDs,
while retaining original text, false/zero, tombstones, queues and preferences.
These are protected SOURCE INPUT; credentials, subscription or ACL cannot be
restored through this parser, which exposes no IO, write or restore port.

Safety planning preserves every original owner row. It validates original raw
manifest JSON (including escaped duplicate names), exact chunk indices/lengths,
framing and canonical padded native Base64. Each plan binds the original
`scope/kind` LocalCipher context. Missing roots with contiguous chunks are explicit
orphan candidates requiring authentication. A present but corrupt/future manifest
never falls back to inferred assembly. Missing/duplicate/gapped chunks refuse;
there is no pruning, empty replacement or `complete=true` result.

Framing/counts do not authenticate a ciphertext or establish orphan completeness.
Every plan has `requiresAuthentication:true`; its future bound native reader must
open AEAD successfully, preserve original UTF8 JSON and reconcile all nested old
ciphers before claiming portable recovery. This primitive does not turn old
LocalCipher/account ciphertext into new-root content by wrapping it again.

Limits:64MiB protected plaintext,128MiB aggregate source ciphertext,10000 input
rows/entries per collection,4096 chunks per group,256KiB original chunk. Native
cipher framing allows the original64MiB plaintext plus12-byte nonce/16-byte tag
and padded Base64. These are parser/plan budgets; the existing native runtime,
snapshot file and aggregate coordinator budgets still apply and need composed
large-data acceptance. Unknown formats are refused rather than truncated.

Focused acceptance50/50 PASS:9 new native-input cases plus41 archive transport
regressions. Includes actual WebCrypto encryption in native LocalCipher framing,
multiple chunks, exact derived AAD/new plaintext readback, reordered raw input,
orphan distinction, duplicate/escaped fields, bad manifests/metadata/owner,
trailing/prototype input, changed account during async owner hashing and a
well-framed tampered ciphertext that still fails AEAD authentication. Types and
scoped ESLint PASS. Full JS1764/1764 PASS,0 failures/skips, with the explicit
owned PHP runtime. Evidence:
`output/release-3.3.6/runtime/archives-native-input-{focused,types,lint}-01.log`
and `archives-native-input-full-js-01.log`.

No JCA/native UI/runtime capture integration, new-root complete archive recovery
or device acceptance is claimed for this unconnected reader. The preceding
composed file/web-job increment is accepted at commit
`8db67ced212ef0caaad55ff0f3465e06dbcdcd7a`; its exact native identity and44 selected
device cases are separate evidence. Source checks44634492570 is running on that
commit; it does not include this following reader. Production3.3.5/149,
floors0/pilot/cutover off and GENESIS_DEPLOY_ANDROID=false remain unchanged.
