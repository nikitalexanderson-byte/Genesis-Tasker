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

The source continuation matches enrollment receipts to the established chained
directory checkpoint, SHA256(previous checkpoint + NUL + command hash). The raw
command hash is used to identify the exact event; it is not confused with that
event's directory checkpoint. Both native/web readback floors use the same chain.

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


## Personal candidate entry core,22 November (source-only)

ComparedPersonalDeviceTarget/E2eeComparedPersonalDeviceTarget require the exact
independently exchanged personal authority fingerprint; the capability retains
an immutable snapshot and never accepts a status response as a pin. Candidate
provisioning creates only a new local root and device keys. No personal-content
root, recovery authority or entitlement is created. Existing local bundles are
unlocked and compared, never replaced. The pinned signed directory must already
be a matching active personal scope before candidate creation.

Matching WebPersonalDeviceEntry/E2eePersonalDeviceEntry reuse existing challenge,
self-proof, external approval, exact submit and normal directory readback without
constructing an unlocked product account. The chunked protected marker precedes
challenge IO, keeps stable attempt IDs and preserves all previous requests. An
explicit new request cannot abandon a staged approval with unknown outcome.
The candidate client closes temporary root capabilities after enrollment. Browser
local unlock material is separate from recovery; native requires the caller to
admit foreground device-credential use.

This core is not a mounted first-entry flow yet: cloud-sync/AuthController
foreground factories, trusted-device target export, both locked gates,14-language
copy, lifecycle/credential handoff and typed custody of the new marker are next.
No compilation/QA; accepted coverage remains9/20.
