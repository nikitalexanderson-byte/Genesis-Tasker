export type SearchableAffair = { title: string; tags?: string[] };
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/\u0451/g, String.fromCharCode(0x435));

/** A plain token matches title or tags; #tokens match tags only. All tokens must match. */
export function matchesAffair(item: SearchableAffair, query: string): boolean {
  const title = normalize(item.title);
  const tags = (item.tags ?? []).map((tag) => normalize(tag.replace(/^#/, "")));
  return query.split(/[\s,;]+/).filter(Boolean).every((token) => {
    const tagged = token.startsWith("#");
    const term = normalize(token.replace(/^#/, ""));
    return !term || (!tagged && title.includes(term)) || tags.some((tag) => tag.includes(term));
  });
}
