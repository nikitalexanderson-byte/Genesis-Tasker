# 3.3.6: original file versions from retained content archives

22 November, implementation candidate. No compilation, automated/runtime checks,
build, provider exercise, push or publication ran. Accepted coverage stays9/20;
typed normal-repository content restore remains separate implementation work.

Web and native now enumerate current and historical content-file entries and
offer explicit original-byte output. Size/SHA-256 are rechecked for the selected
version. Section names reuse existing fourteen-language backup translations;
current/version/file labels and the disclosure about an unencrypted output are
shared in `content-file-copy-v1.json`. Web treats non-JSON/large records as files,
keeps its bounded JSON preview and downloads octet-stream with a safe filename.
No untrusted document/HTML is executed inside the app.

Native first writes and reads back an inert selection intent under the device
root. The system picker above the vault gate carries only its technical ID;
the returned URI is transient and grants no decryption/write authority. After
unlock, the user explicitly confirms output with a fresh account capability.
The product reopens the immutable retained archive, resolves the exact selection,
checks the saved size/hash and only then materializes plaintext bytes. A bounded,
cancellable foreground writer checks an existing exact prefix, writes the file
and verifies complete readback. There is no plaintext spool. Expiry, background,
account change or disposal closes descriptors and wipes owned source/scratch
buffers. Provider/JVM/string erasure and future provider immutability are not
claimed. A failed/partial explicit output may remain at the chosen provider;
the original encrypted archive and other source data are not deleted.

The picker uses the generic suggested name `genesis-content.bin` so private
filenames are not retained above the lock gate. The unlocked list shows original
names and versions; the user can choose the destination name. Requests expire
after two minutes and are not recreated after process death. Saved selection
intents are not live grants and never start IO automatically. The common bounded
output writer is available to the remaining native attachment/draft work.

Consolidated acceptance still needs API26+ and real provider return/resume,
lock/unlock, recreation/process death, wrong owner/same-UID restore/session,
entitlement expiry, pending-intent corruption, duplicate version IDs, empty/
maximum-size/binary files, prefix/readback failures, blocked IO cancellation,
both themes and fourteen-language meaning/rendering. Browser Blob copies and
explicit downloaded plaintext are intentionally outside the application vault;
owned working arrays are cleared, not represented as physical erasure of all
runtime copies.
