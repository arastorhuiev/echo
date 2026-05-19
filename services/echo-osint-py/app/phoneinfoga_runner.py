"""Subprocess-based PhoneInfoga runner.

PhoneInfoga is a Go CLI binary; we invoke `phoneinfoga scan -n <number>
-o <tmpfile>` per request, read the JSON dump after exit, then normalise
into a slim shape the UI surfaces.

The upstream JSON is verbose (per-scanner sub-objects with names like
"googlesearch", "localscanner", "numverify"). We keep the local-scanner
metadata (country/carrier/line type) and the Google dorks; everything
else gets dropped to keep the payload bounded.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile

logger = logging.getLogger("echo.phoneinfoga")

DEFAULT_TIMEOUT_S = 30.0
TERM_GRACE_S = 3.0
PHONEINFOGA_BIN = "phoneinfoga"


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


async def run_phoneinfoga(phone: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> PhoneinfogaResult:
    """Spawn phoneinfoga for `phone` (E.164) and return the normalised result.

    Sync result rather than an event stream — phoneinfoga is a one-shot
    that completes in 1-3s. The TS wrapper translates this into the
    `Started → Final` envelope.
    """

    out_file = NamedTemporaryFile(prefix="phoneinfoga-", suffix=".json", delete=False)
    out_path = Path(out_file.name)
    out_file.close()

    cmd = [
        PHONEINFOGA_BIN,
        "scan",
        "-n",
        phone,
        "-o",
        str(out_path),
    ]

    logger.info("phoneinfoga start phone=%s", phone)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        async with asyncio.timeout(timeout_s):
            rc = await proc.wait()
            if rc != 0:
                stderr = (
                    (await proc.stderr.read()).decode("utf-8", errors="replace")
                    if proc.stderr
                    else ""
                )
                return PhoneinfogaResult(
                    local_scanner=None,
                    google_dorks=[],
                    error=f"phoneinfoga exited {rc}: {stderr.strip() or 'unknown'}",
                )

        try:
            raw = out_path.read_text(encoding="utf-8")
            payload = json.loads(raw)
        except (OSError, json.JSONDecodeError) as err:
            return PhoneinfogaResult(
                local_scanner=None,
                google_dorks=[],
                error=f"phoneinfoga output read failed: {err}",
            )

        return _normalise(payload)
    finally:
        if proc.returncode is None:
            logger.info("phoneinfoga terminate phone=%s pid=%s", phone, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("phoneinfoga kill phone=%s pid=%s", phone, proc.pid)
                proc.kill()
                await proc.wait()
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass


async def stream_phoneinfoga(
    phone: str, timeout_s: float = DEFAULT_TIMEOUT_S
) -> AsyncIterator[dict[str, object]]:
    """Generator wrapper around `run_phoneinfoga` so the FastAPI route can
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


def _normalise(payload: object) -> PhoneinfogaResult:
    """Pluck the bits we surface out of phoneinfoga's nested JSON.

    Tolerant of upstream-schema drift: missing keys map to safe defaults
    rather than raising, so a future phoneinfoga release that renames a
    field doesn't break the route end-to-end.
    """

    if not isinstance(payload, dict):
        return PhoneinfogaResult(local_scanner=None, google_dorks=[], error="payload not a dict")

    number = payload.get("Number") if isinstance(payload.get("Number"), dict) else {}
    results = payload.get("Results") if isinstance(payload.get("Results"), list) else []

    country = (number or {}).get("Country", "") if isinstance(number, dict) else ""
    country_code = (number or {}).get("CountryCode", "") if isinstance(number, dict) else ""
    carrier = (number or {}).get("Carrier", "") if isinstance(number, dict) else ""

    local_scanner: LocalScannerResult | None = None
    google_dorks: list[str] = []

    for scanner in results:
        if not isinstance(scanner, dict):
            continue
        name = scanner.get("Name")
        result = scanner.get("Result")

        if name == "localscanner" and isinstance(result, dict):
            local_scanner = LocalScannerResult(
                valid=bool(result.get("Valid", False)),
                country=str(result.get("Country", country) or country),
                country_code=str(result.get("CountryCode", country_code) or country_code),
                carrier=str(result.get("Carrier", carrier) or carrier),
                line_type=str(result.get("LineType", "")),
            )
        elif name == "googlesearch" and isinstance(result, dict):
            dork_entries = result.get("dorks") if isinstance(result.get("dorks"), list) else []
            for d in dork_entries:
                if isinstance(d, dict):
                    link = d.get("DorkLink") or d.get("Url")
                    if isinstance(link, str) and link.startswith("http"):
                        google_dorks.append(link)

    # If localscanner row was absent, synthesise from Number block.
    if local_scanner is None and isinstance(number, dict) and number:
        local_scanner = LocalScannerResult(
            valid=False,
            country=str(country or ""),
            country_code=str(country_code or ""),
            carrier=str(carrier or ""),
            line_type="",
        )

    return PhoneinfogaResult(local_scanner=local_scanner, google_dorks=google_dorks)


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
