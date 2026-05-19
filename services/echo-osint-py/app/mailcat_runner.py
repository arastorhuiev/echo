"""Subprocess-based mailcat runner.

mailcat is a script repo (`sharsil/mailcat`) — not pip-installable as a
module — that depends on pyppeteer + Chromium. We deliberately DO NOT
clone it into the sidecar image at build time (that'd add ~250 MB of
headless Chromium for a single provider). Instead the runner is
env-conditional: activates only when `MAILCAT_INSTALL_PATH` points at
a clone of the repo whose `requirements.txt` has been installed
locally (typically via a docker-compose volume mount + manual
provisioning step documented in RUNBOOK).

Output is line-based text — mailcat prints `[+]` / `[-]` per provider,
similar to Sherlock. We parse those lines into per-provider events.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("echo.mailcat")

DEFAULT_TIMEOUT_S = 90.0
TERM_GRACE_S = 3.0

# mailcat prints results in two flavours:
#   [+] alice@gmail.com
#   [-] alice@protonmail.com (mx not found)
# `(...)` suffix on `[-]` is optional. Strict regex so banners and
# progress lines don't get mistaken for results.
FOUND_RE = re.compile(r"^\s*\[\+\]\s+(?P<email>\S+@\S+)\s*$")
MISSING_RE = re.compile(r"^\s*\[-\]\s+(?P<email>\S+@\S+)(?:\s+.*)?$")


@dataclass(frozen=True, slots=True)
class MailcatEvent:
    """One line of structured output from a mailcat run."""

    kind: str
    username: str | None = None
    email: str | None = None
    exists: bool | None = None
    checked: int | None = None
    message: str | None = None


def _install_present() -> str | None:
    """Return the resolved install dir if env is set + mailcat.py exists; None otherwise."""

    path = os.environ.get("MAILCAT_INSTALL_PATH")
    if not path:
        return None
    script = Path(path) / "mailcat.py"
    if not script.is_file():
        return None
    return path


async def run_mailcat(username: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> AsyncIterator[MailcatEvent]:
    """Spawn mailcat for `username` and yield events as they arrive.

    Env-conditional. Without `MAILCAT_INSTALL_PATH` we short-circuit
    with one `error` event the route surfaces as a Final.
    """

    install = _install_present()
    if install is None:
        yield MailcatEvent(
            kind="error",
            message=(
                "mailcat not configured. Set MAILCAT_INSTALL_PATH to a clone of "
                "https://github.com/sharsil/mailcat with requirements installed "
                "(see RUNBOOK 'Provider credentials')."
            ),
        )
        return

    yield MailcatEvent(kind="started", username=username)

    cmd = [sys.executable, "-u", str(Path(install) / "mailcat.py"), username]

    logger.info("mailcat start username=%s", username)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=install,  # mailcat reads its data/ folder from cwd
    )

    checked = 0
    try:
        async with asyncio.timeout(timeout_s):
            assert proc.stdout is not None
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")
                event = _parse_line(line, username)
                if event is None:
                    continue
                if event.kind == "result":
                    checked += 1
                yield event

        rc = await proc.wait()
        if rc != 0:
            stderr = (
                (await proc.stderr.read()).decode("utf-8", errors="replace")
                if proc.stderr
                else ""
            )
            yield MailcatEvent(
                kind="error",
                message=f"mailcat exited {rc}: {stderr.strip()[:400] or 'unknown'}",
            )
            return

        yield MailcatEvent(kind="done", checked=checked)
        logger.info("mailcat done username=%s checked=%d", username, checked)
    finally:
        if proc.returncode is None:
            logger.info("mailcat terminate username=%s pid=%s", username, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("mailcat kill username=%s pid=%s", username, proc.pid)
                proc.kill()
                await proc.wait()


def _parse_line(line: str, username: str) -> MailcatEvent | None:
    """Translate one mailcat stdout line into a `MailcatEvent` or None.

    mailcat prints banners + progress lines we don't care about; only
    `[+]`/`[-]` markers turn into result events.
    """

    if not line:
        return None
    if (m := FOUND_RE.match(line)) is not None:
        return MailcatEvent(kind="result", username=username, email=m["email"], exists=True)
    if (m := MISSING_RE.match(line)) is not None:
        return MailcatEvent(kind="result", username=username, email=m["email"], exists=False)
    return None
