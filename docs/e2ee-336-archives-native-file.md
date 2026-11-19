# Native archive import: original bytes and provider metadata

20 November2026. Selected integrity increment; native acceptance is in progress.
This is not a complete `personal.archives` source adapter. Coverage remains9/20.

The previous `importChoose` decoded SAF bytes with replacement UTF-8 and supplied
an invented filename. The renderer then created a File from that changed text.
An invalid byte sequence could therefore change before archive parsing or the
protected source capture saw it.

The bridge now retains bounded original bytes and returns an opaque transfer ID,
actual byte length, SHA256 and the provider's original display name, MIME type,
last-modified timestamp and declared size. Missing metadata is explicitly null;
declared size does not override the bytes actually read. Paths and URI capabilities
are not exposed to JavaScript. Ordered base64url chunks carry exact byte offsets,
next offsets and EOF. The renderer checks all fields, lengths, canonical encoding
and the full digest before constructing a File. Archive text validation and
decryption remain later operations. The existing24MiB limit is unchanged.

The File may need a fallback name/time or normalize its MIME type. The original
descriptor is also retained in a WeakMap, returned by copy and included in the
protected migration input, so that these display choices do not become original
provider provenance. This descriptor is not provider authentication or new
remote object metadata.

Native owned transfer/read buffers are wiped on failed read, explicit clear,
operation end and view close. A cancelled replacement does not first discard an
existing transfer. Chunk/clear calls bind both the native operation and exact
transfer ID. Source capture remains owner/session checked; no plaintext file or
new persistent cache is introduced.

JS acceptance:8 new focused cases PASS; current full suite1746/1746 PASS,
failures/skips0. Covered invalid UTF8/all byte values, zero-length and multiple
chunks, exact original metadata and explicit missing fields, protected source
input, malformed/oversize descriptors, splicing/truncation/corruption/noncanonical
chunks, account changes at each async handoff, and cleanup failure. Types and
scoped ESLint PASS before native assembly. Runtime evidence:
`output/release-3.3.6/runtime/archives-native-file-full-js-01.log`.

Build01 failed during main compilation because the new importClear branch
missed its closing brace; the syntax error was fixed. Build02 SUCCESS8m46s,
selected JVM23/23 PASS (4 new binary transfer,4 chunk transport,2 backup container,
13 archive collector cases). It did not include lint/device acceptance.
Final build03 also includes web whole-job/runtime callback integration and the
last end-versus-import-publication guard. The operation is removed before its
buffer is cleared; installing a new buffer rechecks that exact operation under
the import lock, so late IO cannot recreate it between clear and invalidation.
Final build03 SUCCESS26m44s. Selected JVM23/23 and actual API26/API34
acceptance:22/22 on each device, failures/skips0. Lint0 errors/208 warnings/8 hints.
The net2 additional warnings come from changed dependency-availability metadata:
3 newer Compose BOM/Lifecycle recommendations were added and1 older lookup
recommendation disappeared. No new warning combination points to product source;
dependencies were not changed in this increment. These are not security findings
or a replacement for the release dependency audit. The12 whole-job
cases include exact provider bytes/metadata, cancelled replacement and ending
during a picker wait;6 operation-fence,2 reconciliation,1 real SAF and1 journal
choice case complete each selected run. API26 used the recorded exact-owned-AVD
statementservice dialog dismissal; verifier/permissions/AppOps were not disabled.
API35 was not repeated. Light journal/API34 and dark SAF/API26 screenshots were
inspected; these are not full visual/authenticated-provider acceptance.

Native input SHA256:
`7C85B19E0771B39FE56CB0DD17993F96925ECD4E06D963529C07547AC2EE322E`.
Main APK SHA256:
`15F5E4B5EDA2AA9CB7C498859DC3AB5EB0FC209334E17B3EA4F90FA77F1457E2`;
test APK:
`C88C3BD7EFFCF6FB470952DD05DA992E13015C31A9FADBE31444AAA43F43652A`.
Reports: `output/qa/security336-archives-file-api34-03/results.json`,
`output/qa/security336-archives-file-api26-03/results.json`,
`output/release-3.3.6/runtime/archives-native-file-device-summary-03.json`,
`archives-native-file-assembled-identity-03.json`, `archives-native-file-identity-03.json`,
`archives-native-file-jvm-03.json`, `archives-native-file-lint-03.xml`.
The composed web/runtime JS increment also passed1755/1755 full tests and
22 actual Chromium checks, as detailed in `e2ee-336-archives-web-jobs.md`.

The new raw-file transfer does not yet preserve forms after a
native WebView is destroyed. Native mounted/detached form inventory, strict
nested archive reconciliation, retained old-key loss/new-root readback and
clean recovery remain release gates. Production3.3.5/149, floors0/pilot/cutover
off and GENESIS_DEPLOY_ANDROID=false remain unchanged. No Deploy, Play or personal
device operation has been performed.
