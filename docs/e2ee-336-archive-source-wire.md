# Archive source wire: bounded native encoding

20 November2026. This is a source-wire primitive, not the complete archives
adapter, a protected snapshot, or permission to activate E2EE. The remaining
coordinator/streaming gate is `e2ee-336-archive-stream-requirements.md`.

`BackupSourceJson` writes original Reader UTF16 code units as a JSON string
using bounded8192-character input/output blocks. Every surrogate code unit is
escaped, including split pairs and lone surrogates. Private raw JSON remains a
quoted original string: JSONObject cannot project away duplicate private names
or change their number semantics. BOM, controls and provider names survive.
Binary input uses the platform Base64URL encoder without padding and a64KiB
read buffer. No full binary/string aggregate is created by either encoder.

The source and sink remain caller-owned. Every bounded read/write checks the
original actor before and after IO. Success requires actual EOF, including the
read after a declared byte count: authenticated source readers may verify their
last tag/footer there. A failure can leave partial output, so callers must keep
that output in quarantine and cannot publish a complete snapshot from it.
This primitive has no key generation, AEAD, HTTP, restore or identity port.

## Selected acceptance

Frozen input01:
`3B613B4C03FCB5E2694A26C59EAA6B4C8C4972CAEAADF72F02AD36627A8B24F2`.
Full selected build SUCCESS12m36s, lint0 errors/208 warnings/8 hints and no new
issue/file pairs against ports02. Selected JVM7/7,0 failure/skip: exact Unicode/control round trips across short
reads, generated40MiB text, binary sizes around64KiB, EOF/tag failures,
limits/zero progress, original actor retirement and sink/source ownership.

Actual API26/API34 each passed the one selected native codec case,0 failure or
skip. Host checks verified all original code units, exact non-text bytes,
continued rejection of preserved duplicate private names by the shared strict
parser, and an independently computed digest of the complete quoted40MiB
generated stream. Native read/write blocks were at most8192 units/bytes for the
ASCII large-text fixture. Elapsed1603/1852ms, Java maximum heap512/192MiB
(API26/API34). These are synthetic source-codec measurements, not a full
archive, coordinator, heap-peak or performance acceptance.

Main APK:
`594EA48752CBA8EC005430DA5D6C5CE521B583EFBA1F763BE8B1CED2A57562CA`.
Test APK:
`1D302A5441FA6008E6C79FD3BE7266BDE07D1DD46ADF49D8C5BE66E678FCF674`.
Evidence: runtime `archives-source-wire-{input-01,identity-01,jvm-01,
cross-api26-01,cross-api34-01,assembled-01,lint-delta-01}.json`,
`archives-source-wire-build-01.log`, saved lint XML,
and `output/qa/security336-archives-source-wire-api{26,34}-01/`.

The codec is not yet wired into the inventory/coordinator. Aggregate32/48/64MiB
gates remain in place. Early authenticated process-remnant bindings, nested
old-cipher materialization, complete protected source/reconciliation streaming
and cold recovery without synthetic old keys remain required. Coverage remains
9/20. Full product/direct-upgrade/14-language/visual/provider acceptance and
independent human crypto review remain open. No production/Play/personal device
or version was changed; floors0 and pilot/cutover off are preserved.
