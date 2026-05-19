"""Subprocess-based Maigret runner.

Mirrors `sherlock_runner.py`: spawn `python -u -m maigret` per request,
read NDJSON from stdout, translate to a typed event union the FastAPI
route can SSE-serialise.

Maigret has a broader site corpus than Sherlock (~3000 vs ~600) and
overlaps. We deduplicate at the orchestration layer rather than here —
this runner returns whatever maigret found.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass

logger = logging.getLogger("echo.maigret")

# Per-run wall-clock — same model as sherlock: SIGTERM at expiry, SIGKILL
# on grace. Maigret has ~3x the site count; bump from 90s default.
DEFAULT_TIMEOUT_S = 180.0
TERM_GRACE_S = 3.0


@dataclass(frozen=True, slots=True)
class MaigretEvent:
    """One line of structured output from a Maigret run.

    `kind` is one of `started`, `found`, `done`, `error`. NDJSON lines
    that aren't claimed-site records get dropped silently.
    """

    kind: str
    site: str | None = None
    url: str | None = None
    username: str | None = None
    checked: int | None = None
    message: str | None = None


async def run_maigret(username: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> AsyncIterator[MaigretEvent]:
    """Spawn maigret for `username` and yield events as they arrive.

    Cancellation: cancelling the consuming async task tears down the
    subprocess (SIGTERM, then SIGKILL on grace expiry).
    """

    cmd = [
        sys.executable,
        "-u",  # unbuffered stdout so each NDJSON line flushes immediately
        "-m",
        "maigret",
        username,
        "--json",
        "ndjson",
        "--no-color",
        "--no-progressbar",
        # Per-site timeout — bounded so the long tail can't wedge the run.
        "-T",
        "10",
        # Maigret writes report files we don't need. Point at /tmp; the
        # container wipes /tmp on restart so we never accumulate state.
        "--folderoutput",
        "/tmp",
    ]

    logger.info("maigret start username=%s", username)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    yield MaigretEvent(kind="started", username=username)

    checked = 0
    try:
        async with asyncio.timeout(timeout_s):
            assert proc.stdout is not None
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\n").strip()
                event = _parse_line(line)
                if event is None:
                    continue
                if event.kind == "found":
                    checked += 1
                yield event

        rc = await proc.wait()
        if rc != 0:
            stderr = (await proc.stderr.read()).decode("utf-8", errors="replace") if proc.stderr else ""
            yield MaigretEvent(
                kind="error",
                message=f"maigret exited {rc}: {stderr.strip() or 'unknown'}",
            )
            return

        yield MaigretEvent(kind="done", checked=checked)
        logger.info("maigret done username=%s checked=%d", username, checked)
    finally:
        if proc.returncode is None:
            logger.info("maigret terminate username=%s pid=%s", username, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("maigret kill username=%s pid=%s", username, proc.pid)
                proc.kill()
                await proc.wait()


def _parse_line(line: str) -> MaigretEvent | None:
    """Parse one maigret NDJSON stdout line.

    Maigret emits two flavours of NDJSON:
    1. Per-site records — `{"sitename": "...", "status": "Claimed", "url": "..."}`.
       We only surface `Claimed` (found). Other statuses (Available,
       Illegal, Unknown) get dropped.
    2. Run metadata — `{"engine": "...", "total": ...}` and similar.
       Currently dropped — we compute `checked` ourselves to stay
       consistent with the SherlockEvent contract.
    """

    if not line:
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    status = payload.get("status")
    sitename = payload.get("sitename") or payload.get("site")
    url = payload.get("url")

    if isinstance(sitename, str) and isinstance(url, str) and status == "Claimed":
        return MaigretEvent(kind="found", site=sitename, url=url)
    return None
