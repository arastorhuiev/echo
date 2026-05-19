"""In-process socid-extractor wrapper.

`socid_extractor.extract(html)` is a synchronous parser that returns a
dict of site-specific identifiers (Telegram user_id, VK profile id,
Patreon id, GitHub commit emails, …). We fetch the URL with httpx
(async) and hand the HTML body to the extractor in a worker thread so
the sidecar event loop stays responsive.

The extractor sometimes returns stringified lists for fields like
`links` (`"['https://a', 'https://b']"`). We attempt a permissive
`ast.literal_eval` round-trip in `_normalise_fields` to turn those into
real arrays; anything that fails the eval stays as a string so a future
upstream-format change doesn't break the route.
"""

from __future__ import annotations

import ast
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("echo.socid_extractor")

DEFAULT_TIMEOUT_S = 15.0
MAX_BODY_BYTES = 2 * 1024 * 1024  # 2 MiB cap on the page we hand to the extractor


@dataclass(frozen=True, slots=True)
class SocidExtractorResult:
    found: bool
    url: str
    fields: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


async def run_socid_extractor(
    url: str, timeout_s: float = DEFAULT_TIMEOUT_S
) -> SocidExtractorResult:
    """Fetch `url`, hand the body to socid_extractor.extract, normalise."""

    try:
        async with httpx.AsyncClient(
            timeout=timeout_s,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        ) as client:
            response = await client.get(url)
    except (httpx.RequestError, httpx.HTTPError) as err:
        return SocidExtractorResult(found=False, url=url, error=f"fetch failed: {err}")

    if response.status_code >= 400:
        return SocidExtractorResult(
            found=False,
            url=url,
            error=f"upstream returned {response.status_code} {response.reason_phrase}",
        )

    body = response.text[:MAX_BODY_BYTES]

    try:
        from socid_extractor import extract
    except ImportError as err:
        return SocidExtractorResult(
            found=False, url=url, error=f"socid_extractor import failed: {err}"
        )

    try:
        extracted = await asyncio.to_thread(extract, body)
    except Exception as err:  # noqa: BLE001 — upstream raises generic Exception on parser oddities
        logger.exception("socid_extractor crashed url=%s", url)
        return SocidExtractorResult(found=False, url=url, error=f"extract failed: {err}")

    if not isinstance(extracted, dict) or not extracted:
        return SocidExtractorResult(found=False, url=url, fields={})

    return SocidExtractorResult(found=True, url=url, fields=_normalise_fields(extracted))


def _normalise_fields(raw: dict[str, Any]) -> dict[str, Any]:
    """Turn stringified Python lists into real arrays where we can.

    socid_extractor sometimes returns `"['a', 'b']"` for fields like
    `links`. Try `ast.literal_eval`; on any failure keep the original
    string so the consumer still sees something.
    """

    out: dict[str, Any] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            continue
        if isinstance(value, str) and value.startswith("[") and value.endswith("]"):
            try:
                parsed = ast.literal_eval(value)
                if isinstance(parsed, (list, tuple)):
                    out[key] = [str(x) for x in parsed]
                    continue
            except (ValueError, SyntaxError):
                pass
        if isinstance(value, (str, int, float, bool)):
            out[key] = value
        elif isinstance(value, (list, tuple)):
            out[key] = [str(x) for x in value]
        else:
            out[key] = str(value)
    return out
