import { MobileDisclosure } from "./MobileDisclosure";
import { useState } from "react";
import { IconActionButton } from "./IconActionButton";
import { translateText } from "./i18n";

export default function GoogleConnectNotice({ compact, busy, onConnect }: {
  compact: boolean; busy: boolean; onConnect: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <MobileDisclosure label="Google Calendar и Google Tasks" className={compact ? "affairs-google-connect" : "google-connect-expanded"}>
    <section className="google-connect-banner" aria-labelledby="google-connect-title">
      <IconActionButton icon="close" className="google-connect-dismiss" label={translateText("Скрыть")} onClick={() => setDismissed(true)} />
      <div>
        <span className="eyebrow">Необязательная синхронизация</span>
        <h2 id="google-connect-title">Подключите Google Calendar и Google Tasks</h2>
        <p>Вход уже выполнен. Разрешения на календарь и списки задач запрашиваются отдельно и только после вашего нажатия.
          GENESIS создаёт собственный календарь, а доступ к Google Tasks нужен для показа и двустороннего изменения выбранных вами списков и задач.</p>
        <p><a href="/privacy">Как GENESIS использует и защищает данные Google</a></p>
      </div>
      <button type="button" className="primary-button" onClick={onConnect} disabled={busy}>
        {busy ? "Подключаем…" : "Подключить синхронизацию"}
      </button>
    </section>
  </MobileDisclosure>;
}
