# 3.3.6: explicit external Google copies

Candidate implementation, not compiled or accepted. No Google request, grant,
credential change or provider write was performed while authoring this code.

Private GENESIS task writes remain private. The web/native personal task editor
and shared task detail view expose a separate opt-in copy. The selected account,
provider and exact content are displayed before consent. An all-day Calendar copy
is an explicit choice. A content/account/provider change invalidates the visible
confirmation. The opaque, short-lived consent binds the exact unlocked account
and payload and is consumed once. Importing a JSON/backup cannot recreate it.

The client retains the complete operation under the new device root before
transmission. The new `private-services/google/copy` route accepts only that
explicitly disclosed copy and the current consent version. It performs no
private-content lookup/decrypt and does not receive a vault root, DEK, source task
locator, membership command or restore authority. GENESIS and Google can read
this disclosed content. The existing 14-language external-processing notice is
shown with the selected Google service; the actual content is shown alongside it.

Migration133 stores only owner/provider/account/operation/hash/state/external-ID
receipts, without task content or OAuth credentials. The service checks the live
owner's Google account and OAuth scopes. It reuses identity credential refresh
through a separately named internal helper; legacy Google product operations
retain their existing migration fence. No global bypass or legacy workspace
reader is enabled. The destination is the selected account's default Tasks list
or primary Calendar. Existing provider items are never removed or overwritten.

Calendar event IDs are deterministic for one approved operation. A conflict is
reconciled against that operation's marker. Google Tasks has no equivalent caller
ID: the receipt is marked attempted before POST. After an ambiguous outcome,
retries only search for the saved marker through bounded pages; they never issue
another Tasks insert automatically. Absence, interrupted delivery, a concurrent
conflict or a bound exceeded remains uncertain and is shown as such. Each later
attempt requires reviewing the same saved content again. These copies do not
turn on continuous projection or revive old worker/import commands.

Pending acceptance includes JS/PHP/Kotlin compilation, actual provider contracts
and limits, lost response/process death, simultaneous clients, OAuth renewal,
account switch/lock, retained jobs, exact content/calendar semantics, all14
translations, both schemes and small screens. Habit copies, advanced shared
projection settings and any future continuous consent policy remain unfinished;
this component is not complete external-integration acceptance. Release gates,
accepted coverage9/20 and production3.3.5/149 remain unchanged.
