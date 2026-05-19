"""Subprocess-based ignorant (Megadose) runner.

ignorant is GPL-3.0 so we keep it at arm's length — `python -u -m
ignorant <country_code> <phone>` as a child process and parse the
per-platform JSON dicts off stdout. Same "mere aggregation" reasoning
as PhoneInfoga / GHunt: we never import ignorant into our app code.

Output shape (from the upstream README):
    {"name": "instagram", "domain": "instagram.com", "method": "other",
     "frequent_rate_limit": false, "rateLimit": false, "exists": false}

ignorant prints one such object per platform during the scan, sometimes
multi-line per object. We accumulate stdout, then parse it as either
NDJSON or a single JSON array. Both branches are exercised in unit
tests via the runner's `_parse_payload` helper.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass

logger = logging.getLogger("echo.ignorant")

DEFAULT_TIMEOUT_S = 30.0
TERM_GRACE_S = 3.0

# Strict E.164-without-plus regex for the phone, plus a country-code
# regex (1-3 digits). The sidecar mirrors the same validation at the
# route edge so malformed input dies before we spawn a child.
PHONE_DIGITS_RE = re.compile(r"^\d{4,15}$")
COUNTRY_CODE_RE = re.compile(r"^\d{1,4}$")


@dataclass(frozen=True, slots=True)
class IgnorantEvent:
    """One line of structured output from an ignorant run.

    `kind` is one of `started`, `result`, `done`, `error`. For `result`,
    the per-platform booleans come straight from ignorant. `exists=True`
    ⇒ the phone is registered on that platform — the only sigal we
    really care about; the rest is for transparency.
    """

    kind: str
    phone: str | None = None
    platform: str | None = None
    domain: str | None = None
    method: str | None = None
    exists: bool | None = None
    rate_limit: bool | None = None
    frequent_rate_limit: bool | None = None
    checked: int | None = None
    message: str | None = None


async def run_ignorant(
    phone: str, country_code: str, timeout_s: float = DEFAULT_TIMEOUT_S
) -> AsyncIterator[IgnorantEvent]:
    """Spawn ignorant for `phone` and yield `result` events as they arrive.

    `country_code` is the dialling code WITHOUT the leading `+`
    (ignorant's positional argument convention).
    """

    if not PHONE_DIGITS_RE.match(phone):
        yield IgnorantEvent(kind="error", message=f"phone digits must match {PHONE_DIGITS_RE.pattern}")
        return
    if not COUNTRY_CODE_RE.match(country_code):
        yield IgnorantEvent(
            kind="error", message=f"country_code must match {COUNTRY_CODE_RE.pattern}"
        )
        return

    cmd = [sys.executable, "-u", "-m", "ignorant", country_code, phone]

    logger.info("ignorant start country=%s phone=%s", country_code, phone)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    yield IgnorantEvent(kind="started", phone=phone)

    checked = 0
    stdout_buffer = bytearray()
    try:
        async with asyncio.timeout(timeout_s):
            assert proc.stdout is not None
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                stdout_buffer.extend(chunk)

        rc = await proc.wait()
        if rc != 0:
            stderr = (
                (await proc.stderr.read()).decode("utf-8", errors="replace")
                if proc.stderr
                else ""
            )
            yield IgnorantEvent(
                kind="error",
                message=f"ignorant exited {rc}: {stderr.strip() or 'unknown'}",
            )
            return

        for parsed in _parse_payload(stdout_buffer.decode("utf-8", errors="replace")):
            checked += 1
            yield IgnorantEvent(
                kind="result",
                phone=phone,
                platform=parsed.get("name", "") or "",
                domain=parsed.get("domain") if isinstance(parsed.get("domain"), str) else None,
                method=parsed.get("method") if isinstance(parsed.get("method"), str) else None,
                exists=bool(parsed.get("exists")) if isinstance(parsed.get("exists"), bool) else None,
                rate_limit=(
                    bool(parsed.get("rateLimit"))
                    if isinstance(parsed.get("rateLimit"), bool)
                    else None
                ),
                frequent_rate_limit=(
                    bool(parsed.get("frequent_rate_limit"))
                    if isinstance(parsed.get("frequent_rate_limit"), bool)
                    else None
                ),
            )

        yield IgnorantEvent(kind="done", checked=checked)
        logger.info("ignorant done phone=%s checked=%d", phone, checked)
    finally:
        if proc.returncode is None:
            logger.info("ignorant terminate phone=%s pid=%s", phone, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("ignorant kill phone=%s pid=%s", phone, proc.pid)
                proc.kill()
                await proc.wait()


def _parse_payload(text: str) -> list[dict[str, object]]:
    """Best-effort parse of ignorant's stdout.

    Tries JSON-array first (some versions dump everything as `[...]` at
    the end), then NDJSON (one dict per line), then a permissive
    line-by-line scan that picks up any line beginning with `{`.
    """

    text = text.strip()
    if not text:
        return []

    # Attempt #1 — single JSON array.
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, list):
        return [d for d in payload if isinstance(d, dict)]
    if isinstance(payload, dict):
        return [payload]

    # Attempt #2 — NDJSON.
    out: list[dict[str, object]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict):
            out.append(entry)
    return out
