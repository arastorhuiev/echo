"""Concurrency guards for the OSINT sidecar (phase P9a — safety floor).

The sidecar spawns real subprocesses (Sherlock, Maigret, …) and a heavy
headless Chromium (mailcat). With no cap, a burst of lookups — or a single
Maigret loop — spawns unbounded children and OOM-kills the container. This
module is the SINGLE source of truth for how many heavy provider runs may
be in flight at once.

Two composed limits, both sized from env per memory profile
(see ``deploy/profiles/*.env``):

* a GLOBAL heavy semaphore (``GLOBAL_HEAVY_CONCURRENCY``) — the hard ceiling
  on total concurrent heavy runs across ALL providers;
* a PER-PROVIDER semaphore — a per-tool cap (e.g. ``MAIGRET_MAX_CONCURRENCY``)
  so one greedy provider can't consume every global slot.

**Default-DENY:** a provider missing from the registry gets a per-provider
bound of 1 (never unbounded). Light in-process routes (phonenumbers) don't
call :func:`heavy_slot` at all.

**Invariant** (asserted by tests, and mirrored by the P9b BullMQ caps):
``1 ≤ per-provider bound ≤ GLOBAL_HEAVY_CONCURRENCY``.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

logger = logging.getLogger("echo.concurrency")

_DEFAULT_GLOBAL_HEAVY = 3
_UNLISTED_BOUND = 1  # default-deny: an unregistered provider is capped at 1


def _env_int(name: str, default: int) -> int:
    """Read a positive int from env, falling back to ``default`` when unset,
    empty, non-numeric, or non-positive (a misconfigured knob must never
    silently disable the cap)."""

    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        logger.warning("invalid %s=%r — using default %d", name, raw, default)
        return default
    if value <= 0:
        logger.warning("%s=%d is not positive — using default %d", name, value, default)
        return default
    return value


def _per_provider_bounds(global_heavy: int) -> dict[str, int]:
    """Per-provider caps. A provider defaults to the global ceiling (so the
    global semaphore is the only limiter) unless it carries a tighter, tuned
    knob. Maigret fans out hardest, so it owns the named
    ``MAIGRET_MAX_CONCURRENCY`` profile knob; mailcat drives a ~600 MB
    Chromium, so it stays at 1."""

    g = global_heavy
    return {
        "sherlock": _env_int("SHERLOCK_MAX_CONCURRENCY", g),
        "maigret": _env_int("MAIGRET_MAX_CONCURRENCY", min(2, g)),
        "socialscan": _env_int("SOCIALSCAN_MAX_CONCURRENCY", g),
        "phoneinfoga": _env_int("PHONEINFOGA_MAX_CONCURRENCY", g),
        "mailcat": _env_int("MAILCAT_MAX_CONCURRENCY", 1),
        "ghunt": _env_int("GHUNT_MAX_CONCURRENCY", g),
        "ignorant": _env_int("IGNORANT_MAX_CONCURRENCY", g),
        "telegram-resolve": _env_int("TELEGRAM_MAX_CONCURRENCY", g),
        "truecaller": _env_int("TRUECALLER_MAX_CONCURRENCY", g),
        "socid-extractor": _env_int("SOCID_MAX_CONCURRENCY", g),
        "exiftool": _env_int("EXIFTOOL_MAX_CONCURRENCY", g),
    }


class ConcurrencyGuard:
    """Holds the global + per-provider semaphores and hands out heavy slots.

    Semaphores are created lazily on first use so they bind to the running
    event loop, and per-provider bounds are clamped into
    ``[1, global_heavy]`` so the two-limit invariant always holds even if a
    profile file sets a per-provider knob above the global ceiling.
    """

    def __init__(
        self,
        *,
        global_heavy: int,
        per_provider: dict[str, int],
        unlisted_bound: int = _UNLISTED_BOUND,
    ) -> None:
        self.global_heavy = max(1, global_heavy)
        self._bounds = {
            pid: max(1, min(bound, self.global_heavy))
            for pid, bound in per_provider.items()
        }
        self._unlisted_bound = max(1, min(unlisted_bound, self.global_heavy))
        self._global: asyncio.Semaphore | None = None
        self._sems: dict[str, asyncio.Semaphore] = {}

    def bound_for(self, provider_id: str) -> int:
        """The effective per-provider cap (registry value, or default-deny 1)."""

        return self._bounds.get(provider_id, self._unlisted_bound)

    def _global_sem(self) -> asyncio.Semaphore:
        if self._global is None:
            self._global = asyncio.Semaphore(self.global_heavy)
        return self._global

    def _provider_sem(self, provider_id: str) -> asyncio.Semaphore:
        sem = self._sems.get(provider_id)
        if sem is None:
            sem = asyncio.Semaphore(self.bound_for(provider_id))
            self._sems[provider_id] = sem
        return sem

    @asynccontextmanager
    async def heavy_slot(self, provider_id: str) -> AsyncIterator[None]:
        """Acquire one heavy slot for ``provider_id`` for the duration of the
        ``async with`` block (which must span the whole subprocess lifetime).

        Order: per-provider semaphore first, then the global one — so a
        provider blocked at its own cap does not sit on a global slot, and
        because the single global semaphore is always acquired last there is
        no acquisition cycle (no deadlock)."""

        async with self._provider_sem(provider_id):
            async with self._global_sem():
                yield


GLOBAL_HEAVY_CONCURRENCY = _env_int("GLOBAL_HEAVY_CONCURRENCY", _DEFAULT_GLOBAL_HEAVY)

guard = ConcurrencyGuard(
    global_heavy=GLOBAL_HEAVY_CONCURRENCY,
    per_provider=_per_provider_bounds(GLOBAL_HEAVY_CONCURRENCY),
)


def heavy_slot(provider_id: str) -> AsyncIterator[None]:
    """Module-level shortcut for the process-wide guard. Every heavy provider
    route wraps its run in ``async with heavy_slot("<id>"):``."""

    return guard.heavy_slot(provider_id)
