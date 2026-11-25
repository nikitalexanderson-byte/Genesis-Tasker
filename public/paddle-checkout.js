(() => {
  const copy = {
    en: ['Opening checkout…', 'Checkout has closed.', 'Checkout is unavailable. Please reopen it from your plan.', 'Back to GENESIS'],
    ru: ['Открываем оплату…', 'Окно оплаты закрыто.', 'Оплата недоступна. Откройте её снова в окне тарифа.', 'Вернуться в GENESIS'],
    el: ['Άνοιγμα πληρωμής…', 'Η πληρωμή έκλεισε.', 'Η πληρωμή δεν είναι διαθέσιμη. Ανοίξτε τη ξανά από το πρόγραμμά σας.', 'Επιστροφή στο GENESIS'],
    de: ['Zahlung wird geöffnet…', 'Die Zahlung wurde geschlossen.', 'Die Zahlung ist nicht verfügbar. Öffnen Sie sie erneut in Ihrem Tarif.', 'Zurück zu GENESIS'],
    fr: ['Ouverture du paiement…', 'La fenêtre de paiement a été fermée.', 'Le paiement est indisponible. Rouvrez-le depuis votre formule.', 'Retour à GENESIS'],
    es: ['Abriendo el pago…', 'Se cerró la ventana de pago.', 'El pago no está disponible. Vuelve a abrirlo desde tu plan.', 'Volver a GENESIS'],
    it: ['Apertura del pagamento…', 'La finestra di pagamento è stata chiusa.', 'Il pagamento non è disponibile. Riaprilo dal tuo piano.', 'Torna a GENESIS'],
    pt: ['A abrir o pagamento…', 'A janela de pagamento foi fechada.', 'O pagamento está indisponível. Volte a abri-lo a partir do seu plano.', 'Voltar ao GENESIS'],
    pl: ['Otwieranie płatności…', 'Okno płatności zostało zamknięte.', 'Płatność jest niedostępna. Otwórz ją ponownie w swoim planie.', 'Wróć do GENESIS'],
    sr: ['Отварамо плаћање…', 'Прозор за плаћање је затворен.', 'Плаћање није доступно. Отворите га поново из свог плана.', 'Назад на GENESIS'],
    uk: ['Відкриваємо оплату…', 'Вікно оплати закрито.', 'Оплата недоступна. Відкрийте її знову у вікні тарифу.', 'Повернутися до GENESIS'],
    zh: ['正在打开结账页面…', '结账窗口已关闭。', '暂时无法结账。请从您的套餐页面重新打开。', '返回 GENESIS'],
    tr: ['Ödeme açılıyor…', 'Ödeme penceresi kapatıldı.', 'Ödeme kullanılamıyor. Planınızdan tekrar açın.', "GENESIS'e dön"],
    ja: ['お支払い画面を開いています…', 'お支払い画面を閉じました。', 'お支払い画面を開けません。プランからもう一度開いてください。', 'GENESIS に戻る'],
  };
  const page = new URL(location.href);
  let stored;
  try { stored = localStorage.getItem('genesis-language-v1'); } catch { /* Storage is optional. */ }
  const language = page.searchParams.get('lang') ?? stored ?? navigator.language.split('-')[0];
  const text = Object.hasOwn(copy, language) ? copy[language] : copy.en;
  document.documentElement.lang = Object.hasOwn(copy, language) ? language : 'en';
  const status = document.getElementById('checkout-status');
  const back = document.getElementById('checkout-back');
  status.textContent = text[0];
  back.textContent = text[3];

  async function openCheckout() {
    const endpoint = new URL('/api/billing/paddle-checkout', location.origin);
    const order = page.searchParams.get('billingOrder');
    const transaction = page.searchParams.get('_ptxn');
    if (order) endpoint.searchParams.set('billingOrder', order);
    else if (transaction) endpoint.searchParams.set('transactionId', transaction);
    else throw new Error('CHECKOUT_ORDER_REQUIRED');

    const response = await fetch(endpoint, {credentials:'same-origin', cache:'no-store'});
    if (!response.ok) throw new Error('CHECKOUT_UNAVAILABLE');
    const result = await response.json();
    const returnUrl = new URL(result.returnUrl);
    if (returnUrl.origin !== location.origin) throw new Error('CHECKOUT_RETURN_INVALID');
    back.href = returnUrl.href;
    if (!result.transactionId) {
      location.replace(returnUrl.href);
      return;
    }
    if (!/^live_[A-Za-z0-9_-]{12,120}$/.test(result.token) || !/^txn_[a-z0-9]{26}$/.test(result.transactionId))
      throw new Error('CHECKOUT_RESPONSE_INVALID');

    // Own order verification decides which transaction to show, including on a Paddle payment link.
    if (transaction) {
      page.searchParams.delete('_ptxn');
      history.replaceState(history.state, '', page.href);
    }
    await new Promise((resolve, reject) => {
      const sdk = document.createElement('script');
      sdk.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
      sdk.onload = resolve;
      sdk.onerror = reject;
      document.head.append(sdk);
    });
    window.Paddle.Initialize({
      token: result.token,
      eventCallback: event => {
        if (event.name === 'checkout.closed') status.textContent = text[1];
        if (event.name === 'checkout.error') status.textContent = text[2];
      },
    });
    window.Paddle.Checkout.open({
      transactionId: result.transactionId,
      settings: {displayMode:'overlay', theme:'dark', showAddDiscounts:false, allowDiscountRemoval:false, successUrl:returnUrl.href},
    });
  }

  openCheckout().catch(() => { status.textContent = text[2]; });
})();
