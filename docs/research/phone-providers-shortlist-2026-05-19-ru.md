# Phone-провайдеры — финальный шорт-лист P8 (2026-05-19, RU)

> Документ фиксирует **финальный список phone-провайдеров для имплементации в P8**. Уточняет и заменяет «Search by phone» раздел из `osint-providers-extended-2026-05-18.md` и `osint-providers-decision-2026-05-18-ru.md` (где основным phone-сигналом значился Twilio Lookup v2).
>
> Решение по итогам сессии 2026-05-19:
> - **Twilio Lookup v2 убираем** — это анти-фрод/KYC стек, не people-search. CNAM работает только в US, Identity Match требует уже знать ФИО для сверки. Не закрывает заявленный сценарий «ввёл номер → узнал кто это».
> - **Платные сервисы и RU/UA-агрегаторы — out of scope** на этом этапе (чтобы не дробить юридический фон).
> - **WhatsApp-чек — отклонён** (агрессивный бан, QR-логин с физического телефона).
> - **Кастомных композиций и собственных парсеров не делаем** — берём пять простых открытых библиотек как есть.
>
> **Hotfix 2026-05-19 (post-PR review):** при верификации репозиториев через `gh api` выявлены три неточности первой версии этого документа:
> 1. `Postuf/getcontact` (а также упомянутые форки `vorlie/getcontact-api`, `runnse/get_contact_api`) — **HTTP 404**, репозитории удалены/приватны. Ни одного MIT-licensed maintained Python-враппера для GetContact на 2026-05 не существует. См. § 3 — статус переведён в `deferred`.
> 2. Truecaller-провайдер был помечен как «Node-native (npm)», но **npm-пакета `truecallerpy` нет**. `sumithemmadi/truecallerpy` — это **Python**-библиотека (MIT, 154⭐, last push 2024-05-04). Интеграция → Python sidecar, не Node. См. § 4.
> 3. `LonamiWebs/Telethon` — **архивирован на GitHub 2026-02-21** с пометкой «Moved to codeberg.org/Lonami/Telethon». Проект жив на Codeberg. URL в § 5 обновлён.

---

## TL;DR — что имплементируем

| # | Provider ID | Категория | Роль | Источник | License | Интеграция | Status |
|---|---|---|---|---|---|---|---|
| 1 | `phonenumbers` | phone | infra-валидация | [`daviddrysdale/python-phonenumbers`](https://github.com/daviddrysdale/python-phonenumbers) | Apache-2.0 | Python sidecar (in-process) | `planned-p8a` |
| 2 | `phoneinfoga` | phone | infra+ (Google dorks) | [`sundowndev/phoneinfoga`](https://github.com/sundowndev/phoneinfoga) | GPL-3.0 | CLI subprocess (Go binary) | `planned-p8a` (уже в каталоге) |
| 3 | `getcontact` | phone | reverse-identity (теги) | **нет maintained licensed wrapper** — см. § 3 | n/a | clean-room Python port (≈250 LOC) | **`deferred-p8b`** |
| 4 | `truecaller` | phone | reverse-identity (имя/email) | [`sumithemmadi/truecallerpy`](https://github.com/sumithemmadi/truecallerpy) | MIT | **Python sidecar** (не npm) | `planned-p8a-conditional` |
| 5 | `telegram-resolve` | phone | messenger-presence | [`Lonami/Telethon` on Codeberg](https://codeberg.org/Lonami/Telethon) | MIT | Python sidecar | `planned-p8a` |

PhoneInfoga уже стоит как `planned` в `docs/PROVIDERS.md` (Phase 1 starter set, #4). Из остальных четырёх: phonenumbers и telegram-resolve идут в P8a без блокеров; truecaller идёт условно (см. § 4 — стабильность auth ниже ожидаемой); getcontact **смещаем в P8b** до момента, пока не появится либо живой licensed-форк, либо мы решим тратить ~3 дня на собственный clean-room порт.

---

## 1. `phonenumbers` (libphonenumber Python port)

- **Repo:** <https://github.com/daviddrysdale/python-phonenumbers>
- **License:** Apache-2.0
- **Maintainer:** Google libphonenumber команда (Python-порт David Drysdale, синхронизирован с upstream)
- **Стабильность:** ★★★★★ — нулевая зависимость от внешних сервисов, релизы регулярные, БД операторов обновляется в lock-step с C++ libphonenumber.
- **Auth:** нет.
- **Интеграция:** Python sidecar (in-process модуль, не отдельный процесс на запрос).

### Input

```json
{ "phone": "+442079460958" }
```

### Response (нормализованный)

```json
{
  "valid": true,
  "possible": true,
  "e164": "+442079460958",
  "national_format": "020 7946 0958",
  "international_format": "+44 20 7946 0958",
  "country_code": 44,
  "region_code": "GB",
  "number_type": "FIXED_LINE",
  "carrier_name": "",
  "geocoded_location": "London",
  "timezones": ["Europe/London"]
}
```

`number_type` ∈ `FIXED_LINE | MOBILE | FIXED_LINE_OR_MOBILE | TOLL_FREE | PREMIUM_RATE | SHARED_COST | VOIP | PERSONAL_NUMBER | PAGER | UAN | UNKNOWN`.

`carrier_name` офлайн и неполный — для UK номеров часто пустой, для мобильных в EU/CIS обычно заполнен.

### Сценарий пользователя

> Пользователь вводит `+442079460958`. На экране сразу появляется карточка: **«Великобритания · Лондон · стационарный · Europe/London»**. Это базовый шаг до любых дорогих/нестабильных провайдеров — если номер невалидный, остальные провайдеры даже не запускаются (экономит rate-limit GetContact/Truecaller/Telegram).

---

## 2. PhoneInfoga (уже в каталоге)

- **Repo:** <https://github.com/sundowndev/phoneinfoga>
- **License:** GPL-3.0 (мы вызываем CLI out-of-process → user, не derivative)
- **Stars:** ⭐ 16 421 (verified 2026-05-14)
- **Last push:** 2026-01-06
- **Стабильность:** ★★★★ — активный проект, но сам Google scanner с 2022 отдаёт только готовые dork URL, не результаты.
- **Auth:** нет (numverify scanner требует ключ — мы его выключаем).
- **Интеграция:** CLI subprocess. См. существующую карточку в `docs/PROVIDERS.md` §4.

### Input

```json
{ "phone": "+442079460958" }
```

### Response (наш envelope над `phoneinfoga scan -n`)

```json
{
  "local_scanner": {
    "valid": true,
    "country": "United Kingdom",
    "country_code": "GB",
    "carrier": "",
    "line_type": "FIXED_LINE"
  },
  "google_scanner": {
    "dorks": [
      "https://www.google.com/search?q=intext:%22%2B442079460958%22",
      "https://www.google.com/search?q=intext:%22%2B442079460958%22+site:facebook.com",
      "https://www.google.com/search?q=intext:%22%2B442079460958%22+site:linkedin.com",
      "https://www.google.com/search?q=intext:%22(020)+7946+0958%22",
      "https://www.google.com/search?q=intext:%22%2B442079460958%22+%22resume%22+OR+%22cv%22"
    ]
  }
}
```

### Сценарий пользователя

> После валидации `phonenumbers` пользователь видит блок **«Поискать в Google»** с 5–10 готовыми ссылками: «упоминания на Facebook», «упоминания на LinkedIn», «утечки/pastebin», «резюме». Это не auto-enrichment, а deep-links — пользователь сам открывает интересные. Закрывает кейс «номер где-то засветился публично».

---

## 3. GetContact (unofficial) — **deferred-p8b**

- **Repo:** ~~<https://github.com/Postuf/getcontact>~~ — **HTTP 404 (verified 2026-05-19 via `gh api`)**.
- **Альт-форки из первой ревизии:** ~~`vorlie/getcontact-api`~~ — **404**; ~~`runnse/get_contact_api`~~ — **404**. Оба удалены/приватизированы.
- **Полный поиск по GitHub Search API (2026-05-19, `gh search repos getcontact`)** — ни одного MIT-licensed, активно поддерживаемого Python-враппера:
  - `Numenorean/GetContactAPI` — Python, **license: none**, last code-push **2020-04-06** (5+ лет, метаданные обновляются от тегов, код мёртв).
  - `naufalist/getcontact-web` — PHP, MIT, активен (2025-11-16). Чужой стек.
  - `sooluh/gtc-js` — TypeScript, **license: none**, активен (last push 2026-05-17). Единственный живой, **но «no license» = all rights reserved**, прямой dependency взять нельзя.
  - `subekti404dev/urip-getcontact`, `Numenorean/...`, `v1a0/telegram-getcontact-bot`, прочие — либо unlicensed, либо ≤2022 staleness, либо обёртки над уже-не-работающими версиями.
- **Стабильность:** ★ — кроме отсутствия живой обёртки, GetContact (Lirikon) ротирует AES-схему подписи запросов **квартально**. Любая обёртка живёт 1–14 дней между релизами.
- **Auth:** один раз вытащить `token` из мобильного приложения GetContact (mitmproxy / реверс APK), привязан к нашему служебному номеру.
- **ToS:** нарушаем (не-публичный API). В UI явно помечаем результат как «крауд-сорсинг из GetContact».

### Решение по статусу

**`deferred-p8b`** — в P8a не имплементируем. Варианты на P8b/последующее (выбор владельца):

| Опция | Описание | Сроки | Юр.риск | Рекомендация |
|---|---|---|---|---|
| **A. Clean-room порт** | Прочитать `sooluh/gtc-js` как **протокольную референс-документацию** (не как dependency), переписать на Python с нуля в `packages/providers/phone-providers-py/getcontact.py`. ≈250 LOC. | ~3 дня + ~0.5 дня/мес upkeep на AES-rotation | то же что у любой обёртки (ToS-violation) | **Если решим, что `[ALIAS]` wow стоит maintenance churn** |
| **B. Полностью пропустить** | Никакого GetContact в продукте, опираемся на Truecaller + Telegram-resolve как reverse-identity слой | 0 дней | 0 | **Если оценим, что для UA/CIS-аудитории Truecaller покрытия достаточно** |
| **C. Своя bootstrapped база** | Со временем накопить свой crowd-tag датасет от пользователей (opt-in «отправь свою адресную книгу») | 6+ месяцев | GDPR-heavy | **Не сейчас**, только когда будет critical mass пользователей |

**Default до решения владельца — опция B.** Если в P8b выбирается опция A — открываем отдельный ADR `0017-getcontact-restricted-tier.md` с явным feature-flag и geo-restrict (UA/CIS/TR), как и было заложено.

### Input

```json
{ "phone": "+442079460958" }
```

### Response (нормализованный)

```json
{
  "phone": "+442079460958",
  "found": true,
  "profile": {
    "display_name": "John S.",
    "avatar_url": "https://cdn.getcontact.com/...jpg"
  },
  "tags": [
    { "tag": "John Smith",            "count": 12 },
    { "tag": "Plumber London",        "count":  3 },
    { "tag": "Don't pick up",         "count":  2 },
    { "tag": "Insurance spam",        "count":  1 }
  ],
  "tags_total": 18
}
```

`tags` — это **метки, под которыми этот номер сохранён в адресных книгах других пользователей GetContact**. Core-фича сервиса.

### Сценарий пользователя (когда заведём в P8b)

> Пользователь вводит номер коллеги. В разделе **«Как этот номер сохранён у других»** появляется список меток: `"John Smith" (12 раз)`, `"Plumber London" (3 раза)`, `"Don't pick up" (2 раза)`. Это сценарий, ради которого мы вообще завели phone-категорию — реверс-идентификация номера через crowd-tags. В P8a этот блок UI отсутствует/показывает «временно недоступно».

---

## 4. Truecaller (`truecallerpy`) — **планируем условно**

- **Repo:** <https://github.com/sumithemmadi/truecallerpy>
- **License:** MIT (verified 2026-05-19)
- **Stars:** 154 (verified 2026-05-19, не ~600 как было в первой ревизии)
- **Last push:** **2024-05-04** — ~2 года без обновлений
- **npm:** **пакета `truecallerpy` на npm нет** (npmjs registry вернул `404 null` для всех полей). Первая ревизия ошибочно называла его «Node-native (npm)». На самом деле это **чисто Python-библиотека**.
- **Стабильность:** ★★ (понижено с ★★½ из-за staleness). Truecaller периодически ломает auth-схему; за 2 года без коммитов вероятность того, что login-flow требует чинки силами форка, повышена. Перед мерджем в P8a — короткий smoke-test «реально ли проходит логин на наш служебный номер».
- **Auth:** одноразовый login flow через SMS-код на наш служебный номер. Сохраняем `installationId` в env (`TRUECALLER_INSTALLATION_ID`).
- **ToS:** нарушаем (не-публичный API). В UI помечаем источник.
- **Интеграция:** **Python sidecar** (не Node) — та же ADR-0008, что и Sherlock/GHunt/phonenumbers.
- **Rate-limit:** необъявленный, эмпирически ~100–200 запросов в день с одного `installationId` до бан-волны.

### Контингент-план если login-flow сломан

Если smoke-test в начале P8a покажет, что `truecallerpy` 2024-05 не логинится: альтернатив с близкой звёздностью и MIT-лицензией нет (`Sl-Sanda-Ru/Truecaller-CLI`, 29⭐ GPL-3, push 2024-04 — единственный candidate-замена, но GPL-3 = вирусная лицензия для нашей кодовой базы, использовать только через subprocess). В этом случае Truecaller тоже идёт в **`deferred-p8b`** рядом с GetContact, а P8a сводится к **`phonenumbers` + PhoneInfoga + Telegram-resolve** — это всё ещё закрывает базовый сценарий «валидировал → нашёл в Telegram → готовые dorks для глубокого поиска».

### Input

```json
{ "phone": "+442079460958", "country_code": "GB" }
```

### Response (нормализованный из `truecallerpy.search`)

```json
{
  "phone": "+442079460958",
  "found": true,
  "name": "John Smith",
  "alt_name": "",
  "image_url": "https://...",
  "gender": "M",
  "addresses": [
    { "city": "London", "country_code": "GB", "address": "" }
  ],
  "emails": [
    { "id": "john@example.com", "service": "email" }
  ],
  "tags": ["plumber"],
  "spam_info": {
    "spam_score": 0,
    "spam_type": null
  },
  "score": 0.5,
  "access": "PUBLIC",
  "enhanced": true
}
```

### Сценарий пользователя

> На той же странице поиска, отдельный блок **«Truecaller»**: имя как Truecaller-сеть его видит, аватар, email (если пользователь сам заполнил), spam-score. Дополняет GetContact: GetContact даёт «что про номер написали другие», Truecaller — «как сам владелец заполнил профиль» + спам-метрики.

---

## 5. Telegram resolve_phone (Telethon)

- **Repo:** <https://codeberg.org/Lonami/Telethon> — **активное зеркало**
- **GitHub-mirror:** ~~<https://github.com/LonamiWebs/Telethon>~~ — **архивирован 2026-02-21** (README: «Moved to https://codeberg.org/Lonami/Telethon. The GitHub repository may be deleted in the future.»). Проект жив, переехал.
- **License:** MIT
- **Стабильность:** ★★★★ — MTProto стабилен годами, активный maintainer (Lonami). Переезд на Codeberg в феврале 2026 — не abandonment, а уход с GitHub по политическим причинам (см. сам Codeberg, не GitHub-tracker для багов). Pyrogram (вторая популярная Python MTProto-обёртка) тоже архивирован, но **без замены** — Telethon на Codeberg остаётся главным maintained Python MTProto-клиентом.
- **PyPI:** пакет `telethon` обновляется, ставим как `telethon>=1.36`.
- **Auth:** `api_id`/`api_hash` бесплатно на <https://my.telegram.org> + сессия-аккаунт (нужен реальный disposable-номер для регистрации, один раз). Храним сессию-файл как секрет.
- **ToS:** **формально не нарушаем** — это официальный MTProto API, доступный любому пользователю. Серый момент один: `contacts.ResolvePhone` оставляет запись «контакт добавлен» в записной книге чужого аккаунта (как обычное «сохранил номер в телефон»).
- **Интеграция:** Python sidecar.
- **Rate-limit:** ~100-200 resolve в сутки с одного аккаунта до `FLOOD_WAIT`. На P8 этого хватит, при росте — пул аккаунтов (отдельная задача).
- **Operational note:** в RUNBOOK.md под Provider Credentials — переписать ссылку на репо с GitHub-URL на Codeberg-URL. CI/dependency-resolution не страдает (PyPI неизменен), но любые ссылки в коммит-сообщениях / коде ведём на Codeberg.

### Метод

Последовательность Telethon-вызовов: `ImportContactsRequest([InputPhoneContact])` → если в `users[]` есть результат → `GetFullUserRequest(user_id)` → нормализуем → `DeleteContactsRequest([user_id])` (чтобы не оставлять навсегда в записной книге).

### Input

```json
{ "phone": "+442079460958" }
```

### Response (нормализованный)

```json
{
  "phone": "+442079460958",
  "found_on_telegram": true,
  "user_id": 123456789,
  "username": "johnsmith",
  "first_name": "John",
  "last_name": "S.",
  "photo_url": "https://...",
  "about": "Plumber, London",
  "status": "online",
  "is_premium": false,
  "is_bot": false,
  "is_verified": false,
  "is_scam": false,
  "is_fake": false,
  "common_chats_count": 0
}
```

Если у пользователя выставлен privacy `Who can find me by phone = My Contacts` — `found_on_telegram: false` (тот же ответ, как если человека в TG нет).

`status` ∈ `online | offline | recently | last_week | last_month | long_time_ago | hidden`.

`photo_url` и `about` отдаются только если их privacy = Everybody (дефолт).

### Сценарий пользователя

> Блок **«Telegram»**: если человек есть в TG и не закрыл privacy — показываем username (`@johnsmith`), имя как он сам себя назвал, bio, last seen, ссылку на профиль (`tg://user?id=...` + `t.me/johnsmith`). В EU/CIS покрытие Telegram очень высокое → это часто самый ценный из пяти провайдеров.

---

## Что отклонили в этой итерации (для записи)

| Что | Почему |
|---|---|
| Twilio Lookup v2 | Анти-фрод стек, не people-search. CNAM US-only, Identity Match требует уже знать ФИО. Платный. |
| NumVerify / CallerID Test | Платные. |
| WhatsApp `whatsapp-web.js` | Агрессивный бан, требует QR-логин с физического телефона, мало уникального сигнала поверх Telegram. |
| Signal | Нет публичного enumeration (E2E + sealed sender). |
| Viber | API закрыт, OSINT-выхлоп минимален. |
| RU/UA OSINT-агрегаторы (Глаз Бога, Quick-OSINT и т.п.) | Платные + юридическая каша на данном этапе. |
| `ignorant` (Megadose) | Проверяет регистрацию номера в Instagram/Snapchat — полезно, но категория `phone→social-presence` отдельная от текущего «reverse identity» скоупа. Можно добавить отдельной фазой, не сейчас. |

---

## Что ещё нужно дотащить (NOT in this doc — отдельные задачи)

1. **Обновить `docs/PROVIDERS.md`** — добавить карточки `phonenumbers`, `truecaller`, `telegram-resolve` (после hotfix статусы: `planned-p8a`, `planned-p8a-conditional`, `planned-p8a`). `getcontact` — карточка со статусом `deferred-p8b` и ссылкой на § 3 этого документа. Снять Twilio Lookup из текущего раздела «Search by phone» в `osint-providers-extended-2026-05-18.md` декларативно (через приписку «superseded by phone-providers-shortlist-2026-05-19-ru.md»).
2. **Обновить `docs/AGENT_PLAN.md` P8** — детализировать чек-лист: **P8a = 3 провайдера + 1 conditional** (phonenumbers, PhoneInfoga, telegram-resolve, truecaller-conditional-on-smoketest), **P8b = GetContact decision-point** (clean-room порт или окончательный skip).
3. **Секреты в `.env.example`** — добавить плейсхолдеры `TRUECALLER_INSTALLATION_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_PATH`. Плейсхолдер `GETCONTACT_TOKEN` **не добавляем** до решения P8b — иначе он будет торчать пустым ключом 1+ месяцев и создавать иллюзию готовности.
4. **Disposable Telegram-аккаунт** — отдельная operational задача, не код. Зафиксировать в `RUNBOOK.md` под «Provider credentials». Ссылку на репо ведём на **Codeberg**, не GitHub.
5. **Conformance-тесты** — провайдеры P8a проходят `@echo/providers/core/conformance.ts` (envelope: `Started → Partial → Final`, cancel-on-disconnect, schema-validation).
6. **NEW (post-hotfix):** **Truecaller smoke-test первым шагом P8a** — отдельный 30-минутный subtask «реально ли логинится `truecallerpy@2024-05` в 2026-05». Если нет — Truecaller тоже в `deferred-p8b`, P8a = 3 провайдера.
7. **NEW (post-hotfix):** sibling-документ `free-libs-expansion-2026-05-19-ru.md` для дополнительных free OSS-библиотек **вне phone-категории** (username, social no-auth, domain/IP recon, companies/sanctions, email enrichment) — реальная польза в поиске без расширения paid-стека.
