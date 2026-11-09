"use client";
import type {GenesisUser} from './cloud-sync';
import {subscriptionName} from './subscription-name';
import {translateText} from './i18n';
import {upgradeCopy} from './upgrade-copy';
import {requestUpgrade} from './upgrade-events';
import './billing.css';

/** Settings and the Free sidebar open the same server-backed comparison. */
export function BillingPanel({user}:{user:GenesisUser}) {
  const t=(source:string)=>translateText(source,user.language);
  const text=upgradeCopy(user.language);const en=user.language==='en';
  return <section className="account-preferences billing-panel" data-settings-group="account" aria-labelledby="billing-title" data-no-translate>
    <h3 id="billing-title">{en?'Plan and access':t('Тариф и доступ')}</h3>
    <p className="billing-current-plan">{text.current}: <strong>{subscriptionName(user.subscriptionPlan)}</strong></p>
    <p>{en?'Primary Google account':t('Основной Google-аккаунт')}: <strong>{user.email}</strong></p>
    <p>{en?'Payments and access belong to this account. Linked Google accounts share access and keep their own sync connections.':t('Покупки и доступ принадлежат этому аккаунту. Подключённые Google-аккаунты используют тот же доступ, сохраняя свои подключения синхронизации.')}</p>
    <button type="button" className="secondary-button" aria-haspopup="dialog" onClick={()=>requestUpgrade({reason:'compare'})}>{text.compare}</button>
  </section>;
}
