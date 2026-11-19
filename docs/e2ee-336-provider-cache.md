# Дополнительная граница: server-side provider cache

19 ноября2026. При сверке task source с реальными producers обнаружен отдельный
файловый источник: `server/src/google-sync-cache.php`. Его нельзя считать пустым
из-за отсутствия строк в tasks SQL или отсутствия такой задачи на этом устройстве.
Это обязательный следующий этап task inventory до product activation.

`personal_task_creations.state` при этом **не task JSON**: настоящий producer
`mindmaps.php::genesisCreatePersonalTaskOnce` хранит SHA-256 отпечаток выбранных
Google accounts/list. Client task source теперь сохраняет его и другие старые
state strings как inert history без JSON conversion, новой задачи или повторного
provider POST. Исправление проверяется отдельно от cache boundary.

Актуальная реализация следующего инкремента и её границы:
`e2ee-336-provider-cache-implementation.md`. Ниже сохранён исходный inventory
обнаружения; утверждения «ещё не реализовано» относятся к этому раннему срезу.

## Обнаруженный источник и ограничения

- `dirname(config.db_path)/google-sync/<sha256(primary:USER_ID)>.enc` либо
  `<sha256(linked:LINKED_ACCOUNT_ID)>.enc`; linked IDs принадлежат только текущему
  owner по authoritative `linked_google_accounts.owner_user_id`.
- Серверное secretbox encryption, прежний server config key. Snapshot содержит
  `calendar.items`, `tasks.items`, list titles и sync state. Это приватное
  содержимое внешних копий, иногда единственная ещё не загруженная клиентом copy.
- Fingerprint связан с identity/grant/token state. Его нельзя переносить как
  authorization или молча принимать mismatched file за текущий source.
- Нынешний ordinary helper создаёт directory/lock files, открывает/пишет cache,
  а при malformed/decryption failure может начать с пустого snapshot. Для
  read-only migration он непригоден даже с persist=false.
- Callback может выполнять provider IO и SQL под file lock. Нельзя захватить
  SQLite writer и затем блокирующе ждать этот file lock: старый callback может
  ждать того же SQLite writer. Это возможный обратный порядок блокировок,
  не утверждение о наблюдавшемся production deadlock.
- Текущий E2eeSourceHash перечисляет SQL tables/private user fields; filesystem
  cache ещё не входит в token. Одних SQL triggers для этого источника недостаточно.

## Требуемое продолжение

До activation нужно добавить read-only owner inventory, защиту exact bytes и
непустой/corrupt/unmatched-file review. Пути вычисляются из проверенных owner/
linked IDs; чужие файлы, tokens и identity records не экспортируются. Учитывать
не только существующие tasks, но и прежние list links/labels и отсутствие cache.
Нельзя вызывать Google loaders, refresh tokens, cleanup или acknowledgement.
Клиент обязан явно сохранить external-copy history и не получить из неё право
синхронизировать/повторить uncertain operation. Прежние внешние данные не удалять.

File source должен входить в opaque source token и финальный commit validation.
Нужен единый, проверенный порядок owner operation gate → file/SQL work: уже
выполняющийся legacy callback должен закончиться до snapshot/lease, новые
операции после preparing/active не должны обходить policy через filesystem.
Блокирующий SQL→file lock не добавлять. Shared/reentrant requests, jobs, token
refresh и account change требуют отдельной проверки; receipt ID не является
доступом к linked account. Неблокирующий отказ/повтор сохраняет исходные файлы.

Обязательные синтетические проверки: current/linked/foreign cache separation,
missing/corrupt key/file, fingerprint mismatch, exact original bytes, отсутствие
IO до local snapshot, concurrent file writer/SQL writer без lock inversion,
новый/изменённый cache между source read и commit, process death и no legacy
provider POST после scope fence. File tokens/read/client reconciliation пока
остаются release blocker. Первый owner/file operation gate уже реализован и
проверен отдельно: `e2ee-336-personal-server-io.md`; он не заменяет inventory.

Пять real source adapters описывают проверенный web/native code path, а не
полноту каждого аккаунта/всех источников. Этот новый файловый inventory ещё
не подключён к tasks adapter. Он добавлен к обязательным условиям вместе с
остальными15 категориями, full product routing/recovery/upgrades и независимым
crypto review. Production/floors/cutover/GENESIS_DEPLOY_ANDROID не менялись.
