import {translateText,type Language} from './i18n';

export function upgradeActionName(language:Language) {return upgradeLabel('Подключить больше функций','Unlock more features',language);}
export function upgradeLabel(ru:string,en:string,language:Language) {const value=translateText(ru,language);return language==='en'&&value===ru?en:value;}
export function upgradeCopy(language:Language) {
  const text=(ru:string,en:string)=>upgradeLabel(ru,en,language);
  return {
    action:upgradeActionName(language),title:text('Больше возможностей GENESIS','More possibilities with GENESIS'),
    subtitle:text('Выберите доступ, который подходит вашим делам.','Choose the access that fits your work.'),
    compare:text('Сравнить тарифы','Compare plans'),current:text('Ваш тариф','Your plan'),
    month:text('Месяц','Monthly'),year:text('Год','Yearly'),perMonth:text('в месяц','per month'),perYear:text('в год','per year'),once:text('один раз','one-time payment'),
    features:text('Что входит','Included features'),limits:text('Лимиты выбранного тарифа','Selected plan limits'),
    payment:text('Способ оплаты','Payment method'),notConnected:text('Пока не подключён','Not connected yet'),
    freeSelected:text('Free — текущий бесплатный доступ','Free — free access'),
    freeSync:text('Google Calendar и Google Tasks доступны бесплатно во всех тарифах.','Google Calendar and Google Tasks are free in every plan.'),
    assistant:text('ИИ-помощник пока отключён во всех тарифах.','The AI assistant is currently disabled in every plan.'),
    life:text('Пожизненно: все доступные функции и будущие нововведения.','Lifetime access to all available features and future additions.'),
    seats:text('Осталось мест','Places remaining'),owned:text('У вас уже есть пожизненный доступ Elite.','You already have lifetime Elite access.'),
    preserved:text('Сохранённые советы не входят в квоту дневника. Достижение лимита не удаляет существующие данные.','Saved advice does not count towards the diary limit. Reaching a limit does not delete existing data.'),
    freeAdvice:text('Один совет в день.','One piece of advice per day.'),paidAdvice:text('До 3–6 советов в день — по числу доступных категорий.','Up to 3–6 pieces of advice per day, based on available categories.'),
    included:text('Входит','Included'),excluded:text('Не входит','Not included'),unlimited:text('Без ограничения','Unlimited'),
    limitReason:text('Достигнут лимит текущего тарифа. Выберите подходящий доступ; существующие данные сохраняются.','You reached your current plan limit. Choose suitable access; your existing data stays available.'),
    maximumReason:text('В доступных тарифах нет большей квоты для этого ресурса. Существующие данные сохраняются.','Available plans do not offer a higher quota for this resource. Your existing data stays available.'),
    featureReason:text('Для этой функции нужен другой тариф. Сравните возможности ниже.','This feature needs a different plan. Compare the options below.'),
    noPayment:text('Оплата пока не подключена. Списаний не будет.','Payments are not connected yet. No payment can be taken.'),
    paymentStart:text('Доступ начинается после подтверждения оплаты.','Access starts after payment is confirmed.'),
    continue:text('Перейти к оплате','Continue to payment'),opening:text('Открываем…','Opening…'),
    credit:text('Зачёт неиспользованного периода','Unused-period credit'),listPrice:text('Стоимость тарифа','Plan price'),total:text('К оплате','Amount due'),
    quoteHint:text('Расчёт обновится при создании платежа.','The amount is recalculated when the payment is created.'),
    quoteChanged:text('Сумма изменилась. Расчёт обновлён; проверьте сумму перед повторной оплатой.','The amount changed. The quote has been refreshed; review it before trying again.'),
    shorterPeriod:text('Для этого перехода нужен годовой период.','This upgrade requires an annual period.'),
    chooseYear:text('Выбрать год','Choose annual access'),
    pendingUpgrade:text('Предыдущий переход ещё ожидает подтверждения оплаты.','Your previous upgrade is still awaiting payment confirmation.'),
    coveredPrice:text('Зачёт полностью покрывает стоимость. Оплата этого перехода пока недоступна.','The credit covers the full price. Payment for this upgrade is currently unavailable.'),
    methodUnavailable:text('Недоступен для этого расчёта','Unavailable for this quote'),
    paymentUnavailable:text('Оплата выбранного перехода сейчас недоступна.','Payment for the selected upgrade is currently unavailable.'),
    quoteError:text('Не удалось рассчитать сумму. Обновите расчёт перед оплатой.','Could not calculate the amount. Refresh the quote before payment.'),
    catalogError:text('Не удалось загрузить способы оплаты. Проверьте соединение и попробуйте снова.','Could not load payment methods. Check your connection and try again.'),
    retry:text('Обновить расчёт','Refresh quote'),loading:text('Рассчитываем…','Calculating…'),
    error:text('Не удалось открыть оплату. Ваш доступ не изменился.','Could not open payment. Your access has not changed.'),
    noCheckout:text('Этот способ оплаты сейчас недоступен. Ваш доступ не изменился.','This payment method is currently unavailable. Your access has not changed.'),
  };
}

export const UPGRADE_FEATURES=[
  ['calendar-sync','Google Calendar и Tasks - синхронизация','Google Calendar and Tasks - synchronization'],
  ['calendar','Календарь','Calendar'],['tasks','Задачи','Tasks'],['habits','Привычки','Habits'],['trackers','Трекеры','Trackers'],
  ['habit-timer','Таймер привычек','Habit timer'],['diary','Дневник','Diary'],
  ['dream-journal','Дневник снов с текстовым вводом','Dream journal with text input'],
  ['dream-voice','Дневник снов с голосовым помощником','Dream journal with voice assistant'],
  ['dark-palettes','Дополнительные тёмные палитры','Additional dark palettes'],['mindmaps','Майндмепы','Mind maps'],
  ['stoicheion','Гадание на 1 карте','One-card divination'],['stoicheion-timeline','Гадание на 3 картах','Three-card divination'],
  ['stoicheion-spread','Гадание на 9 картах и разрешение ситуации','Nine-card divination and situation resolution'],
  ['stoicheion-letters','Буквы и их значения','Letters and their meanings'],['data-export','Экспорт данных','Data export'],
  ['shared-projects','Общие проекты','Shared projects'],['messenger','Сообщения','Messaging'],['automations','Автоматизации','Automations'],
  ['physis','Фюзис и другие новые функции (доступны на сайте)','Physis and other new features (available on the website)'],
] as const;
export const BILLING_FEATURE_COPY_KEYS:Record<string,string>={'calendar-sync':'googleSync','stoicheion':'oneCard','stoicheion-timeline':'threeCards','stoicheion-spread':'nineCards','future-modeling':'futureModeling','stoicheion-letters':'letters','physis':'physis','dream-journal':'dreamJournal','dream-voice':'dreamVoice','dark-palettes':'darkPalettes'};
export const UPGRADE_RESOURCE_NAMES=[['Личные проекты','Personal projects'],['Привычки','Habits'],['Личные майндмепы','Personal mind maps'],['Записи дневника','Diary entries'],['Общие проекты','Shared projects'],['Общие майндмепы','Shared mind maps']] as const;
