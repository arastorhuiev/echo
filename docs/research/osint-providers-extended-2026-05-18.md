# OSINT Providers — Extended Catalog Research (2026-05-18)

> **Status:** research artifact, NOT a binding plan. Captures the output of a 3-agent parallel research pass plus session context. Read this tomorrow, decide on the open questions at the top, then we update `docs/PROVIDERS.md` and `docs/AGENT_PLAN.md` accordingly.

## How to pick up tomorrow

1. Read **§ Open decisions** below — 4 questions block extended-P8 scoping.
2. Skim **§ Top 10 wow moments** — that's the product-shaping axis.
3. Skim **§ Synthesis by user-facing category** to see what we'd add.
4. Read **§ Proposed P8 phasing** — there's a multi-phase split waiting for go/no-go.
5. The **§ Appendix — full agent reports** has the raw research if you want to dig deeper.
6. **NEW (2026-05-18 follow-up):** read **§ Part 2 — Ukraine addendum** at the bottom — adds UA state registries, GetContact-class phone→alias services, extended Telegram-mention coverage, and the UA monetization stack (ФОП-3 + LiqPay/MonoPay/Paddle).

---

## Open decisions (the gating ones)

| # | Question | Why it matters | Options |
|---|---|---|---|
| 1 | **Audience** — who's the target user? | Decides legal posture (consent vs. CCPA exposure), data scope, UX, monetization | (a) "scan yourself" consumer, (b) investigator/B2B, (c) consumer search-anyone (ClarityCheck-style), (d) undecided → build flexible backend |
| 2 | **Paid-API budget on dev** — `$0` / `$20-50` / `$100-300` / `$500+`/mo | Filters provider list: free-only catalog is wide but misses plaintext-password tier, premium phone CNAM, face search | Owner indicated: **$0-50, depending on how killer the feature**. Killer features individually justifying spend: DeHashed plaintext passwords (~$15-30/mo), Twilio Lookup phone enrichment (pay-per-req ~$0.04), HIBP breach API ($3.95/mo) |
| 3 | **Face / image search** — in scope for P8 or defer? | EU AI Act + GDPR Art.9 biometrics + CNIL fines on PimEyes + Cheaterbuster ToS violation = highest legal risk in the catalog. Also the highest viral wow per the research. | (a) defer entirely until legal review, (b) only EXIF+SauceNAO (no biometrics), (c) full stack (PimEyes/FaceCheck/Yandex) with consent flow, (d) C2PA AI-provenance only ("is this photo AI-generated?") |
| 4 | **P8a scope** — first concrete sprint | Decides what we build first vs. defer | Options drafted in **§ Proposed P8 phasing** — "Free Wow Foundation" / "Identity Graph Magic" / "Domain Infra Pack" / pick-by-hand |

**Owner's explicit constraints captured this session:**
- Final goal: ClarityCheck-like service with own twist (specifics TBD)
- Hasn't decided what exactly to search for or by which registries
- Wants "interesting" / "user-catching" features (e.g. "see how a person is registered in other phones")
- Budget posture: **$0-50/mo on dev, scaling up if a feature is genuinely killer**
- Defers face-search and P8a scope decisions to tomorrow's session

---

## Session context (preserve for tomorrow)

**What we did this session:**
- Merged M1 (Effect-TS defer-again) → PR #10
- Built P7a (proxy gateway scaffold using tinyproxy) → PR #11
- Spawned 3 parallel research agents for this extended catalog

**Where we are:**
- `main` is at `b3e3fee` (merge of P7a)
- P8 in `docs/AGENT_PLAN.md` still has the original "Phase-1 starter set" scope (Maigret + Holehe + PhoneInfoga + Subfinder + dnstwist + Wappalyzer CLI). **This research expands that significantly** — proposed split into P8a/b/c/d/e/f below.

**What we did NOT decide:**
- Whether to commit any of these new providers to `PROVIDERS.md`
- Whether to insert P8a–f into AGENT_PLAN.md
- Whether to bump Holehe from `planned-stale` to `deferred` (the research suggests `h8mail` as replacement)
- Whether to demote `exifr` to `deferred` in favor of `ExifTool` (Phil Harvey, gold standard, less stale)

---

## Synthesis — by user-facing category

> The convention here is "what does the END USER type in, what does the SCREEN show". Integration patterns (Python sidecar vs Node-native vs hosted API) are secondary — visible in the appendix per-tool tables.

### 🔍 Search by phone

**User question:** "Who's calling me? Is this number a scam? Whose phone is this?"

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **Twilio Lookup v2** | API | $0.005-0.04/req | `{phone:"+14158586273", carrier:{type:"mobile", name:"T-Mobile USA"}, line_type_intelligence:{type:"mobile"}, sim_swap:{last_sim_swap:{swapped_period:"PT336H"}}}` | **SIM-swap detection** = unique premium signal nothing else free or cheap has |
| **NumVerify** | API | free 100/mo, $14.99+ | `{valid:true, carrier:"T-Mobile USA", line_type:"mobile", country_code:"US"}` | Cheapest deterministic carrier+validity |
| **CallerID Test** | API | small/req | `{cnam:"ALEX SMITH", carrier:"T-Mobile US", linetype:"mobile"}` | US CNAM (real-name) — what ClarityCheck phone search returns |
| **ignorant** (Megadose) | Python CLI | free GPL | `[{name:"snapchat", exists:true}, {name:"instagram", exists:false}]` | Phone analog of Holehe |

**Wow:** "(415)XXX-XXXX → Karen M., T-Mobile, flagged as 'IRS scam' by 14 users in community DB, registered on Snapchat + Instagram + WhatsApp, SIM-swap event 14 days ago"

---

### 📧 Search by email

**User question:** "What else does this email belong to? Was the password leaked? What's the real name?"

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **Gravatar REST v3** | API | free | `{display_name:"Jane Doe", location:"Berlin, DE", job_title:"Staff Eng @ Stripe", verified_accounts:[{service:"github",url:"https://github.com/jdoe"},{service:"mastodon",url:"https://hachyderm.io/@jdoe"}], interests:["climbing","postgres"]}` | **Single best value/cost in the entire catalog.** SHA256 hash (not MD5 anymore as of 2024). |
| **HIBP `breachedaccount`** | API | $3.95/mo | `[{Name:"LinkedIn", BreachDate:"2012-05-05", DataClasses:["Emails","Passwords"]}]` | Breach existence flag (no actual passwords) |
| **HIBP Pwned Passwords (range)** | API | free, no key | `00FB30D9A4...:3\n01140C7A...:17\n` (k-anonymity — send 5-char hash prefix) | Validate password against breach corpus without sending it |
| **DeHashed** | API | $5/20q pay-go, $0.25/q sub | `{entries:[{email:"a@b.com", password:"Summer2022!", database:"Adobe"}]}` | **Plaintext passwords** = the "I can literally read your old password" wow |
| **LeakCheck** | API | from ~$15/mo | `{result:[{source:{name:"Adobe", breach_date:"2013-10"}, fields:["email","password"], password:"..."}]}` | Similar to DeHashed, different coverage |
| **Snusbase** | API | from $30/mo | `{results:{Collection1:[{email:"a@b.com", password:"...", hash:"..."}]}}` | Recent combolist focus |
| **GHunt** | Python CLI (Google cookie) | free | `{name:"Alex", gaia_id:"110...", profile_picture:"https://...", reviews:[...], calendar_visible:false}` | Email → Google Maps reviews/photos — exposes real name via review history |
| **Hunter.io** | API | free 25/mo, $49+ | `{data:{email:"patrick@stripe.com", score:97, sources:[{domain:"stripe.com", uri:"..."}]}}` | `domain+first+last → email` (sales tool, but also OSINT) |
| **DeBounce / Kickbox** | API | $0.004-0.008/email | `{result:"deliverable", reason:"accepted_email", disposable:false}` | SMTP-level email existence validation |
| **mosint** | Go orchestrator | free + your keys | Aggregates HIBP+Hunter+IntelX outputs into one JSON | Pattern to copy, not necessarily integrate |
| **mailcat** | Python CLI | free GPL | `{username:"anthropic", valid:["anthropic@gmail.com","anthropic@outlook.com"], checked:22}` | Username → 22 likely emails @ common providers |

**Wow:** "Email `jane@gmail.com` → verified Gravatar 'Jane D., Berlin, Staff Eng @ Stripe', linked GitHub `jdoe`, Google reviewed 47 places mostly in Berlin, leaked in 3 breaches (Adobe 2013, LinkedIn 2016, MyFitnessPal 2018), last leaked password: `Summer2022!`"

---

### 👤 Search by username

**User question:** "What other sites is this person on? Same person across two sites?"

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **WhatsMyName** (dataset) | JSON + tiny runner | free MIT | `{sites:[{name:"GitHub", uri_check:"https://github.com/{account}", e_string:"login", m_string:"Not Found"}, ...]}` — ~600 site definitions | **Take dataset, write our own runner** instead of shipping Sherlock+Blackbird+gosearch CLI wrappers |
| **Blackbird** | Python CLI | free MIT | `{username:"durov", found:[{name:"Telegram", url:"https://t.me/durov", status:"FOUND"}, {name:"GitHub", url:"...", status:"NOT_FOUND"}]}` | Secondary to Sherlock — different algorithm, JSON output |
| **socid-extractor** (soxoj) | Python lib | free MIT | `socid_extractor -u https://t.me/durov` → `{telegram_id:"1", fullname:"Pavel Durov", username:"durov"}` | Enrichment: by URL → extra IDs |
| **socialscan** | Python CLI | free MIT | `[{query:"jack", platform:"Instagram", available:false, valid:true, success:true}]` | **Availability check** (for signup-conflict workflow) — different shape from "exists" |

**Wow:** "`mike_91` exists on Snapchat, Telegram, Discord, OnlyFans, Pornhub; the avatar SHA256 matches across 4 of those (same person, high confidence); same email pattern likely `mike91@gmail.com` (confirmed by Gravatar)"

---

### 🖼️ Search by image / face

**⚠️ Legal red zone** — defer until we discuss & decide. EU AI Act (high-risk classification), GDPR Art.9 biometrics, ongoing PimEyes regulatory cases (CNIL/Hamburg DPA), Cheaterbuster Tinder ToS violation, ClearView class actions.

**User question:** "Where else does this face appear? Is it AI-generated? Active on dating sites?"

| Add | Type | Cost | Concrete sample output | Flag |
|---|---|---|---|---|
| **SauceNAO** | API | free 100/day, $6+/mo | `{results:[{header:{similarity:"95.50"}, data:{ext_urls:["https://twitter.com/.../status/..."], twitter_user_handle:"alice"}}]}` | 🟢 (art/avatars focus — pixel similarity not face match) |
| **TinEye MatchEngine** | API | $200+/mo | `{matches:[{image_url:"...", width:1200, height:800, score:89.5}]}` | 🟢 (pixel duplicates) |
| **Yandex Image** (via SearchAPI/ScrapingBee) | wrapped API | $40-100/mo | `{similar_images:[{url, title, source}]}` | 🟡 (3rd-party scrape wrapper, ToS gray) |
| **FaceCheck.ID** | paid API | $200+/mo, crypto-pay only | `{results:[{url:"https://twitter.com/...", score:92}]}` — includes mugshot/sex-offender/scammer DB matches | 🔴 high legal risk |
| **PimEyes OSINT API** | invite-only (LE/vetted) | enterprise | `{matches:[{url, similarity:0.87, face_box:[x,y,w,h]}]}` | 🔴 effectively unavailable to indie SaaS |
| **DeepFace** | Python lib (self-host) | free MIT | `DeepFace.verify("a.jpg","b.jpg")` → `{verified:true, distance:0.31, threshold:0.40, model:"VGG-Face"}` | 🟡 self-host face matching against own index |
| **InsightFace** | Python lib | free MIT | 512-d embedding vectors per face | 🟡 the model PimEyes-likes use underneath |
| **ExifTool** (Phil Harvey) | CLI | free Artistic/GPL | `[{SourceFile:"img.jpg", Make:"Canon", Model:"EOS R5", GPSLatitude:"40 deg 42' 46.00\" N", CreateDate:"2026:03:14 09:21:11"}]` | 🟢 the gold-standard EXIF — **replace `exifr` which is `planned-stale`** |
| **C2PA / c2patool** | Rust CLI | free Apache-2.0 | `{manifest_store:{active_manifest:"...", manifests:{"...":{claim_generator:"Adobe...", assertions:[{label:"c2pa.actions", data:{actions:[{action:"c2pa.edited"}]}}]}}}}` | 🟢 emerging 2026 standard for AI-image provenance |

---

### 🌐 Search by domain / website

**User question:** "Who owns this site? What other domains do they own? What tech is on it? What subdomains exist?"

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **crt.sh** | free public API | free | `[{issuer_ca_id:1234, common_name:"api.stripe.com", name_value:"api.stripe.com\nstripe.com", not_before:"2026-02-12T00:00:00"}, ...]` | CT logs → subdomains. Reveals personal-name subdomains like `bob-laptop.example.com`. |
| **certspotter (SSLMate)** | freemium | free 100q/hr | Same CT data, better SLA | Use if crt.sh quota is hit |
| **ICANN RDAP** (federated `rdap.org`) | free | free | `{objectClassName:"domain", handle:"DOM-12345", ldhName:"example.com", entities:[{roles:["registrant"], vcardArray:[..., ["email",{},"text","jane@example.com"]]}], events:[{eventAction:"registration", eventDate:"2018-03-12T00:00:00Z"}]}` | **WHOIS sunset Jan 2025** — RDAP is the replacement |
| **SecurityTrails** | freemium | 50q/mo free | `{records:[{values:[{ip:"34.10.5.6"}], first_seen:"2019-04-01", last_seen:"2022-08-15"}, {values:[{ip:"185.x.x.x"}], first_seen:"2022-08-16"}]}` | **DNS history**: "your blog used to point at your home IP in 2019" |
| **CIRCL Passive DNS** | free w/ vetting | free | `{rrname:"stripe.com", rrtype:"A", rdata:"34.107.x.x", time_first:1581..., time_last:1715..., count:4321}` (NDJSON) | Complementary pDNS source |
| **chaos-client** (ProjectDiscovery) | Go binary + PD key | free | `chaos -d stripe.com -silent` → `api.stripe.com\nbilling.stripe.com\n...` | Same publisher as Subfinder/httpx |
| **alterx** (ProjectDiscovery) | Go binary | free | `echo stripe.com \| alterx -enrich` → `dev.stripe.com\nstage.stripe.com\napi-dev.stripe.com\n...` | Permutation generator, feed into Subfinder/httpx |
| **dnsx** (ProjectDiscovery) | Go binary | free | `echo stripe.com \| dnsx -a -resp -json` → `{host:"stripe.com", a:["34.107.x.x"], timestamp:...}` | Fast canonicalization step before any provider |
| **bbot** | Python orchestrator | free GPL | newline-delimited JSON events: `{type:"DNS_NAME", data:"api.stripe.com", scope_distance:0, source:"...", timestamp:...}` | 80+ recon modules in one tool. GPL is a flag for commercial use. |
| **WebAnalyze** | Go binary | free | `{hostname:"target.com", matches:[{app_name:"nginx", version:"1.27.0", categories:["Web servers"]}]}` | Uses Wappalyzer dataset — clean Go subprocess pattern |
| **WhatWeb** | Ruby CLI | free GPL | `[{target:"target.com", plugins:{"nginx":{version:["1.27.0"]}, "Cloudflare":{}, "Google-Analytics":{account:["G-XXXXXX"]}}}]` | Pre-Wappalyzer fingerprinter, less stale for niche tech |
| **CMSeeK** | Python CLI | free MIT | `{cms_name:"WordPress", cms_version:"6.5.2", wp_users:["admin"], wp_themes:["..."]}` | Deep WP/Joomla/Drupal info |
| **Nuclei** | Go binary + templates | free MIT | `{template-id:"tech-detect", host:"target.com", matcher-name:"nginx", extracted-results:["1.27.0"]}` | Massive template library for tech-detect |
| **Katana** | Go binary | free MIT | `{timestamp:"...", request:{method:"GET", endpoint:"https://target.com/api/v1/..."}, response:{status_code:200, headers:{...}}}` | Modern JS crawler for SPA fingerprinting |
| **Wafw00f** | Python CLI | free BSD | `[{url:"https://target.com", detected:true, firewall:"Cloudflare"}]` | WAF detection |
| **HackerTarget reverse-analytics** | freemium | free 50/day | `["janescode.com", "jane-portfolio.dev", "myhusband-and-me.blog", "sailing-with-jane.com"]` | **GA-ID web-of-trust** — top differentiator |
| **PublicWWW** | API | from $99/mo | `{query:"UA-12345", results:[{url:"...", title:"...", first_seen:"2023-..."}]}` | Source-code search across the web — GA IDs, Stripe pks, etc. |

**Wow:** "Site `jane.dev` uses GA `UA-12345678-1`. Same ID found on `jane-portfolio.dev`, `myhusband-and-me.blog`, `sailing-with-jane.com`. Subdomain `home.jane.dev` runs Synology DSM (favicon hash matches IP `185.x.x.x` in Berlin via Shodan)."

---

### 🛰️ Search by IP / ASN

**User question:** "Is this a VPN? Is it on a botnet list? Where is it?"

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **AbuseIPDB** | API | free 1000/day | `{data:{ipAddress:"8.8.8.8", abuseConfidenceScore:0, countryCode:"US", usageType:"Data Center/Web Hosting/Transit", isp:"Google LLC", totalReports:4}}` | Best free IP reputation |
| **GreyNoise Community** | API | free 10k/day | `{ip:"8.8.8.8", noise:false, riot:true, classification:"benign", name:"Google Public DNS"}` | **RIOT flag** dedup known-benign scanners — big alert-fatigue cut |
| **ipapi.is** | API | free 1000/day | `{ip:"...", is_datacenter:true, is_vpn:false, is_proxy:false, is_tor:false, asn:{asn:15169, org:"GOOGLE"}, company:{name:"Google LLC", type:"hosting"}}` | **VPN/datacenter/proxy/tor flags** — what IPinfo lacks |
| **ipapi.co** | API | free 30k/mo | `{ip:"8.8.8.8", city:"Mountain View", region:"California", country:"US", org:"AS15169 Google LLC", timezone:"America/Los_Angeles"}` | Backup if IPinfo quota dries |
| **IPQS** | API | free 5k/mo | `{success:true, fraud_score:85, proxy:true, vpn:true, tor:false, recent_abuse:true, bot_status:true}` | Fraud score 0-100 |
| **Spur.us Context** | paid API | from ~$1k/yr | `{ip:"x.x.x.x", client:{types:["VPN"]}, tunnels:[{operator:"NORDVPN", type:"VPN", anonymous:true}]}` | Best VPN unmasking 2026 — premium only |
| **MaxMind GeoLite2** | self-host dataset | free CC | `mmdblookup` → `{city:{names:{en:"Mountain View"}}, country:{iso_code:"US"}, location:{latitude:37.4056, longitude:-122.0775}}` | Self-hosted fallback — survives any quota issue |
| **bgp.tools** | free API w/ contact | free | `{ASN:15169, Name:"GOOGLE", Description:"Google LLC", CountryCode:"US", Prefixes:[...]}` | Best BGP-side ASN data |
| **Team Cymru IP-to-ASN** | free | free | DNS/whois: `15169 | 8.8.8.0/24 | US | arin | 1992-12-01 | GOOGLE - Google LLC` | Bulk-friendly, no key |

---

### 🔓 Leaks / breaches / dark web

**User question:** "Have my data leaked? What exactly?"

Covered above in **email** category, plus:

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **IntelX** | API | $3000/yr starter | `{id:"...", records:[{type:1, name:"leak.txt", date:"2024-06-...", bucket:"leaks.public.general"}]}` | Paste / leaked-document search |
| **GrayHatWarfare** | API | free 100/day, paid | `{buckets:[{bucket:"stripe-prod-uploads", files:4321, region:"us-east-1"}]}` | **Public S3/Azure/GCS open bucket index** — resumes/personal photos leaked |
| **TruffleHog** | Go binary | free (AGPL) | `{SourceMetadata:{Data:{Git:{commit:"...", file:"config.py", line:42}}}, DetectorName:"AWS", Verified:true, Raw:"AKIA..."}` | 800+ secret types, **`Verified` flag** |
| **gitleaks** | Go binary | free MIT | `[{Description:"AWS Access Key", StartLine:42, File:"config.py", Match:"AKIA...", Commit:"..."}]` | Faster than TruffleHog, fewer detectors — complementary |
| **noseyparker** | Rust binary | free Apache-2.0 | datastore (own format), `report --format json` | Newer Rust scanner, very fast on git history |

---

### 📱 Social (Telegram / Mastodon / Bluesky / Reddit / YouTube)

**User question:** "What does this person post? Their audience? Mentions?"

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **Telethon** | Python MTProto | free MIT | `await client(GetFullChannelRequest("durov"))` → `{full_chat:{id:1, participants_count:120000, about:"..."}, chats:[...]}` | Official-protocol Telegram lib |
| **TGStat API** | freemium | free 500/mo | `{posts:[{id:12345, channel:{username:"opensource_ru", title:"OSS RU"}, text:"thanks @jdoe for the patch", date:1715000000, views:4821}]}` | 60B+ Telegram posts indexed across 3M+ channels — **find your @ mentions in channels you've never been in** |
| **Telemetrio** | freemium | free 1k/mo | `{channels:[{username:"durov", participants:120000, avg_post_reach:98000, category:"Politics", topics:["news","tech"]}]}` | Telegram channel analytics |
| **Bluesky XRPC** (`public.api.bsky.app`) | free no auth | free | `{did:"did:plc:abc", handle:"jane.bsky.social", displayName:"Jane", followersCount:482, postsCount:3914, createdAt:"2024-03-08T12:00:00Z"}` | Fully unauthenticated, generous rate limits |
| **Mastodon.py** | Python lib | free MIT | `Mastodon.account_search("durov")` → `[{id:"123", username:"durov", display_name:"...", followers_count:1000}]` | First-party Mastodon |
| **VK API** | free w/ token | free | `{response:{count:12, items:[{id:1, first_name:"Pavel", last_name:"Durov", domain:"durov"}]}}` | RU-CIS targets |
| **YouTube Data API v3** | free 10k/day | free | `{items:[{id:"UC...", snippet:{title:"Anthropic", customUrl:"@anthropic"}, statistics:{subscriberCount:"45000", videoCount:"12", viewCount:"1200000"}}]}` | Underused in OSINT stacks |
| **yt-dlp** | Python CLI | free Unlicense | `{id:"...", title:"...", uploader:"Anthropic", upload_date:"20260514", duration:900, view_count:120000, like_count:4500}` | Metadata from 1000+ video sites, no download |

---

### 💸 Search by crypto wallet

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **Blockchair** | API | free 1440/day | `{data:{"bc1q...":{address:{balance:12345678, received:987654321, transaction_count:42, first_seen_receiving:"2023-..."}}}}` | 17+ chains in one API |
| **GoldRush (Covalent)** | API | free 100k credits/mo | `{data:{items:[{contract_ticker_symbol:"USDC", balance:"5000000000", quote:5000.12}]}}` | Unified balance/tx, 100+ chains |
| **Moralis** | API | free 40k CU/day | `[{token_address:"0x...", name:"USD Coin", symbol:"USDC", balance:"5000000000", decimals:6}]` | NFT/token metadata strong |
| **Alchemy** | API | free 30M CU/mo | `{transfers:[{blockNum:"0x12...", hash:"0x...", from:"0x...", to:"0x...", value:1.5, asset:"ETH"}]}` | Best ETH/L2 indexer |
| **Helius** (Solana) | API | free 100k req/day | `[{signature:"...", type:"NFT_SALE", source:"MAGIC_EDEN", fee:5000, events:{nft:{buyer:"...", seller:"...", amount:2.5}}}]` | Solana-specific |
| **GoPlus Token Security** | API | free 30 q/min | `{result:{"0x...":{is_honeypot:"0", is_mintable:"1", owner_address:"0x...", slippage_modifiable:"0"}}}` | Honeypot/scam screening |
| **OpenSanctions Crypto** | dataset/API | free CC-BY-NC / paid commercial | `{results:[{id:"...", caption:"OFAC SDN address", schema:"CryptoWallet", datasets:["us_ofac_sdn"]}]}` | Replaces raw OFAC; covers OFAC+EU+UN |
| **Chainabuse** | hosted/API | free | `{reports:[{address:"bc1q...", chain:"BTC", category:"ransomware", reported_at:"2026-..."}]}` | Crowdsourced scam reports |

---

### 🏛️ Public records / Companies / Sanctions

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **OpenCorporates** | API | free rate-limited / £2250/yr commercial | `{results:{companies:[{company:{name:"STRIPE, INC.", jurisdiction_code:"us_de", company_number:"4844800", incorporation_date:"2010-09-23", officers:[...]}}]}}` | 235M+ companies, 145 jurisdictions. **Commercial = paid** |
| **SEC EDGAR** | free API | free | `{cik:"1318605", name:"Tesla, Inc.", tickers:["TSLA"], filings:{recent:{form:["10-K","8-K"], filingDate:[...]}}}` | US filings, exec lists |
| **Companies House UK** | free API w/ key | free 600/5min | `{company_name:"FOO LIMITED", company_number:"12345678", date_of_creation:"2019-...", officers:[...]}` | First-stop UK |
| **OpenSanctions** | dataset free non-commercial / API ~€250+/mo | as labelled | `{responses:{"...":{results:[{id:"...", caption:"VLADIMIR PUTIN", schema:"Person", datasets:["eu_fsf","us_ofac_sdn"], properties:{birthDate:["1952-10-07"]}, score:0.92}]}}}` | Replaces direct OFAC file; OFAC+EU+UN+UK |
| **GLEIF / LEI** | free API | free CC0 | `{data:{attributes:{lei:"254900OFRX8X8H4LSE94", entity:{legalName:{name:"STRIPE PAYMENTS UK LIMITED"}, legalAddress:{...}}}}}` | Global LEI — underused |

---

### 🌍 Geo / Maps / Satellite

| Add | Type | Cost | Concrete sample output | Notes |
|---|---|---|---|---|
| **Nominatim / OSM** | free hosted + self-host | free fair-use | `[{place_id:12345, lat:"48.85826", lon:"2.29449", display_name:"Eiffel Tower, ...", class:"tourism"}]` | Forward + reverse geocoding, no API key |
| **Overpass API** | free | free fair-use | OSM XML/JSON | "find all X near Y" |
| **OpenCage Geocoding** | freemium | free 2.5k/day | `{results:[{formatted:"Eiffel Tower, Paris, France", geometry:{lat:48.8583, lng:2.2944}, confidence:9}]}` | Wrapped OSM with better UX |
| **WiGLE API** | free w/ key | free rate-limited | `{success:true, results:[{trilat:47.61, trilong:-122.33, ssid:"Starbucks", netid:"00:11:22:33:44:55", encryption:"wpa2", lastupdt:"2026-04-..."}]}` | WiFi/BSSID → location |
| **Sentinel Hub / Copernicus** | freemium / free | varies | STAC `{features:[{id:"S2A_...", properties:{datetime:"2026-05-14T...", cloud_cover:12.3}, assets:{B04:{href:"..."}}}]}` | Sentinel-1/2 imagery |
| **STAC + pystac-client** | Python lib | free Apache-2.0 | Iterable STAC Items | Standard interface to imagery catalogs |

---

### 🛠️ Custom parsers (100-300 LOC each)

These don't exist as packaged products — we build them ourselves. Most are **unique** to our product if built.

| # | Parser | Input → Output | Wow | Risk | LOC | Notes |
|---|---|---|---|---|---|---|
| 1 | **github-bio-bridge** | `{github:"jdoe"}` → `{declared_accounts:[{platform:"mastodon", handle:"@jdoe@hachyderm.io", source:"profile_readme"}, {platform:"personal_site", url:"jane.dev", source:"pinned_repo_readme"}], unverified_emails:["jane@jane.dev"]}` | 5 | 🟢 | ~200 (octokit + cheerio) | Reads user's own claims before brute-forcing; much fewer false positives than Sherlock |
| 2 | **email-username-permutator** | `{email:"jane.doe@gmail.com", hints:{interests:["climbing"]}}` → `{candidates:["janedoe","jdoe","jane_doe","janedoe_climber", ...]}` then fan-out to Sherlock | 5 | 🟢 | ~150 stdlib | Magic moment: "I gave you only an email, you found her Strava" |
| 3 | **avatar-sha-cross-match** | `{profiles:[{platform, handle, avatar_url}]}` → `{clusters:[{sha256:"a4d...", members:[{platform:"github", handle:"jdoe"}, {platform:"mastodon", handle:"jane@..."}]}]}` | 5 | 🟢 | ~120 (sharp + crypto) | Trivially defeats handle obfuscation when users reuse avatar |
| 4 | **ga-id-web-of-trust** | `{seed_url:"jane.dev"}` → `{tracking_ids:["UA-12345678-1","G-ABC123"], co_owned_domains:["jane-portfolio.dev","myhusband-and-me.blog","sailing-with-jane.com"]}` | 5 | 🟡 | ~250 (cheerio + HackerTarget) | **Top viral wow** — nobody bundles this into consumer reports |
| 5 | **reddit-comment-prismer** | `{user:"jdoe"}` → `{top_subreddits:[["r/berlin",84],["r/climbing",62]], likely_timezone:"UTC+1 ±1", mentioned_locations:[{name:"Kreuzberg", count:12}], estimated_age_band:"28-34", writing_style:{avg_words:34, casual_score:0.71}}` | 5 | 🟡 | ~300 (axios + tokenizer + optional small LLM) | Beats RedditMetis with location/timezone inference |
| 6 | **exif-home-clusterer** | `{images:[{url,bytes}]}` → `{clusters:[{label:"likely_home", lat:52.5189, lon:13.4015, radius_m:80, confidence:0.87, photo_count:14}, {label:"workplace", lat:52.5300, lon:13.4150, radius_m:120, confidence:0.62}]}` | 5 | 🔴 | ~200 (exiftool + DBSCAN) | Privacy-sensitive — only on user-uploaded photos of themselves with explicit "I'm researching myself" confirmation |
| 7 | **wayback-bio-diff** | `{profile_url:"linkedin.com/in/jdoe"}` → `{timeline:[{date:"2014-06", bio:"CS student @ TUM"}, {date:"2018-03", bio:"SWE @ N26"}, {date:"2022-11", bio:"Staff Eng @ Stripe"}], deleted_claims:["worked at Bitcoin startup 2013"]}` | 5 | 🟢 | ~180 (Wayback CDX + diff) | Resume-archeology — deleted job-titles/old company affiliations are highest-shock |
| 8 | **favicon-fingerprint-net** | `{site:"jane.dev"}` → `{favicon_hash:-1234567890, matches:[{ip:"185.x.x.x", domain:"home.jane.dev", ports:[443,8080], banners:["Synology DSM"]}]}` | 4 | 🟡 | ~150 (mmh3 + Shodan free key) | Finds homelab IP via favicon — unannounced personal services |

---

## 🎯 Top 10 wow moments — cross-cut

Ranked by viral potential × our ability to deliver in P8:

| # | Wow moment | Stack needed | Cost | Legal |
|---|---|---|---|---|
| 1 | "One email → 12 confirmed accounts on other platforms" | Gravatar `verified_accounts` + Sherlock + email-username-permutator parser + GitHub commit-email mining | $0 | 🟢 |
| 2 | "Same avatar on 5 sites = same person" | avatar-sha-cross-match parser + any username/profile source | $0 | 🟢 |
| 3 | "Site `jane.dev` owns 4 more sites via GA-ID" | ga-id-web-of-trust parser + HackerTarget | $0 (free quota) | 🟢 |
| 4 | "Your 2023 leaked password was `Summer2022!`" | DeHashed or LeakCheck (plaintext tier) | $15-30/mo | 🟡 (data handling) |
| 5 | "Phone → name + carrier + IRS-scam flag + SIM-swap 14d ago" | Twilio Lookup v2 + AbuseIPDB-analog for phones | $0.04/req | 🟢 |
| 6 | "LinkedIn bio 2014: 'CS student' → 2018: 'SWE @ N26' → 2022: 'Staff @ Stripe' (+deleted Bitcoin startup claim 2013)" | wayback-bio-diff parser | $0 | 🟢 |
| 7 | "Strava: ran 5K from 123 Oak St this morning at 7am" | Strava public scrape | $0 | 🟡 (creepy) |
| 8 | "Venmo: paid Lisa K $40 for 'drinks' yesterday at 23:14" | Venmo public feed scrape | $0 | 🟡 (creepy) |
| 9 | "This face found on Tinder (active 2h ago) + 2 escort sites" | PimEyes/FaceCheck/SocialCatfish | $30-200/mo | 🔴 (legal review needed) |
| 10 | "Reddit user → Berlin timezone, climbs, posts during work hours, sentiment about ex-employer X" | reddit-comment-prismer parser | $0 | 🟡 |

---

## Proposed P8 phasing (proposal, not committed)

Instead of the original P8 ("add ~6-7 providers" as one phase), split by **value tier**:

### P8a — Free Wow Foundation (3-4 days)
All source-free, legally clean, max wow per dollar.
- **Maigret** (already in plan) — second username scanner
- **Gravatar v3** — top identity bridge
- **HIBP Pwned Passwords (range API)** — free, no key
- **WhatsMyName dataset** + thin runner (replaces multiple username CLIs)
- **Twilio Lookup v2** — paid but cheap ($0.005/req)
- Custom parser 1: **github-bio-bridge**
- Custom parser 3: **avatar-sha-cross-match** (post-processor)

### P8b — Identity Graph Magic (3-4 days)
Things that turn "one input → surprising graph".
- Email-username-permutator (parser 2)
- GA-ID web-of-trust (parser 4) — top-3 wow
- Wayback bio-diff (parser 7)
- Reddit comment prismer (parser 5)
- Bluesky XRPC + Mastodon.py (federated social)
- TGStat (Telegram mentions)

### P8c — Domain / Tech / Infra Pack (2-3 days)
For "whose site is this, what tech, what subdomains."
- crt.sh, ICANN RDAP
- SecurityTrails (DNS history)
- WebAnalyze (tech fingerprint)
- chaos-client + dnsx + alterx (ProjectDiscovery suite)
- favicon-fingerprint-net (parser 8)

### P8d — Premium Paid Tier (2-3 days, opt-in feature flag)
Pricier but guaranteed wow — behind paywall in product:
- DeHashed (plaintext passwords) — $15-30/mo or $5/20q pay-go
- Hunter.io (email-by-name)
- Optional: OSINT Industries API ($39/mo) — orchestrator-as-service for modules we don't build ourselves

### P8e — Image / Face (separate phase, requires legal review)
- ExifTool (replaces stale exifr; gold standard)
- C2PA tools (AI provenance)
- SauceNAO (cheap entry to reverse image)
- exif-home-clusterer parser (🔴 opt-in only)
- **PimEyes / FaceCheck / Yandex** — defer until legal sign-off

### P8f — Crypto Pack (1-2 days, if crypto in scope)
- Blockchair (multi-chain entry)
- GoldRush (Covalent)
- OpenSanctions Crypto (replaces raw OFAC)
- GoPlus (scam screening)

---

## Differentiation opportunities — strategic angles

From the ClarityCheck/comparable-product analysis, 5 angles a new product can exploit (any of these is a viable product-shape decision):

1. **"Honest paywall + show one wow free."** Every legacy broker hides everything behind trial trap. A service that shows one verified high-value data point free ("Yes, this email has 3 hidden dating accounts — pay $X to see which") beats incumbent UX on trust.

2. **Real-time activity feed, not stale broker data.** No consumer product packages Strava/Venmo/CashApp/Yelp-review/Maps-review surface well. OSINT Industries does it for investigators at $$$$. Consumer-priced version feels categorically new vs "John Smith lived at 12 addresses since 1998" report.

3. **Single-input "identity graph" instead of report pages.** Every incumbent shows static PDF-shaped report. A graph UI (input → entities → linked accounts → linked breaches → linked photos, all live, all clickable) is what investigators want — consumers would too.

4. **Breach data with the actual exposed value, not just a breach name.** HIBP/TruthFinder stop at "you were in Adobe breach." Showing actual cracked password, email handle pattern, and password-reuse graph is a SpyCloud-class B2B differentiator at consumer pricing.

5. **"Scan yourself" framing to dodge regulators.** Pitch the product as "see what *anyone* could find about *you*" — same data, inverted UX. Survives CCPA/GDPR scrutiny, rides privacy-anxiety wave that drives HIBP/Aura/PimEyes' "PROtect" SKU. Delete Act DROP launch (Jan 2026) creates tailwind for "automated removal" upsells worth more per month than the search itself.

---

## Flagged: dead / risky / redundant

### Dead or unsuitable in 2026
- **FOCA** — Windows GUI only, last meaningful change 2022. Use `pdfminer.six` + ExifTool.
- **Mozilla Location Service** — shut down 2024.
- **WhatBreach** — superseded by `leaker` + direct breach APIs.
- **EmailHarvester** — duplicates theHarvester.

### Ethical / legal red flags
- **FaceCheck.ID, Lenso.ai, PimEyes** — EU AI Act high-risk classification.
- **email2phonenumber** — triggers many password-reset flows; high abuse/ban-rate.
- **GHunt** — scraped Google session cookies; ToS-gray and brittle.
- **LeakCheck / Snusbase / DeHashed** — surface plaintext passwords on paid tiers; need data-handling policy.
- **Osintgram / Toutatis / instaloader** — heavy Meta ToS friction.
- **GitDorker** — high request volume hits GitHub secondary rate limits fast.

### Heavy overlap — pick one per niche
- **Username sweep:** Sherlock (have) + Blackbird + gosearch + Snoop check the same ~600 sites. Pick **Blackbird** (active, MIT, JSON) as secondary; better: just consume **WhatsMyName** dataset directly.
- **Subdomain enum:** Subfinder (have) + Amass + Findomain + bbot + chaos-client overlap heavily. Keep Subfinder, add **bbot** OR **chaos-client**, skip the rest.
- **Phone validation:** numverify vs Twilio Lookup vs CallerID Test — pick by region.
- **IP geo:** IPinfo (have) + ipapi.co + ipapi.is + MaxMind — pick **one paid + GeoLite fallback**.
- **Tech fingerprint:** WebAnalyze (uses Wappalyzer dataset) > WhatWeb (redundant once that's in).
- **Wayback URL recon:** gau strictly supersedes waybackurls. Pick **gau**.
- **Reverse image:** Yandex/TinEye/SauceNAO/Lenso do different things. Not redundant; pick by use case.

---

## Required adjustments to existing PROVIDERS.md

If we adopt anything from this research:

- **Demote `exifr`** from `planned-stale` → `deferred`, replace with `ExifTool` (gold-standard, less stale, same Python sidecar pattern).
- **Demote `Holehe`** from `planned-stale` → `deferred`, replace with combination of `Gravatar` + Hunter.io free tier + EmailRep. (`h8mail` is also stale; not a clean replacement.)
- **Reposition `Maigret`** as Phase-1 second-username-scanner — but evaluate whether `Blackbird` (more active) is better.
- **Add proxy posture note:** Maigret and any other scrape-based provider (Sherlock too) will benefit from the P7a `proxy-gw` once a paid upstream is configured. Document in each provider's notes.

---

## Appendix A — Full agent reports (verbatim, for re-mining)

Three agents ran in parallel on 2026-05-18. Their full reports are preserved below.

### Appendix A.1 — Hidden gems + custom parsers (agent transcript)

Output focus: 22 less-obvious data sources + 8 small custom-parser ideas, all with concrete output examples and 2026-verified status. Sources include:
- [Gravatar REST API v3 docs](https://docs.gravatar.com/rest-api/)
- [HaveIBeenPwned API v3](https://haveibeenpwned.com/api/v3)
- [Steam Web API documentation](https://steamcommunity.com/dev)
- [Wayback Machine CDX API](https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/README.md)
- [Bluesky OSINT guide](https://www.osintcombine.com/post/bluesky-osint-guide)
- [Google Analytics OSINT (Bellingcat)](https://medium.com/@tracker221B/tracking-the-tracker-osint-with-google-analytics-ids-20f7eccc058b)
- [Reverse Analytics — HackerTarget](https://hackertarget.com/reverse-analytics-search/)
- [Venmo OSINT in 2026](https://www.threatshub.org/blog/are-your-venmo-transactions-still-public-heres-why-and-how-to-change-that-asap/)
- [Strava aircraft-carrier leak March 2026](https://gadgetsandwearables.com/2026/03/20/strava-data-location-leak/)
- [Spotify Web API Feb 2026 migration](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)

**Key findings:**
- Gravatar SHA256 endpoint returns `verified_accounts` even when no avatar exists — underused goldmine.
- GitHub commit-email mining is the single most reliable email→identity bridge in OSINT (many devs commit from `.gitconfig` personal email while setting profile to `noreply`).
- Venmo still default-public in 2026, Strava heatmap continues to leak military bases.
- Spotify removed user-list API endpoints Feb 2026 — must scrape `open.spotify.com` HTML now.
- Travis Brown Twitter username history has coverage gap Jan 2023–early 2026; being re-indexed.

**Uncertain/flagged (do not rely without re-verifying tomorrow):**
- ProtonMail account-exists check via password-reset timing — tightened since 2023, status May 2026 unverified.
- Microsoft Teams presence enumeration — Microsoft hardening enumeration endpoints, May 2026 status unconfirmed.
- Tinder/Bumble photo→profile (CheatEye/SwipeSpy) — likely TOS-violating to industrialize.

### Appendix A.2 — ClarityCheck product analysis (agent transcript)

Output focus: how consumer-facing OSINT/people-search services actually work in 2026, with ClarityCheck as focal point. Compared services: ClarityCheck, BeenVerified, Spokeo, IDCrawl, ThatsThem, FastPeopleSearch, TruthFinder, Intelius, Whitepages, Social Catfish, Cheaterbuster, PimEyes, FaceCheck.ID, OSINT Industries, Epieos, Sherlock.

**Sources:**
- [ClarityCheck homepage](https://claritycheck.com)
- [Trustpilot — ClarityCheck reviews](https://www.trustpilot.com/review/claritycheck.com)
- [Empty Character — ClarityCheck vs TruthFinder/Intelius/Spokeo](https://emptycharacter.com/b/reverse-phone-lookup-review-claritycheck-vs-truthfinder-intelius-and-spokeo/)
- [Lindy — BeenVerified review 2026](https://www.lindy.ai/blog/been-verified-review)
- [Bitdefender — TruthFinder 20M record leak](https://www.bitdefender.com/en-us/blog/hotforsecurity/data-of-over-20-million-truthfinder-and-instant-checkmate-users-leaked-on-hacking-forum)
- [Cheaterbuster homepage](https://www.cheaterbuster.com)
- [Social Catfish AI image detector](https://socialcatfish.com/scamfish/ai-image-detector/)
- [OSINT Industries — Inbox Intel](https://www.osint.industries/post/inbox-intel-how-to-use-emails-for-osint)
- [FTC — Spokeo $800K FCRA settlement](https://www.ftc.gov/news-events/news/press-releases/2012/06/spokeo-pay-800000-settle-ftc-charges-company-allegedly-marketed-information-employers-recruiters)
- [CPPA — Background Alert shutdown](https://cppa.ca.gov/announcements/2025/20250227.html)
- [CPPA — Data Broker Strike Force](https://cppa.ca.gov/announcements/2025/20251119.html)

**Key findings (full table of 16 services with sample-output rows in agent transcript — synthesised above in § Synthesis):**
- Legacy data-broker brands (BeenVerified, Spokeo, Intelius, TruthFinder, Whitepages, ClarityCheck) sell ~identical underlying inventory: US public records (property/court/voter/marriage/criminal) + bulk consumer marketing files + lightly normalised social-profile scrapes.
- Modern OSINT-shaped stack (PimEyes, FaceCheck.ID, Social Catfish, Cheaterbuster, OSINT Industries, Epieos, Sherlock, HIBP+) does *live* lookups across 500-1500 endpoints per query — fresher, denser, more wow but worse marketing reach.
- Business model bifurcation: legacy = $0.99→$25-37/mo sticky-trial dark pattern; modern = per-credit / per-report.
- Speed-to-first-wow is what makes products sticky. ClarityCheck's reviewer reputation isn't from depth — it's "results in 60 seconds with a clean card I can screenshot."
- Most "social media profiles" in legacy reports are garbage. Real depth lives in modern stack.
- Regulatory pressure rising fast: California Delete Act DROP launched Jan 2026, CPPA fined multiple brokers, Vermont/Texas now have registration regimes. FCRA exposure is existential threat. PimEyes etc. carry separate GDPR Art.9 risk.

**Items unverifiable due to anti-bot blocks** (high confidence on pricing/category, lower on exact wording):
- BeenVerified, Intelius, Whitepages, FastPeopleSearch, Cheaterbuster, Social Catfish, OSINT.industries — direct WebFetch returned 403.

### Appendix A.3 — OSINT framework deep crawl (agent transcript)

Output focus: comprehensive long-list of 70+ programmatically-accessible OSINT tools/APIs/datasets that are NOT in current `PROVIDERS.md`. Sources crawled:
- [lockfale/osint-framework](https://github.com/lockfale/osint-framework)
- [jivoi/awesome-osint](https://github.com/jivoi/awesome-osint)
- [Astrosp/Awesome-OSINT-For-Everything](https://github.com/Astrosp/Awesome-OSINT-For-Everything)
- [Bellingcat Toolkit gitbook](https://bellingcat.gitbook.io/toolkit/)
- [GitHub topic: osint-tool](https://github.com/topics/osint-tool)

Organised by category. Full tables of ~70 entries with concrete sample outputs and difficulty ratings are synthesised above in § Synthesis (by category). Highlights of items I would not lose:

**Worth highlighting (didn't make the main category tables above):**
- **bbot** (blacklanternsecurity) — "Sherlock-of-domain-recon", 80+ modules, GPL.
- **Sourcegraph API** — cross-repo regex search for secret hunting at scale.
- **WiGLE API** — WiFi BSSID → location (niche but unique signal).
- **VirusTotal v3** + **urlscan.io** + **AlienVault OTX** + **abuse.ch URLhaus/ThreatFox/MalwareBazaar** — threat-intel package if we ever ship that lens.
- **Sentinel Hub / Copernicus / STAC** — satellite imagery free path.
- **gau** strictly supersedes waybackurls (adds AlienVault OTX + Common Crawl + URLScan).
- **noseyparker** (Rust) — faster than TruffleHog for git history scanning.

**Tools that LOOK good but are dead/risky:**
- FOCA — Windows GUI only, abandoned 2022.
- Mozilla Location Service — shut down 2024.
- WhatBreach, EmailHarvester — superseded.
- snscrape — X/Twitter scraping broken, but Mastodon/Reddit/Telegram/VK still work.

---

## Appendix B — Open questions to answer tomorrow

1. **Audience** — "scan yourself" / investigator-B2B / consumer-search-anyone / undecided-flexible-backend?
2. **Budget** — owner indicated `$0-50/mo depending on killer feature`. Which specific paid APIs justify the cost?
   - HIBP $3.95/mo → enables breach lookup table-stakes
   - Twilio Lookup `$0.005-0.04/req` pay-go → enables phone enrichment wow
   - DeHashed `$5/20q pay-go` → enables plaintext password wow (or wait for monthly?)
   - Hunter.io free 25/mo → free entry
3. **Face / image search** — defer entirely / EXIF+SauceNAO only / full stack with consent flow / C2PA-AI-only?
4. **P8a scope** — Free Wow Foundation / Identity Graph Magic / Domain Infra Pack / pick-by-hand?
5. **Provider demotions** — accept the proposed `exifr → deferred` and `Holehe → deferred` moves?
6. **Custom parser priority** — which 2-3 of the 8 parsers go first?

---

# Part 2 — Ukraine addendum (2026-05-18 follow-up)

> Owner directive this session: «мне надо монетизироваться в Украине». Adds three coordinated research blocks the Part 1 catalog didn't cover:
> **(A)** UA-specific state registries / aggregators / PEP for ФИО-driven search,
> **(B)** GetContact-class **phone → contact-aliases** services (alias = "saved as 'Mom' by 8 people"),
> **(C)** extended Telegram public-channel mention search (beyond the single TGStat row in Part 1),
> **(D)** monetization-in-UA stack (legal regime, payments, ФОП vs Diia.City, mobilisation/wartime exposure).
>
> Same convention as Part 1: table-driven, sample-output–first, **honest unverified flags inline**. Three parallel research agents produced the source material; output here is condensed-with-judgement, not verbatim. Raw agent reports are NOT preserved (token economics) — re-run them next session if needed.

## Part 2 — Open decisions (additional gating)

| # | Question | Why it matters | Options / owner constraints |
|---|---|---|---|
| 5 | **UA market posture — UA-first consumer / UA-first B2B / global-via-Paddle from day 1?** | Decides legal entity (ФОП-3 vs ТОВ vs Diia.City), payment stack, ToS jurisdiction. | (a) UA-first consumer (ФОП-3 + LiqPay + MonoPay), (b) UA-first B2B (lawyers/PI/recruiters at ₴1999/mo), (c) global-via-Paddle MoR + UA contractor, (d) hybrid — recommended in § P2.D |
| 6 | **GetContact-class alias feature — ship it or skip it?** | Real product wow, real ToS+GDPR liability, real maintenance churn. No legal self-serve API exists for the alias-count field. | (a) skip entirely (TrueCaller-B2B / Whitepages-Ekata legal path — no alias wow), (b) ship unofficial-GetContact behind feature-flag + geo-restrict (UA/CIS/TR only), (c) bootstrap own contact-book corpus (long horizon, GDPR-clean), (d) Telegram-userbot as alias-substitute (`[CNAM]`-equivalent) |
| 7 | **Telegram-mention provider — TGStat paid / Lyzem scrape / self-host Telethon fleet?** | Decides P8b shape and ongoing ops cost. | TGStat `.com` Bot tier $19/mo is the rational default; self-host justified only if we exceed $200/mo OR need real-time alerts TGStat doesn't have |
| 8 | **Day-1 payment stack** | Decides whether MVP is launched-to-UA-only or global from day 1. | Recommended: ФОП-3 + Monobank business + LiqPay + MonoPay + Paddle (global) + USDT-TRC20 fallback. See § P2.D.7 |
| 9 | **Geo-block list** | War-time legal exposure; OFAC; "providing assistance to enemy" risk under Art.111 ККУ if UA citizens are tracked by hostile actors | Hard-block RU/BY/IR/KP/SY at edge + payment-method layer; soft-block CN; allow EU/US via Paddle |
| 10 | **Owner mobilisation/conscription status** | ФОП registration does NOT grant deferral; Diia.City employee status MIGHT qualify for ИТ-резерв. | Out of scope for catalog — but interacts with entity choice (Diia.City early access vs ФОП-3 simplicity) |

**Owner constraints reaffirmed this session:**
- Final goal still ClarityCheck-like with own twist; UA monetization is now an explicit hard requirement.
- Liked features highlighted this session: search by ФИО across UA registries, GetContact-style phone-aliases, Telegram-channel mentions.

---

## § P2.A — Ukrainian state registries (search by ФИО / phone / EDRPOU)

### P2.A.1 — Person registries (state-run)

> All UAH amounts are 2025 figures unless flagged; war-time martial-law restrictions noted per row.

| Add | URL | Search by | Cost | Sample output | 2026 status | Flag |
|---|---|---|---|---|---|---|
| **ЄДРСР — Court Registry** | `reyestr.court.gov.ua` | ФИО, EDRPOU, judge, case № | free for humans; programmatic via OpenDataBot/YouControl mirrors | `{doc_id, court, judge, parties:["ОСОБА_1","ТОВ Альфа"], case_no:"752/123/26", text}` — **post-2022 parties often pseudonymised as `ОСОБА_N`; pre-2022 cases still searchable by full ФИО** | live; anti-bot on direct site; use mirrors | 🟢 **headline UA-OSINT primitive** |
| **ЄРБ — Реєстр боржників** | `erb.minjust.gov.ua` | ФИО + DOB OR EDRPOU | free | `{debtor, dob, proceeding_no, debt_type:"alimony|tax|credit|...", executor:"Київський ВДВС"}` | live, daily-refreshed | 🟢 |
| **АСВП — Enforcement proceedings** | `asvpweb.minjust.gov.ua` | ФИО+DOB OR EDRPOU OR proceeding № | free | `{proceeding_no, debtor, creditor, executor, status}` | live | 🟢 sibling to ЄРБ |
| **NAZK Реєстр корупціонерів** | `corruptinfo.nazk.gov.ua` | ФИО + DOB | free | `{person, offence_article:"172-5 КУпАП", court_decision_no, sanction:"fine|...", date}` | live but pruned (records expire by retention law) | 🟢 keep local snapshot |
| **РНБО Sanctions** (via OpenSanctions `ua_nsdc_sanctions`) | `sanctions.nsdc.gov.ua` | ФИО, EDRPOU | free | `{id:"NK-1234", caption, born, citizenship, sanctions:[{decree:"82/2019", measures:["asset_freeze","entry_ban"], expires}]}` | live, very active (Jan 2026 batch: 108 ppl + 78 LEs) | 🟢 best via OpenSanctions normalisation |
| **War & Sanctions portal** | `sanctions.nazk.gov.ua` + `war-sanctions.gur.gov.ua` | ФИО, EDRPOU | free | russia-PEPs/sponsors, "Components in Weapons", "Foreign directors in Russian Companies" | live | 🟢 cross-jurisdiction OSINT tracker built-in |
| **MVS Wanted list** | `mvs.gov.ua/activity/rozsuk` | ФИО, DOB | free | `{person, photo, reason:"hiding|missing", region}` | live | 🟡 per-region submissions, no central API |
| **ЄРОЗБ — Missing persons** | MVS internal | relatives only | n/a | extract format | **closed to public** | 🔴 skip |
| **Реєстр виборців (CEC)** | `cvk.gov.ua` | self only | n/a | n/a | **closed to third parties** | 🔴 skip |
| **ДРФО / tax cabinet** | `cabinet.tax.gov.ua` | self only via Diia/SmartID/KEP | free for self | own RNOKPP/income only | **closed to third parties** | 🔴 not buildable into search |

### P2.A.2 — Companies / FOP — with founder/beneficiary ФИО reverse-lookup

**This is the single most monetisable UA-OSINT primitive: ФИО → all companies founded/directed/UBO'd.**

| Add | URL | Search by | Cost | What it gives | 2026 status | Flag |
|---|---|---|---|---|---|---|
| **ЄДР — Unified State Register** (`data.gov.ua` bulk CSV + `irc.gov.ua/reestr_edr` UI) | various | EDRPOU, name, **founder ФИО**, **director ФИО**, **UBO ФИО** | free bulk; paid wrappers for live queries | `{edrpou, name, status, kveds, address, directors:[{name, role}], founders:[{name, share_pct}], beneficiaries:[{name, share_pct, type:"final"}]}` | live, daily refresh; UBO reporting mandatory since 26-09-2015 | 🟢 **gold** |
| **OpenDataBot API** | `docs.opendatabot.com` | EDRPOU, ФИО, case №, RNOKPP, plate, address | citizen free; Pro **~270 UAH/mo** (10 LE/court monitorings); enterprise sales-led | unified wrapper over ЄДР+ЄДРСР+ЄРБ+АСВП+plates+alimony-debtors | live | 🟢 **best "one API to rule them all" for UA** |
| **YouControl YouScore** | `youscore.com.ua` | EDRPOU, founder/director/UBO ФИО | tiers sales-gated (estimated 5k-50k UAH/mo) | KYC-grade dossier: ownership, sanctions (UA+EU+US+UN), PEP-relatedness, courts, debts, **KEP-signed extracts**, connection graph | live, won Banker Awards 2026 | 🟢 premium B2B |
| **vkursi.pro** | `vkursi.pro/api` ([GitHub `vkursi-pro/API`](https://github.com/vkursi-pro/API)) | EDRPOU, ФИО, RNOKPP | sales-led | 200+ methods incl. signed extracts from USR, ownership docs, property certificates with KEP | live | 🟢 bank-grade alternative |
| **Clarity Project** | `clarity-project.info` | EDRPOU, founder ФИО, tender, beneficiary | freemium; free for journalists/NGOs | tenders + AMCU appeals + contracts + chain analytics | live | 🟢 **best for tender/corruption signal** |
| **ring.org.ua / edr-info.com / UA-REGION** | various | EDRPOU, ФИО | free | basic company card | live | 🟡 free fallback, lower coverage |
| **GLEIF LEI** | `gleif.org` | LEI / legal-name fuzzy | free CC0 | `{lei, legalName, legalAddress}` | live | 🟢 already in Part 1; UA companies trading intl have LEIs |

### P2.A.3 — Property / vehicles / movable assets

| Add | Search by | Cost | 2026 status | Notes |
|---|---|---|---|---|
| **State Register of Property Rights (ДРРП)** | n/a (closed) | n/a | **restricted since 24-02-2022 (martial law)** to notaries + registrars + parties | 🔴 **third-party reverse-lookup closed**. Only Diia "Е-витяг" for owner-self. Skip until restrictions lift. |
| **СРОРМ — Encumbrances on Movable Property** | EDRPOU, ФИО, VIN | free / paid mirror | partial during martial law | 🟡 useful for "is this car under lien" |
| **HSC opendata** (`opendata.hsc.gov.ua`) | plate (redacted), VIN, owner-region (**no ФИО**) | free CSV | live | 🟡 owner ФИО is NOT published; region + first-reg + tech specs only |
| **OpenDataBot plate slice** | plate, VIN | paid | live | 🟡 closest available "plate → person" but bounded by source-data redaction |

### P2.A.4 — Tax / financial / spending

| Add | URL | Search by | Cost | Notes |
|---|---|---|---|---|
| **VAT payers register** | `cabinet.tax.gov.ua/registers` | EDRPOU, RNOKPP, name | free | 🟢 preserved during martial law; critical for "is this counterparty real VAT payer" |
| **Single-tax payers** | same | EDRPOU/RNOKPP | free | 🟢 FOP due-diligence |
| **e-data.gov.ua / SPENDING** | `spending.gov.ua` | EDRPOU, recipient, contract | free | 🟢 treasury-level payment granularity — **"person earned X UAH from state"** pivot when joined with ЄДР |
| **Prozorro OCDS API** | `prozorro.gov.ua` | EDRPOU of winner, tender | free | 🟢 OCDS JSON, ~25 fields per contract |
| **007.org.ua / NashiGroshi** | various | EDRPOU, contract | freemium / free editorial | 🟡 signal sources (investigations attached to person profiles) |

### P2.A.5 — PEP / anti-corruption

> **NAZK declarations register is the highest-wow-per-dollar UA source** — public officials' assets + family + vehicles + foreign accounts + crypto, all public-API, mandatory deadline 2026-04-01 for FY2025 (fresh data right now).

| Add | URL | Search by | Cost | Notes |
|---|---|---|---|---|
| **NAZK Реєстр декларацій** | `public.nazk.gov.ua` | ФИО of declarant + family ФИО, RNOKPP | **free public API** | 🟢 **gold mine**. Includes family ФИО → re-runnable through ЄДР for the "family graph" parser |
| **PEP.org.ua (AntAC, tech: Data Ocean)** | `pep.org.ua` | ФИО, RNOKPP | free read; bulk via Data Ocean (paid, sales-led) | 🟢 analyst-vetted, **more curated than NAZK**, with citations to investigations |
| **Chesno "Знай своїх"** | `chesno.org` | ФИО of politician | free, no general API (scrape) | 🟡 ChesnoMeter integrity score + "Register of Perpetrators of Treason" (collaborators — unique UA signal) |
| **Verkhovna Rada open data** | `data.rada.gov.ua` | MP ФИО, faction, vote | free CKAN | 🟢 110+ datasets, voting drilldown |
| **OpenSanctions UA coverage** | `opensanctions.org/countries/ua` | ФИО, EDRPOU | free non-commercial / paid commercial (~€250+/mo) | 🟢 **best normalisation layer** over UA sources, ~21k UA-connected entities |

### P2.A.6 — Misc / special interest

| Add | URL | Notes |
|---|---|---|
| **Diia / Дія electronic passport** | `diia.gov.ua` | 🟢 **"Sign in with Diia"** = consent-clean "scan yourself" flow; removes lawful-basis risk entirely for own-data product. Material strategic angle. |
| **Apostille register (ЕРА)** | `era.minjust.gov.ua` | 🟡 niche — anchor for "is this apostille real" parser |
| **State Aviation / Maritime** | `saa.gov.ua` etc. | 🟡 partial under martial law, low priority |
| **Myrotvorets** | `myrotvorets.center` | 🔴 **hard-exclude for consumer product** — no official status, Council of Europe + UN HCHR criticism, court evidence ambiguity, ethical landmine |

### P2.A.7 — Top 5 UA-specific "wow" moments

| # | Wow | Stack | Cost | Legal |
|---|---|---|---|---|
| 1 | "Іваненко Іван → 17 court cases as defendant (2014-2026), 3 companies founded (1 active), debtor in 2 enforcement proceedings, alimony debtor since 2023" | ЄДРСР+ЄДР+ЄРБ+АСВП via OpenDataBot | $0 free data; ~270-2000 UAH/mo at OpenDataBot Pro | 🟡 see § P2.D legal |
| 2 | "Phone +380XX → ФОП Петренко, VAT payer, won 4 Prozorro tenders 2025 totalling 12M UAH from Київська ОДА" | OpenDataBot reverse-phone slice + ЄДР + Prozorro + e-data | low UAH/mo | 🟡 |
| 3 | "Judge Сидоренко: 4 apartments Kyiv (286m² total), 2 BMWs '23/'24, spouse sole-founder ТОВ-X that won 8 state contracts, no income justifying any of it" | NAZK API + ЄДР spouse join + e-data | $0 | 🟢 **lowest legal risk** (public officials = statutory transparency) |
| 4 | "ТОВ X founder is on RNBO sanctions list AND in NAZK corruption register AND named in 3 NashiGroshi investigations" | OpenSanctions `ua_nsdc` + `corruptinfo` + NashiGroshi RSS + ЄДР | $0 | 🟢 sanctioned/convicted = minimal privacy expectation |
| 5 | "Counterparty due-diligence: EDRPOU → full ownership graph → all UBOs → for each UBO: courts, debts, PEP, declarations, sanctions screening" | YouScore/vkursi premium OR free composite (OpenDataBot + OpenSanctions + PEP.org.ua + NAZK) | $0 to 1000+ UAH/mo | 🟢 classic B2B KYC, well-trodden |

---

## § P2.B — Phone → contact-aliases (GetContact-class)

> **Skepticism tags**: `[ALIAS]` = true contact-book aliases (the GetContact wow), `[CNAM]` = telecom registry name only, `[WHITEPAGES]` = legacy data-broker name, `[SPAM-LABEL]` = community spam tag (not a personal name). **Most vendors lie in marketing** about what category they're in.

### P2.B.1 — The five real `[ALIAS]` providers, ranked

| Provider | Coverage | Official API | 2026 status | Legal posture | Practical access |
|---|---|---|---|---|---|
| **GetContact** (Lirikon, TR) | ~600M users; **best for TR/AZ/KZ/UA/RU/IR/IN-South** | **none** — no B2B program | active, market-dominant in CIS/MENA | **DE/NL/IT effectively banned**; GDPR-non-compliant; UA: accessible, unenforced; ToS forbids scraping | Reverse-engineered Python libs (`getcontact-py`, `pygetcontact`) — **brittle**, Lirikon rotates AES signing keys ~quarterly. Account needs SMS-receivable number. Free tier: 3 aliases/q cap; Premium ~$3.5/mo → unlimited per account. |
| **TrueCaller** (TR Software Scandinavia, SE) | 400M+ MAU, **dominant IN, strong MENA/Nigeria**; **weak RU/UA/EU** (EU numbers de-indexed since 2018) | **YES — Truecaller for Business + Premium Search API**, sales-gated, ~$1.5-5k/mo floor, ~$0.005-0.05/req | active, **the only legal alias-adjacent provider** | **cleanest in space**, SE-HQ + GDPR-compliant | REST/OAuth, trivial integration. **BUT** the alias-count field is mobile-only — API returns single canonical name + spam + carrier, not "saved 8 times as X". |
| **NumBuster** (HK, UA/RU roots) | ~50-80M users, CIS-tilted | none; "NumBuster Business" SKU dead since ~2022 | active app, **no maintained reverse-eng lib** | same GDPR analysis as GetContact, less enforcement | **Defer** — re-engineering cost > GetContact, coverage subset for our geos |
| **Sync.me** (IL) | ~50-80M, US+LATAM+IL | none since 2021 discontinuation | active app, **no maintained scrape** | same | **Skip** — not feasible in 2026 |
| **CallApp** (IL) | ~100M+ installs, IN/BR/IL strong, weak CIS/EU | none (marketing mentions B2B partnerships, no self-serve) | active app, no API on community-lib radar | same | **Skip** unless we specifically target IN/BR — TrueCaller better there anyway |

**Verdict for owner's UA-bias:** TrueCaller has wrong geo coverage (weak RU/UA); the only operational source of the genuine `[ALIAS]` UX for UA/CIS/TR numbers is **GetContact via unofficial reverse-engineered access**, accepted with ToS+GDPR risk.

### P2.B.2 — Other categories (NOT genuine `[ALIAS]`)

| Provider | Category | API self-serve | 2026 status | Notes |
|---|---|---|---|---|
| **Whitepages Pro / Ekata** (Mastercard) | `[WHITEPAGES]` (US registered name) | yes — Phone Intelligence API, $499/mo entry | active | US-only "real name behind a number". **Not** GetContact UX. |
| **Endato** | `[WHITEPAGES]` | yes, $99/mo entry | active | US public records + credit-header. Pure broker. |
| **Searchbug** | `[WHITEPAGES]` | yes, token-paid | active | Cheaper, US-only |
| **People Data Labs** | `[WHITEPAGES]`-derivative + LinkedIn graph | yes | active | B2B identity resolution; **no alias-from-contacts** |
| **tellows API** (DE) | `[SPAM-LABEL]` | yes, **€39/mo for 5k q** | active | **Easiest legal EU spam-DB**; recommended default spam tile |
| **Hiya / Mr. Number** | `[SPAM-LABEL]` only | no consumer API; Hiya Connect = enterprise telecom (STIR/SHAKEN) | active | Wrong category for our wow |
| **Should I Answer?** (CZ) | `[SPAM-LABEL]` | no API but scrape-friendly (`/phone-number/<E164>`) | active | EU CZ/SK badges |
| **800notes / CallerCenter / CallerSmart** | `[SPAM-LABEL]` | scrape-only | active | US community spam DBs, useful as US badge |
| **ukrnumbers.com** | `[SPAM-LABEL]` (UA) | scrape-only | active | UA-specific spam DB, ~tens of thousands pages |
| **OSINT Industries** | aggregator marketing claims `[ALIAS]` from leaks | yes, $39+/mo | active | **Marketing soft-sell** — verified output is leak-derived single-name, NOT alias counts |
| **Snusbase/LeakPeek/IntelX phone slice** | leak-derivative `[CNAM]` | yes paid | active | Returns leak-source name (single), not aliases-from-contacts |

### P2.B.3 — Creative tier (substitutes & sources nobody packages)

| # | Source | Signal | Feasibility | Legal/ethical |
|---|---|---|---|---|
| 1 | **Own Telegram bot with `contacts.importContacts`** (Telethon userbot fleet) | Self-claimed Telegram display name per phone (`[CNAM]`-equivalent) | Medium: SIM rotation + proxy + ~3-5 q/min throttle. **Still works May 2026.** | ToS-violating to industrialise; privacy setting "Find me by phone → Nobody" defeats it (default is "My Contacts" — most users) |
| 2 | **Bootstrap own contact-book corpus** ("share your phonebook to see who saved you") | True crowdsourced aliases, GDPR-clean if consent designed properly | Long horizon, needs 50k+ phonebooks before useful | **Cleanest long-term path** to a defensible alias dataset |
| 3 | **Facebook 533M (2021) leak** | `phone → FB profile name` (single canonical) | Available in breach forums / IntelX index | **Illegal to redistribute**; not the GetContact UX anyway |
| 4 | **LinkedIn 700M / WhatsApp 500M / Twitter 200M scrapes** | Same shape — single-owner-name | Available | Same legal posture |
| 5 | **TrueCaller 2019 leak (300M, partial)** | `phone → TC name + maybe alias` — only public leak with semi-`[ALIAS]` data | Forum-circulated, ambiguous provenance | Lawless |
| 6 | **GetContact 2020/2022 partial dumps (Turkish forums)** | True `[ALIAS]` data — partial geos | Findable in pieces | Lawless |
| 7 | **TG `mention search` via TGStat** (already in Part 1) | If phone appears in any public TG channel | Cheap, legal (public channels) | 🟢 clean tertiary signal |
| 8 | **Search-engine dorking** (`"+380501234567" site:vk.com OR site:facebook.com`) | Public mentions on indexed pages | Free, cheap | 🟢 the "lazy CTRL-F" — surprisingly effective for businesses |
| 9 | **Marketplace scraping (OLX, Avito, FB Marketplace)** | Sellers list phone + declared name + photo | Scraping required, mostly works | 🟢 clean for businesses, gray for individuals; **OLX UA is a real source for UA market** |
| 10 | **Viber/TikTok/Snap/IG "find by phone" oracles** | Self-claimed display name | Brittle, ToS-violating | 🔴 maintenance hell |
| 11 | **RU/UA "пробив" Telegram bot marketplace** (@glaz_bot etc.) | Real `[ALIAS]` + name + address + sometimes passport — sold cheap | Active 2026, cycle frequently | 🔴 **outright illegal data resale**, often RF-hosted/sanctioned — **hard skip** |

### P2.B.4 — Ranked 30-day implementation recommendation

**Tier A — legal & ship-in-30-days (no real `[ALIAS]`):**
1. Twilio Lookup v2 + CallerID Test (already in Part 1) — `[CNAM]` + SIM-swap + carrier
2. **tellows API €39/mo** — EU `[SPAM-LABEL]` tile
3. **ukrnumbers** scrape — UA `[SPAM-LABEL]` tile (small but UA-specific)
4. **Telegram userbot via Telethon** — `[CNAM]`-equivalent from self-claimed TG names (tertiary tile, ToS-gray, low traffic)
5. TrueCaller B2B — deferred until budget posture changes ($1.5-5k/mo floor over budget today)

**Tier B — accepts trade-offs:**
6. **Unofficial GetContact (community Python lib)** — feature-flagged, **geo-restricted to UA/CIS/TR**, framed as "community contributed unverified aliases (TR/CIS dataset)". ~$20-50/mo for 5-10 premium accounts + SIMs. ~2-5 days build + ~0.5-1 day/mo upkeep. **Only realistic path to GetContact wow at our budget.**
7. **Self-bootstrap contact-book corpus** — schema-design only in 30-day window; don't ship until consent flow + retention/deletion endpoint built

**Tier C — skip:**
8. NumBuster, Sync.me, CallApp, Eyecon (no maintained API/scrape)
9. Endato/PDL/Searchbug (broker names, not aliases)
10. Mr. Number / Should I Answer / 800notes (spam-only — already covered above)
11. Spy Dialer / NumLookup (CNAM derivatives, scrape-fragile)

### P2.B.5 — Required schema additions to `PROVIDERS.md`

If we adopt any of this:

- Add new sub-category `phone-aliases` (distinct from existing `phone` category — different data shape).
- Add taxonomy field `data_type ∈ {ALIAS, CNAM, WHITEPAGES, SPAM-LABEL}` to provider schema.
- Add new status level `planned-restricted` (= implemented but feature-flagged + geo-restricted + ToS-risky), distinct from existing `disabled`/`planned-stale`/`deferred`.
- Add `legal_zone ∈ {clean, regulated, tos-gray, lawless}` field.
- Document moderation pipeline for surfaced aliases (slur/defamation filter, deletion-request endpoint, audit log) — non-optional if `[ALIAS]` ships.

---

## § P2.C — Telegram public-channel mention search (extended)

> Part 1 had one TGStat row + Telemetrio. This expands to a full provider matrix, self-host feasibility, and the "find @handle mentions" answers.

### P2.C.1 — Provider comparison

| Service | Index claim | Mention search `@handle`? | Free tier | Paid tiers (2026) | API | UA/RU coverage | Flag |
|---|---|---|---|---|---|---|---|
| **TGStat .com** | ~3.2M channels, ~60-65B posts | yes (both `@durov` substring + `t.me/durov` link) | 500 req/mo | Bot $19/mo (5k req), Pro $99/mo (50k), Enterprise custom | REST, mature | **strong** (RU/UA native) | 🟢 **primary pick** |
| **TGStat .ru** | shared core index | yes | yes | RUB tiers ~₽1500-15000/mo | yes | RU-skewed UI | 🔴 **don't contract** — UA AML/sanctions exposure with `.ru` entity |
| **Telemetr.io** | ~1M+ channels analytics | partial — better at channel analytics than per-mention recall | 7-day trial | $39 / $99 / $249/mo (last public late 2024 — *unverified 2026*) | REST | strong UA + RU + global | 🟢 secondary |
| **Lyzem** | ~700M-1B msgs, ~2M channels | yes substring | free UI | none | **no API** — HTML scrape, ~10 req/s per IP before rate-limit | strong RU/UA, weak EN | 🟡 free fallback, no SLA |
| **Telegago** | Google CSE backed | yes — Google-indexed only (sparse) | free, ad-supported | none | **UI only** | whatever Google indexed | 🟡 spot-check tool |
| **Combot** | groups only (not channels), 100k+ via bot | no | free for group admins | custom B2B | per-group only | UA/RU active | 🟡 wrong shape |
| **Statorbot** | ~500k channels analytics | no | free | $5-10/mo pro | bot-only, no HTTP API | UA/RU | 🟡 metrics only |
| **Knowsy bot** | claims 4M channels | yes in DM | daily quota free | $10/mo pro | **bot-only, no API** | mixed | 🟡 not integratable |
| **Brand24 / Mention.com** | web+social listening | partial — Brand24 added "selected high-profile" TG Q4 2024 | trial only | $41-179 (Brand24), $49+ (Mention) | yes | **shallow TG coverage**, EN focus | 🔴 wrong tool for our case |
| **CyberRussia / forks** | RU-side TG indexer | yes — legally toxic | mixed | crypto pay-per-query | informal | RU only | 🔴 **OFAC + UA sanctions exposure** — don't integrate |

### P2.C.2 — TGStat API integration shape (the row to add)

```jsonc
// POST https://api.tgstat.com/posts/search?token=$KEY
// query: q="@durov" OR q="\"Pavel Durov\" OR \"Павел Дуров\" OR \"Павло Дуров\""
// filters: peer_type=channel, country=ua, language=uk, hide_forwards=1, start_date, end_date, limit=50

{
  "provider": "tgstat",
  "tier": "bot-$19",
  "query": { "kind": "handle", "value": "@durov" },
  "total_matches": 4821,
  "first_5_posts": [
    {
      "channel": "@opensource_ru",
      "subscribers": 28100,
      "category": "tech",
      "post_date": "2026-05-14T09:21:00Z",
      "views": 12504,
      "snippet": "...thanks @durov for landing the channel-search update...",
      "url": "https://t.me/opensource_ru/4521"
    }
  ],
  "by_country": { "ru": 3120, "ua": 412, "us": 280, "de": 180, "other": 829 },
  "by_language": { "ru": 3801, "en": 502, "uk": 261, "other": 257 },
  "freshness_lag_minutes_median": 12
}
```

**Operational notes:**
- One HTTP request = one quota unit (regardless of `limit`). Free 500/mo ≈ 25k post hits/mo at `limit=50`.
- 10k searches/mo @ consumer scale → Bot $19/mo minimum, Pro $99/mo realistic.
- **Cyrillic transliteration:** must query 2-3 spellings in parallel (`"Pavel Durov" OR "Павел Дуров" OR "Павло Дуров"`) and merge.
- `hide_forwards=1` essential — forwards inflate match count 5-10× with no extra signal.
- Per-language coverage (2024 figures, *unverified 2026*): RU 38%, EN 22%, UK 6%, FA 5%, AR 4%, ES 3%. **Best Cyrillic index in the market.**

### P2.C.3 — Self-host (Telethon fleet) feasibility

| Resource | Volume | Cost/mo |
|---|---|---|
| Phone numbers via sms-activate.org / 5sim | 4 active accounts × $0.30/SMS × ~2-3 re-verifications/yr | ~$2-5 amortised |
| Replacement numbers (banned/aged) | ~6-12/yr | ~$3-5 |
| Hetzner CX22 (4GB/2vCPU) for Telethon fleet | 1 | €5 |
| Postgres FTS local on CX22 (50GB raw text, top 10k channels) | included | €0-4 |
| Bandwidth (50GB initial + 5GB/mo delta) | within Hetzner included | €0 |
| Optional residential proxies | $10-30 | $0-30 |
| **Total realistic** | | **~$15-50/mo** |

**Realistic operating envelope (May 2026, synthesised from community reports):**
- 1 account ≈ 3-5k channels indexed (joined + history pulled).
- Top 10k UA/RU channels (by subscribers) → 3-4 accounts + staggered onboarding over 4-6 weeks.
- `JoinChannelRequest` rate-limit: ~50/day soft, ~200/day hard per account.
- `messages.GetHistory`: ~500 calls/min before FloodWait; bursts >2k in 10 min → 1-24h flood.
- Account lifespan: new numbers ~50-200 joins before flagging; warm numbers (>6mo personal use first) ~500-1500 joins, 6-12 months lifespan.

**Verdict:** **TGStat Pro $99/mo wins on TCO** below ~$200/mo budget. Self-host justifies only if: (a) we exceed $200/mo TGStat, (b) we need sub-minute real-time alerts TGStat doesn't deliver, or (c) we're forced off by ToS dispute.

### P2.C.4 — Library / self-host components

| Component | Use | Pick |
|---|---|---|
| **Telethon** (Python) | Userbot MTProto | 🟢 default (already aligned with `0008-python-osint-sidecar` ADR) |
| **tdlib** (C, official) | More stable, heavier (~150MB RAM per instance) | 🟡 fallback if Telethon ban-rate too high |
| **GramJS** (Node/TS) | Native NestJS fit, smaller community | 🟡 nice integration, weaker ecosystem |
| **Pyrogram** (Python) | Better ergonomics than Telethon | 🟡 backup; 2026 maintenance status uncertain |
| **MadelineProto** (PHP) | Most feature-complete | 🔴 not for us |
| **tg-archive** | Per-channel static archive + FTS | 🟢 for "archive N channels we care about" |
| **Telepathy** | Telethon-based OSINT toolkit | 🟢 reference implementation |
| `tgsearcher` / `tg-stat-clone` forks | Self-host TGStat-lite | 🔴 **no canonical 2026 repo** — search name exists, fork quality wildly variable; plan as "fork Telepathy + write 800-1500 LOC ourselves" |

### P2.C.5 — Phone-input mention search — privacy gate

Phone numbers in public channel text almost never match by accident — if it's there, it's likely a doxx/scam/leak. **Gate phone-input behind:** explicit "I confirm lawful basis" + per-IP rate limit + UA-only IP gate + audit log.

### P2.C.6 — Catalog rows to add

| Provider | Status (proposed) | Tier | Cost | Use |
|---|---|---|---|---|
| TGStat .com | `planned-p8b` | Bot $19/mo (5k req) | low | Primary @-mention / phrase search across public TG |
| Telethon self-host indexer | `planned-p8d-optional` | OSS | infra ~$15-50/mo | Fallback / specialised feature (real-time alerts, channels TGStat misses) |
| Lyzem | `reference-only` | scrape | $0 | Manual spot-check only |
| TGStat .ru | `do-not-use` | n/a | n/a | UA AML/sanctions exposure |

---

## § P2.D — Monetization in Ukraine (2026)

### P2.D.1 — Hard legal gates

**Закон України "Про захист персональних даних"** (#2297-VI, 2010, multiple amendments):

| Article | Effect for us |
|---|---|
| **Ст. 7 ч.5** | Republishing data the **subject made public themselves** is allowed without consent. Covers court-registry data, e-declarations, public TG posts. **Does NOT** cover third-party doxx or leaked DBs. |
| **Ст. 11** | "Legitimate interest" is the realistic basis for OSINT search; Ombudsman applies GDPR-analogue balancing test in practice. |
| **Ст. 14** | Subject has right to know/correct/delete → we need `/forget-me` flow. |
| **Ст. 16** | Sensitive categories (health, sex life, political views, race) need explicit consent — **avoid surfacing**. |
| **Ст. 28** | Fines ₴1.7-34k individuals / ₴17-170k LEs per violation. **Reputational + Ombudsman shutdown order is the bigger threat.** |

**Bill #8153 (GDPR-aligned new redaction)** — passed 1st reading mid-2024, 2nd reading delayed by wartime priorities. **Status May 2026 unverified.** Build product as if it'll pass 2026-2027 (DPIA, breach notice, DPA fining power up to €20M / 4% turnover, explicit balancing test). Side benefit: makes future EU expansion possible.

**Open-data legal anchor:** Law 1845-VIII + KMU Resolution 835 — published open data may be re-used commercially with citation. Covers ЄДР / ЄДРСР / NAZK / РНБО / e-data / Prozorro. Use this clause explicitly in our ToS.

### P2.D.2 — Liability matrix

| Pattern | 2297-VI exposure | Criminal | Practical risk |
|---|---|---|---|
| **Linking** to public source (we show snippet + link, no permanent storage beyond cache) | lowest — basically search engine | none | 🟢 lowest |
| **Aggregating** (one card from 5 sources, ephemeral) | medium — we're a controller | low | 🟡 manageable with notice + opt-out |
| **Republishing** (store and re-serve indefinitely) | high — full controller | medium if identifying | 🔴 needs documented basis per-subject |
| **Inferring / cross-linking** ("same person on 4 sites") | highest — derived personal data | possibly Art.182 ККУ (illegal collection of confidential info) if used for stalking | 🔴 **the wow-feature IS the risky-feature** |

**Stalking co-liability** under Ст.1167 ЦКУ ("moral damage") if subject is harmed by consumer using our data → defences: rate-limit per IP/subject, mandatory "scan yourself / lawful basis" gate, notice-and-opt-out, no home-address surfacing outside e-declarations, full audit log.

### P2.D.3 — Recommended posture lanes

| Posture | Legal risk | Audience | Comment |
|---|---|---|---|
| **B2B compliance / KYC** (lawyers, notaries, PI, banks) | 🟢 lowest — customer's own AML obligation under Law 361-IX = lawful basis | YouControl/vkursi/Clarity tier | viable from day 1 |
| **"Scan yourself" consumer** (Diia.Signature auth, user is data subject) | 🟢 lowest — consent is intrinsic | privacy-anxious consumers | viable from day 1; defensible monetisation via subscription |
| **Public-officials investigative tier** (PEPs only — MPs, judges, civil servants) | 🟢 low — subjects have statutory transparency duty | journalists + activists + general public | viable from day 1 |
| **Consumer "search-anyone"** | 🔴 highest — exactly what Bill #8153 is meant to constrain | mass-market | requires consent-prompt + DPIA + log + opt-out at minimum; **at least one UA people-search service shut down by Ombudsman 2024** (*specific actor unverified*) |

### P2.D.4 — Payment processors

**UA-only customers (UAH cards):**

| Provider | Fee | Setup | Recurring | API | Pick |
|---|---|---|---|---|---|
| **LiqPay** (Privatbank) | 2.5% + ₴1, recurring +1% | very easy | yes mature | REST + signed callbacks | 🟢 default — largest reach (Privat24 auto-fill) |
| **MonoPay** (mono.ua) | 2.0-2.5% + ₴1 negotiable | ridiculously easy if mono is your business bank | yes (newer) | gRPC + REST | 🟢 strong choice if Mono business |
| **Fondy** | 2.5-2.75% + ₴2 | easy | yes | best DX of UA gateways, EN docs | 🟢 second pick |
| **WayForPay** | 2.5-3% + ₴2 | easy | yes | decent | 🟡 fine alt |
| **Portmone / iPay / EasyPay** | 2.5-3% | medium | varies | older | 🟡 not for SaaS |

**Global (USD/EUR):**

| Provider | Take-rate | UA-merchant? | MoR? | UAH payout? | Pick |
|---|---|---|---|---|---|
| **Stripe direct** | 2.9% + $0.30 | **No** (UA still Atlas-only in 2026; *pilot late 2024, status fluid*) | no | — | 🔴/🟡 Atlas only |
| **Stripe Atlas (US LLC)** | + $500 setup + ~$200/yr | yes via LLC | no | USD wire | 🟡 viable, adds entity overhead |
| **Paddle (MoR)** | 5% + $0.50 | **yes, pays UA ФОП directly** | **yes** | USD/EUR wire to UA bank | 🟢 **best fit** |
| **Lemon Squeezy** (Stripe-owned 2024) | 5% + $0.50 | yes | yes | wire or Wise | 🟢 close second |
| **Polar.sh** | 4% + $0.40 | yes | yes | wire | 🟡 newest |
| **Gumroad** | 10% | yes | yes | — | 🔴 too expensive for SaaS |
| **2Checkout / FastSpring** | 4.5-6% / 5.9% + $0.95 | yes | yes | yes | 🟡 enterprise-leaning |
| **NOWPayments / Cryptomus** | 0.5-1.5% + spread | yes (no bank needed) | no | n/a (USDT) | 🟢 crypto fallback |
| **Direct USDT-TRC20 invoice + manual reconcile** | ~$1 tx | yes | no | n/a | 🟢 sanctions-resilient niche |

**Crypto in UA 2026:** ZU #2074-IX legalised "virtual assets" 2022; tax law #2179-IX was vetoed. Current state: individuals can hold/trade crypto; ФОП **cannot** declare crypto income directly — must convert to fiat first (Whitebit/EXMO-Pro UA → off-ramp to UAH card → declare as misc foreign-currency receipt). Draft "crypto-ФОП" law (#10225-1) in committee since late 2024. **Confirm with accountant before scaling.**

### P2.D.5 — Legal entity options

| Setup | Tax | Cap | Solo-fit | Pick |
|---|---|---|---|---|
| **ФОП 3 group (5%)** | 5% revenue + ЕСВ (~₴1.7-2k/mo) | **₴8.3M/yr (2025); 2026 cap unverified ~₴9-10M** | 🟢 ideal | 🟢 **default day-1** |
| **ФОП 3 group (3% + VAT)** | 3% + 20% VAT | same cap | OK if customers are VAT-registered businesses | 🟡 only if B2B-heavy |
| **ФОП загальна система** | 18% PIT + 1.5% mil + 22% ЕСВ on net | unlimited | OK | 🔴 worse than ФОП-3 until cap hit |
| **ТОВ regular** | 18% CIT + 9% dividend WHT + 1.5% mil | unlimited | no (overhead ₴3-10k/mo accounting) | 🟡 only at scale |
| **ТОВ simplified-3 (5%)** | 5% revenue | same cap | OK | 🟡 if liability shield needed over solo |
| **Diia.City ТОВ** | 9% CIT on **distributed** profit + 5% PIT on Diia-employee salaries + ЄСВ capped at min-wage | unlimited | **only at ≥9 specialists + ≥$200k rev** | 🔴 **overkill for solo** — migrate when hiring #2 |
| **Stripe Atlas (US LLC) + UA ФОП contractor** | US 0% if no ECI, ~$500/yr filing; UA 5% on contractor income | LLC unlimited | OK | 🟡 valid escape hatch |
| **Estonia OÜ via e-Residency + UA ФОП** | EE 0% retained, 20% distributions; UA 5% | unlimited | OK | 🟡 EU-customer optimised; useful as "shell on standby" |
| **Bulgaria EOOD** | 10% CIT + 5% dividend WHT | unlimited | no (relocation required) | 🔴 only if relocating |

### P2.D.6 — Currency control (НБУ wartime regime)

- **ФОП USD/EUR account** allowed at Monobank business, Privatbank business, Sense, ПУМБ.
- **Incoming wires from Paddle/LemonSqueezy/Stripe-Atlas** arrive as USD; auto-conversion paused since 2022 → you keep USD. **Unverified May 2026.**
- USD withdrawal to card cap: USD 100k/mo per ФОП per НБУ Постанова #18 wartime; **bumped to ~USD 400k/mo for ИТ-ФОП in 2023, unverified 2026**.
- **MoR workaround** (Paddle/LemonSqueezy) = invoice type "service provider for services rendered" = cleanest under НБУ rules for ФОП-3, no special licensing.

### P2.D.7 — Concrete day-1 minimal stack

For **UA-resident solo founder, $0-50/mo budget, UA-first → global**:

**Legal:**
- **ФОП 3 group, 5%**, КВЕД **62.01** (computer programming) + **63.99** (information service activities)
- ToS + Privacy Policy drafted UA-law-first, GDPR-aware (so Bill #8153 transition is free)
- Service limited to UA jurisdiction by ToS; EU/US allowed via Paddle MoR
- **Hard ToS exclusion:** no UA-citizen home address; no UA-mobilised-person tracking; no Russian/Belarusian users

**Banking:**
- **Monobank business** (UAH + USD ФОП accounts; fastest onboarding, best DX)
- Backup: Privatbank business account (LiqPay native + Privat24 reach)

**Payments:**
- LiqPay (UAH-card consumers) ~2.5%
- MonoPay (parallel, mono users prefer) ~2.0-2.5%
- Paddle as MoR (international USD/EUR) ~5%
- USDT TRC20 manual / NOWPayments (sanctions-resilient niche) ~1-1.5%

**Pricing v1 (hybrid credits + subscription):**

| Tier | Price | Contents |
|---|---|---|
| Free | ₴0 | 3 searches/mo, one wow data point per search, paywall on detail |
| Стартовий | **₴49** one-time | 10-search pack, 30 days |
| **Pro** | **₴199/mo (~$5)** | unlimited up to fair-use, full reports, mention-alerts |
| **B2B** | **₴1999/mo (~$50)** | API access, audit log, KYC'd, lawyer/PI segment |
| Global Pro | **$9/mo via Paddle** | equivalent of ₴199 |
| Global Agency | **$79/mo via Paddle** | equivalent of B2B |

**Net retention estimates** (60% Pro / 30% Стартовий / 10% B2B mix, blended ARPU ~₴280/mo):

| Scale | Gross | Fees | Tax (5%) | ЄСВ | Infra | **Net** |
|---|---|---|---|---|---|---|
| 100 paying | ₴28k/mo ($700) | ₴1k | ₴1.4k | ₴1.8k | ~₴3k ($75 — TGStat Bot, Hetzner) | **~₴20.8k/mo (~$520)** |
| 1,000 paying | ₴280k/mo ($7k) | ₴11k | ₴14k | ₴1.8k | ~₴8k ($200 — TGStat Pro) | **~₴245k/mo (~$6.1k)** |
| 10,000 paying | ₴2.8M/mo ($70k) | ₴110k | **CAP HIT** (~₴9M annual cap) | — | ~₴30k ($750) | requires ТОВ + Diia.City migration |

**ФОП-3 cap is reached at ~2,500 paying users (~₴8-10M/yr).** Plan ТОВ + Diia.City migration **before** crossing — accidental overage = whole-year reclassification to 18% + ЕСВ on net.

### P2.D.8 — Risks specific to UA OSINT monetization

- **Art.111 ККУ ("providing assistance to enemy"):** if UA-hosted service is used by RU agents to track UA citizens. **Mitigations:** geo-block RU/BY/IR/KP/SY at edge + payment-method layer + ToS clauses + audit log + don't allow phone-input search on UA numbers without ID verification.
- **СБУ informal interest:** dual-edged. Don't market to SBU; lawyer up if approached.
- **Subject-level harm via product:** single biggest reputational + regulatory bomb. See § P2.D.2 mitigations.
- **Owner mobilisation/conscription:** ФОП ≠ broń. Diia.City employee status MIGHT qualify for **ИТ-резерв** (sectoral deferral) but requires employer in registry + гіг-контракт + position on Мінцифри "critical IT" list. Solo ФОП = no auto-deferral. **Out of catalog scope, but interacts with entity choice.**

### P2.D.9 — Shell-on-standby (war-escalation hedge)

Maintain **Estonia OÜ** via e-Residency (~€300 setup + €500/yr) as **dormant standby entity**. If UA legal climate becomes hostile (strict Bill #8153 passes, or wartime OSINT classification tightens), migrate operating entity to OÜ in <30 days; UA ФОП becomes contractor of OÜ. **No data migration needed** (infra is EU-located per `0011-deployment-target.md`).

### P2.D.10 — ADRs to draft (next session)

- `docs/adr/0014-payments-stack.md` — LiqPay + MonoPay + Paddle + USDT, with Stripe-direct as future option
- `docs/adr/0015-jurisdiction-and-legal-posture.md` — ФОП-3, UA-first ToS, GDPR-ready architecture, geo-block list, Ombudsman-compliance posture, "scan yourself" framing as primary
- `docs/adr/0016-diia-city-deferred.md` — explicit deferral until ≥9 specialists / ≥$200k revenue

Note: previously `0012-no-auth-no-payments-phase1.md:50` referenced a future "0014 — Payment provider abstraction" slot — this is the moment to fill it.

---

## § P2.E — Custom UA parsers (cross-registry joins, 100-400 LOC each)

> All free-data, none exist as packaged products. Build on top of Part 1's parser convention.

| # | Parser | Input → Output | Wow | Risk | LOC | Notes |
|---|---|---|---|---|---|---|
| 9 | **ua-fio-graph** | `{fio, dob}` → `{companies_founded[], companies_inactive[], court_cases[], debts[], sanctions[], pep_status}` | 5 | 🟡 | ~350 | **The flagship UA query.** Joins ЄДР + ЄДРСР + ЄРБ + АСВП + `ua_nsdc` + PEP.org.ua + NAZK on normalised Cyrillic name + DOB. **Depends on parser #14 (name normaliser) — build that first.** |
| 10 | **fop-by-phone** | `{phone}` → `{fop:{rnokpp, name, taxes_paid_uah, kveds, vat_status, prozorro_wins[]}}` | 4 | 🟡 | ~150 | Many ФОПs publish their contact phone in ЄДР record. Inverse-index of EDR open-data CSV. Surprisingly few products do this. |
| 11 | **declaration-anomaly-detector** | `{official_fio}` → `{declared_assets[], anomalies:[{type:"vehicle_not_in_owner_records|income_vs_assets_ratio|spouse_business_undisclosed", details}]}` | 5 | 🟢 | ~400 | **"Judge gold mine"** parser. Pulls NAZK declaration, cross-checks with HSC vehicles slice + ЄДР spouse business + Prozorro contracts. Public-interest framing = low legal risk. |
| 12 | **court-hearing-aggregator** | `{fio}` → `{upcoming_hearings:[{date, court, case_no, judge, room}]}` | 4 | 🟡 | ~300 | No central API. Build per-court scraper (each appellate/local court publishes own HTML schedule). Combine with case-№ from ЄДРСР. |
| 13 | **edrpou-beneficial-graph** | `{edrpou}` → `{ownership_tree[], ubo_individuals[], red_flags:["circular_ownership","offshore_link_BVI","sanctioned_intermediary"]}` | 5 | 🟢 | ~300 | Walks ЄДР ownership graph (free CSV). YouControl/vkursi do this for €€€; 300-LOC OSS version achievable. |
| 14 | **cyrillic-name-normaliser** | `{input:"Іваненко І.І." OR "Иваненко Иван Иванович" OR "Ivanenko Ivan"}` → `{canonical:"Іваненко Іван Іванович", variants[], confidence:0.92}` | 3 | 🟢 | ~250 | **Critical infrastructure dependency.** Handles RU↔UA transliteration, KMU 55-2010 official transliteration, patronymic generation/stripping, initials expansion. **Build this first**, everything else depends. |
| 15 | **gov-spending-by-person** | `{fio}` → `{companies_owned[], gov_contracts[{tender_id, buyer, amount_uah, source:"prozorro|e-data"}], total_uah}` | 5 | 🟢 | ~250 | ФИО → companies (parser #9) → Prozorro OCDS by EDRPOU + e-data Spending by EDRPOU. **"Person earned X UAH from state"** — viral journalism framing. |
| 16 | **nazk-family-expander** | `{declarant_fio}` → `{family:[{fio, relation, own_declaration_exists, own_companies, own_court_cases}]}` | 4 | 🟢 | ~200 | NAZK declarations list family ФИО. Re-running parser #9 on each gives "family graph". |

---

## § P2.F — Required adjustments to existing docs

**If anything in Part 2 is adopted:**

- **PROVIDERS.md:**
  - Add category `ukraine-registries` with all P2.A entries
  - Add category `phone-aliases` (distinct from `phone`) with GetContact/TrueCaller/NumBuster rows
  - Add taxonomy `data_type ∈ {ALIAS, CNAM, WHITEPAGES, SPAM-LABEL}` to provider schema
  - Add status `planned-restricted` (feature-flagged + geo-restricted + ToS-risky) — separate from existing `disabled`/`planned-stale`/`deferred`
  - Add `legal_zone ∈ {clean, regulated, tos-gray, lawless}` field
  - Add new top-level section "Payments & Monetisation" (or split into `docs/MONETISATION.md`) with LiqPay/MonoPay/Paddle/NOWPayments rows tagged `monetisation` not `data`

- **AGENT_PLAN.md:**
  - Insert **P8b-UA** sub-phase: ua-fio-graph parser (#9) + NAZK declarations + ЄДР reverse-lookup + OpenSanctions `ua_nsdc` + Cyrillic name-normaliser (#14)
  - Insert **P8c-UA** sub-phase: court-hearing-aggregator + declaration-anomaly-detector + edrpou-beneficial-graph + gov-spending-by-person
  - Insert **P9 — Payments & Auth** phase (LiqPay + MonoPay + Paddle + ToS/Privacy + Diia.Signature for "scan yourself")
  - Mark **P11 deployment** as still deferred per `[Hard rules]` memory

- **ADRs to draft:**
  - `0014-payments-stack.md`
  - `0015-jurisdiction-and-legal-posture.md`
  - `0016-diia-city-deferred.md`
  - Possibly `0017-getcontact-restricted-tier.md` if owner says yes to § Open decision #6 option (b)

---

## § P2.G — Honest unverified flags (consolidated)

Material claims to re-verify before committing budget:

- **TGStat .com / .ru shared-index status May 2026** — assumed yes (last verified mid-2024)
- **TGStat 2026 pricing exact figures** — assumed Bot $19 / Pro $99 (last verified late 2024)
- **Telemetr.io 2026 pricing tiers** — last public late 2024
- **Telethon shadow-ban thresholds May 2026** — community-report synthesis through 2025, not Telegram-confirmed
- **GetContact reverse-eng community-lib status May 2026** — Lirikon rotates AES signing schemes quarterly; assume any fork is 1-14 days from breakage
- **TrueCaller for Business pricing** — sales-gated, $1.5-5k/mo floor estimated from comparable indie reports
- **OpenDataBot enterprise pricing** beyond published 270 UAH/mo Pro — sales-gated; assumed range 5-50k UAH/mo
- **YouScore / vkursi pricing** — both sales-led
- **NAZK declarations public API rate limits / auth** May 2026 — documented as public, exact quotas unsurfaced; direct GET test before commit
- **ЄДРСР anti-bot challenge specifics** May 2026 — site is live, protection layer may break naive scraping; OpenDataBot mirror is the safe path
- **PEP.org.ua programmatic access** — Data Ocean named partner, pricing/spec unsurfaced
- **HSC slice "plate → owner"** in OpenDataBot premium tier — pre-2022 coverage existed; post-war redaction extent unverified
- **UA Bill #8153 status** May 2026 — last known stuck in 2nd reading delays
- **UA ФОП-3 annual revenue cap for 2026** — ₴8.3M was 2025 figure, indexed to minimum wage; assume ~₴9-10M
- **НБУ Постанова #18 wartime currency-control thresholds** May 2026 — last bumped 2023, periodic adjustments
- **Stripe-direct support for UA-resident merchants** May 2026 — pilot late 2024, status fluid
- **Specific UA people-search service shut down by Ombudsman 2024** — reports exist, exact actor not verified
- **Conscription/mobilisation rules for ФОП vs Diia.City employees** May 2026 — highly fluid since 2022; consult current legal advisor before relying on for personal status
