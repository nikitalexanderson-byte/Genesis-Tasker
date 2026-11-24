# Genesis Tasker: действующие правила

## Продолжение24 ноября: bounded directory/status ожидание

- Mounted49 завершён FAIL12PASS/1FAIL,2notRepeated; personal и3shared scopes
  ACTIVE, normal task readback PASS. Team editor не открылся до selector.
  Actual429 directory/status не использовали уже имеющийся signed-read retry,
  поэтому refresh снимал refreshed flag. CORRUPT_FILE может маскировать fetch
  failure и сам не доказывает повреждение данных. Cleanup49 PASS.
- Web fix54: typed bounded rate для read/status/directory; scope refresh и
  scopeSummaries используют retryE2eeRead с прежним owner/device/lifecycle guard.
  Ни mutation retry, ни stale-authority fallback, ни larger budget не добавлены.
  RED3/3, GREEN65/65 +close1/1, types/scoped lint/build:web PASS. Immutable54
  копируется только после completion build54; не запускать browser на copy race.
  Новый mounted54 впереди. Native inputs Android не менялись; старый native41
  не выдавать за runtime этой web correction. CI12ef45392523518/11880 SUCCESS
  обоих jobs, но не проверяет последующий54 diff.
- Component53 accepted112/112,49before=49after=53after hash5af34101…df9506.
  No subagents/Daybreak, private JSON/demo-output запреты, подпись/данные,
  coverage и release gates/floors off сохраняются.

## Продолжение24 ноября: окно согласования доступа

- Native PrivateMembershipModal сохраняет открытый editor dialog и поднимает
  review в browser top layer; общий popup frame исключает внешний gate. Это
  web-only UI correction; crypto guards/keys/ACL не менялись. Browser component49
  PASS8/8 на4 ширинах×2 схемах, actual modal/fence/Close/Escape/draft retention.
  Typecheck/build:web PASS, scoped lint0errors/3old warnings, detector49[].
- Mounted membership46-02 FAIL после normal shared readback: team editor не
  открылся до role selector; snapshot содержит E2EE_REFRESH_REQUIRED/
  E2EE_DIRECTORY_CONFLICT и actual429. Это не доказательство modal pointer bug.
  Cleanup PASS. QA entry теперь ждёт roster и использует прежний bounded
  Retry-After/reload/unlock. Новый focused49/session92385 всё ещё идёт на
  уже полностью скопированном immutable49. Он явно notRepeated два принятых42
  personal recovery cases. Ранний48 был запущен до конца copy, owner-checked
  API stopped, cleanup PASS; его изменённый bundle hash не засчитывать как QA.
  Подробности/ограничения — security-336-membership-acceptance-2026-11-24.md.
- Membership clients50-05 PASS6/6: real SQLite/P256/HPKE scope clients, atomic
  3-scope rotation + exact receipt retry, actual revoked read/write refusals,
  old recipient cannot open future root, first trusted device of an EXISTING
  member reads epochs1/2 with explicit history grant, cold owner vault read.
  CLI transport + in-memory encrypted vault, не actual HTTP/IDB/owner-consent UI.
  Cleanup PASS; failed50-04 runtime отдельно owner-checked cleaned. Новые
  scripts/qa/membership-{clients.mjs,client-store.php} не меняют product code.
  Полные33/34 и20-path/48-scenario вывод по-прежнему не завершены.
- Component53 PASS112/112:14 языков×4 widths×2 schemes, palette violet,
  actual modal/fence/checkbox/Close/Escape/retained parent draft и inner overflow.
  Manual de360dark/ja390light/en1440dark; другие снимки geometry/input only.
  Runtime whole membership и font-scale1.3 этим не приняты. Семантически
  прочитаны ещё210 критичных значений external/Drive/archive/cancel/restore copy
  на14 языках, без противоречий; exact keys/hashes в semantic51/52 evidence и
  final-review.md. Product/native inputs не менялись ради этих проверок.

## Продолжение24 ноября: атомарное изменение участников

- Новая предметная приёмка выявила production defect: genesisE2eeEpochKeys
  пропускал rotate-membership. Теперь membership epochs входят в историю как
  обычная rotation; иначе ломалась полнота history grants и проверка key reuse.
  RED membership-atomic45-1124-red02 сохранён. GREEN history02:39 новых assertions
  с реальной SQLite/P256/staging/cancel/atomic ACL+3 rotations/late rollback/
  revoked reader/immutable receipts/history grants/key reuse; cleanup PASS.
- TS/PHP planner+wire15/15 и production stager lifecycle6/6 PASS. Последний
  использует synthetic durable CAS ports и ECDSA, не actual IDB/Android.
  Server opaque capsules не доказывают клиентскую расшифровку. Полные33/34,
  20-path/48-scenario acceptance, signed149→150 и exact final review ещё нужны.
  app/android/contracts/public не менялись; native41 повторять ради server fix
  не нужно. Доказательства — security-336-membership-acceptance-2026-11-24.md.

## Текущее продолжение24 ноября: старое browser storage

- После загрузки паспортных фото самим владельцем Prodamus прошёл шаг5:
  application «Анкета успешно отправлена!», email link «Почта подтверждена».
  Оферта — опубликованные /terms?lang=ru. Заявлены российские/зарубежные карты,
  внешняя интеграция; кредиты/рассрочки и рекурренты выключены. Ожидается внешняя
  проверка1–3рабочих дня; кабинета/ключей/checkout ещё нет. Не активировать wire
  contract5216f0dc по одному факту подачи. Документы в репозиторий не копировались.
- Повторно наблюдался Boosty Basic VERIFICATION COMPLETED, up to EUR500/year.
  Main7964526b принят как новая опубликованная база: exact Source checks
  45364626251 и штатный Deploy45373264770 SUCCESS. Live anonymous donations
  endpoint возвращает Boosty available=true и /genesiscalendar/donate; шесть
  public routes200 с верными реквизитами, /ru/ redirects и неизменный manifest149
  подтверждены. Это не security3.3.6 и не проверка настоящего платежа/выплаты.
- В root добавлен owner-bound legacy-storage retirement: byte-exact старые
  localStorage originals и raw legacy workspace key сначала запечатываются
  independent device vault и перечитываются, потом compare-and-remove под
  действующим migration fence. Resume читает encrypted originals; signed cancel
  восстанавливает только свой незавершённый scope. История отменённого scope не
  воскрешает позже удалённые values. Public profile имеет отдельную retention.
- Focused19/19, tsc/scoped lint и build:web PASS. Actual mounted browser42
  PASS13/13, immutable cb84fedf…87216, owned runtime cleaned. Initial41 FAIL
  сохранён: net::ERR_CONNECTION_FAILED, этот код добавлен в прежний bounded
  explicit form retry без reset. Full JS41:2182/2184 PASS,2 PHP prerequisites;
  с прежним PHP обе затронутые suites PASS11/11. Native41 build SUCCESS21m52s,
  fresh JVM1453:1445PASS/0fail/8old opt-in skips. SourceBEA956EA…230308,
  APK95995C54…982D8C; instrumentation тот же327EC0D3…11826.
- UI41/session71896 завершён PASS_LOCAL_SCOPE4/4 на retained37 без новой миграции.
  Backend изменён только шестью просмотренными payment/donation файлами main49;
  runner проверяет exact allowlist, clean backend и фиксирует новый полный hash,
  не claim-ит byte-identical backend. Backend hashBAAD5E68…E4518C, services
  stopped/reverse removed, owned runtime preserved до release cleanup. Root
  inputs разморожены. Документы и отдельная Prodamus-ветка не native inputs.
  Не повторять принятую native controller37 migration ради нового UI evidence.
  Сохраняются no subagents/Daybreak, запрет чтения client-state/*.private.json и
  demo-output, данные/подпись, cutover/floors off, deployAndroid=false.

## Последнее дополнение24 ноября: Boosty и принятый native40

- Boosty Basic фактически подтверждён в UI (VERIFICATION COMPLETED, до EUR500/год).
  Страница boosty.to/genesiscalendar имеет сохранённые название GENESIS · Nikita
  Lyapin и About; официальный Copy link дал /genesiscalendar/donate. В закрытый
  config.php Hostinger добавлен только boosty (enabled/profile_verified=true,
  этот URL); остальные настройки строго сверены, private rollback сохранён.
  Это пока не публикация нового сайта и не проверка реального платежа.
- Срочный PR49 HEAD3f91441d: PR Source checks45356215106 оба jobs PASS;
  push45356202996 пока ждёт web-and-api. Защита main не обойдена; merge/Deploy
  ещё не выполнены. Production4cc67503/APK149 остаётся. Новый main сначала
  обязан пройти собственные exact-source checks, затем прежний deploy.yml.
- Controller37 platform PASS_LOCAL_SCOPE, actual migration/private reader/
  cold PIN1/1 PASS; старый wrapper INCOMPLETE из-за UI harness. Миграцию не
  повторять для UI: сохранён owned runtime37. UI37/38 дают2PASS/2FAIL; это не
  принятое4/4. Native39 выявил некликабельный Text-child Compose в test selector.
  Native40 ищет реального enabled button ancestor и требует actual STOPPED
  перед следующим launcher entry; diagnostics сохраняют только threads/screen.
  Build40 PASS, unitExecuted=false, product APK byte-identical build37
  (7A7AF1CFB732BF00726E5B8B49DD050CE205E86C872D6B61B4D33A81A9F44D8F).
  UI40 на retained37 завершён PASS_LOCAL_SCOPE:4/4 реальных UI сценария,
  backend unchanged, QA data preserved, services stopped/reverse removed.
  Native inputs разморожены; использовать этот результат без новой миграции.
- API26 source37: фактически36PASS/1FAIL, оригинальный отчёт INCOMPLETE сохранён
  (его Measure-Object сумма2 ошибочна; derived-totals.json считает36/1).
  Source39 focused capacity PASS1/1 после настоящего observed PIN после тяжёлой
  подготовки; periodicRefresh=false, исходный NONE восстановлен. Product APK
  тот же. API34 source37 прежние37/37 PASS; не называть это полной UI приёмкой.
- Отдельный worktree prodamus-gateway-worktree, branch codex/prodamus-gateway-
  20261124, commit5216f0dc: strict form/HMAC/receipt wire contract,63 checks PASS.
  В API не подключён, checkout не активирован. Durable state/schema141, полный
  gateway/web/native, pending/refund lifecycle и merchant acceptance ещё нужны.
  Не изобретать lookup/refund API или merchant URL. Регистрация Prodamus ждёт
  опубликованных реквизитов/тарифов и двух подтверждённых ссылок на шаге3/5.

Следующий раздел и старые sessions ниже — исторические срезы; это дополнение
имеет приоритет. No subagents/Daybreak, private client-state/demo-output запреты,
сохранность данных/подписи и раздельные web/API/APK публикации сохраняются.

## Уточнение донатов 24 ноября 2026

- CloudTips — для российских карт; Boosty — для зарубежных. Сервис выбирается вручную, регион меняет только порядок. Страница boosty.to/genesiscalendar создана на Никиту после подтверждения условий; KYC обязателен до активации. Не выдавать неподтверждённый профиль за работающий приём платежей.
- Сохранить старый CloudTips checkout для3.3.5/149 и подписанную историю. Новые public options stateless; внешняя ссылка не получает account data и не даёт платный доступ. Без сверки внешних донатов автоматическое удаление аккаунтов остаётся закрытым.

## Решение владельца 24 ноября 2026 — единый сайт и оплата

- Paddle отменён. Основной сайт genesiscalendar.com един для всех 14 языков;
  отдельной российской витрины и автоматических переходов по IP/GPS нет.
  Старые /ru/ ссылки допускаются только как переход к соответствующей общей
  странице с сохранением языка. Это прямое разрешение владельца заменяет
  прежние правила двух редакций и регионального скрытия донатов.
- Создатель проекта, ответственный за сервис, исполнитель платных услуг и
  оператор персональных данных — Ляпин Никита Александрович, самозанятый,
  ИНН 772495179010, nikitalexanderson@gmail.com. Владелец домена и хостинга —
  Юрий Логвинов (Iurii Logvinov), demiurge.soft@gmail.com.
- Сохранить ЮKassa, канал Google Play и подготовить подтверждённо подходящий
  международный способ для самозанятого: зарубежные карты, зачисление в рублях.
  Новый checkout не объявлять активным без договора, настроек и приёмки.
- Донаты возвращаются к обычному интерфейсу. Доступность конкретного платежа
  определяется действующими условиями провайдера; не обещать приём всех карт
  во всех странах и отсутствие любых санкционных ограничений.
- Публичные документы и продуктовые тексты должны быть политически нейтральны
  и правдивы об исполнителе, провайдерах и передаче данных. Скрытие участников,
  смена языка или геолокации не заменяют соблюдение применимых ограничений.
- Срочный web-выпуск выполняется отдельно от незавершённой безопасности3.3.6;
  APK149, данные, подпись, update floors и выключенный cutover сохраняются.

## Актуальное продолжение 24 ноября 2026

- Security HEAD c0ac5d82; exact-source CI45343556816 SUCCESS обоих jobs.
  Native build37 SUCCESS, actual JVM1452:1444 PASS/0 failures/8 opt-in skips;
  source hash38322BF326156883D86C237581E33DE5E51B7716FE16BFD1CE5F373DA84A6DCD.
  Focused API34 source37:4 suites/37 cases PASS. API26 per-case source37 идёт
  отдельно с реальным наблюдаемым системным PIN перед каждым case; исходный NONE
  обязателен к восстановлению. Controller37 + unlock UI идёт без периодического
  обновления HAT и с настоящим launcher driver. До его завершения app/android/
  contracts/public в root не менять. Документы не являются native inputs.
- В c0 исправлены web input ownership races (snapshot секретов до await,
  zero owned buffers finally): actual Chromium/IDB RED4 failures, GREEN5/5;
  native source bridge освобождает finished permit до JS acknowledgement,
  сохраняя лимит2 unfinished requests. Streamed source fixture дополнен
  обязательной protocol/owner/scope/migration/hash/fence binding; guard не ослаблен.
- Срочный сайт ведётся в output/release-3.3.6/unified-payments-worktree,
  branch codex/unified-payments-20261124, commit875c8b5e, PR49. Пользователь отменил
  Paddle и две витрины: единый genesiscalendar.com с14 языками, старые /ru/ только
  redirect; исполнитель/PD-controller Никита Ляпин, НПД/ИНН772495179010; Юрий
  Логвинов владеет доменом и хостингом. ФИО, ИНН, реальные тарифы помещены в подвал.
  Политические/санкционные гарантии всех стран не заявляются, реальные роли и
  сервисы обработки данных сохраняются. Source checks веб-ветки пока выполняются;
  это не Deploy и не выпуск безопасности. Production4cc67503/APK149 сохраняется.
- Донаты: CloudTips для российских карт, Boosty для других; ручной выбор доступен,
  регион меняет только порядок. boosty.to/genesiscalendar создана на Никиту после
  отдельного подтверждения условий. Несмотря на ответ владельца о верификации,
  свежая Boosty Verification всё ещё показывает незаполненную AML/KYC форму.
  Не включать приём до действительного допуска; не читать/не присылать коды и
  документы в чат. Анкета Prodamus на шаге3/5 ждёт публикации сайта с реквизитами.
- Полный crypto review,48-system-scenario evidence и signed149→150 ещё не закрыты.
  Старую формальную coverage9/20 нельзя повышать по сумме component test counts.
  No subagents/Daybreak; demo-output и client-state/*.private.json не читать/stage.

- Актуальнее предыдущих срезов: root b929b60f, принятый main4cc67503 включён.
  Block0c5aa442 исправил общий reader: overlapping GETs используют один свежий
  verified snapshot, aggregate GETs не блокируют друг друга, mutations остаются
  барьером. Добавлены owner-bound encrypted space layouts web/native с сохранением
  старого personal document. tsc/scoped lint и53/53 tests PASS. Immutable web36
  actual normal shared task + multi-chunk attachment/photo hash readback PASS2/2,
  legacy project route409, bundle unchanged; report retained58/resume-1795476689849.
  Explicit offline cold shared reader web34 PASS1/1, no signed network requests.
  Native36/session1193 assembling0c5aa442: app/android/contracts/public НЕ менять
  до identity/runtime36. UI35 cancel/PIN/fingerprint3PASS, background1FAIL90s;
  native36 test now uses actual Activity lifecycle without synthetic auth callbacks.
  Original fixture session expired after1h and HTTPS fixture had cookie_secure=false;
  corrected securely, same-owner separate synthetic identity delivery PASS1/1.
  No production cookie/key guard weakened. Root exact-source CI0c5aa failed only
  no-unsafe-finally in retained QA runner; fixed b929b60f, rerun pending. APK149,
  floors/cutover/pilot and deployAndroid=false unchanged; formal coverage9/20.
  Six checked RU announcement PNGs packed in output/release-3.3.6/
  GENESIS-3.3.6-announcement-RU.zip; two black system-auth captures excluded.

- Новейшее продолжение: root67684489 включает guarded Retry-After a365c880/
  09291e57 и optional personal projection c9cee41b. Build31 SUCCESS, JVM1452:
  1444PASS/0failures/8 old opt-in skips. Build32 assemble-only SUCCESS; её
  скопированные XML НЕ новый unit run. Full lint30 SUCCESS0errors/224warnings.
  Controller30 PASS, UI31 PIN/fingerprint/cancel3PASS; background отдельно1PASS.
  Restore31-02 PASS: age snapshot3ACTIVE scopes/25tables, wrong/tamper deny,
  byte-exact restore и actual cold-PIN normal product read; runtime/plaintext
  этого успешного restore очищены. Failed setup restore31-01 ещё очистить.
  UI32 interrupted after observed Android background-launch denial (Home stayed
  foreground). Instrumentation now uses actual system launcher and awaits resumed
  MainActivity. Build33/session83796 assembling; root app/android/contracts/public
  НЕ менять до identity/runtime33. No new product bypass or credential refresh.
  Immutable web33 includes retry binding and72/72 scoped tests, typecheck/lint/
  web build PASS. Retained58 reader still unresolved; diagnostics waits actual
  HTTP429 Retry-After238s (no rate reset/limit increase). Runtime log web33-reader58-04.
  CI79dc45273761078 SUCCESS both jobs. Production149 and activation gates unchanged.

- Актуальнее всех freezes ниже: native30 SUCCESS4m43s на79dc383b,
  JVM1448:1440PASS/0failures/8 opt-in skips; source hash E7B28B6E…,
  APK EE918FA4…/test0B994D62…. Actual API26/API34 source30 по7/7 PASS.
  Controller30 и full lint30 RUNNING (sessions21160/1045), PID32014 сначала
  snapshot/sources. До обоих результатов app/android/contracts/public не менять.
  Build29 имел единственный fixture catch FAIL (wrong exception class при
  корректном extra-field deny); fix79dc383b не меняет production validator.
  Web57 на immutable31 hash-stable FAIL после15PASS: после actual429 retry
  project migration E2EE_CORRUPT_FILE. Не считать приёмкой файлов. Short real
  multi-chunk queue rate/resume/cold-read unit PASS1/1; source отказа ещё ищется.
  Web58/session30471 идёт на том же immutable31 с safe technical stack frames и
  opt-in owned synthetic failure preservation. Client recovery/browser state
  при FAIL сохраняется отдельно от backend в client-state; НИКОГДА не читать,
  не печатать и не stage его private.json. Оба owned каталога очистить до release.
  CI79dc run45273761078 RUNNING. Backend155/1 (неизменённый300s bulk-large
  timeout Windows); HTTP402/402, i18n14 audit, dependency0 подтверждены.

- Самый новый срез: build28 завершилась compile FAIL (LocalPreferences117:
  Kotlin не допускает comma-separated val locals). Исправлено643f01fb;
  build29/session76282 выполняется, app/android/contracts/public до identity29
  не менять. XML из28 не являются новым unit evidence (tasks не выполнялись).
  Web parallel scope-refresh fix aadb00cc/191625eb перенесён в root; typed
  authority inputs snapshot до await. JS full2157:2153PASS/4FAIL; три environment
  prerequisites устранены и rerun PASS, четвёртый — no-op random-ID mutation
  fixture, исправлен гарантированной заменой. Scoped58/58 и rendered62/62 PASS.
  API HTTP402/402 PASS, i18n14 audit PASS, dependency audit0. Full backend ещё
  выполняется. Web56 не засчитан: запущен до завершения immutable copy и bundle
  hash изменился; дополнительно observed transient fetch connection failure.
  Web57/session25778 повторяет content/files на уже завершённом immutable31.
  Runtime29 использовать wrapper28 с явным -RunId29 -NoAuthenticationRefresh
  -KeepFixture (preserves только owned synthetic runtime после controller PASS).

- Последний срез продолжения: native27 full controller PASS (1503s), full lint27
  SUCCESS0errors/224warnings/9hints; UI27 первые2/4 PASS, затем реальный crash
  legacy LocalPreferences.setRemote под active fence. Исправлен цельным блоком:
  device-root UI document + encrypted pending public preferences, typed custody/
  archive inventory web/native, legacy originals unchanged, lock/corruption fail
  closed; adopted foreground vault больше не зависит от HTTP request generation.
  Новая actual regression проверяет pending/ack, реальный public preference HTTP,
  сохранность original и второй cold PIN. JS26/26 PASS; native block требует28.
  Web55 trusted-device enrollment/cold local-code PASS; web53 backup3checks PASS,
  shared project/space ACTIVE, normal task reader timeout после actual429.
  Это не полный PASS web53. Production149 и rollout gates прежние; coverage9/20.
  Не читать и не stage demo-output; не использовать subagents или Daybreak.

- Текущий срез23 ноября22:55: controller26 прошёл personal migration, private
  identity, два real cold-PIN входа и edit/background reread; shared readback
  остановился HTTP AuthFailure, status старым runner не сохранён. Build26 JVM
  1437:1429 PASS/0failures/8 opt-in skips; actual cache cases26/34 по3/3 PASS.
  Перенесены explicit archive inventory web/native, inline import и independent
  public-profile namespace. Новые active-fence cache и bounded Retry-After read
  corrections требуют build27 и runtime; это не готовая приёмка3.3.6. После запуска
  build27 root app/android/contracts/public заморожены до её identity/runtime.
  Старые freezes ниже исторические. Production149 и rollout gates прежние.

- Последний срез23 ноября21:50: full lint24 SUCCESS0errors/224warnings/9hints,
  actual archives+relational source regression24 API26/API34 по4/4 PASS.
  Controller24 дошёл до personal ACTIVE за7m33s; затем test-only predicate ждал
  ready до реального PIN, хотя locked private identity намеренно ready=false.
  Fixture исправлен с явными отрицательными проверками content readiness.
  Следующий build25 меняет только instrumentation; до его identity root
  app/android/contracts/public снова не менять. Web44 vault visuals112/112 PASS,
  но полный shared43 ещё выполняется. Production149 и gates остаются прежними.

- Build23 завершилась JVM1437:1428 PASS/1 FAIL/8 existing opt-in skips. Единственный
  FAIL — новый fixture counter перечислений (реальный vault фильтрует objectPrefix
  после storage.list), не crypto/body отказ. Counter исправлен без изменения main
  кода; build24 повторяет весь RemoteOriginal suite и собирает QA APKs. До результата
  build24 root app/android/contracts/public не менять. Full runtime ещё впереди.

- Native22 full controller завершён20-minute timeout после перехода sources→
  reconciliation; PIN/HAT отказа больше нет. Его inputs разморожены. Web corrections
  перенесены commits83db5557/08851210. Текущая build23 проверяет linear bulk original
  audit и strict EOF/request/body/namespace проверки; root app/android/contracts/public
  не менять до identity23. Cold PIN/biometric и все rollout gates сохраняются.

- Текущая native build22 проверяет foreground durability после300s Keystore HAT:
  cold opening по-прежнему требует реального системного PIN/STRONG biometric;
  memory-only witness уже открытого устройства проверяет exact bundle/slot/key.
  До результата build22 не менять root app/android/contracts/public inputs.
  Web read-floor correction разрабатывается в существующем linked worktree;
  перед переносом дождаться identity22. Старые build9/build14 freezes ниже —
  история, не действующие сборки. Приёмка нового блока ещё не завершена.

- Подтверждение отпечатка использует публичный Compose launcher AndroidX
  Biometric1.4.0-rc01 с Class3/STRONG на всех поддерживаемых API. Core1.18
  FingerprintManagerCompat оказался no-op и удалён из этого пути; старое
  утверждение о рабочем bridge было неверным. Системный PIN запускается только
  отдельным owner-bound переходом. Реальная Keystore-проверка после UI обязательна.
  Снимки кандидата для анонса не являются приёмкой безопасности или выпуском.

- 23 ноября русский SVG-флаг опубликован отдельно от безопасности: main
  4cc6750315ce115074f129239598d6673ae73cc6, Source checks45140708340 и штатный
  Deploy45146768399 SUCCESS. Live meta, SVG200 и реальный radio «Русский» с
  loaded /language-flags/ru.svg без текста RU подтверждены; Android manifest
  3.3.5/149 неизменен. Принятая база включена в security ветку merge b5616c4c.
  Дальнейшая работа только вперёд от неё; это не выпуск/активация3.3.6.

- 23 ноября механизм PIN/отпечатка принят отдельным реальным component run на
  owned API34: RecoveryCredentialActivity + auth-required Android Keystore,
  4/4 (PIN, fingerprint37, отмена, фон). Это ещё не полная приёмка аккаунта или
  выпуск. Доказательство — output/qa/security336-native150-unlock-component-api34-04/.
  Исходный synthetic PIN сохранён. Гонки background generation и encrypted
  job custody исправляются отдельным блоком с обязательным повтором product
  migration; guard-отказы не ослаблять. Во время текущей build14 не менять
  app/android/contracts/public inputs до результата.

- 23 ноября владелец дополнительно поручил экран блокировки приложения с
  отпечатком и PIN, если он ещё не реализован. Существующий fullscreen vault
  gate и системный PIN сохраняются; к тому же одноразовому owner-bound входу
  добавлена платформенная биометрия. Использовать PIN/графический ключ/пароль
  Android, не хранить PIN или отпечатки в GENESIS. На API30+ только STRONG,
  на API26–29 платформенный fingerprint и системный credential fallback.
  Отмена, фон, timeout и смена owner не открывают интерфейс. Callback не заменяет
  фактическое открытие authentication-required Keystore vault. Код ещё требует
  сборки и реальной приёмки отпечатка/PIN на owned эмуляторах; не claim-ить готовый
  релиз или биометрический PASS по наличию API вызова. App inputs текущей build9
  не менять до её результата.

- 23 ноября последним уточнением владелец потребовал заменить буквенное RU
  российским SVG-флагом, как у остальных языков, включая международный выбор
  языка. Это заменяет прежнее исключение без флага для этой кнопки. География,
  оператор, валюта и отдельная российская редакция от выбора языка не меняются.
  Изолированная веб-правка — codex/ru-language-flag-20261123, PR47; её фактическую
  публикацию подтверждать отдельно от подготовки безопасности.

- 23 ноября исправление URL-языка и международных USD Terms опубликовано отдельно:
  принятая production-база main4c209a00356a0211a5a11a24580b458be3cf7bc3,
  Source checks45094862291 и Deploy45099066004 success. Live авторизованные
  EN/USD, международные RU/USD и российские /ru/ RUB подтверждены; APK/manifest149
  сохранены. Security3.3.6 не публиковалась; текущая подготовка развивается
  вперёд от этой базы. Paddle checkout не активирован, deployAndroid=false.

- 23 ноября региональная витрина опубликована отдельно от безопасности: main
  c1205c045862fcfbaa01b48a1fbd7f04d6693b75, Source checks45084250291 success,
  Deploy45088162015 success. Обнаруженный при live-приёмке повторный выбор языка
  аккаунта и старые RUB-цены в международных Terms исправляются вперёд от этой
  базы; публичный документ выбирает язык по URL, международные условия — USD
  на всех14 языках, /ru/ сохраняет российские условия. APK3.3.5/149 и выключенные
  security/Android gates сохраняются. Детали — docs/web-paddle-operator-2026-11-22.md.

## Строгий порядок владельца от 22 ноября 2026

- Выполнять реализацию целыми законченными функциональными блоками кода на web, API и Android. После минимального чтения нужных контрактов сразу вносить весь связанный код; не подменять реализацию повторным исследованием, микроправками и длинными промежуточными отчётами.
- Сначала завершить все оставшиеся блоки исходного задания 3.3.6. Только затем проводить общий анализ/source review, compiler/typecheck/lint/tests/build/CI, приёмку, исправления и итоговое внутреннее крипторевью. До этого не запускать проверки исполнения security-кода.
- Не возвращаться к уже изученным файлам и завершённым блокам без конкретной новой зависимости или ошибки. Не расширять архитектуру сверх требований исходного задания. Документацию обновлять кратко по завершённому блоку; сохранять код и точный остаток.
- Обязательные условия сохранности данных, подписи, совместимости 3.3.5/149, раздельных публикаций и честной итоговой приёмки сохраняются. Срочные готовые веб-правки выпускать отдельно от незавершённой безопасности.


## Подготовка 3.3.6 с 18 ноября 2026

- 22 ноября отдельным веб-выпуском опубликованы исправленная desktop-луна/часы
  и автоматическое включение общих дел без переключателя в Account. Новая принятая
  база mainac8ccf604bb42f7b7b19411f8703b88cd7dce8d2, Source checks45057471114
  success, Deploy45061812677 success. Live meta/health, desktop1440dark и Account
  readback подтверждены; manifest149 неизменен, APK HEAD200/286545165bytes.
  Android3.3.5/149, deployAndroid=false, security coverage9/20, cutover/floors off.
  Это не активация Paddle или приёмка безопасности. Развитие сайта только вперёд
  от этой базы; детали и пределы — docs/web-pricing-region-2026-11-22.md.



- 22 ноября следующим отдельным выпуском опубликованы исправленные региональные
  USD-тарифы, скрытие ЮKassa без положительного текущего RU-сигнала и точечные
  правки карточек, часов, лунной подписи и настроек советов. Принятая текущая
  веб-база — main `6672bbefd65abc4b9c3268800d02c57bd82ed967`, Source checks
  `45042239234` success, штатный Deploy `45048236052` success. Live meta/health,
  неизменный manifest и полный APK3.3.5/149 SHA-256 проверены; живое окно тарифов
  в текущей сессии показывает USD без RUB/ЮKassa. Пределы live QA и снимки —
  `docs/web-pricing-region-2026-11-22.md`. Этот main перенесён в security ветку,
  расширенные правила3.3.6 сохранены. Новая безопасность не публиковалась,
  Paddle checkout не активирован; GENESIS_DEPLOY_ANDROID=false, coverage9/20,
  cutover/floors off остаются. Дальнейшее развитие сайта — вперёд от этой базы.

- 22 ноября срочные публичные веб-правки для Paddle отдельно опубликованы:
  main `c29b76e33cc42160616b2df6f5eca61af94f6c63`, Source checks44962824697
  success, Deploy44965877713 success. Новая международная витрина и `/ru/` —
  принятая база для дальнейшей работы; она уже перенесена в эту локальную ветку.
  Новая безопасность3.3.6 в этот Deploy не входила. Живая проверка98 документов,
  старых русских ссылок, API/Google provider и неизменности APK/manifest3.3.5/149
  прошла. GENESIS_DEPLOY_ANDROID=false. Это не активация Paddle checkout и не
  приёмка локального security-кода: покрытие остаётся9/20, cutover/floors выключены.

- Последним прямым уточнением 21 ноября владелец поручил итоговое крипторевью
  самому исполнителю и потребовал обновить Markdown: «сделай ты этот ревью и
  перепиши md что ты сам все перепроверишь в конце». Отдельное внешнее заключение
  больше не является условием выпуска/активации 3.3.6. После завершения всего кода,
  общей приёмки и исправлений выполнить итоговое внутреннее крипторевью точного
  финального кандидата, сохранить находки, исправления, повторные проверки и
  ограничения. Не называть его независимым человеческим аудитом и не засчитывать
  прежний ограниченный review за проверку нового большого diff. Все остальные
  условия покрытия, сохранности данных, recovery/upgrade и публикации сохраняются.
- 21 ноября владелец явно исключил версии до 3.3.5 из поддерживаемого перехода:
  их отдельные APK и upgrade-проверки для выпуска 3.3.6 не нужны. Релизная
  матрица обновления начинается с 3.3.5/149. Сохранять данные, подпись и очереди
  при 3.3.5 → 3.3.6, существующие schema migrations не удалять. Это уточнение
  заменяет прежнее требование проверять отдельные APK 3.3.4 и более ранних.
- Последним прямым поручением в этом продолжении владелец потребовал завершить
  все обновления и **полный деплой3.3.6**. После полной приёмки разрешены штатные
  отдельные web/API Deploy и подписанный Android APK3.3.6 на сайте. Это снимает
  прежнее ограничение подготовки без публикации для этого выпуска. Сохранить
  package, release-сертификат, данные, существующие workflows и принятую базу
  сайта; versionCode должен превышать все реально использованные, включая149.
  Полный coverage, recovery/direct-upgrade acceptance и итоговое внутреннее
  crypto review исполнителем остаются условиями активации E2EE. До подтверждённой доставки сохранять
  update floors0 и cutover off; GENESIS_DEPLOY_ANDROID включать только на выпуск
  и вернуть false. Личные устройства, Google Play-треки, Production и состав
  тестировщиков не менять как побочный эффект формулировки «деплой».
- Владелец уточнил в текущем продолжении: в3.3.6 сначала тестируется Paddle по
  уже согласованному прозрачному сценарию. Если корректное подключение не
  получится, сравнить альтернативы, включая CloudPayments и Робокассу; это
  резервный вариант, не поручение переключать действующую оплату сейчас.
  Реальные юридические роли, отдельный `/ru/`, один origin и работающая ЮKassa
  сохраняются. Одобрение домена и техническую/платёжную приёмку Paddle нельзя
  подменять языком, геолокацией или сокрытием витрины.
- Последнее решение по публичным языкам: отдельный раздел только `/ru/`,
  остальные языки на основном сайте через переключатель/`?lang=`. Сохранять
  один origin приложения/API/OAuth/ключей и очередей; DNS/поддомены не нужны.
  18 ноября владелец уточнил, что в Android речь о стартовом экране **до входа**:
  русский доступен только при текущем положительном IP-определении России.
  При неизвестной/другой стране — выбранный нерусский язык либо английский;
  сохранённый русский не обходит это правило. Настройки аккаунта после входа
  сохраняют все 14 языков. Не скрывать реальные юридические роли и не подменять
  платёжную допустимость языком/географией экрана. Подробности и QA:
  `docs/public-localization-336.md`.
- Владелец поручил начать реализацию полного security/E2EE-промпта прошлого
  чата и отдельно подчеркнул: изменения безопасности относятся **ко всей
  системе — сайту, API/серверу и Android**. Общие проекты, вложения, локальные
  очереди/черновики и backups входят в обязательный охват. Не сводить работу к
  Android или одному workspace. Полный исходный промпт сохранён побайтно в
  `docs/security-336-implementation-prompt.md`; актуальный журнал и этапы —
  `docs/release-3.3.6.md`. Историческое «анализ, не внедрять» во вступлении
  исходного промпта заменено этим новым поручением на реализацию.
- Параллельно прямо поручены точечные изменения дизайна Android по 11 снимкам.
  Объём и результаты: `docs/release-3.3.6-design.md`. Общая шапка имеет прозрачные
  icon actions в покое и фон при взаимодействии. Тулбары личных/общих дел и
  mindmaps по последнему уточнению — без обводок, с лёгкой подложкой и выделением
  выбранного действия/открытого меню. Декоративные иконки задач/привычек —
  одинаковые приглушённые glyphs без подложки во всех темах, также в календаре.
- Первый общий криптографический контракт реализуется за пределами активной
  legacy sync; это ещё не полный vault/enrollment/recovery/migration. Не повышать
  supported crypto protocol, обязательные update floors или включать cutover
  из-за наличия отдельных модулей. Перед активацией обязательны весь coverage,
  проверка восстановления/прямых обновлений и итоговое внутреннее crypto review.
- До готовности сохраняется действующая Android 3.3.5/149,
  подпись/package/данные и раздельные существующие workflow сохраняются;
  GENESIS_DEPLOY_ANDROID=false. Личные устройства не изменять как побочный
  эффект QA. Новый versionCode проверять перед релизной сборкой, он должен
  быть выше всех уже использованных, включая 149.

## Региональная витрина: уточнение владельца 23 ноября 2026

- Язык и редакция независимы: основной домен — международная редакция,
  `/ru/` — российская с прежними достоверными ролями и реквизитами. Во всех
  редакциях доступны все 14 языков; `/?lang=ru` не меняет международного оператора.
  Hreflang ru на основном домене ведёт в `/?lang=ru`, а не в `/ru/`.
- По последнему ответу владельца российский GPS достаточен для перехода в `/ru/`
  даже при иностранном IP/VPN. Разрешённая ранее геолокация проверяется автоматически;
  новый запрос разрешения — только по явной кнопке. Без достоверного GPS автоматического
  перехода нет. Ручной `/ru/`, выбранный язык, документ и referral сохраняются.
- Для донатов GPS имеет приоритет над IP. Без GPS требуется свежий положительный
  российский IP; неизвестный регион и остальные страны показывают disabled-кнопку
  без платёжной ссылки. Там также не показывать и не claim-ить support popup.
  Это региональное поведение сайта не меняет действующую политику API оплаты.

## Международная витрина: уточнение владельца 22 ноября 2026

- На международных публичных страницах оператор международных продаж и продавец
  — Iurii Logvinov (GENESIS), поддержка demiurge.soft@gmail.com. Не выдавать его
  за автора приложения. Авторство и существующая российская редакция сохраняются.
- Начальный HTML и React используют одну международную редакцию terms/privacy/
  refund/support/delete-account. RU реквизиты и ЮKassa остаются в /ru/.
  Языковые ссылки остаются внутри выбранной редакции; один origin сохраняется.
- Международная витрина описывает weekly reflection / planning review и разные
  виды календаря без слов о гадании. Не менять функции и не обещать прогнозы.
- Paddle описывается условно для покупок через Paddle как Merchant of Record.
  До подтверждённого подключения не объявлять checkout активным. Обязательные
  уведомления об optional AI/диктовке и согласие перед передачей данных сохраняются;
  общая международная политика описывает категории обработчиков и контакты.
- Это отдельный website-only выпуск от ac8ccf60 без незавершённого security-кода,
  Android/APK149, новых миграций БД, порогов обновления или включения E2EE.


## Единственный источник кода

- По прямому указанию владельца от 13 ноября 2026 использовать только
  `nikitalexanderson-byte/Genesis-Tasker`, ветку `main`.
- 15 ноября 2026 по прямому поручению владельца репозиторий переведён
  в Public для снятия блокировки GitHub Actions; текущая видимость Public.
- `nikitalexanderson-byte/calendar-genesis` удалён с GitHub по поручению
  владельца. Не использовать его для разработки, сборок или публикаций.
  Полный локальный архив с проверенной Git-историей:
  `C:/Users/mrdeu/.codex/archives/calendar-genesis-2026-11-13`.
- Работать в отдельной ветке от свежего main; сохранять изменения пользователя.
  Начинать с git status, git diff и точечного поиска связанных файлов.

## Раздельные публикации

- 22 ноября владелец отдельно поручил срочно исправить внутренние тарифы сайта:
  английский интерфейс показывает USD; при другой/неизвестной стране — USD на
  любом языке. ЮKassa предлагается только при положительном текущем определении
  России; известная другая страна имеет приоритет при конфликте сигналов. Не
  принимать язык, часовой пояс или сохранённую валюту за доказательство региона.
  Это отдельный веб-выпуск поверх c29b76e3 без security3.3.6 и Android. Paddle
  checkout не включать из-за исправления показа USD. Достоверные валюты ранее
  созданных заказов/возвратов сохраняются. См. docs/web-pricing-region-2026-11-22.md.

- 22 ноября 2026 владелец прямо поручил срочно выпустить только публичные
  веб-правки для Paddle: английская международная витрина, отдельный `/ru/`,
  локализованные документы, нейтральные пояснения оплаты и компактный footer.
  На международной главной не показывать российские платёжные пояснения,
  RUB и российский флаг; цены там в USD независимо от IP и сохранённой валюты.
  Полные достоверные сведения об исполнителе, владельце инфраструктуры и
  действующей оплате остаются в доступных юридических документах. Это уточняет
  прежнее требование подробного footer. Русский раздел и все 14 языков приложения
  сохраняются. Новую безопасность 3.3.6, E2EE, обязательное обновление и Android
  в этот выпуск не включать. API, Google OAuth, сессии и APK **3.3.5/149** сохраняются;
  `GENESIS_DEPLOY_ANDROID=false`. Paddle Seller **476362**, Iurii Logvinov,
  `genesiscalendar.com`: в кабинете 22 ноября по-прежнему **In review**.
  Наличие этих веб-правок не означает активный Paddle checkout.

- 18 ноября 2026 выпущен Android **3.3.5/149** из
  `3cc5c1bd7467eff56895a069b95ff1263f9df657`: signed build **44168478466**,
  APK-only publisher **44181876895** success. APK и manifest на сайте проверены;
  Samsung SM-A566E обновлён с прежней подписью и данными. AAB149 опубликован
  в существующем Open testing: **Available to testers on Google Play / Full rollout**,
  150 стран, Alpha143 сохранён. `GENESIS_DEPLOY_ANDROID=false`, пороги обязательного обновления 0,
  E2EE cutover выключен. Следующий versionCode должен быть выше 149.
  Галерея и валюта витрины — отдельное веб-поручение, без замены APK149.
  См. `docs/public-gallery-currency-2026-11-18.md`.

- Уточнение владельца 17 ноября 2026: создатель сайта и приложения и основатель
  GENESIS — **Ляпин Никита Александрович**. Владелец домена и хостинга —
  **Юрий Логвинов (Iurii Logvinov)**. За приём платежей для США отвечает Юрий
  Логвинов, для России — Ляпин Никита Александрович. Не называть Юрия владельцем
  всего GENESIS или его создателем. Сохранять это разделение на странице входа,
  в footer, поддержке и юридических документах на всех 14 языках. Уточнение
  ролей не включает Paddle/Google Billing и не меняет владельцев кабинетов.

- Последнее устройство для приёмки 3.3.5 — Samsung SM-A566E, serial
  `R5CY317QVEX`, подключённый владельцем вместо realme. Подписанная 148
  установлена поверх 147 с сохранением данных, но не опубликована. Приёмка
  обнаружила неверное сообщение приглашений при входе через дополнительный
  Google-аккаунт. Исправленная 3.3.5 получает versionCode **149**. Сохранять
  подпись, данные, отдельный QA package и существующий Open testing.

- Последнее уточнение 17 ноября 2026: владелец вошёл в Paddle и разрешил
  необходимые настройки, а также включение Paddle уже в **3.3.5, если всё работает**.
  Это отменяет календарный запрет до 3.3.6, но не проверку готовности. Подтверждены
  Iurii Logvinov / Seller ID 476362 / genesiscalendar.com; домен имеет **In review**,
  API keys пока отсутствуют, sandbox/live E2E не пройдены. До одобрения и успешной
  приёмки checkout остаётся скрытым. Не подавать повторную заявку и не менять
  юридические данные/выплаты без необходимости. Lemon Squeezy и Google Play Billing
  остаются выключенными, ЮKassa сохраняется.
  Владелец также подключил realme RMX5000 и поручил полную функциональную проверку,
  исправление дефектов и обновление основной установки с сохранением данных.
  Для ADB выбирать только serial Z9CYS8MRVKYHH6CA; синтетические сценарии выполняются
  в ru.genesis.calendar.qa1103.debug. Основное приложение не удалять и не очищать.
  Личные Google Drive backups в настройках одобрены для последующего этапа 3.3.6;
  отключённую заготовку нельзя выдавать за готовый recovery. Системная зашифрованная
  копия размещена в закрытом Google Drive владельца, скачана обратно с тем же SHA-256.
  Регулярное расписание ещё не настроено.

- 17 ноября 2026 новым прямым поручением владелец разрешил подготовку, сборку и
  выпуск переходной **3.3.5** на сайте и в существующем **Google Play Open testing**.
  Основа — промпт E2EE от 17 ноября: hardening общей инфраструктуры и bridge
  обязательного обновления, затем отдельная 3.3.6 с проверенной миграцией.
  Порог обязательного обновления на 3.3.6 и E2EE cutover остаются выключенными
  до подтверждённой готовности и доставки совместимого выпуска.
  Lemon Squeezy отменён окончательно; Paddle скрыт до отдельного подключения
  в 3.3.6. Последнее уточнение владельца: **Google Play Billing в 3.3.5 также
  выключен; единственный действующий checkout — ЮKassa**. Сохранять историю
  платежей и доступы. Не включать внешнюю оплату в Play в обход правил канала.
  Приглашения доступны с действующего Standard и выше; Гно Метэр Басилея
  включён в Premium/Business/Elite/Elite+, с прежними особыми перебросами Elite+.
  Перенести функциональные изменения актуального сайта. Дизайн приложения
  сохранять до последующих уточнений. Package, подпись, данные, Alpha,
  Production и состав тестировщиков сохраняются. Это поручение заменяет
  прежний запрет сборки/выпуска 3.3.5 ниже. Реальные устройства без отдельного
  актуального поручения не изменять.

- 17 ноября 2026 владелец отменил Lemon Squeezy для новых продаж и выбрал Paddle
  на Iurii Logvinov, demiurge.soft@gmail.com, Seller ID 476362. Другой кабинет
  476461 не использовать. Старое приглашение вернуло 404; рабочий доступ и
  подключение Paddle ещё не подтверждены. Исполнитель YooKassa остаётся
  Ляпин Никита Александрович, nikitalexanderson@gmail.com, ИНН 772495179010.
  Публичная витрина/документы и ограничения интеграции —
  `docs/paddle-readiness-2026-11-17.md`. Гно включён в Premium/Business/Elite;
  Elite+ получает неограниченные перебросы. Утверждены обычные приглашения
  выше Standard: 10% после первой оплаты, затем 3% при действующей оплате,
  до 10 постоянных приглашённых/30%, общий предел 100%; выплаты Дареса отдельно.
  Исходники и правила для будущего Android 3.3.5 сохранены в
  `docs/release-3.3.5-preparation.md`. Это подготовка, разрешения на сборку,
  установку или выпуск 3.3.5 пока нет. Сохранять действующую 3.3.4/147.
  Позднее 17 ноября владелец отложил подключение Paddle и попросил временно
  оставить эту оплату выключенной. К приглашению пока не возвращаться.
  Исследование Google Play Billing ведётся для иностранных покупателей, прежде
  всего США; владелец сообщил, что Джордж живёт в США. Получатель Google Play,
  владелец и страна текущего платёжного профиля и банк выплат ещё не проверены.
  Подготовку и тестирование Billing можно выполнить до Production.
  Результаты исследования сохранены в подготовке 3.3.5.
  Web/API опубликованы штатным Deploy **43993908653** success, исходник
  **de4938d5c51c866fc2a36df747d626c78c7a7cef** (PR #35), Source checks
  **43986629803** success с website_only=true и Android job skipped.
  Живая приёмка без авторизации: шесть public routes, 14 языков, восемь
  размеров/схем, Pricing/Features, юридические ссылки и мобильный Sign In — PASS.
  Android 3.3.4/147, manifest, SHA-256, URL/размер/ETag APK сохранены;
  GENESIS_DEPLOY_ANDROID=false. Подробности — paddle-readiness и подготовка 3.3.5.

- 16 ноября 2026 выпущен **Android 3.3.4/147** по прямому поручению владельца.
  Релизный исходник `d850ed11f819c191014fcb60a2fc5e6d96872b6c` (PR #31–33),
  Source checks `43862192526` success, подписанная сборка `43868424624` success,
  APK-only публикация `43882600504` success. Публичные APK и manifest проверены.
  Samsung SM-A566E обновлён поверх 146 с прежним сертификатом, UID и данными;
  восемь сочетаний тем и два запуска со значка прошли; текущие dark/violet
  восстановлены. Финальный 147 прошёл 215/215 функциональных сценариев,
  проверки 14 языков, телефонов/планшета и дополнительную приёмку API26.
  Подписанный AAB: DEX 97,43%, EXACT_MATCH, AGP 9.4.1 / R8 9.4.24.
  В Google Play Open testing **147 + возобновление канала + скриншоты RU/EN**
  отправлены на review; подтверждён **Changes in review**, Managed publishing off.
  Сохранены 150 стран/регионов, Unlimited, Alpha 143 и Production.
  Кандидат 146 на сайт и в Play не публиковался. Следующий versionCode >147.
  Сайт/API не выкладывались, incumbent остался
  `4ba77f2ff9cbda28a70fbb80549a96e559882cca`; `GENESIS_DEPLOY_ANDROID=false`.
  Полная приёмка, ограничения и подпись — `docs/release-3.3.4.md`.

- Production: `https://genesiscalendar.com`, только Hostinger.
  Единственный разрешённый серверный корень:
  `/home/u531952483/domains/genesiscalendar.com`.
- Не читать и не изменять соседние сайты. Beget не используется для приложения.
- Web и Android публикуются раздельными существующими ручными workflows.
  Поручение обновить Android не разрешает заменять сайт или общий API.
  Поручение восстановить сайт не разрешает откатывать приложение.
- Сайт восстановлен 13 ноября: Deploy 43447998003, веб-исходники совпадают
  с последней согласованной публикацией 94ab5d3 от 11 ноября.
- Владелец 13 ноября прямо утвердил текущий сайт как базовую версию:
  commit 59b05b165875f87848888d70aabca52b6837d876. Дальнейшие изменения сайта
  выполнять только вперёд от актуального main, сохраняя принятые правки.
  Любой откат сайта, публикация старого снимка или использование
  restore_web_only требуют нового прямого указания владельца на этот откат.
  Android продолжает развиваться независимо; его выпуск не даёт разрешения
  менять, откатывать или повторно публиковать веб-версию.
- Предыдущая публикация Android: 3.3.3/145, APK на сайте и основном
  realme RMX5000, с сохранением данных и прежней подписи. Исходник:
  `08610aaa471c6ce1d692c5f80f63233d8d530192`; подписанная сборка `43780546869`,
  APK-only публикация `43788853815`. Веб/API при этом не выкладывались;
  их incumbent остался `4ba77f2ff9cbda28a70fbb80549a96e559882cca`.
  Samsung SM-A566E ранее обновлён и
  проверен на 3.3.2/144 исходника `892d2c13`; затем владелец забрал Samsung
  и явно заменил его на realme для финальной установки и приёмки.
  Последняя отправленная в Google Play Closed testing Alpha версия —
  3.3.1/143; этот трек и его тестировщики сохранены. 16 ноября 2026 владелец
  поручил Open testing: AAB 3.3.3/145 и обновлённая карточка с описаниями
  и release notes на 14 языках, по 8 финальных кадров RU/EN отправлены Google;
  статус Changes in review, Managed publishing off. География Open —
  ровно прежние 150 стран/регионов Alpha, участие Unlimited.
  Production не выпускать: владелец ожидает отзывы и Lemon Squeezy.
  Сохранять package,
  release-сертификат, пользовательские данные и существующий Alpha.
  Подготовка 3.3.4 потребовала versionCode выше 145. DEX-оптимизация подписанного
  AAB 3.3.3 — 97.43%, EXACT_MATCH (AGP 9.4.1 / R8 9.4.24); не возвращать
  глобальный `-dontoptimize`. Приёмка и пределы проверки — `docs/release-3.3.3.md`.
  Согласованный Android-календарь, дневная подложка 12% и общая высота трёх
  карт сохраняются; новые изменения только по следующему поручению.
  Исходники подписанной 3.3.1:
  `5444bd714a60e3fc4a26b186b693b6d73f4f16ba`. Android-изменения архивной 3.3.0
  перенесены и проверены в 3.3.1; восстановление сайта само по себе не является
  переносом Android-правок.
- `GENESIS_DEPLOY_ANDROID=false` по умолчанию. Не запускать Android jobs
  или публикацию без соответствующего поручения. Не очищать данные приложения.

## Сохранение продукта и проверка

- Правило владельца от 14 ноября 2026: Android обновляется сразу до максимальной
  доступной версии, независимо от числа пропущенных выпусков. Не строить цепочку
  промежуточных APK. Публичный `android-update.json` всегда указывает на полный
  последний подписанный APK; публикация сначала размещает APK, затем manifest.
  Перед загрузкой и установкой заново проверять актуальную версию без кеша,
  заменять устаревшее предложение/скачанный APK новым целевым выпуском. Проверять
  все предлагаемые приложением пути установки: завершённое системное уведомление
  DownloadManager не должно открывать старый APK в обход новой проверки manifest.
  Исторические миграции данных сохранять внутри одного обновления, без требования
  установки промежуточных версий приложения. Проверять
  прямые переходы через несколько версий и сохранение данных/подписи. В Google Play
  использовать последнюю версию, подтверждённую магазином для существующего трека
  и данной установки; тарифы/данные/тестировщиков и Production-трек не менять.

- Уточнение владельца 13 ноября 2026: небесная и ночная (синие), лесная
  светлая и тёмная схемы — принятые образцы. Не менять их дизайн и цвета,
  кроме прямо порученных правок. Рубиновую и пурпурную доводить по аналогии
  с этими образцами отдельными ограниченными селекторами; изменения палитр
  не должны затрагивать друг друга. Текущие исключения: вечерний гражданский
  баннер «Сегодня», выравнивание уведомлений, светлые лунные сетки, карточки
  ФЮЗИС, контраст задач и одинаковый оттенок ячеек в светлых календарях дел,
  естественный край и зависящее от ветра движение облаков, переносы целыми
  словами и перенос переключателей разделов в общую шапку. Переключатель
  личных/общих дел виден только при действующем доступе Business/Elite/Elite+.
  Android не входит в поручение.

- Сохранять все календари, данные, изображения, иконки и смысловые места ассетов.
  Развивать существующий Universal UI; не менять стек без необходимости.
- Сохранять обе цветовые схемы и 14 языков. Не разрывать слова по буквам.
  Цели касания: 44px web, 48dp Android, кроме документированных исключений.
- Экран «Сегодня» показывает фактический сегодняшний день. Другие даты
  открываются в «Календарь → Месяц».
- Для UI сохранять снимки до/после и проверять 360/390/768/1440 px в обеих
  схемах. Указывать фактически проверенный объём и непроверенные состояния.
- Перед обычной публикацией выполнить locked install, lint, тесты и build:web;
  выполнить смысловую вычитку изменённых переводов. Не расширять проверку
  и не запускать Android-сборки ради изменений только документации.

- 22 ноября владелец поручил: для новых аккаунтов включены только афоризмы
  философов; советы Авроры выключены по умолчанию и включаются вручную. В
  Account первым открывается подменю философов. Сохранённый выбор источников
  существующих пользователей, история и лимиты не сбрасываются.

- 22 ноября владелец поручил удалить из Account переключатель включения общих
  проектов сайта. При действующем тарифе включать автоматически через существующий
  серверный entitlement-checked API, сохраняя объявление с переходом в общие дела.
  Уведомления, приглашения и события команды сохраняются. Desktop-луна и часы
  выровнены по левому краю с отдельным зазором; имя покровительницы внутри луны.
  Мобильная компоновка сохраняется. Это отдельный веб-выпуск без security3.3.6.
