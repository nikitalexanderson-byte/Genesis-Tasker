/** Decimal text to integer kopecks. Payment arithmetic stays in integer units. */
export function partnerMinor(value: string, signed = false): number | null {
  const match = value.trim().match(signed ? /^(-?)(\d{1,11})(?:[.,](\d{1,2}))?$/ : /^()(\d{1,11})(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const minor = BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? '').padEnd(2, '0'));
  if (minor > BigInt('1000000000000')) return null;
  return Number(match[1] ? -minor : minor);
}

export function partnerDecimal(minor: number | null): string {
  if (minor === null) return '';
  const amount = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}
