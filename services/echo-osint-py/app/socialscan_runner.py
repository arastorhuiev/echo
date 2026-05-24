"""Subprocess-based socialscan runner.

Unlike Sherlock/Maigret we can't pipe NDJSON from stdout — socialscan
1.x/2.x only knows how to dump a JSON array to a file. So we hand it a
temp path, wait for the process to exit, read the file, and yield one
`result` event per platform check followed by `done`.

This is less granular than the streaming Sherlock pattern but
socialscan only checks ~10 platforms per query, so the whole run is
sub-30s. A single batch-style flush is fine in practice.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile

logger = logging.getLogger("echo.socialscan")

DEFAULT_TIMEOUT_S = 60.0
TERM_GRACE_S = 3.0


@dataclass(frozen=True, slots=True)
class SocialscanEvent:
    """One line of structured output from a socialscan run.

    `kind` is one of `started`, `result`, `done`, `error`. For
    `result`, `available=False` ⇒ this handle is **taken** on that
    platform (signal we surface as "exists there").
    """

    kind: str
    query: str | None = None
    platform: str | None = None
    available: bool | None = None
    valid: bool | None = None
    success: bool | None = None
    message: str | None = None
    checked: int | None = None


async def run_socialscan(
    queries: list[str], timeout_s: float = DEFAULT_TIMEOUT_S
) -> AsyncIterator[SocialscanEvent]:
    """Run socialscan on the given queries and yield per-platform events.

    `queries` is a mix of usernames and email addresses — socialscan
    auto-detects which platforms can validate each form.
    """

    if not queries:
        yield SocialscanEvent(kind="done", checked=0)
        return

    yield SocialscanEvent(kind="started", query=", ".join(queries))

    out_file = NamedTemporaryFile(prefix="socialscan-", suffix=".json", delete=False)
    out_path = Path(out_file.name)
    out_file.close()

    cmd = [
        sys.executable,
        "-u",
        "-m",
        "socialscan",
        *queries,
        "--json",
        str(out_path),
    ]

    logger.info("socialscan start queries=%s", queries)
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
                yield SocialscanEvent(
                    kind="error",
                    message=f"socialscan exited {rc}: {stderr.strip() or 'unknown'}",
                )
                return

        # Read the JSON dump socialscan wrote. Shape per upstream README:
        #   [{"query": "...", "platform": "...", "available": ..., "valid": ..., "success": ..., "message": "..."}]
        try:
            raw = out_path.read_text(encoding="utf-8")
            payload = json.loads(raw)
        except (OSError, json.JSONDecodeError) as err:
            yield SocialscanEvent(kind="error", message=f"socialscan output read failed: {err}")
            return

        # socialscan 2.x dumps `{ <query>: [entry, ...] }`; flatten it.
        # Older versions wrote a flat list — keep tolerating that shape.
        entries: list[dict[str, object]] = []
        if isinstance(payload, list):
            entries = [e for e in payload if isinstance(e, dict)]
        elif isinstance(payload, dict):
            for query_results in payload.values():
                if isinstance(query_results, list):
                    entries.extend(e for e in query_results if isinstance(e, dict))
        else:
            yield SocialscanEvent(
                kind="error", message=f"socialscan output had unexpected shape: {type(payload).__name__}"
            )
            return

        checked = 0
        for entry in entries:
            event = _parse_entry(entry)
            if event is None:
                continue
            checked += 1
            yield event

        yield SocialscanEvent(kind="done", checked=checked)
        logger.info("socialscan done queries=%s checked=%d", queries, checked)
    finally:
        if proc.returncode is None:
            logger.info("socialscan terminate queries=%s pid=%s", queries, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("socialscan kill queries=%s pid=%s", queries, proc.pid)
                proc.kill()
                await proc.wait()
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass


def _parse_entry(entry: dict[str, object]) -> SocialscanEvent | None:
    """Turn one socialscan JSON dict into a `result` SocialscanEvent.

    socialscan 2.x serialises booleans as the literal strings `"True"`
    and `"False"`, not real JSON bools — keep tolerating real bools too
    so an older socialscan or a test fixture still parses cleanly.
    """

    query = entry.get("query")
    platform = entry.get("platform")
    if not isinstance(query, str) or not isinstance(platform, str):
        return None
    message = entry.get("message")
    return SocialscanEvent(
        kind="result",
        query=query,
        platform=platform,
        available=_coerce_bool(entry.get("available")),
        valid=_coerce_bool(entry.get("valid")),
        success=_coerce_bool(entry.get("success")),
        message=str(message) if isinstance(message, str) and message else None,
    )


def _coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value == "True":
            return True
        if value == "False":
            return False
    return None
