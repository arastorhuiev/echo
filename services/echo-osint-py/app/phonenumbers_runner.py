"""In-process libphonenumber wrapper.

Unlike Sherlock/Maigret/mailcat, this provider doesn't spawn a subprocess —
`phonenumbers` is a synchronous Python library that resolves a parse +
metadata lookup in well under a millisecond. So the route returns a single
JSON object instead of SSE-streaming; the TS wrapper translates it into
the standard `Started → Final` envelope.

Source: Google libphonenumber (Apache-2.0), Python port by David Drysdale.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import phonenumbers
from phonenumbers import NumberParseException, carrier, geocoder, timezone

NumberType = Literal[
    "FIXED_LINE",
    "MOBILE",
    "FIXED_LINE_OR_MOBILE",
    "TOLL_FREE",
    "PREMIUM_RATE",
    "SHARED_COST",
    "VOIP",
    "PERSONAL_NUMBER",
    "PAGER",
    "UAN",
    "VOICEMAIL",
    "UNKNOWN",
]

# Map libphonenumber's PhoneNumberType enum ints to our string names. We
# enumerate explicitly so a future upstream enum extension surfaces as
# "UNKNOWN" rather than crashing the runner.
_TYPE_MAP: dict[int, NumberType] = {
    phonenumbers.PhoneNumberType.FIXED_LINE: "FIXED_LINE",
    phonenumbers.PhoneNumberType.MOBILE: "MOBILE",
    phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE: "FIXED_LINE_OR_MOBILE",
    phonenumbers.PhoneNumberType.TOLL_FREE: "TOLL_FREE",
    phonenumbers.PhoneNumberType.PREMIUM_RATE: "PREMIUM_RATE",
    phonenumbers.PhoneNumberType.SHARED_COST: "SHARED_COST",
    phonenumbers.PhoneNumberType.VOIP: "VOIP",
    phonenumbers.PhoneNumberType.PERSONAL_NUMBER: "PERSONAL_NUMBER",
    phonenumbers.PhoneNumberType.PAGER: "PAGER",
    phonenumbers.PhoneNumberType.UAN: "UAN",
    phonenumbers.PhoneNumberType.VOICEMAIL: "VOICEMAIL",
}


@dataclass(frozen=True, slots=True)
class PhonenumbersResult:
    valid: bool
    possible: bool
    e164: str | None
    national_format: str | None
    international_format: str | None
    country_code: int | None
    region_code: str | None
    number_type: NumberType
    carrier_name: str
    geocoded_location: str
    timezones: list[str]
    parse_error: str | None


def run_phonenumbers(phone: str) -> PhonenumbersResult:
    """Validate + enrich a phone number against libphonenumber's offline DB.

    Returns a result object even when parsing fails — `valid=False` plus a
    `parse_error` describing why. We deliberately do NOT raise on parse
    failure: invalid-input is a useful signal to surface in the UI, not
    a server-side exception.
    """

    try:
        # `None` = no default region — caller must pass E.164 (`+CC...`).
        parsed = phonenumbers.parse(phone, None)
    except NumberParseException as exc:
        return PhonenumbersResult(
            valid=False,
            possible=False,
            e164=None,
            national_format=None,
            international_format=None,
            country_code=None,
            region_code=None,
            number_type="UNKNOWN",
            carrier_name="",
            geocoded_location="",
            timezones=[],
            parse_error=str(exc),
        )

    is_valid = phonenumbers.is_valid_number(parsed)
    is_possible = phonenumbers.is_possible_number(parsed)

    number_type = _TYPE_MAP.get(phonenumbers.number_type(parsed), "UNKNOWN")

    return PhonenumbersResult(
        valid=is_valid,
        possible=is_possible,
        e164=phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164),
        national_format=phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.NATIONAL),
        international_format=phonenumbers.format_number(
            parsed, phonenumbers.PhoneNumberFormat.INTERNATIONAL
        ),
        country_code=parsed.country_code,
        region_code=phonenumbers.region_code_for_number(parsed),
        number_type=number_type,
        carrier_name=carrier.name_for_number(parsed, "en") or "",
        geocoded_location=geocoder.description_for_number(parsed, "en") or "",
        timezones=list(timezone.time_zones_for_number(parsed)),
        parse_error=None,
    )
