import type { Language } from "./i18n";
import copy from "./account-discovery-copy.json";
import { ExperimentalIcon } from "./ExperimentalIcon";

export default function SharedAffairsHint({ language, onGuide }: { language: Language; onGuide: () => void }) {
  const text = copy[language];
  return <aside className="shared-affairs-hint" role="note">
    <ExperimentalIcon name="team" />
    <p data-no-translate>{text.sharedBefore}<button type="button" className="account-guide-link" onClick={onGuide}>{text.account}</button>{text.sharedAfter}</p>
  </aside>;
}
