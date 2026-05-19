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

from app.maigret_runner import DEFAULT_TIMEOUT_S as MAIGRET_DEFAULT_TIMEOUT_S
from app.maigret_runner import MaigretEvent, run_maigret
from app.phonenumbers_runner import run_phonenumbers
from app.sherlock_runner import DEFAULT_TIMEOUT_S, SherlockEvent, run_sherlock
from app.socialscan_runner import DEFAULT_TIMEOUT_S as SOCIALSCAN_DEFAULT_TIMEOUT_S
from app.socialscan_runner import SocialscanEvent, run_socialscan

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


class PhonenumbersQuery(BaseModel):
    phone: str = Field(min_length=1, max_length=PHONE_MAX_LEN)


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
