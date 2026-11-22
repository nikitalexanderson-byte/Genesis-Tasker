# 3.3.6: shared transition composition (candidate source)

22 November 2026. This is implementation before consolidated acceptance, not a
compiled/tested release or a change to accepted coverage9/20.

Web/native product migration controllers now attach space/project transitions to
the live private owner account. They reuse its device vault and independently
pinned authority; closing a borrowed controller does not lock the account.
Owner, resource, kind, scope, approved device keys, original session, foreground,
workspace epoch and frozen editor surface remain bound. Each run/cancel still
requires independent recovery input and the actual root probe.

Shared transitions use the complete relational source catalogue and the existing
protected capture, signed-original replay, reconciliation, immutable plan,
upload/readback and commit sequence. Active-personal deny markers stay bound to
the personal scope. A child cancellation cannot delete or repoint them. A new
or recovered device can establish that same irreversible deny boundary from a
freshly verified active personal directory, under the existing Web Locks/Room
mutex and SQL barrier. A conflicting existing binding/token still fails closed.

An owner-only signed personal read discovers technical resource IDs, including
legacy resources without a scope. It returns no titles, content or old keys and
does not grant trust. Stable proposed scope IDs plus protected immutable setup
packets allow explicit setup/retry; the real shared directory is verified with
the device's independent owner pin. Existing foreign-owner resources cannot be
migrated through this operation.

Both account security panels now expose these transitions through the existing
recovery dialog. Shared-specific title, explanation, action and completion copy
are supplied for all14 languages through one contract consumed by both clients.
The dialog reuses the foreground/stop/cancel and independent file/secret flow.
After active migration, the actual shared repository bootstrap is prepared,
flushed and read back before saving the owner's trust binding. The owner pin is
already independently known; peer trust still uses full fingerprint comparison.

Remaining creation composition: fresh space intent -> space transition -> inbox
setup/transition -> private intended values -> verified recipients, then real
create/resume UI. Fresh project topology/inheritance and advanced domain parity
remain code work. Incomplete source-stage and divergent-version review remain
the separately documented retained-history work; no originals were removed to
make this controller succeed.

No tests, compiler/typecheck, lint, build, CI, push, deployment or device actions
were run. Consolidated QA must cover both clients, fresh/recovered device markers,
same-UID relogin, peer-owner rejection, setup response loss, cancelled/restarted
children, source completeness, bootstrap response loss and14-language UI states.
Production3.3.5/149/Paddle website, floors0, cutover off and
GENESIS_DEPLOY_ANDROID=false are unchanged.
