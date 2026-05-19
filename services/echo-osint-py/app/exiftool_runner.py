"""Subprocess-based ExifTool runner.

ExifTool is the gold-standard EXIF / IPTC / XMP metadata reader (Phil
Harvey, GPL-3.0 + Artistic dual). We invoke the `exiftool` Perl CLI as
a subprocess — `mere aggregation`, GPL stays at the binary boundary.

We download the image URL via httpx into a temp file, run
`exiftool -json -G -fast2 <file>`, then parse the dict it prints. The
output is huge by default (~50-200 fields per image); we slim it to a
fixed allowlist the UI surfaces: who made the picture, when, where, on
what device, and any IPTC byline / copyright credits.

Streaming subprocess stdout would buy nothing here — ExifTool only
flushes at end-of-process — so we wait for exit and parse the full
buffer. Cancellation still works via SIGTERM-then-SIGKILL.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile

import httpx

logger = logging.getLogger("echo.exiftool")

DEFAULT_TIMEOUT_S = 30.0
TERM_GRACE_S = 3.0
EXIFTOOL_BIN = "exiftool"
MAX_IMAGE_BYTES = 32 * 1024 * 1024  # 32 MiB cap on the image we download

# Allowlist of EXIF/XMP/IPTC fields we surface. Anything else gets
# dropped at the normalisation step to keep the wire payload bounded
# and avoid leaking irrelevant metadata.
SURFACED_TAGS: dict[str, str] = {
    # Core EXIF
    "EXIF:Make": "make",
    "EXIF:Model": "model",
    "EXIF:DateTimeOriginal": "date_taken",
    "EXIF:CreateDate": "create_date",
    "EXIF:ModifyDate": "modify_date",
    "EXIF:LensModel": "lens_model",
    "EXIF:Software": "software",
    # GPS
    "EXIF:GPSLatitude": "gps_latitude",
    "EXIF:GPSLongitude": "gps_longitude",
    "EXIF:GPSAltitude": "gps_altitude",
    "EXIF:GPSDateStamp": "gps_date",
    # IPTC byline (often carries the photographer's name)
    "IPTC:By-line": "byline",
    "IPTC:Credit": "credit",
    "IPTC:Source": "source",
    "IPTC:CopyrightNotice": "copyright",
    # XMP modern equivalents
    "XMP:Creator": "creator",
    "XMP:Rights": "rights",
    # File-level metadata
    "File:FileType": "file_type",
    "File:MIMEType": "mime_type",
    "File:ImageWidth": "width",
    "File:ImageHeight": "height",
}


@dataclass(frozen=True, slots=True)
class ExifResult:
    found: bool
    file_type: str | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    # Camera + capture
    make: str | None = None
    model: str | None = None
    lens_model: str | None = None
    software: str | None = None
    date_taken: str | None = None
    # GPS — we leave lat/lon as strings to preserve the raw EXIF
    # representation; the UI can parse "37 deg 24' 35.40\" N" if it wants
    # a numeric form.
    gps_latitude: str | None = None
    gps_longitude: str | None = None
    gps_altitude: str | None = None
    gps_date: str | None = None
    # IPTC / XMP credits
    byline: str | None = None
    credit: str | None = None
    source: str | None = None
    copyright: str | None = None
    creator: str | None = None
    rights: str | None = None
    # Catch-all for surfaced-but-not-in-the-dataclass fields, kept as
    # strings to stay schema-stable.
    extra: dict[str, str] = field(default_factory=dict)
    error: str | None = None


async def run_exiftool(image_url: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> ExifResult:
    """Download `image_url`, exec exiftool, return the slim ExifResult.

    The download is bounded by `MAX_IMAGE_BYTES` and `timeout_s` (the
    same timeout covers both the download and the exiftool run).
    """

    tmp = NamedTemporaryFile(prefix="exif-", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    try:
        try:
            async with httpx.AsyncClient(
                timeout=timeout_s,
                follow_redirects=True,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/126.0.0.0 Safari/537.36"
                    ),
                },
            ) as client:
                response = await client.get(image_url)
        except (httpx.RequestError, httpx.HTTPError) as err:
            return ExifResult(found=False, error=f"image fetch failed: {err}")

        if response.status_code >= 400:
            return ExifResult(
                found=False,
                error=f"image fetch returned {response.status_code} {response.reason_phrase}",
            )

        body = response.content
        if len(body) > MAX_IMAGE_BYTES:
            return ExifResult(
                found=False,
                error=f"image exceeds {MAX_IMAGE_BYTES} byte cap ({len(body)} downloaded)",
            )

        tmp_path.write_bytes(body)

        cmd = [EXIFTOOL_BIN, "-json", "-G", "-fast2", str(tmp_path)]

        logger.info("exiftool start url=%s size=%d", image_url, len(body))
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
                    return ExifResult(
                        found=False,
                        error=f"exiftool exited {rc}: {stderr.strip()[:400] or 'unknown'}",
                    )

            stdout = (await proc.stdout.read()).decode("utf-8", errors="replace") if proc.stdout else ""

            try:
                payload = json.loads(stdout)
            except json.JSONDecodeError as err:
                return ExifResult(found=False, error=f"exiftool output JSON parse failed: {err}")

            # exiftool -json always returns a list (one entry per file).
            if not isinstance(payload, list) or not payload:
                return ExifResult(found=False, error="exiftool returned empty result")

            entry = payload[0]
            if not isinstance(entry, dict):
                return ExifResult(found=False, error="exiftool entry not a dict")

            return _normalise(entry)
        finally:
            if proc.returncode is None:
                logger.info("exiftool terminate pid=%s", proc.pid)
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
                except TimeoutError:
                    logger.warning("exiftool kill pid=%s", proc.pid)
                    proc.kill()
                    await proc.wait()
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _normalise(entry: Mapping[str, object]) -> ExifResult:
    """Map exiftool's flat dict into the slim ExifResult."""

    slim: dict[str, str] = {}
    for tag, key in SURFACED_TAGS.items():
        if tag in entry:
            value = entry[tag]
            if value is None or value == "":
                continue
            slim[key] = str(value)

    # Width / height are present as ints in exiftool's output; coerce.
    def _to_int(s: str | None) -> int | None:
        if s is None:
            return None
        try:
            return int(float(s))
        except (TypeError, ValueError):
            return None

    return ExifResult(
        found=bool(slim),
        file_type=slim.get("file_type"),
        mime_type=slim.get("mime_type"),
        width=_to_int(slim.get("width")),
        height=_to_int(slim.get("height")),
        make=slim.get("make"),
        model=slim.get("model"),
        lens_model=slim.get("lens_model"),
        software=slim.get("software"),
        date_taken=slim.get("date_taken"),
        gps_latitude=slim.get("gps_latitude"),
        gps_longitude=slim.get("gps_longitude"),
        gps_altitude=slim.get("gps_altitude"),
        gps_date=slim.get("gps_date"),
        byline=slim.get("byline"),
        credit=slim.get("credit"),
        source=slim.get("source"),
        copyright=slim.get("copyright"),
        creator=slim.get("creator"),
        rights=slim.get("rights"),
    )
