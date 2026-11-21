# Обязательная admission реальных защищённых записей

Дополнение21 ноября: отложенный полный native lint выполнен на следующем
inputD57549, включающем эти provider writes и scoped current guards.0 errors/
208 warnings/8 hints, без новых issue/file pairs/count increases; API26/API34
каждый27/27. Точные identities и пределы — `e2ee-336-current-write-guards.md`.
Ниже сохранён исходный результат input2979; его deferred-lint формулировки
относятся к тому checkpoint и не являются текущим незакрытым блокером.

21 ноября 2026. Функциональная приёмка web/native границы записи пройдена.
Полный native lint нового input отложен до следующего интеграционного checkpoint;
этот результат не означает полную релизную приёмку или выпуск3.3.6.
Coverage остаётся9/20; run/upload/activation state4 и cutover закрыты.

Все записи настоящих IndexedDB `records`/`keyMaterial`, ciphertext SQLite и
Android AtomicFile device bundles проходят общую проверку места. Отдельные
source/plan/coordinator/remote-original writers больше не могут заменить
физическую проверку callback с вымышленным usage. Их собственные ограничения
данных/metadata сохраняются. Memory providers служат тестам компонентов и не
становятся продуктовыми durable capabilities.

Для IDB оба COUNT, все affected-row CAS, подтверждённые deletion credits и
запись находятся в одной strict transaction двух stores. На Android COUNT и
изменения records находятся в одной SQLite transaction; создание encrypted
device bundles сериализуется прежним общим mutation lock. Другие namespaces
включаются в counts, их тела/ключи для измерения не открываются. Для CAS и
rewrite читаются только реально затрагиваемые ciphertext rows.

Рост вычисляется из фактической сериализации ciphertext и ключа записи.
Учитываются две будущие копии, размер предыдущей затронутой строки и16KiB page
headroom на изменение, плюс1MiB reserve. Предельные counts —10000/1000; новый
произвольный byte cap не добавляется. Browser usage/quota относятся ко всему
origin, native использует прежние provider files и StatFs. Это консервативная
оценка и snapshot, не физическая резервация. Чужой writer может занять место
после измерения; durable transaction всё ещё обязана отказать атомарно.

IDB владеет неизменяемой копией каждого ciphertext row до первого await.
Существование определяется cursor presence, а не `get(...) ?? null`: invalid
serial и даже существующий key row со значением undefined не могут стать
основанием заменить старую запись как отсутствующую. Unknown quota и provider
exceptions отказывают фиксированным кодом; retirement/lock отменяет позднюю
запись. Коды capacity/usage сохраняются через quarantine transport без текста
filesystem/provider exceptions.

Native `.new` считается существующим key bundle. Первая provision не заменяет
такой незавершённый контейнер. Отсутствие DB допустимо только перед самой первой
записью ключевого bundle: ни companions DB, ни каких-либо device bundles ещё нет.
Обычное измерение/unlock по-прежнему требует настоящую базу. Admission ключа
предшествует созданию нового alias AndroidKeyStore и AtomicFile mutation;
Keystore authentication остаётся обязательной. Количество aliases не выдаётся за
число encrypted bundle records.

Web evidence:

- сохранён RED настоящей IDB/vault записи при подставленном quota estimate0:
  прежняя запись игнорировала этот сигнал. Это не физическое заполнение диска;
- Chromium157:14/14 новых проверок обязательной записи, console0. Проверены
  quota/unknown/shrinking/provider failure, lock во время await, cold reopen,
  immutable input, malformed/undefined rows и конкурентные последние slots;
- regressions настоящих provider: preparation/ownership15/15, raw original23/23
  и content-plan13/13, каждый console0; вместе65 browser cases. Проверены два
  generated9MiB originals, полный cold readback и независимые bounded host hashes;
- полный JS2044/2044,0 failure/skip; owned TSC03 и scoped ESLint02 PASS.
  Первый types01 отказал на TS-типе array descriptor; исправлен без изменения
  теста. JS01 предшествует дополнительной cursor-presence проверке; текущий
  полный прогон — JS02. Browser green01 содержит12 cases до двух follow-ups,
  green02 — все14; исходный RED не перезаписывается.

Frozen native input:
`2979FD1FD89D412950486ED652717A0776BAF529D61DF975DD0A8EB5754B1AB6`.
Новый build SUCCESS10м11с. Полный JVM:1398 PASS,0 failure,8 прежних opt-in HTTP
skips (status BLOCKED, их нельзя отмечать PASS). API26/API34 каждый23/23,
0 failure/skip, exact source/APK identities и все8 provider methods сверены;
временные PIN обоих owned AVD возвращены в NONE. API26 использовал наблюдаемый
Confirm Device Credential UI, API34 — системный `locksettings verify`; продуктовый
credential/biometric dialog на API34 этим не проверен. Новый input включает8
provider cases: конкурентные
record/key limits, реальные отказавшие writes и сохранение partial key bundle,
плюс прежние metadata/retirement cases. Count fixtures содержат копии synthetic
ciphertext, не доказательство ownership/дешифрования каждого fixture row.

Main QA APK:
`42AC5DE6F5A0E4D8003EA9E9C3E2D31ED9CCA6A8653DA4B5D583A4D3600A8839`.
Test APK:
`FBB114181C76AE83B8BC6D6EEDC546FFB552AEA5A4C60E7D65BC5F196D9F1CE6`.
`build:web` PASS:98 HTML/14 языков/280 gallery images, disclosures, dictionaries
и offline precache сохранены. После всех проверок source/APK/prompt hashes
совпали; `runtime/provider-write-final-identity-01.json` фиксирует общий результат.
Нет нового UI текста; это не semantic/visual приёмка всего продукта, физического
OEM/аппаратного backing Keystore, настоящего OS process kill или recovery.

Evidence — `output/release-3.3.6/runtime/provider-write-*` и
`output/qa/security336-provider-write-api{26,34}-01/results.json`.
Полный native lint принятого base component относится к input1AD0; для нового
input он пока не выполнен. Обязательная финальная release-проверка не отменена;
её можно объединить со следующим интеграционным checkpoint.

Эта граница не создаёт HTTP capture factory, source-history EOF, authenticated
key custody, новый recovery или complete content plan. Все10 legacy actions
ещё нуждаются в обязательной planning session/capture композиции, далее —11
реальных categories, обычные writers/enrollment/unlock/recovery, shared ACL+
rotation, files/Drive и полная приёмка3.3.5→3.3.6. Старые APK не проверяются.
