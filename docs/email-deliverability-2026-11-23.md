# GENESIS registration mail: current evidence

23 November 2026. Investigation remains open; no successful Inbox delivery to
the affected recipient is claimed.

The supplied 22 November screenshot shows a Gmail Spam folder message titled
"Confirm your GENESIS registration", from noreply@genesiscalendar.com. Gmail's
banner refers to similarity to messages previously identified as spam. The
sender details show mailed-by and signed-by genesiscalendar.com and TLS.
The screenshot does not expose the full Authentication-Results or sending IP.
The affected recipient is redacted here; its full address is not committed.

Public DNS read on 23 November:

- SPF: `v=spf1 include:_spf.mail.hostinger.com ~all`.
- DMARC: `v=DMARC1; p=none`.
- MX: mx1.hostinger.com (5), mx2.hostinger.com (10).

The exact recipient/date/sender query returned no message in the connected
Gmail account. Prior successful SPF/DKIM/DMARC evidence for a different received
message cannot establish the headers or Inbox placement of this one.

Source inspection: `email-transport.php` already uses authenticated TLS SMTP,
multipart plain/HTML alternatives, stable Message-ID, aligned configured sender
and Auto-Submitted. Registration has a 48-hour token, one queued initial message
per account and an explicit resend with cooldown. The registration HTML footer
is currently empty. Adding clear request context and a visible first-party URL
may improve usability; its effect on Gmail reputation is unverified.

Next evidence required for delivery acceptance is the original message's
Authentication-Results/Received headers and a fresh, explicitly authorized
delivery sample. Preserve the existing confirmation, cooldown and account
retention behavior. DNS enforcement or provider changes require an inventory
of legitimate senders and a concrete verified configuration. This investigation
has not changed DNS, the provider, Gmail labels or sent any message.
