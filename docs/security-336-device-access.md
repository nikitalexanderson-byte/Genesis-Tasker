# Device approval composition, 22 November (candidate source)

The normal web/native Account → Shared data security now hosts device request,
independent fingerprint comparison, owner approval export and candidate-session
submission. Both clients use the same strict public request contract and proof
domain. A server proposal/HTTP boolean never supplies the comparison or a pin.
The selected scope uses a previously independently accepted authority; saving
that pin no longer requires opening a scope before this device is enrolled.

Protected intent precedes challenge IO. Optional requestId adds exact challenge
issuance receipts, preserving the same user/session/key-bound challenge after a
lost response. Existing callers keep their prior shape. Expiry never refreshes
an existing request; a new action creates a new retained intent. Owner approval
verifies the requester's self-proof, target/pin, scope owner device and expiry.
The HPKE implementation re-addresses that owner's verified current and historical
root capsules to the compared receiving key. Raw root bytes exist only within
the existing HPKE helper and are wiped. Grant packets precede export.

The candidate persists the exact approval before network verification/submission.
It verifies the pinned signed directory, exact challenge/self-proof, signer,
history, own keys and checkpoint. A lost POST repeats the same packet. Completion
requires exact receipt, directory readback and a normal trusted-scope open.
Requests/grants survive restart; grants can be exported again. Foreground,
session/workspace/lifecycle guards fence callbacks; UI clears exchange buffers
on background. The14-language catalogue is shared by web/native assets.

Follow-up source composition adds ACL-only technical discovery to status: an
eligible member without an enrolled device can discover the scope, independently
compare its authority, and create a request. Existing owner/enrolled listings are
preserved. Newly discovered scopes must pass the same effective read ACL used by
directory/challenge access; restricted grants are respected. Discovery still
contains only scope kind/IDs/state, no key, approval or private content.

Source inspection also corrected retained recovery-enrollment sessionHash shape:
the existing API emits64 hexadecimal characters, not32 base64url bytes. Neither
the server wire shape nor old signed packets were rewritten.

This is not consolidated acceptance. No compiler, typecheck, lint, tests, builds,
CI, publication or device action ran. Accepted coverage stays9/20.

The new panel runs inside an already independently unlocked product account.
First personal-device access still uses the existing independent recovery entry;
the new panel is not yet a recovery-free initial personal-enrollment entry.
Normal invitation acceptance/member editing and all-owner membership/rotation
composition remain required. Native/web snapshots,14-language semantic review,
API26+, process death, session replacement, expiry, key substitution, wrong scope,
concurrent directory changes, lost response, replay, revoked signer/recipient and
complete history forwarding must be included in later acceptance.
