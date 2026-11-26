# Private file manifest validation — accepted reader increment

20 November2026. Following the accepted writer commit22e261a1. **This reader
increment is accepted locally, not released.** Current native build/input02 is
separate from writer input01; do not reuse its APK identity with SkipBuild.
Source-stage checkpoint20a64cc2 passed full CI44708122877(web/API and Android).
Writer22e261a1 is pushed; CI44718191095 was in progress when this note was written.

The authenticated v1 file manifest is still untrusted structured input. The old
reader projected JSON before duplicate/lexical checks and validated individual
descriptors during fetching. A malformed later descriptor could therefore reach
the first chunk fetch. Android `JSONObject.getString` can also coerce scalar
types that JavaScript/JVM reject. The new web/native paths validate the entire
descriptor set before any chunk fetch, file-key import or aggregate allocation.

New purpose-specific private-file JSON lexers validate before JSON projection:

- Strict UTF8, retaining a leading BOM so it is refused as non-JSON syntax.
  Valid BOM characters inside filenames and escaped lone UTF16 units remain.
- Standard JSON punctuation, escapes, numbers and literals; no comments,
  single/unquoted names, trailing commas, equals/semicolon separators or extra
  trailing documents. Unicode escape hex digits are ASCII only on both platforms.
- Decoded names are unique, including escaped spellings, in every object.
- Limits:256KiB private manifest, depth16,10000 values,128 names/object,
  64UTF16 units/name,512units/string value and32characters/numeric token.
  The v1 schema's own narrower field/count limits still apply afterward.
  No large number/object materialization precedes those resource checks.
- IDs/operation IDs/hashes have explicit string/technical/32-byte hash checks;
  the complete ordered lengths/indices and duplicate IDs are checked before IO.
  Chunk IDs remain opaque; consumers must use their existing safe storage/API
  lookup contracts. No filesystem path or authority is restored from a descriptor.

The crypto/file schema, legitimate SDK-generated v1 files and opaque file
contents are unchanged. The parser inspects the private manifest, never the
user's opaque file bytes. No new AEAD/KDF or fallback format is introduced.

Shared synthetic syntax corpus contains4valid/25invalid cases, including
escaped duplicate names, Android-lenient syntax, UTF8 errors and non-ASCII
escape digits. JS draft03 passes67 selected preflight/stream/storage/migration
cases. Scoped lint draft03 and owned types draft04 pass. The browser harness
addition initially had a TypeScript inference issue in a hex fixture helper;
its repaired input is included in those final checks.

Native draft01 was deliberately cancelled before acceptance while compiling:
the resource review added per-string and numeric-token bounds before object/
number materialization. Its log/input and explicit cancelled marker are retained.
Accepted native input02:
`E2837F269C221F759B6A9B2DF6120C54DC95758378E6381372898D1311ABCF77`.
Selected JVM154/154 pass; the exact assembled APKs were recorded before the
runtime suite. Actual API26/API34 each pass4/4,0 failures/skips: the existing
three writer/provider/IO cases plus strict syntax and six malformed later
descriptors requiring zero fetches. No earlier writer APK was reused.

Host cross-checks of both fresh native reports pass. Each platform's two
extracted artifacts match their recorded hashes. Independent bounded host
construction matches the entire generated40MiB/160chunk source. Elapsed
8,922/14,069ms(API26/API34), Java max heaps512/192MiB; peak heap and product SLA
are not measured. Both JCA vectors open in the existing WebCrypto v1 reader
with9 opaque bytes and all original filename units.

Actual Chromium157/WebCrypto/IndexedDB passes10/10, including the shared corpus
and six later-descriptor failures before IO,37 individually persisted immutable
chunks and full9MiB+7byte readback through a cold IDB connection. Structured
report: `output/release-3.3.6/runtime/file-preflight-browser-report-02.json`.
Synthetic keys stay public/in memory; these are primitive/provider/IO checks,
not product presence, enrollment or fresh-device recovery acceptance.

Main APK02:
`21FED23461318280E61FCD3A71CEFEA8BC332B84C1FC7389F51724FCC4E3C76E`.
Test APK02:
`9ED4E3C2C41754C760802A4D810501280FEFDABA45D50D6B8D205B77DC1DE058`.
Build SUCCESS18m50s; lint0 errors/208 warnings/8 hints with no new issue/file
pairs versus writer input01. The assembled APKs used for runtime acceptance
match the final build identity. Exact reports use `file-preflight-*-02` under
`output/release-3.3.6/runtime/` and actual
`output/qa/security336-file-preflight-api{26,34}-02/results.json`.

This still does not implement the complete coordinator/common reader, all20
sources, device enrollment/recovery, direct upgrades or independent human review.
Coverage9/20, production3.3.5/149 and floors0/pilot/cutover off stay unchanged.
