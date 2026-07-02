"""One-time interactive Telegram (Telethon) login for the OSINT sidecar.

Run once to mint the portable session file the `telegram-resolve`
provider needs:

    docker compose run --rm osint-py python -m app.telegram_login

Reads TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_PATH from
the environment (wired via `.env.providers`). Prompts for your phone
number and the login code Telegram sends you, then writes the session
file to TELEGRAM_SESSION_PATH — which points at the mounted `./secrets`
volume, so the file lands on the host at `./secrets/telegram.session`.

Unlike a bare `client.start()`, this driver prints the channel Telegram
used to deliver the code (App / Sms / Call) and turns the common login
failures into clear one-line messages, so a code that never arrives is
diagnosable instead of a silent hang at the code prompt.

The session file IS the credential: it lives under the git-ignored
`secrets/` dir and must never be committed or shared. To run the
provider on another host, copy that one file across — you do NOT need
to repeat this interactive login there.
"""

from __future__ import annotations

import os
import sys
from getpass import getpass
from pathlib import Path


def _label(me: object) -> str:
    username = getattr(me, "username", None)
    return f"@{username}" if username else getattr(me, "first_name", None) or "your account"


def _channel_hint(channel: str) -> str:
    hints = {
        "App": (
            "Open the Telegram app where this number is logged in → the 'Telegram' "
            "service chat. The code is delivered there, NOT by SMS."
        ),
        "Sms": "Check this number's SMS inbox.",
        "Call": "Telegram will call and dictate the code.",
        "FlashCall": "Telegram calls; the code is the caller number's last digits.",
        "MissedCall": "Telegram calls and hangs up; code = caller's last digits.",
    }
    return hints.get(channel, "Check your phone for the code.")


def main() -> int:
    api_id_raw = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")
    session_path = os.environ.get("TELEGRAM_SESSION_PATH")

    # The `and` chain narrows all three to non-None for the code below
    # (mirrors telegram_runner.py); the comprehension only names which are
    # actually missing for the error message.
    if not (api_id_raw and api_hash and session_path):
        missing = [
            name
            for name, value in (
                ("TELEGRAM_API_ID", api_id_raw),
                ("TELEGRAM_API_HASH", api_hash),
                ("TELEGRAM_SESSION_PATH", session_path),
            )
            if not value
        ]
        print(
            f"error: missing env var(s): {', '.join(missing)}.\n"
            "Set them in .env.providers (see docs/OWNER_TODO.md §2b).",
            file=sys.stderr,
        )
        return 2

    try:
        api_id = int(api_id_raw)
    except ValueError:
        print(f"error: TELEGRAM_API_ID is not an integer: {api_id_raw!r}", file=sys.stderr)
        return 2

    # The session path normally points inside the mounted secrets volume
    # (/secrets/...). Make sure the parent dir exists before Telethon opens
    # the SQLite session file there.
    session_file = Path(session_path)
    try:
        session_file.parent.mkdir(parents=True, exist_ok=True)
    except OSError as err:
        print(f"error: cannot create {session_file.parent}: {err}", file=sys.stderr)
        return 1

    from telethon.errors import (
        ApiIdInvalidError,
        FloodWaitError,
        PhoneCodeExpiredError,
        PhoneCodeInvalidError,
        PhoneNumberBannedError,
        PhoneNumberInvalidError,
        SessionPasswordNeededError,
    )
    from telethon.sync import TelegramClient

    client = TelegramClient(session_path, api_id, api_hash)
    client.connect()

    try:
        if client.is_user_authorized():
            print(f"✓ Already authorised as {_label(client.get_me())}.")
            print(f"  Session at {session_path}. Nothing to do.")
            return 0

        phone = input("Phone number (with country code, e.g. +380...): ").strip()

        try:
            sent = client.send_code_request(phone)
        except ApiIdInvalidError:
            print(
                "error: api_id/api_hash rejected by Telegram. Re-check both values "
                "from my.telegram.org.",
                file=sys.stderr,
            )
            return 1
        except PhoneNumberBannedError:
            print(f"error: {phone} is banned on Telegram.", file=sys.stderr)
            return 1
        except PhoneNumberInvalidError:
            print(f"error: invalid phone number: {phone!r}", file=sys.stderr)
            return 1
        except FloodWaitError as err:
            mins = round(err.seconds / 60)
            print(
                f"error: rate-limited by Telegram — wait {err.seconds}s (~{mins} min) "
                "before retrying. Each repeated attempt extends this; stop and wait.",
                file=sys.stderr,
            )
            return 1

        # .start() hides this; surfacing it is the whole point of this driver.
        channel = type(sent.type).__name__.removeprefix("SentCodeType")
        print(f"\n→ Telegram reports the code was sent via: {channel}")
        print(f"  {_channel_hint(channel)}")
        if sent.next_type is not None:
            next_channel = type(sent.next_type).__name__.removeprefix("SentCodeType")
            print(f"  (A resend would arrive via: {next_channel} — re-run to trigger it.)")

        try:
            code = input("\nPlease enter the code you received: ").strip()
            try:
                client.sign_in(phone, code=code)
            except SessionPasswordNeededError:
                client.sign_in(password=getpass("2FA password: "))
        except PhoneCodeInvalidError:
            print("error: that code is wrong. Re-run and try again.", file=sys.stderr)
            return 1
        except PhoneCodeExpiredError:
            print("error: that code expired. Re-run to request a fresh one.", file=sys.stderr)
            return 1

        me = client.get_me()
        print(f"\n✓ Logged in as {_label(me)}. Session saved to {session_path}.")
        print("Start the stack now:  docker compose up -d")
        return 0
    finally:
        client.disconnect()


if __name__ == "__main__":
    raise SystemExit(main())
