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
import os
import shutil
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("echo.maigret")

# Per-run wall-clock — same model as sherlock: SIGTERM at expiry, SIGKILL
# on grace. Maigret has ~3x the site count; bump from 90s default.
DEFAULT_TIMEOUT_S = 180.0
TERM_GRACE_S = 3.0

# Maigret rewrites its sites DB on every run. The bundled file lives
# inside the read-only venv, so we copy it under /tmp on first use and
# hand maigret a `--db` path it can actually write to.
_MAIGRET_BUNDLED_DB = Path(
    "/opt/venv/lib/python3.13/site-packages/maigret/resources/data.json"
)
_MAIGRET_DB = Path("/tmp/.maigret/data.json")
_MAIGRET_DB_LOCK = asyncio.Lock()


async def _ensure_maigret_db() -> None:
    if _MAIGRET_DB.is_file():
        return
    async with _MAIGRET_DB_LOCK:
        if _MAIGRET_DB.is_file():
            return
        _MAIGRET_DB.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copy, _MAIGRET_BUNDLED_DB, _MAIGRET_DB)
        logger.info("maigret db staged at %s", _MAIGRET_DB)


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
    """Spawn maigret for `username`; yield Started, the `found` events
    after the run completes, then Done.

    Maigret 0.6.x's stdout is human-readable progress text. The
    machine-readable NDJSON we actually parse lands in a file inside
    `--folderoutput` after the subprocess exits, so streaming is
    inherently batched: the consumer sees one cluster of `found`
    events at the end. The TS provider is fine with that shape (each
    NDJSON entry becomes a Partial), and we lose nothing functional
    since maigret itself buffers all results until exit.

    Cancellation: cancelling the consuming async task tears down the
    subprocess (SIGTERM, then SIGKILL on grace expiry).
    """

    await _ensure_maigret_db()

    report_dir = Path("/tmp")
    report_path = report_dir / f"report_{username}_ndjson.json"
    if report_path.exists():
        try:
            report_path.unlink()
        except OSError:
            pass

    cmd = [
        sys.executable,
        "-u",
        "-m",
        "maigret",
        username,
        "--json",
        "ndjson",
        "--no-color",
        "--no-progressbar",
        # Per-site timeout — bounded so the long tail can't wedge the run.
        # Maigret 0.6.x's `-T` shorthand was reassigned to `--txt` (a
        # report-format flag), so we must use the long `--timeout` form.
        "--timeout",
        "10",
        # NDJSON report goes here; we read it after the subprocess
        # exits. Container wipes /tmp on restart so we never accumulate.
        "--folderoutput",
        str(report_dir),
        # Skip the sites-DB self-update — we vendor the pinned version
        # via the wheel, and the container's `osint` user has no write
        # access outside /tmp anyway.
        "--no-autoupdate",
        # Hand maigret a writable copy of its bundled sites DB. Without
        # this, `db.save_to_file` at the end of every run tries to
        # rewrite the read-only venv resource and crashes the process.
        "--db",
        str(_MAIGRET_DB),
    ]

    logger.info("maigret start username=%s", username)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        # Maigret's `db_updater` insists on `MAIGRET_HOME` being writable
        # even with --no-autoupdate (it still touches the dir for the
        # active sites cache). Redirect to /tmp so the unprivileged
        # `osint` user can write.
        env={**os.environ, "MAIGRET_HOME": "/tmp/.maigret"},
    )

    yield MaigretEvent(kind="started", username=username)

    checked = 0
    try:
        try:
            async with asyncio.timeout(timeout_s):
                rc = await proc.wait()
        except TimeoutError:
            yield MaigretEvent(
                kind="error", message=f"maigret timed out after {timeout_s:.0f}s"
            )
            return

        if rc != 0:
            stderr = (await proc.stderr.read()).decode("utf-8", errors="replace") if proc.stderr else ""
            yield MaigretEvent(
                kind="error",
                message=f"maigret exited {rc}: {stderr.strip() or 'unknown'}",
            )
            return

        if not report_path.exists():
            yield MaigretEvent(
                kind="error",
                message=f"maigret report missing at {report_path}",
            )
            return

        try:
            ndjson = report_path.read_text(encoding="utf-8")
        except OSError as err:
            yield MaigretEvent(kind="error", message=f"maigret report read failed: {err}")
            return

        for raw_line in ndjson.splitlines():
            event = _parse_line(raw_line.strip())
            if event is None:
                continue
            if event.kind == "found":
                checked += 1
            yield event

        yield MaigretEvent(kind="done", checked=checked)
        logger.info("maigret done username=%s found=%d", username, checked)
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
        try:
            report_path.unlink(missing_ok=True)
        except OSError:
            pass


def _parse_line(line: str) -> MaigretEvent | None:
    """Parse one record from maigret's NDJSON report.

    Maigret 0.6.x writes one JSON object per checked site, with a
    nested `status` block whose own `status` field is `"Claimed"` for
    hits. We only surface those — other states (Available, Illegal,
    Unknown) are not useful signal in our pipeline.
    """

    if not line:
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    sitename = payload.get("sitename")
    if not isinstance(sitename, str):
        site = payload.get("site")
        sitename = site if isinstance(site, str) else None

    status_obj = payload.get("status")
    status_value: str | None
    if isinstance(status_obj, dict):
        status_inner = status_obj.get("status")
        status_value = status_inner if isinstance(status_inner, str) else None
    elif isinstance(status_obj, str):
        status_value = status_obj
    else:
        status_value = None

    url = payload.get("url_user")
    if not isinstance(url, str):
        url_top = payload.get("url")
        url = url_top if isinstance(url_top, str) else None
    if isinstance(status_obj, dict) and not isinstance(url, str):
        url_inner = status_obj.get("url")
        url = url_inner if isinstance(url_inner, str) else None

    if isinstance(sitename, str) and isinstance(url, str) and status_value == "Claimed":
        return MaigretEvent(kind="found", site=sitename, url=url)
    return None
