"""Tests for the sidecar concurrency guard (phase P9a — safety floor).

Covers the two invariants the DoD calls out:
* **default-DENY** — an unregistered provider is capped at 1, never unbounded;
* **per-provider bound ≤ GLOBAL_HEAVY** — enforced even if a knob over-sets it;
plus proof that ``heavy_slot`` actually bounds live concurrency (single
provider cap, global ceiling across providers, and the unlisted default-deny).
"""

from __future__ import annotations

import asyncio

from app.concurrency import ConcurrencyGuard, _env_int, _per_provider_bounds


def _guard(global_heavy: int = 3, per_provider: dict[str, int] | None = None) -> ConcurrencyGuard:
    return ConcurrencyGuard(
        global_heavy=global_heavy,
        per_provider={"maigret": 2} if per_provider is None else per_provider,
    )


def test_unlisted_provider_defaults_to_one() -> None:
    assert _guard().bound_for("totally-unknown-provider") == 1


def test_registered_provider_uses_its_bound() -> None:
    assert _guard(global_heavy=3, per_provider={"maigret": 2}).bound_for("maigret") == 2


def test_per_provider_bound_clamped_to_global() -> None:
    # a knob set above the global ceiling must be clamped down to it
    assert _guard(global_heavy=2, per_provider={"sherlock": 10}).bound_for("sherlock") == 2


def test_bounds_never_below_one() -> None:
    assert _guard(global_heavy=3, per_provider={"maigret": 0}).bound_for("maigret") == 1


def test_env_int_rejects_bad_values(monkeypatch) -> None:
    monkeypatch.delenv("X_KNOB", raising=False)
    assert _env_int("X_KNOB", 5) == 5
    monkeypatch.setenv("X_KNOB", "not-a-number")
    assert _env_int("X_KNOB", 5) == 5
    monkeypatch.setenv("X_KNOB", "0")
    assert _env_int("X_KNOB", 5) == 5
    monkeypatch.setenv("X_KNOB", "7")
    assert _env_int("X_KNOB", 5) == 7


def test_maigret_knob_from_env(monkeypatch) -> None:
    monkeypatch.setenv("MAIGRET_MAX_CONCURRENCY", "1")
    assert _per_provider_bounds(global_heavy=3)["maigret"] == 1


def test_registry_invariant_all_within_global() -> None:
    g = 3
    bounds = _per_provider_bounds(global_heavy=g)
    guard = ConcurrencyGuard(global_heavy=g, per_provider=bounds)
    for pid in bounds:
        assert 1 <= guard.bound_for(pid) <= g


async def test_heavy_slot_bounds_single_provider() -> None:
    guard = _guard(global_heavy=5, per_provider={"maigret": 2})
    peak = _PeakTracker()
    await asyncio.gather(*(peak.run(guard, "maigret") for _ in range(8)))
    assert peak.value <= 2


async def test_heavy_slot_global_ceiling_across_providers() -> None:
    # each provider individually allows 5, but the global ceiling is 2
    guard = ConcurrencyGuard(
        global_heavy=2,
        per_provider={"sherlock": 5, "maigret": 5, "ghunt": 5},
    )
    peak = _PeakTracker()
    pids = ["sherlock", "maigret", "ghunt"] * 4
    await asyncio.gather(*(peak.run(guard, p) for p in pids))
    assert peak.value <= 2


async def test_unlisted_provider_runs_serially() -> None:
    guard = _guard(global_heavy=5, per_provider={"maigret": 2})
    peak = _PeakTracker()
    await asyncio.gather(*(peak.run(guard, "fake-unlisted") for _ in range(5)))
    assert peak.value == 1  # default-deny → strictly serial


class _PeakTracker:
    """Records the maximum number of coroutines simultaneously inside a slot."""

    def __init__(self) -> None:
        self._live = 0
        self.value = 0

    async def run(self, guard: ConcurrencyGuard, provider_id: str) -> None:
        async with guard.heavy_slot(provider_id):
            self._live += 1
            self.value = max(self.value, self._live)
            await asyncio.sleep(0.02)
            self._live -= 1
