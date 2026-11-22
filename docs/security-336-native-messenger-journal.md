# 3.3.6: native messenger draft/command journal (candidate)

22 November2026. Source implementation, not compilation, acceptance or final
crypto review. No tests/compiler/lint/build/CI/provider/device/publication ran.
Coverage stays9/20; production3.3.5/149, floors0 and cutover off are unchanged.

The actual normal native messenger now saves a versioned owner/conversation/kind
draft with its stable token and exact edit target/base revision. A process restart
does not reinterpret an unfinished edit as a fresh message. Old text-only drafts
and three-field pending commands are read explicitly; raw originals are retained
before normalization/replacement. Selecting another edit cannot overwrite an
unrelated nonempty composition. Cancelling an edit saves its original as history.
UI input writes start in event order with captured conversation/token instead of
an unbound delayed callback; sends/deletes also check their original target.

New command headers retain the exact method/path/body, original composition and
known sequence. Receipt fields bind the message ID and resulting revision. An
uncertain response retries the original packet; bounded fresh readback may prove
the same ciphertext/text/deletion already applied. A full done marker is saved
before draft/command cleanup. Cleanup preserves DELETE's independent composition,
an unrelated/revised draft and unbound legacy drafts; it never clears them solely
because a network request returned successfully. Command originals are archived
in protected inert cells before marker changes or final removal.

Explicit conflict recovery rechecks actual current state. It proceeds only when
the original create ID already exists, or a targeted edit/delete revision has
advanced, so the old operation cannot mutate the current row through its old CAS.
Quota errors, missing/uncertain rows or a failed/incomplete read are not accepted
as a completed cancellation. A durable recovery-draft marker precedes replacing
the visible draft and retiring the original command; no recovered copy is sent
automatically. The existing device/pin checks and message wire formats stay.

This does not change ordinary chat visibility into permission to erase local
outboxes. The full E2EE/source requirements, typed restore, membership/device
replacement and separate shared-message conflict/tombstone work remain. Legacy
commands without a provable composition binding intentionally leave that draft
in place after acknowledgement. Consolidated QA must exercise149 upgrade,
pending edit/delete/POST response loss, done/recovery cleanup crashes, same-UID
relogin/restore, stale/late UI input, revoked peer devices, message pagination,
header corruption, capacity and both schemes/all14 UI languages.
