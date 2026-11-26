# Единый сайт, реквизиты Prodamus и способы доната

## Новое решение владельца: альтернативы Prodamus

Позднее24 ноября владелец отверг дополнительные требования Prodamus и поручил
искать другой сервис для физлица на НПД без ИП: зарубежные карты, зачисление в
рублях; crypto вывод необязателен. ЮKassa/CloudTips/Boosty и production не менялись.
Новые кабинеты и checkout не создавались, поддержке сообщения не отправлялись.

Проверены публичные условия24 ноября, не merchant-specific approval:

- Robokassa явно указывает тариф «Самозанятые: Базовый» и foreign cards9,9%,
  отдельная страница подтверждает рублёвое зачисление. Roboчек СМЗ существует.
  Подключение конкретного продавца без постоянной регистрации НЕ подтверждено;
  старое соглашение физлиц предусматривало страницу паспорта с регистрацией.
  Нельзя обещать, что новый кабинет не запросит её или документы на ПО.
  https://robokassa.com/payments/tarify/
  https://robokassa.com/payments/payment-method/inostrannye-karty/
  https://robokassa.com/blog/articles/kak-prinimat-oplatu-s-inostrannykh-kart/
- EasyStaff Invoice: public registration требует реальный полный Address;
  verification описывает фото удостоверения/загранпаспорта и live selfie,
  возможны portfolio/additional checks. Paylinks доступны только Trusted.
  Это пока резерв для инвойсов, не подтверждённая полная SaaS subscription/API
  замена и не обещание отсутствия address checks.
  https://start.easystaff.io/ru/helpcenter/verification
  https://easystaff.io/ru/help-center/paylinks
- Lava.top: public KYC — ID + live selfie;8% successful payment, foreign
  currency -> RU card возможна по внутреннему conversion rate. Для вывода
  нужны минимум3 реальные продажи и security review до7 рабочих дней. Terms
  clauses4.5–4.7 разрешают дополнительные документы/address verification.
  Кроме того FAQ запрещает гадания/Таро/ритуалы; без прямого одобрения полного
  GENESIS нельзя объявлять подходящей заменой Paddle или менять описание
  приложения ради сокрытия функций. API/webhooks наличие подтверждено отдельно.
  https://faq.lava.top/article/79240
  https://faq.lava.top/article/68562
  https://lava.top/docs/terms
  https://faq.lava.top/article/76098
  https://faq.lava.top/article/76482
- Т-Банк: public internet acquiring требует ИП/организацию; самозанятый без ИП
  не равен ИП на НПД. ЮKassa official accept-methods ограничивает foreign cards
  конкретными системами; общий приём US/EU Visa/Mastercard не подтверждён.
  ENOT homepage адресована ИП/ООО, NPD-only onboarding не подтверждён.
  https://www.tbank.ru/business/help/business-payments/internet-acquiring/how-work/working-conditions/
  https://yookassa.ru/docs/support/payments/accept-methods
  https://enot.io/

Подтверждённого сервиса, одновременно принимающего любые зарубежные карты,
работающего с НПД без ИП и гарантирующего отсутствие всех документов/подтверждения
адреса, не найдено. Приоритет Robokassa по НПД условен согласием на фактический
адрес/доступный документ и полный продукт; EasyStaff — запасной invoice route.
Использование ИИ само по себе не делает проект чужим ПО: OpenAI Terms Content
assigns Output as between user/OpenAI to extent permitted by law; это не
заключение о правах на сторонние библиотеки/изображения и не готовое гарантийное
письмо. https://openai.com/policies/terms-of-use/

## Опубликовано24 ноября

Дополнительный отбор после уточнения «самозанятый без ИП, crypto необязательно»:
CloudPayments в собственном материале указывает ИП для подключения эквайринга
самозанятому, поэтому NPD-only onboarding не подтверждён:
https://cloudpayments.ru/blog/zachiem-ekvairingh-malomu-bizniesu/ . PayMaster
в текущем публичном FAQ сообщает о недоступности foreign cards:
https://info.paymaster.ru/sposoby-oplaty-na-sajte/ . Self.PayAnyWay существует
для НПД, но актуальная публичная cards page заявляет российские карты, а не
общий иностранный приём:
https://service.payanyway.ru/info/w/ru/public/w/payment-methods/cards.html .
Это дополнительные исключения/неподтверждённые варианты, не новые подключения.
Robokassa по тарифу НПД остаётся первым условным кандидатом:9,9% foreign cards,
RUB settlement; отсутствие требования страницы регистрации не подтверждено.
Новые кабинеты/обращения/договоры не создавались, Prodamus не активировался.

Main7964526b2e78ce5956cfaf95a1f9df129dc95b1a прошёл собственные Source checks
45364626251, оба jobs SUCCESS. Штатный Deploy45373264770 SUCCESS. Live metadata
подтверждает этот commit; шесть публичных EN/RU страниц возвращают200 с реальными
реквизитами и без Paddle. Старые /ru/ ссылки проверены отдельно. Android manifest
побайтно эквивалентен сохранённому до Deploy; APK3.3.5/149 не заменялся.

Boosty Basic подтверждён в UI (VERIFICATION COMPLETED, текущий annual limit
EUR500). Private configuration enabled/profile_verified=true с официальной
ссылкой https://boosty.to/genesiscalendar/donate. Live anonymous
GET /api/donations/methods вернул boosty.available=true и ровно эту ссылку.
CloudTips checkout сохранён. Реальный платёж/выплата не выполнялись; Basic не
равен Standard/Pro. Новая безопасность3.3.6 в эту публикацию не включена.

Следующие абзацы сохраняют историю подготовки; прежний статус pending KYC и
disabled config заменён результатом выше.

Решение владельца24 ноября: отменить Paddle, отдельную российскую витрину и переходы по IP/GPS. Все14 языков доступны на genesiscalendar.com; старые /ru/ ссылки302 ведут на соответствующий общий документ с сохранением языка и query. API/OAuth origin, данные и APK3.3.5/149 сохраняются.

Создатель, исполнитель платных услуг и оператор персональных данных: Ляпин Никита Александрович, НПД, ИНН772495179010, nikitalexanderson@gmail.com. Юрий Логвинов / Iurii Logvinov — владелец домена и хостинга, demiurge.soft@gmail.com. Эти роли одинаковы во всех языках. В подвале главной видны исполнитель, ИНН, инфраструктура, контакт и переход к реальным тарифам. Действующие цены и функции приложения, включая авторские календари и карточную саморефлексию, сохранены.

USD — отдельные фиксированные цены для сравнения; они больше не маскируются идентификатором Paddle. ЮKassa остаётся действующим checkout. Google Play Billing сохраняет прежний выключенный release gate. Prodamus — выбранный кандидат для зарубежных карт с рублёвым зачислением; анкета ещё не завершена, новый тарифный шлюз не объявляется подключённым.

Новое уточнение владельца: CloudTips — для российских карт, Boosty — для карт других стран. Диалог позволяет выбрать способ вручную; регион меняет только порядок. Гражданство и разрешённость платежа из него не выводятся. Координаты не передаются серверу. Прежняя надпись «донаты доступны только из России» удалена. Существующий серверный CloudTips invoice и подписанные webhook/защита истории сохранены.

Страница https://boosty.to/genesiscalendar создана на Никиту после отдельного подтверждения условий24 ноября. Boosty требует KYC до приёма платежей. Международный способ остаётся выключенным до завершения onboarding и проверки страницы владельца. В config.php предусмотрен boosty: enabled=false, profile_verified=false, profile_url пустой. Разрешена только точная HTTPS-страница boosty.to/<profile>/donate без query, фрагмента, userinfo, порта и передачи данных аккаунта. Public GET /api/donations/methods stateless и не заменяет login cookie. Пока внешняя история донатов не сверяется с аккаунтами, включение Boosty закрывает автоматическое удаление неактивных аккаунтов; донор не считается отсутствующим по одному CloudTips-реестру.

В privacy сохранены реальные Google, Hostinger, GigaChat, ЮKassa и CloudTips disclosures; добавлено условное раскрытие Boosty. Удалены разделение продавцов США/РФ и все активные упоминания Paddle. Нейтральный раздел условий описывает ограничения банков/стран/провайдера без обещания приёма всех карт или отсутствия любых санкций.

Проверки: tsc и lint0errors; i18n-audit14 PASS; локальные26 domain/render tests PASS; PHP CloudTips и billing PASS;98 статических HTML и280 существующих gallery images PASS. Первичная browser-проверка нашла дублирование кнопки закрытия нового donation dialog общим header manager; исправлено штатным data-dialog-header=none. Подтверждающий browser-прогон PASS5/5, startup PASS8/8. Подвал: автоматическая проверка EN/RU×light/dark×360/390/768/1440 PASS16/16, вручную просмотрены EN dark1440 и RU light360; остальные кадры не объявляются полным ручным просмотром. Bundle c59b49e4faf23132d1b80bb5b71d5e2c7af01f0a024f19abfa54b1515d19a636 неизменен; synthetic cleanup PASS. Exact-commit CI/Deploy записать после результата. Это не выпуск/активация безопасности3.3.6.

Источники выбора провайдеров: https://prodamus.ru/priem-mezhdynarodnyh-platezhey ; https://boosty.to/boosty/posts/de1e6f32-3a80-4824-95bd-a264ff1b00aa . Требования Prodamus к ФИО/ИНН/тарифам воспроизведены по открытой анкете и снимку владельца.
