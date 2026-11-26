# Ёмкость общего E2EE-хранилища

21 ноября 2026. Принят компонент измерения провайдера и ограниченной арифметики
headroom. Web- и native-проверки завершены в указанном ниже объёме. Это основа для
обязательной admission в factories, а не её завершённая продуктовая интеграция.
Source coverage остаётся9/20; run/upload/activation state4 закрыты.

Web читает COUNT обеих IndexedDB stores (`records`, `keyMaterial`) в одной
readonly transaction, без загрузки ciphertext bodies и без открытия чужих
ключей. Считаются все namespaces и владельцы. Byte usage/quota берутся из
настоящего browser storage estimate всего origin, включая caches. Отсутствующие,
нецелые или отрицательные значения не превращаются в нулевое использование.
Известная нулевая квота означает недостаток места. Нужны настоящий provisioned
device и его actual IndexedDB provider; memory/lookalike capability не подходит.
Device/provider identity и актуальность операции проверяются вокруг awaits.

Native считает все rows отдельной ciphertext SQLite, файлы базы/journal/WAL/SHM
и все защищённые device bundles в принадлежащем provider каталоге. Параметры
свободного места — `StatFs`. DirectoryStream ограничен префиксом ключевых файлов;
их содержимое не читается. Atomic `.bak`/`.new` включаются в byte usage, сохраняя
один logical key-record для владельца. Неизвестная key-file роль или отсутствие
базы — фиксированная ошибка, не empty usage и не создание replacement DB.
Метрики не дают права открыть записи другого namespace.

Общая JS/Kotlin арифметика учитывает будущие record/key counts, bytes новой
записи, временную стоимость rewrite и safety reserve. Проверяются safe integers
и суммы без переполнения. Поддерживаемые пределы record/key counts нельзя
увеличить настройкой выше10000/1000. Уменьшившаяся ниже текущего usage квота
отказывает как capacity. Результат содержит только числа, не migration/EOF,
identity, billing, membership или recovery receipt.

Измерение — snapshot провайдера, browser bytes являются оценкой. Это не
физическая резервация и не гарантия отсутствия последующего quota/disk failure.
Другой writer способен занять место после проверки. Существующие durable
transactions по-прежнему должны отказывать атомарно и сохранять принятые
records; ошибка не разрешает очистку старой работы или пустой vault.

Компонентные проверки:

-15 общих арифметических vectors, включая exact boundary, чужие contexts/keys,
  rewrite peak, shrinking/zero quota и safe-integer overflow;
-JS unknown fields/accessors/types и отказ от memory/structural provider;
-47 связанных JS cases прошли,0 failure/skip; scoped ESLint и owned TSC PASS;
-Chromium157:15/15 actual IDB/quota cases, console0. Два настоящих provisioned
  synthetic devices делят один provider. Проверены общие counts без body reads,
  неизменность ciphertext, отсутствие чужого read grant, недоступная quota,
  фиксированная ошибка без provider текста, retirement/lock и cold unlock;
-полный JS-прогон2033/2033,0 failure/skip;
-native build SUCCESS11м19с. Полный JVM:1397 PASS,0 failure,8 существующих
  opt-in HTTP skips (их нельзя считать пройденными); новые3 admission cases
  прошли. API26:19/19 (4 provider,8 planning,6 remote original,1 key audit),
 0 failure/skip. Временный PIN owned AOSP26 AVD возвращён в NONE;
-API34:19/19,0 failure/skip, temporary PIN возвращён в NONE. Проверены exact
  source/APK identities обоих device reports. API34 использовал системный
  `locksettings verify` и наблюдаемый SystemUI `pinEntry` с известным synthetic
  PIN; это не приёмка продуктового credential-dialog. Первые API34 attempts
  остановились до instrumentation на системной настройке credential UI;
  отдельный attempt07 остановился на precondition keyguard,0 product tests.
  Они не объявляются product PASS. Сохранены исходные records/logs, ни тесты,
  ни Keystore-политика ради setup не ослаблялись. Для повторов используются
  новые run ids, исходный failure01 не перезаписывается;
-полный lint текущего input SUCCESS14м21с:0 errors/208 warnings/8 hints.
  Новых issue/file pairs и увеличений их counts относительно принятого
  streamed-ownership baseline нет. XML отличается расположением строк;
  побайтная идентичность baseline не заявляется;
-`build:web` PASS:98 HTML/14 языков/280 изображений галереи, disclosures,
  словари и offline precache сохранены. После всех проверок source/APK/prompt
  identities повторно сверены в `runtime/provider-admission-final-identity-01.json`.

Frozen native input:
`1AD0F6C38E39539E35EC24FC7BDDE679E3DE4E63E2399652B7EB4B47E15395BB`.
Main QA APK:
`370E397BCD4A9CC05720736BC3061904920A6F9AE57C8B5831C04D7935A068D5`.
Test APK:
`87E5B0D768A48EB36EB16098924FC3B9C94F33DAAC68ADCD8357AC231F5888AB`.
Build/unit/browser/types/lint evidence — `output/release-3.3.6/runtime/`
с префиксом `provider-admission-`. Приёмка API26:
`output/qa/security336-provider-admission-api26-01/results.json` и
`output/qa/security336-provider-admission-api34-08/results.json`;
общая сверка — `runtime/provider-admission-post-device-identity-01.json`.
Эти проверки ещё не являются полной продуктовой или релизной приёмкой.

На момент самостоятельной приёмки этого компонента обязательное подключение
к source/plan/coordinator/remote-original ещё отсутствовало. Следующий отдельно
проверенный этап общей границы writes, вычисление роста из реальной serialization
и его ограничения — `e2ee-336-provider-write-admission.md`. Session/factory
lifecycle и полный product отказ/повтор/recovery при нехватке места остаются
незавершёнными; одни числовые callbacks не являются такой интеграцией.
