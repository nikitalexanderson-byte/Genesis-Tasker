# Secret peer-key change: scenario35

24 November2026, correction after native57. Current Messenger already refuses
a different pinned device/key pair. Its web/native interfaces incorrectly used
the generic pending-or-disconnected notice for that refusal. Web also retained
the previous security code after this particular refresh failure.

The correction adds a separate changed-key notice on all14 languages and clears
the stale web code. It does not replace pins, keys, message history or drafts;
the original secret-chat protocol still has no forward-secrecy claim.

Acceptance added for the actual current native MessengerRepository with real
P256/message encryption and synthetic transport/durable-memory ports: changed
peer key, substituted public key, blocked sends, cold retained pin/draft and
original-key history readback. Browser acceptance mounts the actual Messenger
with real WebCrypto/IndexedDB and an ordinary synthetic backend login. Chat
responses are modeled, including a substituted peer public key; this does not
claim real two-party server enrollment or private-vault storage acceptance.

The browser check covers the visible warning, stale-code removal, disabled Send,
encrypted local draft, cold retained pin and original-key history. Its localized
layout matrix is14 languages ×4 widths ×2 schemes. Results, exact input hashes
and limitations must be recorded after execution; no new PASS is claimed here.
