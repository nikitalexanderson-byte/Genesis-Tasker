# Native archive origins before final publication

20 November2026. Selected component acceptance; not accepted as complete
archives coverage or permission to enable migration. Source/coordinator
streaming remains a separate gate in `e2ee-336-archive-stream-requirements.md`.

The existing final-v1 `.ref` remains unchanged. An additional encrypted
`.origin` holds the original binding/view/blob before any input frame can be
acknowledged. Its distinct AAD includes the original spool directory and blob
ID. It uses the same LocalCipher/platform AEAD as the existing spill; no new
cipher/KDF or session capability is introduced. Every acknowledged frame is
synced. On Android, creation and final-reference renames also sync their private
directory after opening without following a symlink and checking fstat S_ISDIR.
The final ref becomes durable before removing the early origin.

| Restart input | Read-only catalog behavior |
| --- | --- |
| Complete final-v1 ref and binary | Original completed source; normal reader still authenticates all frames/footer/EOF |
| Final ref with matching leftover origin | Same completed source, after both metadata bindings authenticate and match |
| Early origin with partial/renamed data or an unfinished index | Identifiable incomplete inert input; never a completed Form or resumable operation |
| Unknown old pending/binary/index file without authenticated provenance | Explicit BACKUP_FORM_UNBOUND_REMNANT; preserve files, no sweep/rebind/empty-history fallback |
| Corrupt/substituted early or final metadata | Integrity/authentication refusal; no fallback to whichever copy happens to open |

`origins()` bounds the small metadata catalog. `retained()` refuses incomplete
entries instead of returning only the completed subset and implying a full
history. Source consumers must still filter the original owner/context and
materialize required old ciphers under the independent new root. This catalog
does not enumerate all process directories, parse partial documents, migrate
archives, grant restore authority or establish portability by itself.

Build01 stopped at compile: Android's public SDK does not expose O_DIRECTORY.
That failed log is preserved. Input02 uses the public open/O_NOFOLLOW,
fstat S_ISDIR and fsync calls, with no numeric flag workaround.

Input02:
`3DCA082F95184A2BE083E047FEE11C3485FB22549E1A122FB4F1CB41B1B60205`.
Selected JVM47/47 across8 suites,0 failure/skip. This includes7 new origin
cases: metadata before first-frame encryption, partial/final crash windows,
unknown old files, substitution, encryption/directory-sync refusal and ID reuse.

Actual API26/API34 each passed64/64 selected cases,0 failure/skip, including
the3 new real-Keystore/directory-sync origin cases, old-v1 compatibility,
40MiB form/codec,24MiB binary,51MiB retained history, actual SAF, operation
lifetimes, portability and preview. Each platform also passed26 host checks:
values/new-root6, real SAF5, canonical portability4, binary6 and source-wire5.
All19 extracted artifact hashes per platform match the runner reports.

Actual20,615,080-byte/eight-map preview passed without restore in67,745/64,073ms
(API26/API34); a small confirmed edit took376/466ms, one4-unit value chunk and
one small manifest. Both dark preview and light journal PNGs were inspected.
These selected screenshots do not cover the whole visual/14-language matrix.
Java max heap512/192MiB; peak heap, API26/192MiB, API35 and OEMs are not accepted.
Extra frame/directory synchronization adds IO; no speedup or SLA is claimed.

Main APK:
`672BF03CA245A6F0794E2CAAC8ACBA8AEEF8187043B0811C44DE4256BD0EAAC2`.
Test APK:
`FAF7F254B6DEF5A8258989F725746D6EFF5C3D971DCCAF9F091547FF1C732246`.
Input02 build ended FAILED20m36s at lint: O_CLOEXEC is public only fromAPI27.
Its47 JVM and64/platform native results are retained as input02 evidence,
not final accepted-build evidence. Input03 guards that public field by SDK;
API26 uses only public O_RDONLY/O_NOFOLLOW/fstat/fsync with a read-only handle
closed in finally. No numeric/hidden-API workaround or lint suppression is used.
Input03 also includes the next retained-inventory stream implementation, so it
requires its own complete identity/build/native and host checks.
Evidence: runtime `archives-origins-
{input-01,input-02,identity-02,jvm-02,native-summary-02}.json`, the five host
cross-check reports per platform and `output/qa/security336-archives-origins-
api{26,34}-02/`. Synthetic restart windows do not substitute for an actual
reboot or power-loss fault-injection test.

Final input04 acceptance is shared with the retained-inventory producer:
`e2ee-336-archive-inventory-stream.md`. Both API26/API34 passed all3 origin cases
within the final18-case focused run. Main APK is byte-identical to input03;
the only04 native-source change is the stream test's pause helper. Lint03/04:
0 errors/208 warnings/8 hints, no new issue/file pairs against source-wire01.
Build03 SUCCESS20m36s; build04 SUCCESS2m19s. The input02 counts above remain
historical evidence and do not stand in for these fresh04 origin cases.
