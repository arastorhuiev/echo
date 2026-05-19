# syntax=docker/dockerfile:1.7
# Python OSINT sidecar — hosts every Python-only OSINT tool for echo.
# Multi-stage: build wheels into a venv, then copy the venv into a slim runtime.

ARG PYTHON_VERSION=3.13

# ─────────────────────────────────────────────────────────────
# builder — installs deps into an isolated venv
# ─────────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# PhoneInfoga is a Go binary we invoke as a subprocess per request.
# Pinned tag — bumping requires re-running the smoke-test in RUNBOOK.
ARG PHONEINFOGA_VERSION=2.11.0

WORKDIR /build

# Sherlock has no compiled deps but a few transitive ones do (e.g. lxml on
# some sub-deps). Install build essentials only in the builder stage so the
# runtime image stays slim. `curl` here downloads the PhoneInfoga binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pull the PhoneInfoga prebuilt binary. amd64-only — arm64 deployments
# will need a per-arch download here.
RUN curl -fsSL -o /tmp/phoneinfoga.tar.gz \
        "https://github.com/sundowndev/phoneinfoga/releases/download/v${PHONEINFOGA_VERSION}/phoneinfoga_Linux_x86_64.tar.gz" \
    && tar -xzf /tmp/phoneinfoga.tar.gz -C /usr/local/bin phoneinfoga \
    && chmod +x /usr/local/bin/phoneinfoga \
    && rm /tmp/phoneinfoga.tar.gz

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml ./
RUN pip install --upgrade pip setuptools wheel \
    && pip install .

# ─────────────────────────────────────────────────────────────
# runtime — slim image, venv only
# ─────────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# wget is used by the docker-compose healthcheck. tini reaps zombie sherlock
# subprocesses (we spawn one per request and terminate them on cancel).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        wget \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 osint \
    && useradd --system --uid 1001 --gid osint --home /app osint

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /usr/local/bin/phoneinfoga /usr/local/bin/phoneinfoga
COPY --chown=osint:osint app/ ./app/

USER osint

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-config", "app/logging.json"]
