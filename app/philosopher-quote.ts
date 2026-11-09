/** Presentation only: catalog identities, quotations and stored snapshots stay intact. */
export function philosopherQuoteParts(body: string, author: string) {
  const signature = (value: string) => value.normalize("NFKC").trim().replace(/^\(\s*|\s*\)$/g, "").replace(/[.。]$/, "").replace(/\s+/g, " ").toLocaleLowerCase();
  const lines = body.trim().split(/\r?\n/);
  const credit = author.trim();
  if (credit && lines.length > 1 && signature(lines.at(-1)!) === signature(credit)) lines.pop();
  let quote = lines.join("\n").trim();
  let context = "";
  const opening = quote[0];
  const closing = opening === "(" ? ")" : opening === "（" ? "）" : "";
  if (closing) {
    let depth = 0;
    for (let index = 0; index < quote.length; index++) {
      if (quote[index] === opening) depth++;
      else if (quote[index] === closing && --depth === 0) {
        context = quote.slice(1, index).replace(/[()（）]/g, "").trim();
        quote = quote.slice(index + 1).trim();
        break;
      }
    }
  }
  return { context, quote, author: credit };
}
