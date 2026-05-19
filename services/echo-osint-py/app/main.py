"""FastAPI entrypoint for the echo OSINT Python sidecar.

Exposes:

- `GET /health`            — liveness probe used by docker-compose and the
                              api readiness check.
- `GET /info`              — provider catalog the sidecar can serve.
- `POST /providers/sherlock/run`
                            — text/event-stream of per-site results;
                              honours client disconnect.

Each request that streams cancels its child subprocess on disconnect by
letting the StreamingResponse drive generator teardown (`aclose()` then
`finally` cleanup in `sherlock_runner.run_sherlock`).
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator

import anyio
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.ghunt_runner import DEFAULT_TIMEOUT_S as GHUNT_DEFAULT_TIMEOUT_S
from app.ghunt_runner import run_ghunt_email
from app.ignorant_runner import DEFAULT_TIMEOUT_S as IGNORANT_DEFAULT_TIMEOUT_S
from app.ignorant_runner import IgnorantEvent, run_ignorant
from app.maigret_runner import DEFAULT_TIMEOUT_S as MAIGRET_DEFAULT_TIMEOUT_S
from app.maigret_runner import MaigretEvent, run_maigret
from app.phoneinfoga_runner import DEFAULT_TIMEOUT_S as PHONEINFOGA_DEFAULT_TIMEOUT_S
from app.phoneinfoga_runner import run_phoneinfoga
from app.phonenumbers_runner import run_phonenumbers
from app.sherlock_runner import DEFAULT_TIMEOUT_S, SherlockEvent, run_sherlock
from app.socialscan_runner import DEFAULT_TIMEOUT_S as SOCIALSCAN_DEFAULT_TIMEOUT_S
from app.socialscan_runner import SocialscanEvent, run_socialscan
from app.socid_extractor_runner import DEFAULT_TIMEOUT_S as SOCID_EXTRACTOR_DEFAULT_TIMEOUT_S
from app.socid_extractor_runner import run_socid_extractor
from app.telegram_runner import DEFAULT_TIMEOUT_S as TELEGRAM_DEFAULT_TIMEOUT_S
from app.telegram_runner import run_telegram_resolve
from app.truecaller_runner import DEFAULT_TIMEOUT_S as TRUECALLER_DEFAULT_TIMEOUT_S
from app.truecaller_runner import run_truecaller

logger = logging.getLogger("echo.main")

# E.164 max length is 15 digits + leading `+`. Accept slightly wider so
# users can paste numbers with spaces/dashes and let libphonenumber
# normalise. Hard upper bound prevents abuse.
PHONE_MAX_LEN = 32

SIDECAR_VERSION = "0.0.0"
# Same character class echo's @echo/providers/sherlock inputSchema uses.
# Mirrored here so the sidecar can reject obviously malformed input fast
# without trusting the caller did it.
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,50}$")


class ProviderInfo(BaseModel):
    id: str
    category: str
    description: str


class SidecarInfo(BaseModel):
    sidecar: str = "echo-osint-py"
    version: str = SIDECAR_VERSION
    providers: list[ProviderInfo]


class SherlockQuery(BaseModel):
    username: str = Field(min_length=1, max_length=50)


class MaigretQuery(BaseModel):
    username: str = Field(min_length=1, max_length=50)


class SocialscanQuery(BaseModel):
    # socialscan accepts a mixed list of usernames + emails; the API
    # caller is responsible for pre-validating both forms.
    queries: list[str] = Field(min_length=1, max_length=10)


class SocidExtractorQuery(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class IgnorantQuery(BaseModel):
    # Country dialling code WITHOUT the leading `+` (ignorant's positional convention).
    country_code: str = Field(min_length=1, max_length=4, pattern=r"^\d+$")
    # National-significant number digits only (no `+`, no spaces).
    phone: str = Field(min_length=4, max_length=15, pattern=r"^\d+$")


class GhuntEmailQuery(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class GhuntEmailResponse(BaseModel):
    configured: bool
    found: bool
    name: str | None = None
    gaia_id: str | None = None
    profile_picture: str | None = None
    cover_photo: str | None = None
    emails: list[str] = []
    reviews_count: int | None = None
    maps_contributions: int | None = None
    calendar_visible: bool | None = None
    error: str | None = None


class SocidExtractorResponse(BaseModel):
    found: bool
    url: str
    fields: dict[str, object]
    error: str | None


class PhonenumbersQuery(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LEN)


class PhoneinfogaQuery(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LEN)


class PhoneinfogaLocalScanner(BaseModel):
    valid: bool
    country: str
    country_code: str
    carrier: str
    line_type: str


class PhoneinfogaResponse(BaseModel):
    local_scanner: PhoneinfogaLocalScanner | None
    google_dorks: list[str]
    error: str | None


class TelegramResolveQuery(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LEN)


class TelegramResolveResponse(BaseModel):
    configured: bool
    found_on_telegram: bool
    user_id: int | None = None
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    about: str | None = None
    status: str | None = None
    is_premium: bool | None = None
    is_bot: bool | None = None
    is_verified: bool | None = None
    is_scam: bool | None = None
    is_fake: bool | None = None
    photo_url: str | None = None
    error: str | None = None


class TruecallerQuery(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LEN)
    country_code: str | None = Field(default=None, max_length=8)


class TruecallerAddressResponse(BaseModel):
    city: str
    country_code: str
    address: str


class TruecallerSpamResponse(BaseModel):
    spam_score: int
    spam_type: str | None


class TruecallerResponse(BaseModel):
    configured: bool
    found: bool
    name: str | None = None
    alt_name: str | None = None
    image_url: str | None = None
    gender: str | None = None
    addresses: list[TruecallerAddressResponse] = []
    emails: list[str] = []
    tags: list[str] = []
    spam_info: TruecallerSpamResponse | None = None
    score: float | None = None
    access: str | None = None
    enhanced: bool | None = None
    error: str | None = None


class PhonenumbersResponse(BaseModel):
    valid: bool
    possible: bool
    e164: str | None
    national_format: str | None
    international_format: str | None
    country_code: int | None
    region_code: str | None
    number_type: str
    carrier_name: str
    geocoded_location: str
    timezones: list[str]
    parse_error: str | None


app = FastAPI(title="echo-osint-py", version=SIDECAR_VERSION)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/info", response_model=SidecarInfo)
def info() -> SidecarInfo:
    return SidecarInfo(
        providers=[
            ProviderInfo(
                id="sherlock",
                category="username",
                description="Username hunting across hundreds of social platforms (sherlock-project).",
            ),
            ProviderInfo(
                id="phonenumbers",
                category="phone",
                description="Phone number validation + region/carrier/type metadata (libphonenumber).",
            ),
            ProviderInfo(
                id="maigret",
                category="username",
                description="Username hunting across ~3000 sites — broader corpus than Sherlock.",
            ),
            ProviderInfo(
                id="socialscan",
                category="username",
                description="Username/email availability check across ~10 social platforms.",
            ),
            ProviderInfo(
                id="phoneinfoga",
                category="phone",
                description="Phone scanner — Go CLI, returns local-scanner metadata + Google dorks.",
            ),
            ProviderInfo(
                id="telegram-resolve",
                category="phone",
                description="Telegram MTProto phone→profile resolver — env-conditional (Telethon).",
            ),
            ProviderInfo(
                id="truecaller",
                category="phone",
                description="Truecaller phone→identity lookup — env-conditional (truecallerpy).",
            ),
            ProviderInfo(
                id="socid-extractor",
                category="username",
                description="URL → site-specific IDs (~130 methods, post-processor for Sherlock/Maigret).",
            ),
            ProviderInfo(
                id="ignorant",
                category="phone",
                description="Phone → social presence on Instagram / Snapchat / Amazon (Megadose).",
            ),
            ProviderInfo(
                id="ghunt",
                category="email",
                description="Email → Google profile / Maps reviews — env-conditional (GHunt, AGPL subprocess).",
            ),
        ],
    )


@app.post("/providers/sherlock/run")
async def sherlock_run(
    body: SherlockQuery,
    timeout_s: float = Query(default=DEFAULT_TIMEOUT_S, gt=0, le=300),
) -> StreamingResponse:
    if not USERNAME_RE.match(body.username):
        raise HTTPException(
            status_code=422,
            detail={"error": "InvalidUsername", "expected": USERNAME_RE.pattern},
        )

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in run_sherlock(body.username, timeout_s=timeout_s):
                yield _to_sse(event)
                # Yield control so StreamingResponse can observe a client
                # disconnect between events. Without this, a fast inner
                # generator can starve cancellation for the full run.
                await anyio.sleep(0)
        except Exception as err:  # noqa: BLE001 — surface unexpected runner errors
            logger.exception("sherlock runner crashed")
            yield _to_sse(SherlockEvent(kind="error", message=str(err)))

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        # Disable proxy buffering (matches the Node SSE controller).
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)


@app.post("/providers/maigret/run")
async def maigret_run(
    body: MaigretQuery,
    timeout_s: float = Query(default=MAIGRET_DEFAULT_TIMEOUT_S, gt=0, le=600),
) -> StreamingResponse:
    if not USERNAME_RE.match(body.username):
        raise HTTPException(
            status_code=422,
            detail={"error": "InvalidUsername", "expected": USERNAME_RE.pattern},
        )

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in run_maigret(body.username, timeout_s=timeout_s):
                yield _to_sse(event)
                await anyio.sleep(0)
        except Exception as err:  # noqa: BLE001 — surface unexpected runner errors
            logger.exception("maigret runner crashed")
            yield _to_sse(MaigretEvent(kind="error", message=str(err)))

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)


@app.post("/providers/socialscan/run")
async def socialscan_run(
    body: SocialscanQuery,
    timeout_s: float = Query(default=SOCIALSCAN_DEFAULT_TIMEOUT_S, gt=0, le=300),
) -> StreamingResponse:
    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in run_socialscan(body.queries, timeout_s=timeout_s):
                yield _socialscan_to_sse(event)
                await anyio.sleep(0)
        except Exception as err:  # noqa: BLE001
            logger.exception("socialscan runner crashed")
            yield _socialscan_to_sse(SocialscanEvent(kind="error", message=str(err)))

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)


@app.post("/providers/phoneinfoga/run", response_model=PhoneinfogaResponse)
async def phoneinfoga_run(
    body: PhoneinfogaQuery,
    timeout_s: float = Query(default=PHONEINFOGA_DEFAULT_TIMEOUT_S, gt=0, le=120),
) -> PhoneinfogaResponse:
    """Subprocess-based phoneinfoga lookup.

    Returns a synchronous JSON shape (not SSE) — the scan completes in
    1-3s and a single Final on the TS side is fine. `error` is
    non-null on subprocess/parse failures; the route still returns 200
    so the caller surfaces the failure as a Final, not an HTTP error.
    """

    result = await run_phoneinfoga(body.phone, timeout_s=timeout_s)
    local = result.local_scanner
    return PhoneinfogaResponse(
        local_scanner=(
            PhoneinfogaLocalScanner(
                valid=local.valid,
                country=local.country,
                country_code=local.country_code,
                carrier=local.carrier,
                line_type=local.line_type,
            )
            if local is not None
            else None
        ),
        google_dorks=result.google_dorks,
        error=result.error,
    )


@app.post("/providers/phonenumbers/run", response_model=PhonenumbersResponse)
def phonenumbers_run(body: PhonenumbersQuery) -> PhonenumbersResponse:
    """Synchronous in-process libphonenumber lookup.

    Returns 200 in both valid and invalid cases — `valid: false` is a
    legitimate result the UI surfaces. Only catastrophic library bugs
    surface as 500s (handled by FastAPI default).
    """

    result = run_phonenumbers(body.phone)
    return PhonenumbersResponse(
        valid=result.valid,
        possible=result.possible,
        e164=result.e164,
        national_format=result.national_format,
        international_format=result.international_format,
        country_code=result.country_code,
        region_code=result.region_code,
        number_type=result.number_type,
        carrier_name=result.carrier_name,
        geocoded_location=result.geocoded_location,
        timezones=result.timezones,
        parse_error=result.parse_error,
    )


@app.post("/providers/ghunt/run", response_model=GhuntEmailResponse)
async def ghunt_run(
    body: GhuntEmailQuery,
    timeout_s: float = Query(default=GHUNT_DEFAULT_TIMEOUT_S, gt=0, le=180),
) -> GhuntEmailResponse:
    """Run `ghunt email <email>` and return the normalised JSON profile.

    Env-conditional — when `GHUNT_CREDS_PATH` isn't set / the file is
    missing, returns `configured=false` with an instructive error
    rather than spawning a useless subprocess.
    """

    result = await run_ghunt_email(body.email, timeout_s=timeout_s)
    return GhuntEmailResponse(
        configured=result.configured,
        found=result.found,
        name=result.name,
        gaia_id=result.gaia_id,
        profile_picture=result.profile_picture,
        cover_photo=result.cover_photo,
        emails=result.emails,
        reviews_count=result.reviews_count,
        maps_contributions=result.maps_contributions,
        calendar_visible=result.calendar_visible,
        error=result.error,
    )


@app.post("/providers/ignorant/run")
async def ignorant_run(
    body: IgnorantQuery,
    timeout_s: float = Query(default=IGNORANT_DEFAULT_TIMEOUT_S, gt=0, le=120),
) -> StreamingResponse:
    """Run ignorant on the given phone and stream per-platform events as SSE."""

    async def stream() -> AsyncIterator[bytes]:
        try:
            async for event in run_ignorant(body.phone, body.country_code, timeout_s=timeout_s):
                yield _ignorant_to_sse(event)
                await anyio.sleep(0)
        except Exception as err:  # noqa: BLE001
            logger.exception("ignorant runner crashed")
            yield _ignorant_to_sse(IgnorantEvent(kind="error", message=str(err)))

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)


@app.post("/providers/socid-extractor/run", response_model=SocidExtractorResponse)
async def socid_extractor_run(
    body: SocidExtractorQuery,
    timeout_s: float = Query(default=SOCID_EXTRACTOR_DEFAULT_TIMEOUT_S, gt=0, le=60),
) -> SocidExtractorResponse:
    """URL → site-specific IDs via socid_extractor.

    Synchronous JSON shape — the extractor is one-shot (fetch + parse,
    ~1-3s total). Network or parser failures land in `error` rather than
    throwing 5xx; the consumer surfaces them as a Final with no
    extracted fields.
    """

    result = await run_socid_extractor(body.url, timeout_s=timeout_s)
    return SocidExtractorResponse(
        found=result.found,
        url=result.url,
        fields=dict(result.fields),
        error=result.error,
    )


def _ignorant_to_sse(event: IgnorantEvent) -> bytes:
    """Serialize one IgnorantEvent as an SSE `data:` frame.

    Drops `None` fields so the wire payload stays compact and the Node
    consumer can rely on a stable shape per `kind`.
    """

    payload: dict[str, object] = {"kind": event.kind}
    if event.phone is not None:
        payload["phone"] = event.phone
    if event.platform is not None:
        payload["platform"] = event.platform
    if event.domain is not None:
        payload["domain"] = event.domain
    if event.method is not None:
        payload["method"] = event.method
    if event.exists is not None:
        payload["exists"] = event.exists
    if event.rate_limit is not None:
        payload["rate_limit"] = event.rate_limit
    if event.frequent_rate_limit is not None:
        payload["frequent_rate_limit"] = event.frequent_rate_limit
    if event.checked is not None:
        payload["checked"] = event.checked
    if event.message is not None:
        payload["message"] = event.message
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()


def _socialscan_to_sse(event: SocialscanEvent) -> bytes:
    """Serialize one SocialscanEvent as an SSE `data:` frame.

    socialscan events carry an extra per-platform shape (available /
    valid / success booleans) the Sherlock/Maigret helper doesn't know
    about, so this one stays separate.
    """

    payload: dict[str, object] = {"kind": event.kind}
    if event.query is not None:
        payload["query"] = event.query
    if event.platform is not None:
        payload["platform"] = event.platform
    if event.available is not None:
        payload["available"] = event.available
    if event.valid is not None:
        payload["valid"] = event.valid
    if event.success is not None:
        payload["success"] = event.success
    if event.message is not None:
        payload["message"] = event.message
    if event.checked is not None:
        payload["checked"] = event.checked
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()


@app.post("/providers/telegram-resolve/run", response_model=TelegramResolveResponse)
async def telegram_resolve_run(
    body: TelegramResolveQuery,
    timeout_s: float = Query(default=TELEGRAM_DEFAULT_TIMEOUT_S, gt=0, le=120),
) -> TelegramResolveResponse:
    """Resolve a phone to a Telegram profile. Env-conditional.

    Returns 200 in all paths — the `configured` + `error` fields
    communicate "not provisioned" vs real Telethon failures.
    """

    result = await run_telegram_resolve(body.phone, timeout_s=timeout_s)
    return TelegramResolveResponse(
        configured=result.configured,
        found_on_telegram=result.found_on_telegram,
        user_id=result.user_id,
        username=result.username,
        first_name=result.first_name,
        last_name=result.last_name,
        about=result.about,
        status=result.status,
        is_premium=result.is_premium,
        is_bot=result.is_bot,
        is_verified=result.is_verified,
        is_scam=result.is_scam,
        is_fake=result.is_fake,
        photo_url=result.photo_url,
        error=result.error,
    )


@app.post("/providers/truecaller/run", response_model=TruecallerResponse)
async def truecaller_run(
    body: TruecallerQuery,
    timeout_s: float = Query(default=TRUECALLER_DEFAULT_TIMEOUT_S, gt=0, le=60),
) -> TruecallerResponse:
    """Truecaller phone→identity lookup. Env-conditional."""

    result = await run_truecaller(body.phone, body.country_code, timeout_s=timeout_s)
    return TruecallerResponse(
        configured=result.configured,
        found=result.found,
        name=result.name,
        alt_name=result.alt_name,
        image_url=result.image_url,
        gender=result.gender,
        addresses=[
            TruecallerAddressResponse(
                city=a.city, country_code=a.country_code, address=a.address
            )
            for a in result.addresses
        ],
        emails=result.emails,
        tags=result.tags,
        spam_info=(
            TruecallerSpamResponse(
                spam_score=result.spam_info.spam_score,
                spam_type=result.spam_info.spam_type,
            )
            if result.spam_info is not None
            else None
        ),
        score=result.score,
        access=result.access,
        enhanced=result.enhanced,
        error=result.error,
    )


def _to_sse(event: SherlockEvent | MaigretEvent) -> bytes:
    """Serialize one Sherlock/Maigret event as an SSE `data:` frame.

    Both runner event types share the same field shape (kind/site/url/
    username/checked/message). Drops `None` fields so the wire payload
    stays compact and the Node consumer can rely on a stable shape per
    `kind`.
    """

    payload: dict[str, object] = {"kind": event.kind}
    if event.site is not None:
        payload["site"] = event.site
    if event.url is not None:
        payload["url"] = event.url
    if event.username is not None:
        payload["username"] = event.username
    if event.checked is not None:
        payload["checked"] = event.checked
    if event.message is not None:
        payload["message"] = event.message
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()


@app.exception_handler(HTTPException)
def http_exception_handler(_request: object, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"error": exc.detail}
    return JSONResponse(status_code=exc.status_code, content=detail)
