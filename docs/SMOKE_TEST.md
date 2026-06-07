# Local smoke — пошаговый прогон echo API

> Все длинные команды записаны **одной строкой**, чтобы zsh/bash не сломал
> их при copy-paste. Если что-то отвалится — `docker compose logs <name>`
> покажет почему. Команды можно запускать как есть из этого файла.

## 0. Требования

- Docker Desktop запущен (`docker info` должно отвечать)
- `jq` (`brew install jq`) — для красивого вывода и парсинга id'ов
- `curl` (есть из коробки на macOS)

## 1. Подготовка (раз за чистый клон)

```bash
cd /Users/arastorhuiev/Projects/echo
```

```bash
cp .env.example .env
```

Файл `.env` опционален — docker-compose подставит дефолты сам, но без него Docker выводит warning.

## 2. Поднять стек

```bash
docker compose up -d --build
```

Первая сборка — 3-5 минут (Python sidecar собирается с нуля + Node images). Дальнейшие `up -d` — секунды.

Проверь что все 5 сервисов `healthy`:

```bash
docker compose ps
```

Ожидаемо: `postgres`, `redis`, `osint-py`, `api`, `worker` — все `Up ... (healthy)` (у `worker` healthcheck не настроен — просто `Up`).

## 3. Health checks

Liveness:
```bash
curl -s http://localhost:3000/api/health/live
```
Ожидается: `{"status":"live"}`

Readiness (postgres + redis + sidecar):
```bash
curl -s http://localhost:3000/api/health/ready | jq
```
Ожидается: `status:"ok"` и три `up`.

Sidecar напрямую:
```bash
curl -s http://localhost:8000/health
```
Ожидается: `{"status":"ok"}`

Реестр провайдеров:
```bash
curl -s http://localhost:3000/api/providers | jq
```
Ожидается: массив с `sherlock`, `stub-success`, `stub-fail`.

## 4. Реальный Sherlock lookup

Создать лукап (однострочно):

```bash
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups -H 'Content-Type: application/json' -d '{"providerId":"sherlock","query":{"username":"anthropic"}}' | jq -r .id); echo "lookup id: $LOOKUP_ID"
```

Открыть SSE стрим (`-N` = no buffering):

```bash
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

Ожидаемый поток:
```
id: 1747...-0
data: {"_tag":"Started"}

id: 1747...-1
data: {"_tag":"Partial","chunk":{"site":"GitHub","url":"https://github.com/anthropic"}}

... ещё Partial'ов по мере того как Sherlock обходит ~400 сайтов ...

id: 1747...-N
data: {"_tag":"Final","data":{"found":[...],"checked":407}}
```

Время: 30-90 секунд. Стрим закроется автоматически после `Final`.

## 5. Параллельные логи

В отдельном терминале (Cmd+T):

```bash
docker compose logs -f worker --tail=20
```

Увидишь `Lookup <id> completed (provider=sherlock, events=...)` в конце.

```bash
docker compose logs -f osint-py --tail=20
```

Увидишь `sherlock start username=...` → `sherlock done username=... checked=...`.

## 6. Тест отмены (cancel)

Создай ещё один лукап (другой username, чтобы не словить кеш):

```bash
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups -H 'Content-Type: application/json' -d '{"providerId":"sherlock","query":{"username":"github"}}' | jq -r .id); echo "lookup id: $LOOKUP_ID"
```

**Терминал A** — открой стрим:
```bash
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

**Терминал B** — через ~3-5 секунд (когда уже капают `Partial`) запусти cancel:
```bash
curl -X DELETE http://localhost:3000/api/lookups/$LOOKUP_ID
```

Ожидается ответ: `{"id":"...","cancelRequested":true,"previousStatus":"running"}`.

В терминале A должен прийти `{"_tag":"Cancelled"}` и стрим закроется. В логах sidecar появится `sherlock terminate username=github pid=...` — child-процесс прибит.

## 7. Тест cache

Повторный лукап того же `username` в течение 24 часов:

```bash
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups -H 'Content-Type: application/json' -d '{"providerId":"sherlock","query":{"username":"anthropic"}}' | jq -r .id); echo "lookup id: $LOOKUP_ID"
```

```bash
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

Должно отработать **мгновенно** (<1 сек): `Started` → `Final` без `Partial`'ов. Это `withCache` отдал результат напрямую из Redis. В логах воркера НЕ будет hit'а к sidecar.

## 8. Тест reconnect (SSE `Last-Event-ID`)

Создай лукап:
```bash
LOOKUP_ID=$(curl -s -X POST http://localhost:3000/api/lookups -H 'Content-Type: application/json' -d '{"providerId":"sherlock","query":{"username":"twitter"}}' | jq -r .id); echo "lookup id: $LOOKUP_ID"
```

Открой стрим и оборви через `Ctrl+C` где-то на 3-й секунде:
```bash
curl -N http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

Запомни последний `id: ...` из вывода (например `1747000000001-0`).

Реконнект с `Last-Event-ID` — подставь свой id вместо `1747000000001-0`:
```bash
curl -N -H 'Last-Event-ID: 1747000000001-0' http://localhost:3000/api/lookups/$LOOKUP_ID/stream
```

Стрим возобновится **со следующего события** — без дубликатов и потерь. Replay TTL = 1ч после `Final`.

## 9. Заглянуть в state снаружи

Redis Stream одного лукапа:
```bash
docker compose exec redis redis-cli XRANGE lookup:events:$LOOKUP_ID - +
```

Длины очередей BullMQ:
```bash
docker compose exec redis redis-cli LLEN bull:q.lookup:wait
docker compose exec redis redis-cli LLEN bull:q.lookup:active
```

Содержимое таблицы `lookups`:
```bash
docker compose exec postgres psql -U echo -d echo -c "SELECT id, provider_id, status, created_at FROM lookups ORDER BY created_at DESC LIMIT 10;"
```

События одного лукапа в Postgres:
```bash
docker compose exec postgres psql -U echo -d echo -c "SELECT seq, payload FROM lookup_events WHERE lookup_id='$LOOKUP_ID' ORDER BY seq;"
```

## 10. Bruno UI (опционально, визуально удобнее)

```bash
brew install --cask bruno
```

Запусти Bruno → `File → Open Collection` → выбери `/Users/arastorhuiev/Projects/echo/bruno/echo-api`. Environment `local` уже настроен (порты 3000 + 8000).

Стримящие requests (`stream-sherlock`, `sherlock-run`) лучше гонять через curl — Bruno UI не визуализирует SSE поток. В `docs` каждого `.bru` файла есть curl-equivalent.

## 11. Hot reload / итерации

После изменений в коде:

| Что менял | Команда |
|---|---|
| Node код (`apps/api`, `apps/worker`, `packages/**`) | `docker compose up -d --build api worker` |
| Python код (`services/echo-osint-py`) | `docker compose up -d --build osint-py` |
| `docker-compose.yml` / `Dockerfile` | `docker compose up -d --build` (полная пересборка) |
| `.env` / переменные окружения | `docker compose up -d` (без `--build`) |

Контейнер автоматически рестартится. Postgres/Redis state остаётся в named volumes (если не делал `down -v`).

## 12. Teardown

Остановить, state сохраняется в volumes:
```bash
docker compose down
```

Прибить со всем state'ом (postgres + redis volumes удаляются):
```bash
docker compose down -v
```

## 13. Если что-то ломается

| Симптом | Куда смотреть |
|---|---|
| Контейнер в `Restarting (1)` | `docker compose logs <name> --tail=100` — ищи stack trace |
| `/api/health/ready` 503, sidecar `down` | `docker compose logs osint-py` — мог не успеть подняться (start_period 20 сек) |
| Лукап моментально `Failed` | `docker compose logs osint-py` + `docker compose logs worker` — обычно либо sidecar CLI-flag ошибка, либо Sherlock получает 403/429 от сайтов |
| SSE стрим висит без событий | `docker compose exec redis redis-cli XRANGE lookup:events:<id> - +` — есть ли вообще события? Нет — воркер не пишет; есть — api не читает |
| Конфликт портов (3000/5432/6379/8000) | `lsof -iTCP -sTCP:LISTEN \| grep -E '3000\|5432\|6379\|8000'` |
| Изменил код, но контейнер крутит старый | Забыл `--build` в `docker compose up` |

## 14. Полная очистка

Если хочешь начать с нуля (удалить все Docker resources проекта):

```bash
docker compose down -v --rmi local
```

Удалит контейнеры, volumes (postgres + redis state), и локально-собранные images (`echo-api`, `echo-worker`, `echo-osint-py`). При следующем `up --build` всё пересоберётся с нуля.
