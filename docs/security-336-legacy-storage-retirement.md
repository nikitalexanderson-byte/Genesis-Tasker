# Browser legacy originals: encrypted retention before retirement

The final canary review found that migrated browser accounts could retain the
old raw workspace key and ordinary localStorage copies. New private writes
already used the independent vault; these originals needed the same protection.

All mounted migration source readers now use an owner-bound read-only port.
It captures the exact values actually read, without deleting other accounts or
unread keys. At signed migration commit, under the existing write fence, each
original and the complete index are saved and independently read back from the
device vault. Only unchanged live values are then removed. Failed writes,
changed source bytes, lock and owner changes refuse retirement and preserve
the originals. Prepared originals survive interruption and remain available to
the migration reader after a cold unlock. Normal product readers never consume
these historical values or execute their queues.

After a verified cancellation, only the cancelling scope's retired originals
are restored, before releasing its legacy fence. Cancelled history cannot
resurrect values subsequently deleted by the user. The ordinary profile cache
continues to use its separate validated public projection and encrypted original.
Typed custody inventories cover the new index and original documents.

Focused checks:19/19 (9 retirement scenarios,10 existing profile scenarios),
typecheck/scoped lint and build:web PASS. Tests use the actual independent vault,
cold unlock, ciphertext tamper, write failures, source races and cancellation.
An initial direct strip-only invocation could not parse existing TypeScript
parameter properties; the established transform-types runner passed.

Actual mounted browser42 passed13/13, including absence of the raw legacy key
and private task canary from ordinary localStorage, normal encrypted task
read/edit, cold reload, offline unlock and clean-browser recovery. Its immutable
bundle hash is cb84fedf56c61d102528b6a88920a0d853543fcced90547d4a2a6dbf85387216;
the bundle was unchanged and the owned runtime cleanup passed. The initial41
run remains FAIL: it encountered net::ERR_CONNECTION_FAILED. The existing
bounded explicit form retry now recognizes that connection failure; it reuses
the same recovery kit and durable migration, without resetting state or limits.

Full JS41 ran2184 tests:2182 passed,2 failed because PHP was not configured in
the test environment. With the existing approved PHP binary selected, both
affected suites passed11/11; no product validator was changed for this rerun.
Native41 assembled successfully21m52s with fresh JVM execution:1453 tests,
1445 passed,0 failed,8 existing opt-in skips. Source hashBEA956EA…230308;
product APK95995C54…982D8C; unchanged instrumentation327EC0D3…11826.
UI41 passed4/4 against the retained accepted controller37 fixture, without
repeating migration or clearing data. Actual system PIN, emulated hardware
fingerprint, cancellation and background relocking were exercised.
The reviewed six-file payment-only backend change is recorded explicitly;
the backend is not falsely described as byte-identical to controller37.
Current backend hashBAAD5E68…E4518C is fixed separately. Services were stopped
and the reverse mapping removed; the owned fixture remains for final cleanup.
This is not full20-path/48-scenario acceptance, final review or activation.
