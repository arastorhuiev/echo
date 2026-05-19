# P8 — финальный план библиотек (REV-3, 2026-05-19, RU)

> **Канонический документ для P8.** Версия REV-3 — окончательная перед стартом имплементации. Учитывает три раунда review-комментариев владельца от 2026-05-19. Все репозитории проверены через `gh api` (включая `repos/<o>/<r>/commits` для real-commit-date, не `pushed_at`).
>
> **REV-3 изменения от REV-2:**
> - **Удалены из P8b:** Bluesky XRPC и Mastodon.py — за пределами текущего скоупа people-search MVP.
> - **`sooluh/gtc-js` дата уточнена:** последний реальный коммит **2025-10-15** (~7 мес), не 2026-05-17. `pushed_at: 2026-05-17` в GitHub API двигался активностью dependabot-веток, не реальной работой автора. Лицензия по-прежнему отсутствует.
> - **GetContact решение зафиксировано:** опция A (use `sooluh/gtc-js` as-is via private install) выбрана — имплементируем как полноценного провайдера. Приложение private, для личного использования — legal risk минимальный.
> - **`naufalist/getcontact-web`** (PHP, MIT, последний коммит 2025-11-16) добавлен как **last-resort fallback** в самом конце P8 — только если `sooluh/gtc-js` не заработает.
> - **TGStat + Telemetrio** перемещены из § 8 Backlog в § 7 Deferred-permanent — больше не возвращаемся.
>
> **REV-2 изменения от REV-1:**
> - Удалены целиком: P8d (Domain/IP recon), P8e (Companies/Sanctions global), P8-UA (Ukraine pack).
> - Перенесены в P8a (из P8c): `mailcat`, `socialscan`, `EmailRep` — базовый email/username слой.
> - В backlog «как-нибудь потом»: Hunter.io (free 25/мес), yt-dlp (метаданные видео).
> - Переписан раздел про GetContact / `sooluh/gtc-js` — честное legal-меню.
> - Удалена paid-секция целиком (бизнес-модель + бюджет + tier-ladders).
> - P8f (image) переименован в **P8d**.
>
> **Скоуп:** только библиотеки и API-провайдеры. Бизнес/бюджет/парсеры в этом документе **нет**.
>
> **Связанные файлы:**
> - `docs/research/phone-providers-shortlist-2026-05-19-ru.md` — расширенные I/O-примеры по phone-провайдерам (живой supporting-doc, в P8a Foundation refer'имся туда за полным шорт-листом).
> - `docs/research/osint-providers-extended-2026-05-18.md` — исходный исследовательский каталог (~40k токенов EN+UA addendum). Часть выводов уже сапёрсиднута этим документом; остаётся в репо как **read-only архив** того, что было пересмотрено.
> - Удалены в REV-2: `osint-providers-decision-2026-05-18-ru.md`, `free-libs-expansion-2026-05-19-ru.md`. Содержимое либо вошло сюда, либо явно отброшено.

---

## 0. Один взгляд

**Implement (17 провайдеров на 4 суб-фазы):**

| Sub | Тема | Кол-во провайдеров |
|---|---|---|
| **P8a** | Foundation: phone + username + email (всё базовое) | 12 |
| **P8b** | Identity-extra (URL→IDs + GetContact) | 1 + GetContact decision |
| **P8c** | Email/identity deepening (Google + phone-social) | 2 |
| **P8d** | Image foundation | 2 |

**Cross-cutting правила:**

1. **AGPL/GPL библиотеки = subprocess-only.** Никогда не импортируем — только запускаем как отдельный процесс через `child_process.spawn` / `subprocess.run`. Даёт «mere aggregation», наш код не считается derivative work.
2. **Python sidecar pattern (ADR-0008):** все Python-библиотеки в одном `osint-py-sidecar` контейнере, общаются с NestJS через gRPC.
3. **Conformance contract (P5):** каждый провайдер реализует `OsintProvider` интерфейс и эмитит `Started → Partial → Final` envelope.
4. **Verification cadence:** `gh api` перед добавлением новой либы. Архивированный/мёртвый upstream = блокер.

---

## 1. P8a — Foundation (~4-5 дней)

> Базовый каркас: ввёл телефон / username / email → получил wow-точку. После P8a у нас есть работающий MVP с тремя категориями входа.

### 1.1. `python-phonenumbers` (libphonenumber Python port)

- **Repo:** <https://github.com/daviddrysdale/python-phonenumbers>
- **License:** Apache-2.0 ✓
- **Stars / Last push:** 3 738⭐ / 2026-05-07
- **Auth:** нет. **Integration:** Python sidecar (in-process). **Free-tier:** unlimited, полностью оффлайн.
- **Input:** `{ phone: "+442079460958" }`
- **Output:** `{ valid: true, e164, region_code: "GB", number_type: "FIXED_LINE", geocoded_location: "London", timezones }`
- **Сценарий:** валидируется ли номер вообще, какая страна/город, мобильный или стационарный. Базовый шаг до любых дорогих/нестабильных провайдеров.

### 1.2. `phoneinfoga` (CLI subprocess)

- **Repo:** <https://github.com/sundowndev/phoneinfoga>
- **License:** GPL-3.0 → **subprocess-only**
- **Stars / Last push:** 16 421⭐ / 2026-01-06
- **Integration:** Go binary, `phoneinfoga scan -n <e164>`, парсим JSON-stdout. **Free-tier:** unlimited.
- **Output:** `{ local_scanner: {...}, google_scanner: { dorks: [<5-10 готовых Google search URL>] } }`
- **Сценарий:** 5-10 deep-link Google-dork URL для пользователя («найди этот номер на Facebook / LinkedIn / pastebin»). Уже стоит в `docs/PROVIDERS.md` как Phase 1 starter #4.

### 1.3. `Sherlock` (anchor — P7 done)

- **Repo:** <https://github.com/sherlock-project/sherlock>, MIT, 83 492⭐ / 2026-05-19
- **Status:** anchor — работает после P7 (`packages/providers/sherlock-py` через Python sidecar).
- **Роль:** username → найден на N сайтах из ~600.

### 1.4. `Maigret`

- **Repo:** <https://github.com/soxoj/maigret>, MIT, 29 431⭐ / 2026-05-18
- **Integration:** Python sidecar (тот же контейнер что Sherlock). **Auth:** нет. **Free-tier:** unlimited.
- **Output:** `{ accounts: [{ site, url, status: "claimed" }] }` — ~3000 сайтов, надмножество Sherlock.
- **Сценарий:** вторичный username-сканер с более широким покрытием. Запускается параллельно Sherlock, результаты дедуплицируются.

### 1.5. `WhatsMyName` dataset + own runner

- **Repo (датасет):** <https://github.com/WebBreacher/WhatsMyName>, MIT (датасет CC-BY)
- **Integration:** загружаем `wmn-data.json` (~600 сайтов) в наш Node-код, гоняем HTTP-фан-аут с heuristic-matchers. **~150 LOC runner на нашей стороне.**
- **Сценарий:** третий username-источник, контролируем сами (датасет апдейтится upstream раз в неделю автоматически). Уменьшает зависимость от чужих CLI.

### 1.6. `Telethon` (Telegram MTProto)

- **Repo:** <https://codeberg.org/Lonami/Telethon> — **активный**, last commit 2026-05-09 (Update to layer 225). На GitHub репо архивирован 2026-02 с явным «Moved to Codeberg».
- **PyPI:** ставится как `pip install telethon` (PyPI публикация не пострадала от переезда).
- **License:** MIT ✓
- **Auth:** `api_id` + `api_hash` бесплатно на <https://my.telegram.org> + одноразовая сессия-аккаунт (disposable SIM).
- **Integration:** Python sidecar. **Rate-limit:** ~100-200 resolve/сутки до `FLOOD_WAIT`.
- **Input:** `{ phone: "+442079460958" }`
- **Output:** `{ found_on_telegram: true, user_id, username, first_name, about, status: "online" }` или `{ found_on_telegram: false }`
- **Сценарий:** phone → Telegram profile, если человек в TG и не закрыл privacy. В EU/CIS покрытие очень высокое.

### 1.7. `truecallerpy` (conditional)

- **Repo:** <https://github.com/sumithemmadi/truecallerpy>
- **License:** MIT ✓
- **Stars / Last push:** 154⭐ / **2024-05-04** (~2 года staleness)
- **Уточнение:** это **Python библиотека**, не npm. npm-пакета `truecallerpy` не существует (проверено через registry.npmjs.org).
- **Auth:** одноразовый login flow через SMS на служебный номер; `installationId` в env.
- **Integration:** Python sidecar.
- **Status:** `planned-p8a-conditional` — первый чекин P8a = 30-минутный smoke-test «логинится ли в мае 2026». Если нет — Truecaller переходит в Deferred.
- **Сценарий:** phone → имя как Truecaller-сеть видит владельца + spam-score.

### 1.8. Gravatar REST v3

- **Endpoint:** `https://api.gravatar.com/v3/profiles/<sha256-of-email>`
- **License/Auth:** публичный API, без ключа, free. **Integration:** прямой `fetch`. **Free-tier:** unlimited fair-use.
- **Output:** `{ display_name, location, job_title, verified_accounts: [{ service, url }], interests }`
- **Сценарий:** email → реальное имя + публично-задекларированные соц-аккаунты. Дешевейший high-value сигнал в каталоге.

### 1.9. HIBP Pwned Passwords (range API)

- **Endpoint:** `https://api.pwnedpasswords.com/range/<5-char-sha1-prefix>`
- **License/Auth:** публичный API, без ключа, free. **Integration:** клиент-сайд SHA1 → префикс на API (k-anonymity, сам пароль никогда не уходит).
- **Output:** `{ pwned: true, breach_count: 17 }` или `{ pwned: false }`
- **Сценарий:** «утёк ли мой пароль» — feature, которую можно показывать **прямо на лендинге без регистрации**. Доверие к продукту.

### 1.10. `mailcat` (перенесён из REV-1 P8c в P8a)

- **Repo:** <https://github.com/sharsil/mailcat> *(правильное написание — `sharsil`, не `sharsi`)*
- **License:** Apache-2.0 ✓
- **Stars / Last push:** 871⭐ / 2026-05-17 (свежий)
- **Integration:** Python sidecar (можно импортировать — Apache-2.0). **Auth:** нет. **Free-tier:** unlimited.
- **Input:** `{ username: "anthropic" }`
- **Output:** `{ valid: ["anthropic@gmail.com", "anthropic@outlook.com", ...], checked: 22 }`
- **Сценарий:** username → ~22 вероятных email на популярных провайдерах. Усиливает email-граф + пополняет вход для последующих email-провайдеров.

### 1.11. `socialscan` (перенесён из REV-1 P8c в P8a)

- **Repo:** <https://github.com/iojw/socialscan>
- **License:** MPL-2.0 ✓
- **Stars / Last push:** 1 761⭐ / 2026-04-27
- **Integration:** Python sidecar. **Auth:** нет. **Free-tier:** unlimited.
- **Input:** `{ username: "durov" }`
- **Output:** `{ checks: [{ platform: "Instagram", available: false, valid: true }, ...] }`
- **Семантика отличается от Sherlock:** Sherlock говорит «существует ли аккаунт `jdoe` на X», socialscan говорит «можно ли **зарегистрировать** `jdoe` на X». Side-effect: «занят» = доказательство существования без визита на сайт.

### 1.12. EmailRep (перенесён из REV-1 P8c в P8a)

- **Endpoint:** `https://emailrep.io/<email>`
- **License/Auth:** SaaS, **free unauthenticated** (fair-use rate-limit). Бесплатный ключ — выше квоты.
- **Integration:** прямой `fetch`.
- **Output:** `{ reputation: "high", suspicious: false, references: 3, details: { first_seen, profiles: ["github", "linkedin", "twitter"], domain_reputation } }`
- **Сценарий:** «эта почта подозрительная? сколько раз засветилась? на каких платформах?» — reputation-score + список платформ, где email фигурирует. Сильно дополняет Gravatar.

---

## 2. P8b — Identity-extra (~1-2 дня)

> P8a уже даёт Telegram-результат по телефону + Sherlock/Maigret/WhatsMyName по username. P8b добавляет универсальный извлекатель ID из URL **и закрывает GetContact-вопрос** имплементацией Option A из § 5. В REV-3 удалены Bluesky и Mastodon — за пределами текущего people-search скоупа.

### 2.1. `socid-extractor` (универсальный URL → ID extractor)

- **Repo:** <https://github.com/soxoj/socid-extractor>, MIT ✓, 980⭐ / 2026-05-14
- **Integration:** Python sidecar. **Auth:** нет. **Free-tier:** unlimited.
- **Input:** `{ url: "https://t.me/durov" }` — любая social URL
- **Output:** `{ telegram_id: "1", fullname: "Pavel Durov", username: "durov", ... }` — sites-specific IDs.
- **Сценарий:** post-processor после Sherlock/WhatsMyName/Maigret: для каждого найденного URL вытаскиваем дополнительные IDs (Telegram user_id, VK user_id, и т.д.) — фид в граф идентичности.

### 2.2. GetContact via `sooluh/gtc-js` (option A) — отдельная развёрнутая секция

См. **§ 5** ниже. P8b имплементирует Option A: vendored gtc-js в `packages/providers/getcontact-vendored/` + Node-subprocess враппер. Параллельно — issue к автору с просьбой о лицензии.

---

## 3. P8c — Email/identity deepening (~1-2 дня)

> Узкий слой: глубже копаем email→Google и phone→social-presence. Только два провайдера остались после миграций в P8a и в Backlog.

### 3.1. `GHunt` (AGPL — subprocess-only)

- **Repo:** <https://github.com/mxrch/GHunt>
- **License:** **AGPL-3.0** ⚠ (GitHub UI показывает `NOASSERTION`, но `LICENSE.md` явно AGPL) → **subprocess-only, никогда не импортируем**
- **Stars / Last push:** 18 947⭐ / 2026-04-10
- **Auth:** Google cookie (бесплатный, вытащить один раз браузер-debugger'ом, далее храним).
- **Integration:** Python CLI subprocess (`ghunt email <target> --json`, парсим stdout).
- **Free-tier:** unlimited (Google не банит за наш rate).
- **AGPL §13 (network clause) нюанс:** триггерится только если мы **модифицируем** GHunt. Запуск unmodified GHunt как subprocess — «mere aggregation», AGPL не распространяется на наш SaaS-код. Если когда-нибудь начнём патчить GHunt — публикуем модифицированную версию.
- **Output:** `{ name, gaia_id, profile_picture, reviews: [...], maps_contributions: [...], calendar_visible: false }`
- **Сценарий:** email → реальное имя через Google Maps reviews / фото. Часто эта связка дороже всех остальных email-провайдеров вместе. Один из топ-wow моментов на email-входе.

### 3.2. `ignorant` (GPL — subprocess-only)

- **Repo:** <https://github.com/megadose/ignorant>
- **License:** **GPL-3.0** → **subprocess-only**
- **Stars / Last push:** 1 751⭐ / 2024-07-27 (staleness ~10 мес — Megadose-tools обычно работают долго)
- **Integration:** Python CLI subprocess. **Auth:** нет. **Free-tier:** unlimited.
- **Input:** `{ country_code: "44", phone: "07911123456" }`
- **Output:** `{ checks: [{ name: "instagram", registered: true }, { name: "snapchat", registered: false }, { name: "amazon", registered: true }] }`
- **Сценарий:** phone → social-presence на Instagram / Snapchat / Amazon. **Другая семантика** чем GetContact/Truecaller (не reverse-identity, а existence-on-platform).

---

## 4. P8d — Image foundation (~1-2 дня)

> Минимальный image-стек. Раньше в REV-1 был P8f — после удаления REV-1 P8d/P8e номера ужались.

### 4.1. SauceNAO (reverse image)

- **Endpoint:** `https://saucenao.com/search.php` (API mode)
- **License/Auth:** SaaS, ключ бесплатный (без карты).
- **Integration:** HTTP fetch + multipart upload или URL.
- **Free-tier:** **100 запросов/день** на ключ.
- **Категория:** **pixel-similarity, не face-match** — юридически чистая зона, выходим из-под EU AI Act / биометрики.
- **Output:** `{ results: [{ header: { similarity: "95.50" }, data: { ext_urls: ["https://twitter.com/.../status/..."], twitter_user_handle: "alice" } }] }`
- **Сценарий:** «эта аватарка / арт где-то встречалась» — закрывает кейс «один и тот же avatar на 5 сайтах = один человек».

### 4.2. ExifTool (Phil Harvey)

- **Repo:** <https://github.com/exiftool/exiftool>
- **License:** GPL-3.0 + Artistic (dual-licensed) → **subprocess-only**
- **Stars / Last push:** 4 695⭐ / 2026-05-05
- **Integration:** Perl CLI subprocess, `exiftool -json <file>`.
- **Free-tier:** unlimited.
- **Output:** `[{ SourceFile, Make: "Canon", Model: "EOS R5", GPSLatitude: "40 deg ... N", CreateDate: "2026:03:14 09:21:11" }]`
- **Сценарий:** «когда сделано / где сделано / на чём сделано фото» — GPS, время, модель камеры. Привязано к scan-yourself или явно согласному источнику (privacy-sensitive).

---

## 5. GetContact — отдельная decision-секция

> В REV-1 я записал «protocol-reference» как рекомендацию, и владелец резонно спросил: «то, что у `sooluh/gtc-js` нет лицензии, не значит что он не работает или его нельзя взять на будущее, почему он протокольный?» — переписываю честно.

### 5.1. Что вообще происходит с GetContact-обёртками на 2026-05

| Кандидат | Статус | Лицензия | Last **commit** |
|---|---|---|---|
| `Postuf/getcontact` | HTTP 404 | — | — |
| `vorlie/getcontact-api` | HTTP 404 | — | — |
| `runnse/get_contact_api` | HTTP 404 | — | — |
| `Numenorean/GetContactAPI` (Python, 25⭐) | репо живой, **код мёртв** | none | 2020-04-06 |
| **`sooluh/gtc-js`** (TypeScript, 21⭐) | свежий пушаемый, но code-activity умеренная | **none** | **2025-10-15** (~7 мес) |
| `naufalist/getcontact-web` (PHP, 24⭐) | свежий | **MIT** ✓ | **2025-11-16** |

> **Уточнение даты gtc-js:** GitHub API `repos/sooluh/gtc-js` возвращает `pushed_at: 2026-05-17`, что в первой версии этого документа я ошибочно прочёл как «последний коммит вчера». На самом деле `pushed_at` отражает любую активность по всем ref-ам репозитория, включая 5 автоматических `dependabot/*` веток. Реальный последний код-коммит автора в `main` — `e81de669 "chore: upgrade dependencies"` от **2025-10-15** (~7 месяцев). Подтверждено через `gh api repos/sooluh/gtc-js/commits`.
>
> **Замечание про `naufalist/getcontact-web`:** на самом деле он одновременно **свежее** gtc-js на ~1 мес и **лицензирован MIT**. Но: (1) PHP вместо TS требует тащить PHP runtime в наш sidecar — сложнее операционно; (2) подход «vendored TypeScript + Node subprocess» сильно проще на нашем стеке. Поэтому gtc-js → primary, naufalist → last-resort fallback (см. § 5.4).

### 5.2. Что юридически значит «no license»

- **«Без лицензии»** ≠ «не работает». Код полностью работоспособен — это вопрос **прав использования**, не функциональности.
- **По умолчанию (US/EU copyright law):** если автор не указал лицензию, действует «all rights reserved». Это значит:
  - **Нет права** копировать код в наш репозиторий
  - **Нет права** распространять его как часть нашего продукта
  - **Нет права** делать derivative work и распространять
- **Что мы при этом всё ещё можем делать:**
  - Склонировать репо и запускать локально для исследования
  - Прочитать код, чтобы понять, как обёртка общается с GetContact API
  - Использовать через приватный install (без redistribution) — формально серая зона, но в практике dev/research-проектов это норма

### 5.3. Реальное меню опций для нашего P8

| Опция | Что делаем | Сроки | Юр.риск | Когда выбрать |
|---|---|---|---|---|
| **A. Use as-is via private install** | Клонируем `sooluh/gtc-js` в наш репозиторий (как submodule или vendored), запускаем как subprocess из NestJS. Никаких модификаций. | ~1 день | **Низкий, пока private** (dev-репо, не публичный продукт). Поднимется до среднего при выводе в paid SaaS — formal redistribution. | **Default для текущего этапа.** Private repo + free SKU → риск минимальный, ценность высокая. |
| **B. Попросить автора добавить лицензию** | Открыть GitHub issue на `sooluh/gtc-js` с просьбой добавить MIT/Apache. Параллельно опция A. | 0 дней (ask + ждать) | Нулевой если ответят, такой же как A пока ждём. | Делаем **всегда параллельно** с A. Если автор ответит — мы белые и пушистые. |
| **C. Clean-room reimplement на Python** | Читаем `gtc-js` как референс протокола (это **legal** — изучать код для понимания, как библиотека общается с серверами GetContact), пишем свою обёртку на Python с нуля. | ~3 дня + ~0.5 дня/мес maintenance на квартальные AES-ротации Lirikon | Нулевой | Когда выходим в **публичный коммерческий продукт** и хотим закрыть legal exposure от точки → 0. |
| **D. Skip GetContact** | Не имплементируем вообще, опираемся на Truecaller + Telegram-resolve как reverse-identity слой. | 0 дней | Нулевой | Если после P8a + P8b видно, что Truecaller + TG-resolve уже закрывают «введи номер → узнай кто это» для UA/CIS аудитории. |

### 5.4. Решение (зафиксировано в REV-3)

**Выбрана опция A: use `sooluh/gtc-js` as-is via private install.** Параллельно — опция B (open GH issue автору с запросом MIT/Apache лицензии).

Логика:
- Репозиторий echo **приватный**, владелец **пока не деплоит** приложение, использует **в личных целях** → fingerprint в публичной экосистеме ≈ 0, distribution не происходит.
- Бесплатно работающая `[ALIAS]`-фича = большая ценность для UA/CIS аудитории.
- Если автор `sooluh/gtc-js` ответит на issue — переходим в полностью белую зону.
- Если когда-нибудь выйдем в публичный paid SaaS и риск-аппетит изменится — мигрируем на опцию C (3 дня clean-room порта на Python, известно как).

**Что фиксируем сейчас:**
- **Status:** `getcontact` = **`planned-p8b-private-install`**
- **Где:** `packages/providers/getcontact-vendored/` — git submodule на `sooluh/gtc-js` (read-only upstream, никаких модификаций)
- **Враппер:** Node-subprocess из NestJS, реализует `OsintProvider` интерфейс, эмитит `Started → Partial → Final`
- **Параллельно:** опен issue на <https://github.com/sooluh/gtc-js/issues/new> с просьбой добавить LICENSE-файл (MIT/Apache)

**Last-resort fallback — `naufalist/getcontact-web` (опция E):**

Если в момент имплементации P8b выяснится, что `sooluh/gtc-js` сломан (Lirikon обновил AES-схему, и upstream не догнал, потому что 7 мес без коммитов автора) — переключаемся на:

- **Repo:** <https://github.com/naufalist/getcontact-web>
- **License:** MIT ✓ (юр.чистая)
- **Stars / Last push:** 24⭐ / 2025-11-16
- **Стек:** PHP
- **Стоимость переключения:** добавить PHP runtime в `osint-py-sidecar` контейнер (превратить в `osint-multi-sidecar`) + переписать subprocess-враппер с Node-call на PHP-call. ~0.5 дня работы.
- **Когда триггерим:** только если gtc-js smoke-test (первый чекин P8b) показывает «не работает». **Default — не трогаем.**

---

## 6. Codeberg — что нашлось дополнительно

Проверил Codeberg explore через API на ключевые слова `osint`, `phone lookup`, `username search`. Результат:

- **Telethon** на Codeberg — **подтверждён живым** (last commit 2026-05-09, default branch `v1`, ставится как `pip install telethon`).
- Других значимых OSINT-инструментов на Codeberg, превосходящих то, что у нас уже есть в плане, **не обнаружено**. Все найденные репо имеют 0⭐, нишевые, или дублируют GitHub-аналоги (rengine, OSINTMap, telegraph и т.п. — нет смысла мигрировать).
- Codeberg на 2026-05 — это в основном **зеркала проектов, ушедших с GitHub по политическим причинам**, а не самостоятельная OSS-экосистема. Для phase-by-phase инкрементального добавления библиотек GitHub остаётся главным.

**Action item:** в `RUNBOOK.md` под Provider Credentials прописать, что для Telethon ссылка на репо — **codeberg.org/Lonami/Telethon**, не GitHub. PyPI неизменен.

---

## 7. Deferred — что **не** имплементируем сейчас (с причинами)

### 7.1. Superseded by better choice

| Lib | Заменено на |
|---|---|
| **Twilio Lookup v2** | phone-shortlist (phonenumbers + PhoneInfoga + Telegram-resolve + Truecaller). Twilio — анти-фрод стек, не people-search. |
| **exifr** (JS, MIT, stale) | **ExifTool** (P8d) — более полный охват, индустриальный стандарт. |
| **Holehe** (Python, GPL, stale) | Gravatar + GHunt + mailcat — три источника лучше одного. |

### 7.2. License-incompatible / не работают

| Lib | Почему отброшено |
|---|---|
| **`p1ngul1n0/blackbird`** (6 059⭐) | No license = all rights reserved. Sherlock + Maigret + WhatsMyName уже покрывают сценарий — не стоит брать ещё один без лицензии. |
| **`Postuf/getcontact`**, **`vorlie/getcontact-api`**, **`runnse/get_contact_api`** | Все **HTTP 404** — репозитории удалены. |
| **`Numenorean/GetContactAPI`** | No license + last code-push 2020-04 (5+ лет staleness). |

Про `sooluh/gtc-js` — это **не** в этой секции. См. § 5.

### 7.3. Operationally too risky / detection-locked

| Service | Почему |
|---|---|
| **WhatsApp web checks** | Агрессивный бан, требует QR-логин с физического телефона. |
| **Signal** | Нет публичного enumeration (E2E + sealed sender). |
| **Viber** | API закрыт, OSINT-выхлоп минимален. |

### 7.4. Legally toxic — никогда не интегрируем

| Service | Почему |
|---|---|
| **Myrotvorets** | Нет официального статуса, критика Council of Europe + ООН HCHR. |
| **TGStat .ru** | UA AML/sanctions exposure — контракт с `.ru` entity запрещён UA-юрлицу. |
| **«Пробив»-боты в TG** (`@glaz_bot`, Глаз Бога, Quick-OSINT) | Нелегальная перепродажа данных, часто RF-hosted/sanctioned. |
| **Любые breach-dumps** (GetContact partial / FB 533M / прочее) | Illegal to redistribute. |

### 7.5. Telegram-аналитика и индексация — out of product scope (REV-3)

| Service | Почему отброшено навсегда |
|---|---|
| **TGStat** (Telegram channel mention search) | (1) Платно от $19/мес. (2) Основной домен `.ru` = UA AML/sanctions exposure. (3) Даже бесплатный тир (500 req/мес) хостится на `.ru`. (4) Зеркало `.com` — формально другой entity, но владельцы те же; реальная legal exposure не уходит. **Решение REV-3: не возвращаемся, даже если найдём «легально-чистый» обход.** |
| **Telemetrio** (channel analytics) | echo фокусируется на **people-search**, не на channel-monitoring. Аналитика каналов — другая продуктовая вертикаль. **Решение REV-3: не возвращаемся.** Если когда-нибудь появится нужда — рассмотрим неwhem-zero конкурентов отдельно. |

---

## 8. Backlog — «к этому когда-нибудь вернёмся»

> Не делаем сейчас, но не отбрасываем навсегда. Записано здесь, чтобы потом легко поднять.

### 8.1. Email/identity нюансы

| Service | Почему отложено | Когда вернёмся |
|---|---|---|
| **Hunter.io (free 25/мес)** | B2B email-finder (`domain + first + last → likely email`). Оверхедный для consumer-MVP — мало кто из обычных пользователей знает домен компании target'а. | Когда заведём B2B SKU или фичу «найди corporate email». |
| **EmailRep paid key** | Free unauthenticated tier (что у нас в P8a) хватает на dev. Auth-ключ нужен только при упоре в rate-limit. | Когда DAU вырастет до уровня, когда unauth-rate начнёт прижимать. |

### 8.2. Видео-метаданные

| Service | Почему отложено | Когда вернёмся |
|---|---|---|
| **yt-dlp metadata** (YouTube/TikTok/Twitch/Vimeo/…) | Categorically полезен для «дай URL — получи профиль автора», но текущий MVP фокусируется на email/phone/username входе. Тащить yt-dlp + flask на ещё одну категорию входа = оверхедно. | Когда заведём «URL-input» как первый класс ввода в UI. |

### 8.3. Domain + IP recon (целый удалённый блок)

| Что было в REV-1 P8d | Зачем когда-нибудь вернёмся |
|---|---|
| crt.sh, ICANN RDAP, chaos-client, dnsx, alterx, webanalyze, AbuseIPDB, GreyNoise, ipapi.is, MaxMind GeoLite2 | Полная domain/IP-категория. Логично включать когда добавим вход «введи домен или IP», который сейчас не приоритет. |

### 8.4. Companies + Sanctions (global) — целый удалённый блок

| Что было в REV-1 P8e | Зачем когда-нибудь вернёмся |
|---|---|
| OpenSanctions, GLEIF LEI, SEC EDGAR, Companies House UK | KYC/AML-категория. Логично включать при B2B-SKU (юристы, compliance officers, journalists). |

### 8.5. Ukraine pack — целый удалённый блок

| Что было в REV-1 P8-UA | Зачем когда-нибудь вернёмся |
|---|---|
| OpenDataBot, NAZK declarations, PEP.org.ua, Prozorro OCDS, e-data.gov.ua, ЄДР bulk, cyrillic-name-normaliser | Расширенный UA-пакет для UA-аудитории (ФИО across UA registries, judge-declaration anomalies, government-spending pivot). Откладываем до момента, когда базовый MVP покажет, что core-fичи работают и появится bandwidth на регион-специфичный pack. |

### 8.6. Прочие категории

| Что | Когда вернёмся |
|---|---|
| **Crypto chains** (Blockchair, GoldRush, Moralis, Alchemy, Helius, GoPlus, Chainabuse) | P9+ (если фича востребована платящими) |
| **Secret hunting** (TruffleHog, gitleaks, noseyparker) | P9+ для GitHub commit-email mining parser |
| **Image extended** (DeepFace, InsightFace, C2PA, Yandex/PimEyes/FaceCheck) | P10+ после legal review (EU AI Act, биометрика) |
| **mosint** Go orchestrator | Используем как **pattern reference** для своего email-orchestrator, **не как dependency** |
| **VK API, YouTube Data API v3** | Defer — Telegram-resolve (P8a) уже даёт основной messenger-сигнал; VK/YT — отдельные категории, не приоритет |

---

## 9. Хронология PR'ов

> Каждая суб-фаза = один PR в стиле текущей `phase-per-PR` cadence.

```
P8a (Foundation)
   ──► P8b (Social + GetContact decision)
         ──► P8c (Email/identity deepening)
               ──► P8d (Image foundation)
```

- **P8a обязательно первым** — даёт работающий каркас (phone + username + email основы).
- **P8b** строго после P8a (socid-extractor работает по URL'ам которые приходят из P8a Sherlock/Maigret; GetContact интегрируется как полноценный провайдер).
- **P8c и P8d** между собой независимы — можно перетасовать под продуктовую логику. Default order — P8c → P8d (по убыванию ожидаемого consumer-wow).

---

## 10. Что обновлять в репо после go-ahead

> Меняется одним отдельным PR (не вместе с этим планом).

1. **`docs/PROVIDERS.md`** — добавить 19 новых карточек со статусами из этого документа. Декларативно «superseded»:
   - `exifr` → ExifTool (P8d)
   - `Holehe` → Gravatar + GHunt + mailcat
2. **`docs/AGENT_PLAN.md`** — раскрыть P8 в P8a/P8b/P8c/P8d с per-фазовой декомпозицией.
3. **`.env.example`** — добавить плейсхолдеры **только** для тех ключей, что нужны на free-tier:
   - `TRUECALLER_INSTALLATION_ID` (после успешного smoke-test)
   - `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_PATH`
   - `SAUCENAO_API_KEY` (free 100/day)
   - **Не добавляем:** `GETCONTACT_TOKEN` появится в `.env.example` **только когда** опция A из § 5.4 будет фактически закодирована (т.е. в начале P8b). `EMAILREP_API_KEY` — только если упремся в free rate.
4. **`RUNBOOK.md`** — раздел Provider Credentials с пошаговыми операционными инструкциями (Telethon disposable SIM, Truecaller SMS-flow, SauceNAO API key signup и т.д.). Ссылки на Telethon ведём на Codeberg.
5. **`packages/providers/core/types.ts`** — на этапе REV-2 не трогаем (paid-tier ladders удалены, поле `tier` пока не нужно).
6. **ADR-0019** (опционально, если решим) — один общий ADR со ссылкой на этот документ. Никакого дублирования контента.

---

## 11. Open decisions (на момент REV-3)

| # | Вопрос | Default REV-3 |
|---|---|---|
| 1 | Truecaller smoke-test в начале P8a — точно ли заводим, если живой? | **Да, заводим** в P8a; smoke-test = первый чекин P8a, если упадёт → в Deferred одной строчкой |
| 2 | GetContact опции A/B/C/D из § 5.3 | **A + параллельно B**. Vendored as private submodule, issue к автору. C — fallback при выходе в paid SaaS. |
| 3 | Порядок P8c → P8d или наоборот | P8c сначала (email-сторона ценнее) |
| 4 | Когда вернуть paid/business-блок | После P8c — увидим реальный free-flow и можно осмысленно настраивать tier-1 |
| 5 | Когда возвращать Ukraine pack из § 8.5 | Не раньше **после** P8d MVP, отдельным релизом с UA-аудиторией |

---

## 12. Summary cheat sheet

| Категория | Active P8 | Backlog | Defer permanent |
|---|---|---|---|
| **Phone** | phonenumbers, PhoneInfoga, Telethon, truecallerpy (conditional), GetContact-via-`sooluh/gtc-js` (private), ignorant | — | Twilio Lookup, NumBuster, WhatsApp checks, Signal, Viber |
| **Username** | Sherlock (anchor), Maigret, WhatsMyName runner, socialscan, socid-extractor | — | Blackbird (no license) |
| **Email** | Gravatar, HIBP Pwned Passwords, mailcat, EmailRep, GHunt | Hunter.io (free 25/мес), EmailRep paid | Holehe (superseded) |
| **Social** | Telethon (P8a — phone→TG) | — | TGStat (.ru-block + paid), Telemetrio (channel-analytics out of scope), Bluesky XRPC, Mastodon.py — все out-of-scope в REV-3 |
| **Image** | SauceNAO, ExifTool | — | exifr (superseded), PimEyes/FaceCheck (biometrics) |
| **Domain/IP** | — (целая категория в backlog) | crt.sh, RDAP, ProjectDiscovery toolset, IP-rep APIs, GeoLite2 | — |
| **Sanctions/Companies** | — (целая категория в backlog) | OpenSanctions, GLEIF, SEC EDGAR, Companies House UK | — |
| **UA registries** | — (целая категория в backlog) | OpenDataBot, NAZK, PEP.org.ua, Prozorro, e-data | Myrotvorets, ДРРП (closed) |
| **Crypto** | — | Blockchair/GoldRush/Moralis/Alchemy/Helius (P9+) | — |
| **Video** | — | yt-dlp (когда URL-input станет first-class) | — |
| **Secrets** | — | TruffleHog, gitleaks (P9+ для git mining) | — |

**Active total: 17 провайдеров (REV-3). Backlog total: ~23 провайдера с trigger-условиями возврата. Permanent-defer (никогда): TGStat / Telemetrio / Bluesky / Mastodon / биометрика / breach-dumps / etc.**
