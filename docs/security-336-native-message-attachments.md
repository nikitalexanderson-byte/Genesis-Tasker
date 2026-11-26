# 3.3.6: native shared-message file intake/output (candidate)

22 November2026. Implementation before consolidated acceptance. No compiler,
tests, lint, build, provider exercise, CI or publication ran. Coverage stays9/20.

The real shared-message screen no longer reads/writes provider plaintext from an
old picker callback. It first saves an encrypted owner/conversation/draft-bound
intake or exact file-output selection. The existing above-vault picker handoff
carries only an intent ID and purpose; only transient content URIs survive it.
After unlocking, explicit import/output uses the fresh repository capability,
the original session/restore guard and foreground checks. Archive destinations
are purpose-separated from message input/output and cannot consume one another.

Message intake retains the original draft, participant key IDs, selected-file
count, immutable file IDs/nonces, full source SHA-256 and every ciphertext-part
hash before writing chunks. Every part is read back. A process stop leaves an
explicit incomplete selection, not a claimed EOF. Reselecting the same files in
the same order replays only the identical source/ciphertext; nonce replay checks
the saved complete-source digest BEFORE encryption. Different source bytes,
drafts or participant pins require review and leave existing material intact.
The normal file cells are the retained source too, avoiding a second complete
ciphertext copy. Normal send/cancel/remove cleanup retains all referenced intake,
original-draft and saved-draft chunks.

The screen lists unfinished/deferred selections. It blocks sending a draft with
an unresolved active intake, permits explicitly keeping the intake for later,
and offers explicit draft restoration. Before switching drafts it saves/readbacks
the displaced composition in the protected journal; those copies remain
selectable even when the original intake later completes. Restoration never
sends a message. Header writes are bounded to64 intakes,16 saved alternatives per
intake and300KiB; capacity refusal preserves the old header/chunks rather than
evicting them. Full old-source/custody/retention cost and useful capacity belong
in consolidated large-history acceptance, not an unsupported performance claim.

Provider input is bounded to the existing5 files/10MiB each and requires real
EOF. Cancellation signals, tracked descriptors/streams and owned buffers stop
IO and clear working bytes on expiry/background. Explicit output reopens the
selected original message sequence/revision/sender/file, rechecks current peer
pins, AEAD-decrypts its content and file, and uses the existing bounded writer
with destination-prefix and complete readback verification. The suggested picker
name remains generic; decrypted content and private names do not live above the
vault gate. The exact JSON payload comparison used for lost message receipts now
checks the whole payload, including the complete participant key-ID map.

Input/resume/defer and draft-copy disclosure have shared14-language contracts.
No physical erasure of provider/JVM/immutable-string copies is claimed. A failed
explicit plaintext output may remain at the selected destination; the encrypted
source/journal is retained. Provider MIME lookup itself has no cancellable API26
equivalent; checks after it prevent a late result from reaching the repository.

Remaining message work includes normal-messenger durable edit state/exact-command
recovery, legacy shared-message conflict-copy/tombstone details and reminder/
notification/deep-link/background entrypoints. The new code needs actual API26+,
picker/lock/relogin/process-death, wrong-source/order, stale-draft, partial-write,
capacity, maximum-file, background IO, restore/copy and final artifact acceptance.
Existing test references to the removed raw key-file writer still need conversion
when the owner-authorized consolidated test stage starts.
