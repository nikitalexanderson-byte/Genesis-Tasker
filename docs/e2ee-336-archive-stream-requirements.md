# Archive capture: remaining streaming gate

Implementation requirements,20 November2026. This is a plan for the next gate,
not a format implementation, accepted adapter, or permission to activate E2EE.
See the immutable security prompt and `security-336-acceptance-matrix.md`.

## Current boundaries

| Layer | Current behavior and remaining problem |
| --- | --- |
| Native retained forms/values | Authenticated UTF16 spill,96Mi code-unit logical value/form limit, independent stored candidates/history; complete capture still materializes JSON |
| Native retained binary | Original file up to24MiB, source-only bounded readback with full digest/footer/EOF; retained File arrays released after spill |
| Archive inventory | Reference-catalog protocol3 producer streams current retained views without an aggregate; legacy32/48MiB capture and complete source/coordinator replacement remain open |
| Shared source/coordinator |64MiB serialized snapshot and128MiB aggregate history/content budgets; capture and planning currently copy complete ByteArrays/JSON |
| Native safety/held state | Original Room rows and `native-protected-state-v1` can contain nested old LocalCipher documents/tasks and encrypted safety groups; their framing alone proves no authentication or portability |
| Process remnants | New `.origin` locators bind candidates before first acknowledgment; final-v1 refs remain readable. The bounded catalog distinguishes known partials and refuses unknown old remnants. Full owner-filtered directory collection/materialization remains open |
| Web | Original localStorage safety/held strings, memory safety and actual File/editor input are preserved in a bounded aggregate; streaming must include these real paths too |

## Required properties

1. Preserve the complete original inventory under the independent new client
   root BEFORE any reconciliation/network request. Replacing a limit constant
   or increasing a Java heap is not streaming acceptance. Source-only producers
   must have no HTTP, restore, prune, payment, identity or ACL mutation port.
2. Use bounded encrypted local chunks and a durable stage journal. Publish the
   complete snapshot pointer with CAS only after every required path, count,
   digest, original-context check and EOF succeeds. Partial/losing/crashed stages
   remain identifiable inert input; they must not masquerade as a completed
   source or silently vanish from future reconciliation.
3. Preserve original raw text/code units and original binary/provider metadata.
   A streaming codec must retain JSON number/duplicate-name semantics for the
   strict common reader, including split pairs, lone surrogates and BOMs. Do not
   project private originals through JSONObject and call that lossless capture.
4. Before a source is considered protected/portable, open every required old
   cipher using its ORIGINAL owner/scope/kind/AAD and retained old key. Include
   portable materialized content alongside needed inert originals. Copying an
   old device-bound cipher into a new encrypted snapshot cannot establish
   recovery after the old Keystore alias is lost.
5. Large old AEAD reads may require quarantined encrypted staging until final
   tag verification. No partial plaintext may become active content, a complete
   source, a remote object or restore authority before authentication finishes.
   Use platform/library AEAD, not a replacement cipher or invented KDF.
6. Give incomplete process candidates an authenticated original owner/epoch/
   view/role/blob binding before acknowledging retained input. Distinguish a
   partial publication from a final footer and manifest. Do not sweep unknown
   remnants, rebind them to a later session, or infer a complete empty history.
   Existing final-v1 refs remain readable with their exact historical semantics.
   The new spill implements early origins (`e2ee-336-archive-origins.md`);
   whole-source collection and new-root stage journals still need this property.
7. Capture small immutable catalogs/references under the inventory monitor;
   bulk reads must release that monitor and check original actor/version before
   and after bounded IO. Retirement must be visible before waiting for cleanup.
   The form-port lifetime increment addresses part of this and is tested
   separately; it does not itself stream the whole source.
8. Streaming must extend through the coordinator and the actual native/WebView
   common-reader input, not terminate in a giant intermediate JSON/base64/tree.
   Reuse the established source/content domains and distinguish remote content
   from device-only original queues/keys/history. Staged source chunks grant no
   replay capability and cannot restore sessions, subscription or shared ACL.
9. Capacity admission must reflect actual disk/record/provider limits with a
   recoverable no-space/refusal path. Originals and prior accepted stages survive
   refusal. Do not claim all-account capacity from a single large fixture.

## Acceptance still needed

Exercise actual combined input above the former32/48/64MiB aggregate gates,
including a24MiB file, multiple selected/unselected histories, original raw
forms, nested native safety/held copies and portable/device-bound archives.
Check bounded Java heap at the supported device settings, not only duration.
After complete protection, delete only the synthetic old alias/key and cold-read
the entire resulting input/content through the independent new root. Cover
process loss and failures at each chunk/journal/final-pointer boundary, parallel
preparation/CAS, owner/same-UID retirement, malformed/duplicate/unattributed data,
truncation/reordering and no network before completion. Repeat meaningful web
browser/IndexedDB and API26/API34 paths; an isolated source stream is not full
product migration, all14-language semantics, direct upgrade or human review.
