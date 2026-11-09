import type { PhysisAccessStatus } from './access-check';
import './access.css';

export function PhysisAccessNotice({ status, retry, language }: { status: PhysisAccessStatus; retry: () => void; language: string }) {
  const en = language === 'en';
  return <section className="physis-access-notice" aria-labelledby="physis-access-title">
    <h1 id="physis-access-title">{en ? 'Physis' : 'Фюзис'}</h1>
    <p role="status">{status === 'checking' ? en ? 'Checking access…' : 'Проверяем доступ…'
      : status === 'error' ? en ? 'Could not check access. Check your connection and try again.' : 'Не удалось проверить доступ. Проверьте соединение и повторите попытку.'
      : en ? 'Physis is unavailable for this account.' : 'Фюзис недоступен для этого аккаунта.'}</p>
    {status !== 'checking' ? <div className="physis-access-actions"><button type="button" className="secondary-button" onClick={retry}>{en ? 'Check again' : 'Проверить снова'}</button></div> : null}
  </section>;
}
