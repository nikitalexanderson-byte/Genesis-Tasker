# Восстановление исходного local root владельцем

21 ноября2026. Текущий increment в разработке; это не system acceptance3.3.6.
Production3.3.5/149, coverage9/20, floors0, pilot/cutover off сохраняются.

## Граница доверия

Device-local root открывает разные private scopes одного владельца. Он никогда
не адресуется участникам проекта, project recovery authority или public key,
полученному только с сервера. Экспорт требует отдельно введённый32-byte secret,
основной recovery kit владельца и совпадение ОБОИХ public keys с primary pin
разблокированного устройства. Google session и shared directory этого не заменяют.

Используется existing HKDF/AES-GCM `ProtectedBundle` с отдельным purpose
`original-root-custody-v1`. Внутри только root и purpose-bound certificate,
подписанный primary recovery authority. Certificate закрепляет opaque artifact ID,
original owner/device scope/device ID, generation/epochs, key ID, PUBLIC original
signer, root hash и оба public keys authority. Старые private device signing/
receiving keys не экспортируются. Изменений crypto suite/writer/envelope нет.

Новый клиент сохраняет собственную signing identity. Recovered capability
предоставляет только revocable staged/legacy-original readers; нет произвольного
domain reader, raw root getter, подписания, enrollment, HTTP/session, replay
очередей, billing/ACL restore или activation. Certificate описывает сохранённый
original; он не доказывает текущие серверные права или полноту всего account.

## Хранение и текущий review

Web использует существующий IndexedDB `keyMaterial`: create-only presence CAS,
actual provider counts и quota admission перед физической transaction. Custody
не шифруется утраченным local root. Missing/corrupt rows не заменяются пустыми.
Native добавляет отдельную owner-secret-encrypted file family в noBackupFilesDir;
все final/partial/backup bytes и logical key records входят в provider admission.
Key-file/SQLite writes используют общий mutation lock.

Review воспроизвёл настоящий Chromium RED: accepted custody row не содержал
публичной reference, поэтому её потеря возвращала циклическую зависимость от
старого vault. Теперь artifact/reference находятся в ОДНОЙ admitted immutable
row/file; `describe` отдаёт только untrusted metadata, `recoverById` проверяет
owner certificate с независимым primary pin. Readback требует обе части.

Native write теперь использует явный create-only `.new`, file force, atomic
rename и directory fsync; ни чтение, ни отказ не удаляют partial/backup remnants.
Это устраняет различие реализаций Android `AtomicFile` на API26 и34. Всё входит
в общий key/record admission lock; отсутствующая DB не создаётся. Новая SQLite
schema не вводится. Device-key audit дополнительно сверяет owner/protocol/pin.

Внутренний review также перенёс binding read ports под secret cleanup и делает
descriptor snapshot до чтения discovered ID: getter не выполняется. Полный
normal product recovery и ordinary writers этим изменением не включаются.

## Приёмка текущего web input

Final JS2081/2081,0 failures/skips,160.3s; project TSC04 и scoped ESLint03 PASS.
Actual Chromium157/IndexedDB19/19, console0/0. Этот browser run
проверяет full2MiB+17 staged source после удаления только synthetic old key row,
fresh identity, отсутствие старых private keys в payload, оба pin fields,
same-owner project kit refusal, ciphertext tamper/undefined presence, cold reads,
quota refusal и retirement после quota await. Сохранён initial17-case checkpoint,
затем отдельный durable-reference RED, затем19-case GREEN. Финальная browser
identity записывается отдельно после завершения native acceptance.

`build:web`02 PASS:280 gallery JPEG,98 HTML/14 languages,13 built UI dictionaries,
173 mandatory/433 visual precache assets и действующие disclosures сохранены.
UI copy не менялся; это не смысловая/визуальная приёмка будущей recovery UX.

Full JS01 имел2077 PASS/2 environment failures: shell не получил прежний PHP
runtime, автозагрузка старого pinned8.4.27 URL вернула404. Явно выбран existing
isolated PHP, оба затронутых suites прошли11/11; последующие полные02/03 прошли.
Failed01 не считается PASS. Native build01 SUCCESS12m13s, JVM1418 PASS/0 failure/
8 existing opt-in HTTP skips,1426 total/248 suites (unit status BLOCKED). Build02
отказал на отсутствующем public SDK `O_DIRECTORY`;03 использует directory FD
через public `O_RDONLY` и тот же fsync. У03 device/lint acceptance ещё нет.

## Обязательная последующая композиция

Staged raw bytes могут содержать nested legacy LocalCipher/AAD ciphertext.
Перенос нового local root сам по себе не материализует такой private content:
нужны захват и semantic conversion пока старый alias ещё доступен. Отдельно
остаются authenticated remote originals, mixed state4 history/content plans/run,
product recovery/unlock/enrollment, все11 remaining sources, shared root rotation,
files/Drive, signed3.3.5→3.3.6,48 system cases и14-language acceptance.

Внутреннее AI review не является независимой человеческой экспертизой.
Личные устройства, Play и production этим increment не меняются.
