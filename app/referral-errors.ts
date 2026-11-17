export type ReferralErrorKey = 'error' | 'primaryRequired' | 'standardRequired' | 'privateProgram';

/** Only public, expected access failures replace the retryable network message. */
export function referralErrorKey(status: unknown, code: unknown): ReferralErrorKey {
  if (status === 403 && code === 'REFERRAL_PRIMARY_GOOGLE_REQUIRED') return 'primaryRequired';
  if (status === 403 && code === 'REFERRAL_STANDARD_REQUIRED') return 'standardRequired';
  if (status === 409 && code === 'REFERRAL_PRIVATE_PARTNER_PROGRAM') return 'privateProgram';
  return 'error';
}
