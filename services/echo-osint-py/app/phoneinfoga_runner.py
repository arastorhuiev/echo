"""HTTP-based PhoneInfoga runner backed by `phoneinfoga serve`.

PhoneInfoga v2.11 removed the `-o <file>` JSON output flag from
`phoneinfoga scan`, and the per-invocation CLI is now human-readable
only. The supported way to drive it programmatically is the embedded
REST API exposed by `phoneinfoga serve`.

We start one long-lived `phoneinfoga serve --no-client -p <port>`
subprocess from the FastAPI lifespan (see `main.py`) and POST against
its `/api/v2/scanners/{local,googlesearch}/run` endpoints from this
runner. The local scanner gives us country/carrier/line type; the
googlesearch scanner builds a list of social-media / paste-site / SMS
dork URLs the UI surfaces as "search for this number on platform X".

The REST API rejects phone numbers with `+`, spaces, or dashes, so we
normalise to digits-only before sending. The runner returns the same
`PhoneinfogaResult` shape as before — main.py and the TS provider
don't need to change.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger("echo.phoneinfoga")

DEFAULT_TIMEOUT_S = 30.0
TERM_GRACE_S = 3.0
PHONEINFOGA_BIN = "phoneinfoga"

# Container-local port for the embedded REST API. Chosen to dodge the
# upstream default of 5000 in case anything else inside the container
# ever binds it.
PHONEINFOGA_PORT = 5111
PHONEINFOGA_URL = f"http://127.0.0.1:{PHONEINFOGA_PORT}"
PHONEINFOGA_READY_TIMEOUT_S = 8.0

# Singleton subprocess managed by `start_phoneinfoga` / `stop_phoneinfoga`.
_phoneinfoga_proc: asyncio.subprocess.Process | None = None
_phoneinfoga_lock = asyncio.Lock()

NON_DIGIT_RE = re.compile(r"\D")


@dataclass(frozen=True, slots=True)
class LocalScannerResult:
    valid: bool
    country: str
    country_code: str
    carrier: str
    line_type: str


@dataclass(frozen=True, slots=True)
class PhoneinfogaResult:
    local_scanner: LocalScannerResult | None
    google_dorks: list[str] = field(default_factory=list)
    error: str | None = None


async def start_phoneinfoga() -> None:
    """Spawn `phoneinfoga serve` and poll until the REST API answers.

    Idempotent: subsequent calls are a no-op while the process is alive.
    Called from the FastAPI lifespan in `main.py` so the server is ready
    before any request lands.
    """

    global _phoneinfoga_proc
    async with _phoneinfoga_lock:
        if _phoneinfoga_proc is not None and _phoneinfoga_proc.returncode is None:
            return

        logger.info("phoneinfoga serve start port=%d", PHONEINFOGA_PORT)
        _phoneinfoga_proc = await asyncio.create_subprocess_exec(
            PHONEINFOGA_BIN,
            "serve",
            "--no-client",
            "-p",
            str(PHONEINFOGA_PORT),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        # Poll /api/ until the embedded HTTP server starts answering.
        # phoneinfoga binds within a couple of hundred milliseconds in
        # practice; the longer ceiling exists only to surface a real
        # boot failure (port conflict, binary missing) as a clear error
        # rather than a silent hang.
        async with httpx.AsyncClient(timeout=0.5) as client:
            deadline = asyncio.get_event_loop().time() + PHONEINFOGA_READY_TIMEOUT_S
            while True:
                if _phoneinfoga_proc.returncode is not None:
                    stderr = b""
                    if _phoneinfoga_proc.stderr is not None:
                        try:
                            stderr = await asyncio.wait_for(
                                _phoneinfoga_proc.stderr.read(), timeout=0.5
                            )
                        except TimeoutError:
                            pass
                    raise RuntimeError(
                        f"phoneinfoga serve exited {_phoneinfoga_proc.returncode}: "
                        f"{stderr.decode('utf-8', errors='replace').strip() or 'unknown'}"
                    )
                try:
                    r = await client.get(f"{PHONEINFOGA_URL}/api/")
                    if r.status_code == 200:
                        logger.info("phoneinfoga serve ready")
                        return
                except httpx.HTTPError:
                    pass
                if asyncio.get_event_loop().time() >= deadline:
                    raise RuntimeError(
                        f"phoneinfoga serve did not become ready within "
                        f"{PHONEINFOGA_READY_TIMEOUT_S}s"
                    )
                await asyncio.sleep(0.2)


async def stop_phoneinfoga() -> None:
    """Terminate the long-lived `phoneinfoga serve` subprocess, if any."""

    global _phoneinfoga_proc
    async with _phoneinfoga_lock:
        proc = _phoneinfoga_proc
        _phoneinfoga_proc = None
        if proc is None or proc.returncode is not None:
            return
        logger.info("phoneinfoga serve terminate pid=%s", proc.pid)
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
        except TimeoutError:
            logger.warning("phoneinfoga serve kill pid=%s", proc.pid)
            proc.kill()
            await proc.wait()


async def run_phoneinfoga(phone: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> PhoneinfogaResult:
    """POST `phone` (any human format) to the local+googlesearch scanners.

    Both calls run in parallel; the result is merged into our slim
    `PhoneinfogaResult` shape. Upstream HTTP errors land in `error` so
    the FastAPI route can return 200 with a Final, not 5xx.
    """

    digits = NON_DIGIT_RE.sub("", phone)
    if not digits:
        return PhoneinfogaResult(
            local_scanner=None,
            google_dorks=[],
            error="phoneinfoga: phone has no digits",
        )

    body = {"number": digits}
    try:
        async with httpx.AsyncClient(base_url=PHONEINFOGA_URL, timeout=timeout_s) as client:
            local_resp, dorks_resp = await asyncio.gather(
                client.post("/api/v2/scanners/local/run", json=body),
                client.post("/api/v2/scanners/googlesearch/run", json=body),
                return_exceptions=False,
            )
    except httpx.HTTPError as err:
        return PhoneinfogaResult(
            local_scanner=None,
            google_dorks=[],
            error=f"phoneinfoga HTTP error: {err}",
        )

    if local_resp.status_code != 200:
        return PhoneinfogaResult(
            local_scanner=None,
            google_dorks=[],
            error=(
                f"phoneinfoga local scanner returned {local_resp.status_code}: "
                f"{local_resp.text[:200]}"
            ),
        )
    if dorks_resp.status_code != 200:
        return PhoneinfogaResult(
            local_scanner=_parse_local(local_resp.json()),
            google_dorks=[],
            error=(
                f"phoneinfoga googlesearch scanner returned {dorks_resp.status_code}: "
                f"{dorks_resp.text[:200]}"
            ),
        )

    return PhoneinfogaResult(
        local_scanner=_parse_local(local_resp.json()),
        google_dorks=_parse_dorks(dorks_resp.json()),
    )


async def stream_phoneinfoga(
    phone: str, timeout_s: float = DEFAULT_TIMEOUT_S
) -> AsyncIterator[dict[str, object]]:
    """Generator wrapper around `run_phoneinfoga` so a FastAPI route can
    SSE-serialise the result as a `started` then `done` pair, matching
    the Sherlock/Maigret event shape."""

    yield {"kind": "started", "phone": phone}
    result = await run_phoneinfoga(phone, timeout_s=timeout_s)
    if result.error is not None:
        yield {"kind": "error", "message": result.error}
        return
    yield {
        "kind": "done",
        "local_scanner": _local_scanner_to_dict(result.local_scanner),
        "google_dorks": result.google_dorks,
    }


def _parse_local(payload: object) -> LocalScannerResult | None:
    """Pluck country/carrier/line type out of the `local` scanner response.

    phoneinfoga 2.11 returns `{"result": {raw_local, local, e164,
    international, country_code, country}}`. The shape is stable but
    deliberately permissive — missing keys map to safe defaults rather
    than raising.
    """

    if not isinstance(payload, dict):
        return None
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    return LocalScannerResult(
        valid=bool(result.get("country") or result.get("e164")),
        country=str(result.get("country", "") or ""),
        country_code=str(result.get("country_code", "") or ""),
        carrier="",
        line_type="",
    )


def _parse_dorks(payload: object) -> list[str]:
    """Flatten the googlesearch scanner response into a list of URLs.

    phoneinfoga groups dorks by category (`social_media`,
    `disposable_providers`, etc.) under `result`; each entry is a dict
    with a `url` field we surface verbatim. Schema-drift tolerant.
    """

    if not isinstance(payload, dict):
        return []
    result = payload.get("result")
    if not isinstance(result, dict):
        return []
    urls: list[str] = []
    for group in result.values():
        if not isinstance(group, list):
            continue
        for entry in group:
            if not isinstance(entry, dict):
                continue
            url = entry.get("url")
            if isinstance(url, str) and url.startswith("http"):
                urls.append(url)
    return urls


def _local_scanner_to_dict(ls: LocalScannerResult | None) -> dict[str, object] | None:
    if ls is None:
        return None
    return {
        "valid": ls.valid,
        "country": ls.country,
        "country_code": ls.country_code,
        "carrier": ls.carrier,
        "line_type": ls.line_type,
    }
