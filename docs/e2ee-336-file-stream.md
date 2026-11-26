# Bounded v1 file encryption — writer acceptance

20 November2026. TS/native file writer accepted within the scope below.
Do not use earlier source-stage APKs as evidence for this changed source input.
It does not finish the streamed coordinator/common reader, all archives, device
key custody, recovery, full product acceptance or the independent human review.
Coverage stays9/20; production3.3.5/149 and all activation gates stay unchanged.

`sealE2eeFileStream` / native `E2eeFiles.sealStream` preserve the existing v1
format: random independent file key, fresh per-envelope DEKs,256KiB attachment
chunks, signed expected context and the encrypted authenticated final manifest.
The64MiB per-file format limit stays; no aggregate limit or Java heap is raised.
The writer holds a bounded plaintext/ciphertext working set and at most256
small descriptors. Its supplied sink must be local ciphertext quarantine.
Caller owns source/key custody, actual quota admission and source fencing.

Source EOF is read even after the declared final byte. Short/extra/zero/malformed
input, a final source tag error, sink refusal and actor retirement cannot return
a completed manifest. Ciphertext prefixes stay inert: no manifest/file key is
published through the API. They are not a completed file or durable input-save
receipt; keep the complete protected original until coordinator publication.
The JS iterator is closed on failure and borrowed chunks are snapshotted before
awaits. Native caller owns InputStream closing. Both wipe owned plaintext/key
buffers and check the actor around crypto/IO/sink awaits or blocking calls.

Existing batch APIs delegate to this writer, retaining their existing array
return shape for compatibility; those callers still aggregate ciphertext.
This does **not** make the current migration planner stream automatically.
The coordinator still needs a durable local plan, all required coverage and
readback before any transport or `planned:true` publication.

Native private-manifest encoding now escapes surrogate code units before UTF8.
This preserves pairs and lone units in original filenames instead of replacing
them during `JSONObject.toString().toByteArray(UTF_8)`. Schema, expected context,
AEAD/KDF suite and v1 readers are unchanged. Previously lost units in historical
files cannot be recovered by changing a new writer.

Draft JS01 passed67 selected cases. Scoped lint found `no-unsafe-finally` in
cleanup/error propagation; fixed by retaining the primary failure and throwing
after cleanup, not from finally. Draft02 passed64 selected stream/storage/
migration cases, owned types and scoped lint pass. These are draft JS results,
not native/platform or composed-protocol acceptance.

Public interoperability material: `tests/fixtures/e2ee/file-stream-web-v1.json`,
generated from already-public test keys and opaque9-byte content. The actual
test uses generated40MiB plaintext -> private ciphertext files -> the existing
v1 reader, plus independent bounded host digest and actual JCA/WebCrypto interop.
Fixture keys are public/held in memory; this is file primitive/provider/IO
evidence, never user-presence, fresh enrollment or device-recovery acceptance.

## Exact accepted writer evidence

- Input01 `96A2A7D95458F510BD211851950CFD6E422019BBBFFFB12D97B68FE4A0E3B12A`.
  Native build SUCCESS18m1s, selected JVM152/152; lint0 errors/208 warnings/8
  hints, no new issue/file pairs versus the accepted source-stage input03.
- Actual API26/API34 each3/3,0 failures/skips. Generated40MiB/160chunks are
  written to private ciphertext files and all bytes read back through the
  existing v1 reader. Independent bounded host SHA256 matches the entire source.
  Elapsed8,011/11,670ms(API26/API34), Java max heaps512/192MiB; peak heap and
  production SLA are not measured. Each result's two extracted artifacts match.
- Both providers read the public streaming WebCrypto vector and export a new
  JCA v1 vector. The existing Node WebCrypto reader opens each with all9 opaque
  bytes and all filename code units, including BOM, lone surrogate and emoji.
- Actual Chromium157/WebCrypto/IndexedDB:8/8.37 immutable ciphertext chunks
  for9MiB+7bytes persist individually; a new IDB connection reads every original
  byte and filename unit. Web/native v1 interoperability, final-tag refusal and
  retirement/borrowed-buffer cleanup pass. Fixture keys remain in memory.
- Scoped ESLint/owned types pass. JS draft02's64 selected stream/storage/
  migration cases pass after cleanup repair; draft01's67 included the unchanged
  three device-vault cases. These are distinct runs, not a full product matrix.

Main APK01:
`0BE247AD6990694C6C114D4C4CAA7DA0F1F780445B030093F4EF86A51878A393`.
Test APK01:
`7BEC0DD3F2F468EC762E1CC49219F43CA5D5B07707554648AF2AB929A2E34F3D`.

Remaining composed work includes strict private-manifest/descriptor preflight
before chunk IO, streamed common readers, durable plan/coordinator publication,
all original sources/old nested tags, real key custody/recovery, direct upgrades
and independent human review. This writer acceptance does not waive those gates.
