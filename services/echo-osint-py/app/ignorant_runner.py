"""Subprocess-based ignorant (Megadose) runner.

ignorant is GPL-3.0 so we keep it at arm's length — invoke the
`ignorant` console script as a child process and parse the
human-readable stdout. Same "mere aggregation" reasoning as
PhoneInfoga / GHunt: we never import ignorant into our app code.

ignorant 1.2 has no `__main__.py`, so `python -m ignorant` no longer
works; the binary entry point installed by pip is just `ignorant`.

Stdout shape (one banner block, one line per platform, one final tally):

    *******************
       +48 537529192
    *******************
    [-] amazon.com
    [+] instagram.com
    [x] snapchat.com

    [+] Phone number used, [-] Phone number not used, [x] Rate limit
    3 websites checked in 1.08 seconds

Markers map straight to `exists` / `rate_limit`:
- `[+]` → exists=True
- `[-]` → exists=False
- `[x]` → rate_limit=True (exists unknown)
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

logger = logging.getLogger("echo.ignorant")

DEFAULT_TIMEOUT_S = 30.0
TERM_GRACE_S = 3.0
IGNORANT_BIN = "ignorant"

# Strict E.164-without-plus regex for the phone, plus a country-code
# regex (1-3 digits). The sidecar mirrors the same validation at the
# route edge so malformed input dies before we spawn a child.
PHONE_DIGITS_RE = re.compile(r"^\d{4,15}$")
COUNTRY_CODE_RE = re.compile(r"^\d{1,4}$")

# One stdout line per platform check, e.g. `[+] instagram.com`.
RESULT_LINE_RE = re.compile(r"^\[([+\-x])\]\s+([A-Za-z0-9._-]+\.[A-Za-z]{2,})\s*$")


@dataclass(frozen=True, slots=True)
class IgnorantEvent:
    """One line of structured output from an ignorant run.

    `kind` is one of `started`, `result`, `done`, `error`. For `result`,
    the per-platform booleans come straight from ignorant. `exists=True`
    ⇒ the phone is registered on that platform — the only signal we
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
    """Spawn ignorant for `phone` and yield one event per platform line.

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

    cmd = [IGNORANT_BIN, "--no-color", "--no-clear", country_code, phone]

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

        for parsed in _parse_stdout(stdout_buffer.decode("utf-8", errors="replace")):
            checked += 1
            yield IgnorantEvent(
                kind="result",
                phone=phone,
                platform=parsed["platform"],
                domain=parsed["domain"],
                exists=parsed["exists"],
                rate_limit=parsed["rate_limit"],
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


def _parse_stdout(text: str) -> list[dict[str, object]]:
    """Pluck `[+|-|x] domain.tld` lines from ignorant's banner-heavy stdout."""

    out: list[dict[str, object]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        m = RESULT_LINE_RE.match(line)
        if m is None:
            continue
        marker, domain = m.group(1), m.group(2)
        exists: bool | None
        rate_limit: bool | None
        if marker == "+":
            exists, rate_limit = True, False
        elif marker == "-":
            exists, rate_limit = False, False
        else:  # 'x'
            exists, rate_limit = None, True
        out.append(
            {
                "domain": domain,
                "platform": _domain_to_platform(domain),
                "exists": exists,
                "rate_limit": rate_limit,
            }
        )
    return out


def _domain_to_platform(domain: str) -> str:
    """`instagram.com` → `Instagram`. Strip TLD, title-case the stem."""
    stem = domain.split(".")[0]
    return stem[:1].upper() + stem[1:].lower() if stem else domain
