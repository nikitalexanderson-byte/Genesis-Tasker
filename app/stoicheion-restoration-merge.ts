import { validateRestorationDocument, type RestorationDocument } from "./stoicheion-restoration-work";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Independent changes merge; two edits to the same practice require an explicit choice. */
export function mergeRestorationDocuments(base: RestorationDocument, local: RestorationDocument, remote: RestorationDocument): RestorationDocument {
  const byId = (doc: RestorationDocument) => new Map(doc.works.map(row => [row.id, row]));
  const before = byId(base), left = byId(local), right = byId(remote);
  const removed = [...new Map([...remote.removed, ...local.removed].map(row => [row.id, row])).values()];
  const deleted = new Set(removed.map(row => row.id));
  const works = [...new Set([...left.keys(), ...right.keys()])].flatMap(id => {
    if (deleted.has(id)) return [];
    const a = left.get(id), b = right.get(id), original = before.get(id);
    if (!same(a, original) && !same(b, original) && !same(a, b)) throw new Error("RESTORATION_REVISION_CONFLICT");
    const row = !same(a, original) ? a : b;
    return row ? [row] : [];
  });
  return validateRestorationDocument({ version: 1, works, removed });
}
