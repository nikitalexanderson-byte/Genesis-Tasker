import type { DailyAdvice } from "./daily-advice";
import { compactAdviceBody } from "./advice-text";
import { philosopherQuoteParts } from "./philosopher-quote";

/** Shared by Today's cards and the read-only original advice in the diary. */
export function AdviceBodyText({ advice }: { advice: DailyAdvice }) {
  const philosophy = advice.collection === "philosophers" ? philosopherQuoteParts(advice.body, advice.sources[0]?.author ?? "") : null;
  return <>
    {philosophy?.context ? <p className="daily-advice-context" lang={advice.language}>{philosophy.context}</p> : null}
    <p className="daily-advice-body" lang={advice.language}>{compactAdviceBody(philosophy?.quote ?? advice.body)}</p>
    {philosophy?.author ? <p className="daily-advice-author" lang={advice.language}>({philosophy.author})</p> : null}
  </>;
}
