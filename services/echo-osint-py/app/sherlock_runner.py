"""Subprocess-based Sherlock runner.

We invoke `python -u -m sherlock_project` as a child process and parse its
stdout line by line. Subprocess gives us three things the library API does
not:

- Clean cancellation. When the HTTP client disconnects we send SIGTERM to
  the child and reap it via tini.
- Unbuffered streaming. `python -u` flushes per print() so each site result
  surfaces immediately, not at end-of-run.
- Crash isolation. A misbehaving sherlock release cannot wedge the uvicorn
  worker — the parent FastAPI process stays responsive.

The cost is one Python interpreter start per request (~250-500 ms). At
echo's scale (single-digit RPS for username lookups) that's well below
sherlock's own ~10-60 s wall-clock and not worth optimising.
"""

from __future__ import annotations

import asyncio
import logging
import re
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass

logger = logging.getLogger("echo.sherlock")

# Sherlock's `--print-all --no-color` output format:
#   [+] GitHub: https://github.com/john_doe
#   [-] Twitter: Not Found!
# `--verbose` adds `[NNNms]` between the site name and the colon; we
# match optionally so both forms parse.
FOUND_RE = re.compile(r"^\[\+\]\s+(?P<site>[^:\[]+?)(?:\s+\[\d+ms\])?:\s+(?P<url>https?://\S+)$")
NOT_FOUND_RE = re.compile(r"^\[-\]\s+(?P<site>[^:\[]+?)(?:\s+\[\d+ms\])?:\s+Not Found!")

# Cap per-run wall-clock — Sherlock can hang on unresponsive sites if a
# per-site timeout is generous. We send SIGTERM at this point, then
# SIGKILL after a small grace window.
DEFAULT_TIMEOUT_S = 90.0
TERM_GRACE_S = 3.0


@dataclass(frozen=True, slots=True)
class SherlockEvent:
    """One line of structured output from a Sherlock run.

    `kind` is one of `started`, `found`, `not_found`, `done`, `error`.
    Other fields are populated based on the kind:

    - `found`/`not_found`: `site` is the platform name; `url` is the
      profile URL (only for `found`).
    - `started`: `username` echoes the queried username.
    - `done`: `checked` is the total number of sites parsed.
    - `error`: `message` is the failure description.
    """

    kind: str
    site: str | None = None
    url: str | None = None
    username: str | None = None
    checked: int | None = None
    message: str | None = None


async def run_sherlock(username: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> AsyncIterator[SherlockEvent]:
    """Spawn sherlock for `username` and yield events as they arrive.

    Cancellation: cancelling the consuming async task terminates the
    subprocess (SIGTERM, then SIGKILL on grace expiry) and re-raises
    `asyncio.CancelledError` to the caller. The `finally` block runs
    even if the caller never calls `aclose()` explicitly because
    StreamingResponse drives generator teardown on disconnect.
    """

    cmd = [
        sys.executable,
        "-u",  # unbuffered stdout so each line flushes immediately
        "-m",
        "sherlock_project",
        username,
        "--print-all",
        "--no-color",
        # Per-site HTTP timeout. Aggressive to keep the long-tail bounded.
        "--timeout",
        "10",
        # Sherlock 0.15 has no `--no-txt`; it always writes a per-username
        # txt with the found URLs. Point it at /tmp so it doesn't clutter
        # the workdir. Container restart wipes /tmp.
        "--folderoutput",
        "/tmp",
    ]

    logger.info("sherlock start username=%s", username)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    yield SherlockEvent(kind="started", username=username)

    checked = 0
    try:
        # asyncio.wait_for cancels the inner task on timeout, which
        # bubbles up as CancelledError into the finally cleanup block —
        # same code path as a client disconnect.
        async with asyncio.timeout(timeout_s):
            assert proc.stdout is not None
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
                event = _parse_line(line)
                if event is None:
                    continue
                if event.kind in ("found", "not_found"):
                    checked += 1
                yield event

        rc = await proc.wait()
        if rc != 0:
            stderr = (await proc.stderr.read()).decode("utf-8", errors="replace") if proc.stderr else ""
            yield SherlockEvent(
                kind="error",
                message=f"sherlock exited {rc}: {stderr.strip() or 'unknown'}",
            )
            return

        yield SherlockEvent(kind="done", checked=checked)
        logger.info("sherlock done username=%s checked=%d", username, checked)
    finally:
        if proc.returncode is None:
            logger.info("sherlock terminate username=%s pid=%s", username, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("sherlock kill username=%s pid=%s", username, proc.pid)
                proc.kill()
                await proc.wait()


def _parse_line(line: str) -> SherlockEvent | None:
    """Translate one sherlock stdout line into a `SherlockEvent` (or None).

    Sherlock prints assorted banner / progress lines that we drop. Only
    `[+]`/`[-]` site result lines turn into events.
    """

    if not line:
        return None
    if (m := FOUND_RE.match(line)) is not None:
        return SherlockEvent(kind="found", site=m["site"].strip(), url=m["url"])
    if (m := NOT_FOUND_RE.match(line)) is not None:
        return SherlockEvent(kind="not_found", site=m["site"].strip())
    return None
