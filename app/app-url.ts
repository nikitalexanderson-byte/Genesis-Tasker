const GENESIS_URL_BASE = typeof window === "undefined" ? "https://genesiscalendar.com" : window.location.origin;

export function cleanGenesisAppUrl(value: string | URL) {
  const url = value instanceof URL
    ? new URL(value.href)
    : new URL(value, GENESIS_URL_BASE);
  url.searchParams.delete("qa");
  return `${url.pathname}${url.search}${url.hash}`;
}
