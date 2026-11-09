"use client";
import RU from './texts.ru.json';
import { useEffect, useRef, useState } from 'react';
import { MODELING_SERVICE_PRICES, modelingAvailableMethod, modelingCheckoutUrl, modelingServiceCopy, type ModelingPaymentCatalog, type ModelingPaymentMethod, type ModelingPaymentOrder } from '../modeling-service';
import { billingMoney } from '../billing';
import type { Language } from '../i18n';
import type { AuroraHost } from './host';
export function AuroraPayment({ host, resultId, onUnlocked }: {
    host: AuroraHost;
    resultId: string;
    onUnlocked: (solution: unknown) => void;
}) {
    const text = modelingServiceCopy(host.language as Language), [catalog, setCatalog] = useState<ModelingPaymentCatalog | null>(null), [method, setMethod] = useState<ModelingPaymentMethod | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const key = useRef(crypto.randomUUID()), live = useRef(true), pending = useRef(false);
    const [order, setOrder] = useState<ModelingPaymentOrder | null>(null);
    useEffect(() => {
        live.current = true;
        void host.billing<ModelingPaymentCatalog>(`/billing/modeling/catalog?client=${host.client}`).then(c => { if (live.current) {
            setCatalog(c);
            setMethod(c.methods.find(m => m.provider === c.routing.preferredProvider && modelingAvailableMethod(m)) ?? c.methods.find(modelingAvailableMethod) ?? null);
        } }).catch(() => { if (live.current)
            setError(text.error); });
        return () => { live.current = false; };
    }, [host, text.error]);
    async function open() { const value = await host.readResult(resultId); if (value.id !== resultId)
        throw new Error('AURORA_RESULT_MISMATCH'); if (live.current)
        onUnlocked(value.solution); }
    async function perform(checkOnly = false) {
        if (pending.current)
            return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            if ((catalog?.forecastElitePlus || catalog?.testingAccess)) {
                await open();
                return;
            }
            if (checkOnly) {
                if (order) {
                    const fresh = await host.billing<ModelingPaymentOrder>(`/billing/modeling/orders/${order.id}`);
                    if (live.current)
                        setOrder(fresh);
                    if (fresh.status === 'paid')
                        await open();
                    else if (live.current)
                        setError(text.pending);
                }
                else
                    await open();
                return;
            }
            if (!method || !modelingAvailableMethod(method))
                throw new Error('BILLING_NOT_CONFIGURED');
            const value = await host.billing<ModelingPaymentOrder>('/billing/modeling/orders', { method: 'POST', body: JSON.stringify({ resultId, provider: method.provider, client: host.client, idempotencyKey: key.current }) });
            if (value.resultId !== resultId)
                throw new Error('AURORA_RESULT_MISMATCH');
            if (live.current)
                setOrder(value);
            if (value.status === 'paid')
                await open();
            else {
                const url = modelingCheckoutUrl(value);
                if (url)
                    host.openCheckout(url);
                else if (live.current)
                    setError(text.pending);
            }
        }
        catch {
            if (live.current)
                setError(text.error);
        }
        finally {
            pending.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    return <section className="aurora-payment" aria-label={text.title}>
  <h3>{text.title}</h3><p>{text.description}</p>
  {(catalog?.forecastElitePlus || catalog?.testingAccess) ? <p className="admin-elite-plus">{catalog?.testingAccess ? text.testing : text.privileged}</p> : <>
   <p className="aurora-price">{billingMoney(MODELING_SERVICE_PRICES.RUB, host.language as Language, 'RUB')} / {billingMoney(MODELING_SERVICE_PRICES.USD, host.language as Language, 'USD')}</p>
   {catalog?.methods.filter(modelingAvailableMethod).map(m => <label className="aurora-choice" key={m.provider}><input type="radio" name="aurora-payment" checked={method?.provider === m.provider} onChange={() => setMethod(m)} disabled={busy || Boolean(order)}/>{m.provider === 'yookassa' ? 'YooKassa' : 'Lemon Squeezy'} · {billingMoney(m.amountMinor, host.language as Language, m.currency)}</label>)}
  </>}
  <div className="aurora-actions"><button type="button" className="primary-button" disabled={busy || !catalog || !catalog.forecastElitePlus && !catalog.testingAccess && !method} onClick={() => void perform()}>{busy ? RU.text0001 : (catalog?.forecastElitePlus || catalog?.testingAccess) ? text.open : text.pay}</button>
   <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(true)}>{text.check}</button></div>
  {catalog && !catalog.forecastElitePlus && !catalog.testingAccess && !method ? <p role="status">{text.unavailable}</p> : null}{error ? <p role="alert">{error}</p> : null}
 </section>;
}
