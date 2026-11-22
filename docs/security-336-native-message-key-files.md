# 3.3.6: native independent message-key files

22 November 2026, source candidate only. No compilation, automated/instrumented
tests, provider exercise, build, CI or publication ran. Accepted coverage 9/20
and all activation gates are unchanged.

The real `MessagingScreen` no longer retains its backup password across a system
picker or calls the repository's raw provider-output callback. It supplies the
already encrypted v2 independent key file to `NativeMessageKeyTransfer`. The
host is mounted above the private-vault gate, with an exact transient request,
original owner/session/restore and live data-exchange entitlement, a two-minute
expiry and one accepted picker return. No password, private key, vault capability,
provider URI or transient grant is persisted. Process death/expiry requires a new
explicit attempt; original message keys and source files are untouched.

Provider IO requires foreground again, has cancellation signals, tracked live
descriptors/streams and bounded owned buffers. Export refuses an unrelated
existing destination, writes the encrypted file, reads it completely back and
compares exact bytes before completion. Import accepts a bounded encrypted v1/v2
key-file wrapper, checks encoding/header bounds and keeps only ciphertext until
the user unlocks the current repository and re-enters the backup key/password.
Decryption/import checks the same original request around awaits; the permanent
repository retirement from the earlier key-lifetime change remains in force.
Request replacement, expiry, UI background/disposal and failure clear owned byte
arrays; provider/JVM/string erasure is not promised. The key dialog uses
FLAG_SECURE. The independent message wire format, pins and history are preserved.

This handoff is deliberately transient, not a durable draft/file transfer queue.
Full durable message draft/attachment staging, exact-command recovery in the old
shared-message UI and remaining notification/deep-link/background work are still
implementation items. Consolidated acceptance must exercise actual providers and
API26+, picker return/resume ordering, unmount/recreation/process death, wrong
owner/same-UID relogin/restore, entitlement expiry, blocked provider opens/reads/
writes, duplicate/late returns, partial and readback mismatch, old password files,
v2 interoperability and lock during key import/publication. Existing
`MessagingRepositoryTest` cases referencing removed `writeBackup` need migration
to the new actual handoff acceptance; they have not been compiled or run.
