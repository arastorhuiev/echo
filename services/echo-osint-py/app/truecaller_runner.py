"""Truecaller phone→name resolver via the truecallerpy unofficial wrapper.

Env-conditional: activates only when TRUECALLER_INSTALLATION_ID is set.
The installation_id is the one-time login artifact captured from the
SMS-flow described in RUNBOOK.

truecallerpy is an unofficial library: Truecaller can ban the linked
account at any time, AES-rotate the auth schema between minor releases,
or break the underlying mobile API endpoint outright. We absorb all of
those as a `Final` with `error` set rather than throwing — the UI shows
"Truecaller temporarily unavailable" and the rest of the lookup
proceeds.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger("echo.truecaller")

DEFAULT_TIMEOUT_S = 20.0


@dataclass(frozen=True, slots=True)
class TruecallerAddress:
    city: str = ""
    country_code: str = ""
    address: str = ""


@dataclass(frozen=True, slots=True)
class TruecallerSpamInfo:
    spam_score: int = 0
    spam_type: str | None = None


@dataclass(frozen=True, slots=True)
class TruecallerResult:
    configured: bool
    found: bool
    name: str | None = None
    alt_name: str | None = None
    image_url: str | None = None
    gender: str | None = None
    addresses: list[TruecallerAddress] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    spam_info: TruecallerSpamInfo | None = None
    score: float | None = None
    access: str | None = None
    enhanced: bool | None = None
    error: str | None = None


async def run_truecaller(
    phone: str, country_code: str | None, timeout_s: float = DEFAULT_TIMEOUT_S
) -> TruecallerResult:
    """Look up a phone number via the truecallerpy library, if configured."""

    installation_id = os.environ.get("TRUECALLER_INSTALLATION_ID")
    if not installation_id:
        return TruecallerResult(
            configured=False,
            found=False,
            error=(
                "Truecaller lookup not configured. Set "
                "TRUECALLER_INSTALLATION_ID by running the SMS-login flow "
                "from RUNBOOK 'Provider credentials'."
            ),
        )

    try:
        import truecallerpy
    except ImportError as err:
        return TruecallerResult(
            configured=True,
            found=False,
            error=f"truecallerpy import failed: {err}",
        )

    # truecallerpy 1.0.x exposes `search_phonenumber` as an async coroutine
    # with camelCase kwargs (phoneNumber / countryCode / installationId).
    # `wait_for` enforces our timeout bound — the library's own httpx
    # client has its own 5s default but we still want a clean ceiling.
    fn = getattr(truecallerpy, "search_phonenumber", None)
    if fn is None:
        return TruecallerResult(
            configured=True,
            found=False,
            error="truecallerpy.search_phonenumber not found — library API drift?",
        )

    try:
        raw = await asyncio.wait_for(
            fn(
                phoneNumber=phone,
                countryCode=country_code or "ZZ",
                installationId=installation_id,
            ),
            timeout=timeout_s,
        )
    except TimeoutError:
        return TruecallerResult(configured=True, found=False, error="truecallerpy timed out")
    except Exception as err:  # noqa: BLE001
        logger.exception("truecallerpy crashed")
        return TruecallerResult(configured=True, found=False, error=f"truecallerpy error: {err}")

    # 1.0.x swallows httpx errors into a sibling envelope rather than
    # raising — propagate that as our own `error` so the UI sees the
    # real cause (HTTP 401 = banned installationId, 5xx = upstream
    # outage, etc.) instead of a generic "no result".
    if isinstance(raw, dict) and isinstance(raw.get("error"), str):
        message = raw.get("message") if isinstance(raw.get("message"), str) else raw["error"]
        status = raw.get("status_code")
        suffix = f" (HTTP {status})" if isinstance(status, int) else ""
        return TruecallerResult(
            configured=True, found=False, error=f"truecallerpy error: {message}{suffix}"
        )

    return _normalise(raw)


def _normalise(raw: object) -> TruecallerResult:
    """Map truecallerpy's response (varies by version) into our slim shape.

    Tolerant of structural drift: anything we can't find maps to a safe
    default + `configured=True, found=False` rather than raising.
    """

    if not isinstance(raw, dict):
        return TruecallerResult(configured=True, found=False, error="truecallerpy returned non-dict")

    data_root = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    if not isinstance(data_root, dict):
        return TruecallerResult(configured=True, found=False, error="truecallerpy data not a dict")

    data_list = data_root.get("data")
    if not isinstance(data_list, list) or not data_list:
        return TruecallerResult(configured=True, found=False)

    first = data_list[0]
    if not isinstance(first, dict):
        return TruecallerResult(configured=True, found=False)

    addresses_raw = first.get("addresses") if isinstance(first.get("addresses"), list) else []
    addresses: list[TruecallerAddress] = []
    for a in addresses_raw:
        if isinstance(a, dict):
            addresses.append(
                TruecallerAddress(
                    city=str(a.get("city", "") or ""),
                    country_code=str(a.get("countryCode", "") or ""),
                    address=str(a.get("address", "") or ""),
                )
            )

    emails_raw = first.get("internetAddresses") if isinstance(first.get("internetAddresses"), list) else []
    emails: list[str] = []
    for e in emails_raw:
        if isinstance(e, dict):
            ident = e.get("id")
            if isinstance(ident, str) and "@" in ident:
                emails.append(ident)

    tags_raw = first.get("tags") if isinstance(first.get("tags"), list) else []
    tags = [t for t in tags_raw if isinstance(t, str)]

    spam_info_raw = first.get("spamInfo") if isinstance(first.get("spamInfo"), dict) else None
    spam_info: TruecallerSpamInfo | None = None
    if spam_info_raw is not None:
        score = spam_info_raw.get("spamScore", 0)
        spam_type = spam_info_raw.get("spamType")
        spam_info = TruecallerSpamInfo(
            spam_score=int(score) if isinstance(score, int) else 0,
            spam_type=str(spam_type) if isinstance(spam_type, str) else None,
        )

    return TruecallerResult(
        configured=True,
        found=True,
        name=str(first.get("name", "") or "") or None,
        alt_name=str(first.get("altName", "") or "") or None,
        image_url=str(first.get("image", "") or "") or None,
        gender=str(first.get("gender", "") or "") or None,
        addresses=addresses,
        emails=emails,
        tags=tags,
        spam_info=spam_info,
        score=float(first.get("score")) if isinstance(first.get("score"), int | float) else None,
        access=str(first.get("access", "") or "") or None,
        enhanced=bool(first.get("enhanced")) if "enhanced" in first else None,
    )
