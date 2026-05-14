# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for echo apps.
# Build target chosen at build time via APP arg (api or worker).
# Worker target won't be used until P3 lands apps/worker; the plumbing
# is here so we don't change Dockerfile shape later.

ARG NODE_VERSION=24

# ─────────────────────────────────────────────────────────────
# base — pinned Node + pnpm via corepack
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────
# deps + build — installs all deps, builds the chosen app
# ─────────────────────────────────────────────────────────────
FROM base AS builder
ARG APP=api

# Manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/${APP}/package.json apps/${APP}/
COPY packages/ packages/

RUN pnpm install --frozen-lockfile

# Now copy sources and build
COPY apps/${APP}/ apps/${APP}/
RUN pnpm -F "@echo/${APP}" build

# ─────────────────────────────────────────────────────────────
# runtime — slim image with only what's needed to run
# ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP=api
ENV NODE_ENV=production \
    APP=${APP}

RUN apk add --no-cache tini wget

WORKDIR /app

# Copy node_modules and built artifacts (preserve ownership for the node user).
# pnpm puts each workspace package's direct deps in apps/<app>/node_modules
# as symlinks pointing into /app/node_modules/.pnpm/, so we must copy BOTH:
# - the root /app/node_modules (the actual .pnpm content-addressable store)
# - the per-app apps/<app>/node_modules (the symlink fan-out)
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
