# OSINT Providers — Extended Catalog Research (2026-05-18)

> **Status:** research artifact, NOT a binding plan. Captures the output of a 3-agent parallel research pass plus session context. Read this tomorrow, decide on the open questions at the top, then we update `docs/PROVIDERS.md` and `docs/AGENT_PLAN.md` accordingly.

## How to pick up tomorrow

1. Read **§ Open decisions** below — 4 questions block extended-P8 scoping.
2. Skim **§ Top 10 wow moments** — that's the product-shaping axis.
3. Skim **§ Synthesis by user-facing category** to see what we'd add.
4. Read **§ Proposed P8 phasing** — there's a multi-phase split waiting for go/no-go.
5. The **§ Appendix — full agent reports** has the raw research if you want to dig deeper.

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
