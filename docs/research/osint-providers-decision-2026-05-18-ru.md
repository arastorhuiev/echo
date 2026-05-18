# OSINT — решения по P8 (2026-05-18, RU)

> Документ-решение по итогам исследования `osint-providers-extended-2026-05-18.md` (Part 1 + Part 2 UA). Фиксирует выбор владельца, рекомендацию по монетизации и финальный шорт-лист провайдеров под текущий бюджет.
>
> Английский ресерч остаётся как полный архив; этот файл — отжатая русскоязычная выжимка. Перед началом P8a сверяемся именно с ним.

---

## 1. Контекст и рамки

**Цель проекта:** ClarityCheck-подобный сервис со своим твистом — глубокий OSINT-поиск по одному входу (email / телефон / username / фото / домен), консьюмерский UX, монетизация в первую очередь в Украине.

**Жёсткие рамки от владельца (зафиксированы в этой сессии):**
- Бюджет на старте **до $50/мес** включая хостинг.
- Готовность масштабироваться, если придёт инвестор/маркетолог → архитектура должна оставлять «двери» для роста.
- Поиск по картинке — **в скоупе**, любимая фича (при необходимости геоблок по regions where biometric search illegal).
- Украинские модули — отдельной папкой, чтобы для UA-аудитории работал расширенный пакет.
- Кастомные парсеры на основе ключевых сервисов — поддержанная идея.
- Phase-per-PR cadence (см. memory), private repo, секреты — нет.

---

## 2. Бизнес-модель — моя рекомендация

**Вопрос владельца:** платить за каждый сервис отдельно (per-service) **или** один deep-research → глобальный отчёт?

**Рекомендация: единый бандл-отчёт ("Deep Research") как основной продукт + freemium teaser.**

Аргументация:

| Критерий | Per-service | Bundle Deep Research |
|---|---|---|
| Воспринимаемая ценность | низкая (узкий ответ) | высокая (всё в одном) |
| Сложность UX | choice paralysis | один input → один отчёт |
| Прайсинг | дробный, плохо запоминается | одна SKU = одна цена |
| Соответствие incumbent UX | нет (ClarityCheck/BeenVerified — бандл) | да |
| Дифференциация | трудно отстраиваться | через depth + кастом-парсеры |
| Влияние на retention | низкий repeat-rate | подписка + mention-alerts держат пользователя |

**Концепция SKU (стартовая):**

| Тир | Цена | Что внутри |
|---|---|---|
| Free / Teaser | ₴0 | 1 поиск/мес → показываем **одну wow-точку** (например «12 связанных аккаунтов найдено»), paywall на детали |
| Стартовый | **₴49 (one-time)** | 5 deep-отчётов, 30 дней — конвертация free → пробник |
| Pro | **₴199/мес (~$5)** | unlimited deep-research, mention-alerts по @-handle / телефону / имени, история отчётов |
| B2B | **₴1999/мес (~$50)** | API-доступ, audit log, KYC'd — для юристов/PI/recruiter'ов |
| Global Pro | **$9/мес (Paddle)** | эквивалент Pro для международных платежей |
| Global Agency | **$79/мес (Paddle)** | эквивалент B2B |

Гибрид сохраняет **«scan-yourself» framing** (юридически чище, см. ЗУ #2297-VI ст.7 ч.5 в Part 2) **и** не отрезает investigator-B2B апсейл, если придёт маркетолог. Free-тиер с «одной wow-точкой» — антидот против sticky-trial dark pattern легаси-брокеров, прямой плюс к доверию.

**Что НЕ делаем в MVP:**
- Per-service top-ups (рассмотрим как post-MVP эксперимент, если retention слабый).
- Отдельные SKU по категориям («только image search»). Дробит ценность.

---

## 3. Выбранные провайдеры (P8a starter)

Только то, что владелец отметил «нравится» / «топ» + минимальные зависимости-клей.

### 3.1 Топ-предпочтения владельца

| Провайдер | Категория | Цена | Что даёт |
|---|---|---|---|
| **Twilio Lookup v2** | phone | $0.005-0.04/req pay-go | CNAM + carrier + SIM-swap флаг — единственный wow-сигнал в категории phone в рамках бюджета |
| **GHunt** | email → Google | free (Python CLI) | email → Google Maps reviews / фото / реальное имя. Sidecar-паттерн уже есть (ADR 0008). |
| **mailcat** | username → emails | free GPL (Python CLI) | username → 22 вероятных email на популярных провайдерах. Усиливает email-граф. |
| **SauceNAO** | reverse image | free 100/day, $6+/мес | Реверс-картинка по pixel similarity (не биометрика → юридически чистая зона). Дешёвый вход в image-сёрч. |
| **Telethon** | Telegram | free MIT (Python) | MTProto userbot — основа любой TG-фичи (mention-alerts, контакт-graph, real-time канал-monitor). |
| **TGStat .com** | Telegram channels | free 500/мес → Bot $19/мес | Поиск упоминаний `@handle` / фразы по ~3M каналов, ~60B постов. Лучший Cyrillic-индекс на рынке. |
| **Telemetrio** | Telegram analytics | free 1k/мес → ~$39+/мес платно | Аналитика канала (subs, reach, category) — дополнение к TGStat. |

### 3.2 Менее приоритетные (включаем, но без флагмана)

| Провайдер | Категория | Цена | Роль |
|---|---|---|---|
| **HIBP Pwned Passwords (range API)** | password breach | free, no key | Чистая free-фича «утёк ли пароль» — k-anonymity, без отправки самого пароля. |
| **mosint** | email aggregator | free Go + your keys | **Не интегрируем как зависимость** — берём как образец архитектуры для своего email-orchestrator'а. |
| **socid-extractor** | enrichment | free MIT (Python) | URL → дополнительные ID'ы (Telegram, VK и т.п.). Тонкий пост-процессор после Sherlock/WhatsMyName. |

### 3.3 Обязательные зависимости / клей (нужны, даже если не «нравятся»)

| Зависимость | Зачем |
|---|---|
| **Gravatar REST v3** | Без него GHunt и email-поиск теряют половину wow. SHA256 → publicly-declared соц-сети. Бесплатно, must-have. |
| **WhatsMyName dataset** | JSON-датасет ~600 сайтов; пишем свой тонкий runner вместо обёртки над Sherlock/Blackbird/gosearch (Sherlock уже в P7). |
| **Maigret** (уже в плане) | Второй username-scanner для расширения покрытия — оставляем как было запланировано. |
| **ExifTool** (Phil Harvey) | Замена stale `exifr`. Гольд-стандарт EXIF, идёт через Python sidecar. Нужен для image-сёрча. |

---

## 4. Украинский модуль — отдельная папка

**Решение владельца:** UA-сервисы выделяются в отдельную папку → для украинской аудитории работает расширенный пакет, накапливает детали по реестрам.

### 4.1 Предлагаемая структура

```
packages/providers/ua/
  edr/                  # ЄДР — Unified State Register (companies, founders, UBO)
  edrsr/                # ЄДРСР — Court Registry
  nazk-declarations/    # NAZK — declarations of officials (public API)
  opendatabot/          # OpenDataBot wrapper (ЄДР+ЄДРСР+ЄРБ+АСВП в одном)
  opensanctions-ua/     # OpenSanctions UA coverage (ua_nsdc)
  pep-org-ua/           # PEP.org.ua (AntAC)
  prozorro/             # Prozorro OCDS (state tenders)
  e-data/               # spending.gov.ua (treasury)
  cyrillic-name-utils/  # name normaliser (RU↔UA transliteration, патронимы)
```

### 4.2 Стартовый набор UA (P8b-UA)

1. **OpenDataBot API** — единая точка входа над ЄДР+ЄДРСР+ЄРБ+АСВП (citizen free; Pro ~270 UAH/мес).
2. **NAZK Реєстр декларацій** — public API, бесплатно, **fresh data** (deadline FY2025 — 2026-04-01).
3. **OpenSanctions UA (`ua_nsdc`)** — РНБО sanctions через нормализованный слой.
4. **Cyrillic name normaliser** — кастомный парсер (см. §5 #14), **критическая инфраструктура** для всех UA-джоинов.
5. **PEP.org.ua** — analyst-vetted, более курированный чем NAZK.
6. **Prozorro OCDS** + **e-data** — для парсера «person earned X UAH from state».

### 4.3 Намеренно НЕ включаем (юридически токсично)

| Провайдер | Почему |
|---|---|
| **Myrotvorets** | Нет официального статуса, критика Council of Europe + ООН HCHR, ethical landmine. |
| **TGStat .ru** | UA AML/sanctions exposure для UA-юрлица — контракт с `.ru` entity запрещён. |
| **«Пробив»-боты в TG** (`@glaz_bot` и т.п.) | Нелегальная перепродажа данных, часто RF-hosted/sanctioned. |
| **GetContact (unofficial)** | Откладываем до отдельного решения, см. § 6 «открытые». ToS-violation + GDPR-non-compliance + квартальная ротация ключей Lirikon. |
| **ДРРП** (property register) | Закрыт для third-party reverse-lookup с 24-02-2022 (martial law). |

### 4.4 Топ-3 UA-wow моментов (под наш стек)

1. **«ФИО Иваненко → 17 court cases (2014–2026), 3 companies founded (1 active), debtor in 2 enforcement proceedings, alimony debtor since 2023»** — OpenDataBot + ЄДРСР + ЄРБ + АСВП. Стоимость: free → 270 UAH/мес Pro.
2. **«Judge Сидоренко: 4 квартиры Kyiv (286m²), 2 BMW '23/'24, spouse — единственный founder ТОВ-X с 8 госконтрактами, без обоснованного дохода»** — NAZK + ЄДР spouse join + e-data. Стоимость: **$0**. Юридически чище всех (public officials = statutory transparency).
3. **«EDRPOU → full UBO graph → для каждого UBO: courts, debts, PEP, sanctions»** — OpenDataBot + OpenSanctions + PEP.org.ua + NAZK. Классический B2B KYC.

---

## 5. Кастомные парсеры — приоритет P8a

> Идея владельца («кастомные парсеры на основе основных сервисов») — поддержана. Это главный источник дифференциации; ни один incumbent не собирает эти комбо в consumer-цене.

### 5.1 Топ-3 на P8a (под выбранный стек)

| # | Парсер | Вход → Выход | Зависит от | LOC |
|---|---|---|---|---|
| **1** | **email-username-permutator** | `{email:"jane.doe@gmail.com"}` → `{candidates:["jane","jdoe","jane_doe",...]}` → фан-аут в Sherlock/WhatsMyName | stdlib | ~150 |
| **2** | **avatar-sha-cross-match** | `{profiles:[{platform, handle, avatar_url}]}` → `{clusters:[{sha256, members:[...]}]}` | sharp + crypto | ~120 |
| **3** | **github-bio-bridge** | `{github:"jdoe"}` → `{declared_accounts:[...], emails_from_commits:[...]}` (читает README/pinned/profile) | octokit + cheerio | ~200 |

Эти три парсера + выбранные провайдеры дают «one email → 12 confirmed accounts + clusters» — рекламируемый wow на free-тиере.

### 5.2 Отложенные парсеры (P8b+)

| # | Парсер | Когда подключим |
|---|---|---|
| #4 | **ga-id-web-of-trust** | Top viral wow, но нужен HackerTarget paid tier — после Pro-подписчиков. |
| #5 | **reddit-comment-prismer** | Нужен LLM-токенайзер — после P8a. |
| #6 | **exif-home-clusterer** | 🔴 privacy-sensitive, **только в scan-yourself** с явным согласием. |
| #7 | **wayback-bio-diff** | Резюме-археология. Лёгкий парсер, можно затащить в P8b. |
| #8 | **favicon-fingerprint-net** | Когда добавим Shodan free key. |
| #9 | **ua-fio-graph** | Флагман UA-пакета; зависит от #14. |
| #14 | **cyrillic-name-normaliser** | **Первый в UA-фазе**, всё UA от него зависит. |
| #15 | **gov-spending-by-person** | После #9 и #14. |

---

## 6. Открытые решения (на следующую сессию)

| # | Вопрос | Default-ответ если не зафиксируем |
|---|---|---|
| 1 | HIBP **Breach API** ($3.95/мес) сверх Pwned Passwords-range? | **Нет в P8a**, добавляем когда появятся первые платящие. |
| 2 | DeHashed plaintext passwords ($15-30/мес) — killer feature? | **Отложить** до подтверждения «scan-yourself» позиционирования + юридическая обвязка хранения. |
| 3 | Image-сёрч стек после SauceNAO — Yandex / FaceCheck / PimEyes? | **PimEyes/FaceCheck — defer** (EU AI Act, ToS, биометрика). Yandex через ScrapingBee — рассмотреть в P8e только под бюджет роста. |
| 4 | GetContact (`[ALIAS]` wow для UA/CIS/TR) — feature-flagged ship или skip? | **Skip в P8a**. Отдельный ADR `0017-getcontact-restricted-tier.md` если решим включать. |
| 5 | Бизнес-модель — финализируем bundle-only или allow per-service top-ups? | **Bundle-only в MVP** (см. §2). Per-service — post-MVP эксперимент. |
| 6 | Геоблок-лист | Hard-block RU/BY/IR/KP/SY; soft-block CN. |
| 7 | TGStat tier на день-1 | Free 500/мес хватит на dev; Bot $19/мес — когда выйдем на ≥10 платящих. |

---

## 7. Бюджет — month-1 разбивка

| Статья | Цена | Комментарий |
|---|---|---|
| Hetzner CX22 (app + Python sidecar) | €5/мес | основной сервер |
| Hetzner CX22 (Telethon userbot, optional) | €5/мес | если запускаем mention-alerts day-1 |
| TGStat free tier | $0 | 500 req/мес хватит на dev и pilot |
| Telemetrio free | $0 | 1k/мес |
| Twilio Lookup v2 | $0.04 × ~200 запросов = ~$8/мес | scale-with-usage; пилотный объём |
| SauceNAO free | $0 | 100/day хватит для MVP |
| Gravatar / HIBP / GHunt / mailcat / socid / Telethon | $0 | free OSS / free API |
| sms-activate.org / 5sim (SIM-карты для Telethon) | $2-5/мес | амортизировано если Telethon включён |
| Резерв (proxy, domain, mail) | ~$10/мес | |
| **Итого** | **~$35-45/мес** | укладываемся в $50 cap |

**Headroom для роста (когда найдём investor/маркетолога):**

| Upgrade | Цена | Триггер |
|---|---|---|
| TGStat Pro tier ($99/мес, 50k req) | +$80/мес | >5k mention-search/мес |
| TGStat Bot tier ($19/мес) | +$19/мес | первый платящий клиент |
| HIBP Breach API | +$3.95/мес | как только feature востребован |
| DeHashed (plaintext passwords) | +$15-30/мес | юр.обвязка готова |
| HackerTarget paid tier | +$10-50/мес | для GA-ID web-of-trust парсера |
| Yandex Image (ScrapingBee) | +$40-100/мес | расширение image-сёрча |
| Telemetrio paid | +$39/мес | mention-alerts на VIP-каналы |
| OpenDataBot Pro (UA) | +~270 UAH/мес (~$6) | UA-фаза запущена |
| TrueCaller for Business | +$1500-5000/мес | только при investor money |

---

## 8. Изменения в существующих документах (после go-ahead)

**`docs/PROVIDERS.md` — потребуется обновление:**
- Понизить **`exifr`** с `planned-stale` → `deferred`, заменить на **ExifTool** (тот же sidecar-паттерн).
- Понизить **`Holehe`** с `planned-stale` → `deferred`, заменить комбинацией Gravatar + GHunt + mailcat.
- Добавить новые провайдеры: Twilio Lookup v2, GHunt, mailcat, SauceNAO, Telethon, TGStat, Telemetrio, Gravatar, HIBP-PwnedPasswords, socid-extractor, WhatsMyName-runner.
- Добавить новую категорию `ukraine-registries` (см. § 4).
- Добавить тэг `legal_zone ∈ {clean, regulated, tos-gray}` (без `lawless` — мы такие провайдеры не интегрируем).

**`docs/AGENT_PLAN.md` — потребуется обновление:**
- P8 раскладываем на:
  - **P8a — Free Wow Foundation** (3-4 дня): Maigret + Gravatar + HIBP-PwnedPasswords + WhatsMyName-runner + Twilio Lookup v2 + парсеры #1-3.
  - **P8b — Telegram pack** (2-3 дня): Telethon + TGStat + Telemetrio + socid-extractor.
  - **P8c — Email/Username pack** (2-3 дня): GHunt + mailcat + email-username-permutator (если не вошёл в P8a).
  - **P8d — Image-сёрч** (1-2 дня): SauceNAO + ExifTool.
  - **P8b-UA — Ukraine pack** (3-5 дней): OpenDataBot + NAZK + OpenSanctions-UA + cyrillic-name-normaliser + ua-fio-graph (parser #9).
  - **P8e — Image extended** (под бюджет роста): Yandex/PimEyes по результатам legal review.

**Новые ADR (на следующую сессию, после согласия):**
- `0015-osint-providers-extended.md` — фиксирует решения этого документа.
- `0016-ukraine-providers-module.md` — формализует UA-папку и юридическую обвязку (ЗУ #2297-VI, KMU 835).
- `0017-business-model-bundle-vs-per-service.md` — фиксирует выбор bundle-only.
- `0018-image-search-scope.md` — SauceNAO в P8a, PimEyes/FaceCheck deferred.
- ADR по платежам/payments (LiqPay+MonoPay+Paddle) — отдельно, после согласия по P9.

---

## 9. Что коммитим в этом PR (#12)

- ✅ Этот файл `docs/research/osint-providers-decision-2026-05-18-ru.md` — решения и план.
- ✅ Part 2 UA-аддендум, накопленный в working tree `docs/research/osint-providers-extended-2026-05-18.md` — фиксируем как продолжение того же ресерча.
- ❌ **Не трогаем** `PROVIDERS.md` и `AGENT_PLAN.md` в этом PR — обновим в отдельном PR после явного go-ahead.
- ❌ **Не пишем код** в этом PR (это research-фаза).

---

## 10. Чек-лист на следующую сессию

- [ ] Принять/скорректировать §2 (бизнес-модель: bundle vs per-service).
- [ ] Подтвердить §3 (стартовый список провайдеров) — есть ли что добавить/убрать.
- [ ] Подтвердить §4 (UA-папка) — структура и порядок подключения.
- [ ] Зафиксировать §5 (топ-3 парсеры на P8a).
- [ ] Решить §6 (открытые вопросы — особенно #2 DeHashed и #4 GetContact).
- [ ] Создать ADR из §8.
- [ ] Открыть P8a-фазу в `AGENT_PLAN.md` с детальной декомпозицией.
- [ ] (Опционально) обсудить P9 — payments stack (LiqPay+MonoPay+Paddle), чтобы быть готовыми к монетизации сразу после P8.
