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

from app.sherlock_runner import DEFAULT_TIMEOUT_S, SherlockEvent, run_sherlock

logger = logging.getLogger("echo.main")

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


def _to_sse(event: SherlockEvent) -> bytes:
    """Serialize one SherlockEvent as an SSE `data:` frame.

    Drops `None` fields so the wire payload stays compact and the Node
    consumer can rely on a stable shape per `kind`.
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
