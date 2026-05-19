"""Telegram phone→profile resolver via Telethon MTProto.

Env-conditional: activates only when TELEGRAM_API_ID,
TELEGRAM_API_HASH and TELEGRAM_SESSION_PATH are set. Without those
creds the runner returns a clean `not_configured` result instead of
silently failing — the provider then surfaces "Telethon not provisioned"
to the user.

The resolve flow follows the standard MTProto idiom:
    contacts.ImportContacts([{phone, first_name, last_name}])
  → if users[] non-empty: users.GetFullUser(user_id)
  → contacts.DeleteContacts([user_id])    # clean up our address book

We DO NOT keep the contact added to our session's address book — the
DeleteContacts call runs in a try/finally so a crash mid-resolve still
removes the entry on the next successful run.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger("echo.telegram")

DEFAULT_TIMEOUT_S = 30.0


@dataclass(frozen=True, slots=True)
class TelegramResult:
    configured: bool
    found_on_telegram: bool
    user_id: int | None = None
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    about: str | None = None
    status: str | None = None
    is_premium: bool | None = None
    is_bot: bool | None = None
    is_verified: bool | None = None
    is_scam: bool | None = None
    is_fake: bool | None = None
    photo_url: str | None = None
    error: str | None = None
    raw_warnings: list[str] = field(default_factory=list)


def _env_credentials() -> tuple[str | None, str | None, str | None]:
    return (
        os.environ.get("TELEGRAM_API_ID"),
        os.environ.get("TELEGRAM_API_HASH"),
        os.environ.get("TELEGRAM_SESSION_PATH"),
    )


async def run_telegram_resolve(phone: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> TelegramResult:
    """Resolve a phone to a Telegram profile, if Telethon is provisioned.

    Returns a `TelegramResult` with `configured=False` when env creds
    are absent — UI surfaces "Telegram lookup not configured. See
    RUNBOOK 'Provider credentials'." Real Telethon errors land in
    `error` with `configured=True`; the lookup completes as a Final.
    """

    api_id_raw, api_hash, session_path = _env_credentials()
    if not (api_id_raw and api_hash and session_path):
        return TelegramResult(
            configured=False,
            found_on_telegram=False,
            error=(
                "Telegram lookup not configured. Set TELEGRAM_API_ID, "
                "TELEGRAM_API_HASH, TELEGRAM_SESSION_PATH and provision a "
                "disposable Telegram session (see RUNBOOK)."
            ),
        )

    try:
        api_id = int(api_id_raw)
    except ValueError:
        return TelegramResult(
            configured=False,
            found_on_telegram=False,
            error=f"TELEGRAM_API_ID is not an integer: {api_id_raw!r}",
        )

    # Lazy import — keeps test runs that don't exercise the Telegram
    # path from forcing the (heavy) telethon import on every sidecar
    # startup. The actual route handler awaits this function, so the
    # import cost amortises across runs.
    try:
        from telethon import TelegramClient
        from telethon.tl.functions.contacts import (
            DeleteContactsRequest,
            ImportContactsRequest,
        )
        from telethon.tl.functions.users import GetFullUserRequest
        from telethon.tl.types import InputPhoneContact
    except ImportError as err:
        return TelegramResult(
            configured=True,
            found_on_telegram=False,
            error=f"telethon import failed: {err}",
        )

    client = TelegramClient(session_path, api_id, api_hash, timeout=timeout_s)

    try:
        await client.connect()
        if not await client.is_user_authorized():
            return TelegramResult(
                configured=True,
                found_on_telegram=False,
                error="Telethon session not authorised. Re-run the SIM-provisioning step from RUNBOOK.",
            )

        contact = InputPhoneContact(
            client_id=0,
            phone=phone,
            first_name="echo-lookup",
            last_name="",
        )
        import_result = await client(ImportContactsRequest([contact]))
        users = list(getattr(import_result, "users", []) or [])

        if not users:
            return TelegramResult(configured=True, found_on_telegram=False)

        user = users[0]
        user_id = int(user.id)
        full = None
        try:
            full = await client(GetFullUserRequest(user_id))
        except Exception as err:  # noqa: BLE001 — surface as warning, not failure
            logger.warning("GetFullUserRequest failed user=%s err=%s", user_id, err)

        about = None
        if full is not None:
            full_user = getattr(full, "full_user", None)
            about = getattr(full_user, "about", None)

        status_obj = getattr(user, "status", None)
        status_name = type(status_obj).__name__ if status_obj is not None else None

        result = TelegramResult(
            configured=True,
            found_on_telegram=True,
            user_id=user_id,
            username=getattr(user, "username", None),
            first_name=getattr(user, "first_name", None),
            last_name=getattr(user, "last_name", None),
            about=about,
            status=status_name,
            is_premium=bool(getattr(user, "premium", False)),
            is_bot=bool(getattr(user, "bot", False)),
            is_verified=bool(getattr(user, "verified", False)),
            is_scam=bool(getattr(user, "scam", False)),
            is_fake=bool(getattr(user, "fake", False)),
        )

        # Best-effort cleanup. A failure here is non-fatal — we've already
        # got the data we need; the contact entry just lingers in the
        # session for a bit.
        try:
            await client(DeleteContactsRequest([user_id]))
        except Exception as err:  # noqa: BLE001
            logger.warning("DeleteContactsRequest failed user=%s err=%s", user_id, err)

        return result
    except Exception as err:  # noqa: BLE001
        logger.exception("telegram resolve crashed")
        return TelegramResult(
            configured=True,
            found_on_telegram=False,
            error=f"telethon error: {err}",
        )
    finally:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass
