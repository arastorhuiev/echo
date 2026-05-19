"""Subprocess-based GHunt runner.

GHunt is AGPL-3.0 — we keep it at arm's length and never import it into
our app code. AGPL §13 only triggers on *modified* sourcing-over-the-
network, which we don't do; an unmodified `ghunt` invoked as a child
process counts as "mere aggregation".

Env-conditional: needs both `GHUNT_CREDS_PATH` set AND the file
actually present. Without that the route returns a clean
`configured=false` instead of trying to spawn (which would either spin
on stdin asking for creds, or crash with a config-missing error).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile

logger = logging.getLogger("echo.ghunt")

DEFAULT_TIMEOUT_S = 60.0
TERM_GRACE_S = 3.0
GHUNT_BIN = "ghunt"


@dataclass(frozen=True, slots=True)
class GhuntResult:
    configured: bool
    found: bool
    name: str | None = None
    gaia_id: str | None = None
    profile_picture: str | None = None
    cover_photo: str | None = None
    emails: list[str] = field(default_factory=list)
    reviews_count: int | None = None
    maps_contributions: int | None = None
    calendar_visible: bool | None = None
    error: str | None = None


def _creds_present() -> str | None:
    """Return the resolved creds path if both the env var is set and the
    file exists; None otherwise. Used by the route to short-circuit
    when GHunt isn't operationally provisioned."""

    path = os.environ.get("GHUNT_CREDS_PATH")
    if not path:
        return None
    if not Path(path).is_file():
        return None
    return path


async def run_ghunt_email(
    email: str, timeout_s: float = DEFAULT_TIMEOUT_S
) -> GhuntResult:
    """Run `ghunt email <email> --json <tmpfile>` and parse the result.

    Synchronous result (the CLI is one-shot, ~2-5s typical). Errors and
    "not configured" land in the same `error` field rather than
    bubbling up — the consumer surfaces them as a Final.
    """

    creds = _creds_present()
    if creds is None:
        return GhuntResult(
            configured=False,
            found=False,
            error=(
                "GHunt not configured. Set GHUNT_CREDS_PATH to a creds.m "
                "file produced by `ghunt login` (see RUNBOOK 'Provider credentials')."
            ),
        )

    out_file = NamedTemporaryFile(prefix="ghunt-", suffix=".json", delete=False)
    out_path = Path(out_file.name)
    out_file.close()

    cmd = [GHUNT_BIN, "email", email, "--json", str(out_path)]

    # GHunt looks for its creds in ~/.config/ghunt/. Point HOME at the
    # parent of the creds.m file so a custom path Just Works without
    # patching upstream.
    env: dict[str, str] = dict(os.environ)
    env["HOME"] = str(Path(creds).parent.parent)  # creds.m → ghunt/ → parent dir

    logger.info("ghunt start email=%s", email)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
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
                return GhuntResult(
                    configured=True,
                    found=False,
                    error=f"ghunt exited {rc}: {stderr.strip()[:400] or 'unknown'}",
                )

        try:
            raw = out_path.read_text(encoding="utf-8")
            payload = json.loads(raw)
        except (OSError, json.JSONDecodeError) as err:
            return GhuntResult(
                configured=True, found=False, error=f"ghunt output read failed: {err}"
            )

        return _normalise(payload, email=email)
    finally:
        if proc.returncode is None:
            logger.info("ghunt terminate email=%s pid=%s", email, proc.pid)
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
            except TimeoutError:
                logger.warning("ghunt kill email=%s pid=%s", email, proc.pid)
                proc.kill()
                await proc.wait()
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass


def _normalise(payload: object, email: str) -> GhuntResult:
    """Pluck the bits we surface out of GHunt's JSON.

    The upstream schema isn't fully stable (GHunt is an active fork
    target); be permissive — missing fields map to None / [] rather
    than raising.
    """

    if not isinstance(payload, Mapping):
        return GhuntResult(configured=True, found=False, error="ghunt payload not a dict")

    # GHunt nests interesting bits under "PROFILE_CONTAINER" with a
    # "profile" sub-object; some versions inline them at the top level.
    container = payload.get("PROFILE_CONTAINER") if isinstance(payload.get("PROFILE_CONTAINER"), Mapping) else None
    profile_root = container.get("profile") if container and isinstance(container.get("profile"), Mapping) else None
    profile = profile_root if profile_root is not None else payload

    if not isinstance(profile, Mapping):
        return GhuntResult(configured=True, found=False, error="ghunt profile not a dict")

    # All known keys we surface. Tolerant of casing and naming drift —
    # we try a few common spellings before giving up on a field.
    name = (
        _str_field(profile, "name")
        or _str_field(profile, "names")
        or _str_field(profile, "displayName")
    )
    gaia_id = _str_field(profile, "gaiaID") or _str_field(profile, "gaia_id")
    profile_picture = _str_field(profile, "profilePhotos") or _str_field(profile, "profile_picture")
    cover_photo = _str_field(profile, "coverPhotos") or _str_field(profile, "cover_photo")

    emails: list[str] = []
    email_block = profile.get("emails") if isinstance(profile.get("emails"), list) else []
    for e in email_block:
        if isinstance(e, Mapping):
            value = e.get("value") or e.get("id")
            if isinstance(value, str) and "@" in value:
                emails.append(value)
        elif isinstance(e, str) and "@" in e:
            emails.append(e)
    if email not in emails:
        emails.insert(0, email)  # always echo the queried address

    reviews = profile.get("reviews_count")
    maps = profile.get("maps_contributions")
    calendar_visible = profile.get("calendar_visible")

    return GhuntResult(
        configured=True,
        found=bool(name or gaia_id),
        name=name,
        gaia_id=gaia_id,
        profile_picture=profile_picture,
        cover_photo=cover_photo,
        emails=emails,
        reviews_count=reviews if isinstance(reviews, int) else None,
        maps_contributions=maps if isinstance(maps, int) else None,
        calendar_visible=calendar_visible if isinstance(calendar_visible, bool) else None,
    )


def _str_field(d: Mapping[str, object], key: str) -> str | None:
    """Coerce a top-level field that might be string / dict / list-of-dicts
    into a single string. Returns None when no usable string is found."""

    value = d.get(key)
    if isinstance(value, str) and value:
        return value
    if isinstance(value, Mapping):
        # GHunt sometimes wraps "names" as `[{"fullname": "..."}]`.
        for candidate in ("fullname", "full_name", "name", "url"):
            inner = value.get(candidate)
            if isinstance(inner, str) and inner:
                return inner
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, str) and first:
            return first
        if isinstance(first, Mapping):
            for candidate in ("fullname", "full_name", "name", "url"):
                inner = first.get(candidate)
                if isinstance(inner, str) and inner:
                    return inner
    return None
