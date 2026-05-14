# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for echo apps.
# Build target chosen at build time via APP arg (api or worker).

ARG NODE_VERSION=24

# ─────────────────────────────────────────────────────────────
# base — pinned Node + pnpm via corepack
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────
# deps + build — installs all deps, builds the chosen app and
# all its workspace dependencies (config, db, observability, contracts)
# in topological order.
# ─────────────────────────────────────────────────────────────
FROM base AS builder
ARG APP=api

# Manifests + workspace shape first, for layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/${APP}/package.json apps/${APP}/
COPY packages/ packages/

# Workspace `prepare` hooks build dist/ for the @echo/* packages here,
# so by the time apps/${APP} compiles, its workspace deps are ready.
RUN pnpm install --frozen-lockfile

# Sources for the chosen app
COPY apps/${APP}/ apps/${APP}/

# `... ` (3 dots) = the app + every workspace package it transitively depends on.
RUN pnpm --filter "@echo/${APP}..." run build

# ─────────────────────────────────────────────────────────────
# runtime — slim image with only what's needed to run
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP=api
ENV NODE_ENV=production \
    APP=${APP}

RUN apk add --no-cache tini wget

WORKDIR /app

# Copy node_modules + built workspace deps + the app itself.
# pnpm symlink fan-out is preserved by copying both the root
# /app/node_modules (.pnpm content store) and the per-app
# apps/<app>/node_modules (the symlink view).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages ./packages
COPY --from=builder --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=node:node /app/apps/${APP}/dist ./apps/${APP}/dist
COPY --from=builder --chown=node:node /app/apps/${APP}/node_modules ./apps/${APP}/node_modules
COPY --from=builder --chown=node:node /app/apps/${APP}/package.json ./apps/${APP}/

USER node
WORKDIR /app/apps/${APP}

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
