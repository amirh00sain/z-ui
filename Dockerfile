# syntax=docker/dockerfile:1
#
# xray-pilot — single image, single process.
#
#   1) web      : builds the React frontend
#   2) build    : compiles the Go binary with the frontend embedded (go:embed)
#   3) runtime  : minimal Debian image that serves the panel on :8080
#
# Build:  docker build -t xray-pilot .
# Run:    docker run -p 8080:8080 -v xray-pilot-data:/data xray-pilot

########################################################################
# 1. Frontend
########################################################################
FROM node:24-bookworm-slim AS web

WORKDIR /src/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./

# Surfaced in the UI as "vX.Y.Z"; falls back to "dev" for local builds.
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=${VITE_APP_VERSION}

RUN npm run build

########################################################################
# 2. Go binary
########################################################################
FROM golang:1.26-bookworm AS build

WORKDIR /src

# Warm the module cache before copying the sources so source edits do not
# invalidate dependency downloads.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# main.go embeds frontend/dist, so it must exist before the build.
COPY --from=web /src/frontend/dist ./frontend/dist

# modernc.org/sqlite is pure Go — CGO stays off, which keeps the binary static.
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux GOFLAGS=-mod=mod \
    go build -trimpath -ldflags "-s -w -X main.Version=${VERSION}" -o /out/xray-pilot .

########################################################################
# 3. Runtime
########################################################################
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 xray \
 && useradd --system --uid 10001 --gid xray --home-dir /app --shell /usr/sbin/nologin xray \
 && mkdir -p /app /data /data/ssh \
 && chown -R xray:xray /app /data

WORKDIR /app
COPY --from=build --chown=xray:xray /out/xray-pilot /app/xray-pilot

# The panel always listens on 8080. Override with XRAY_PILOT_SERVER_PORT if needed.
ENV XRAY_PILOT_SERVER_PORT=8080 \
    XRAY_PILOT_SERVER_MODE=release \
    XRAY_PILOT_DATABASE_DRIVER=sqlite \
    XRAY_PILOT_DATABASE_DSN=/data/xray-pilot.db \
    XRAY_PILOT_SSH_DEFAULT_KEY_PATH=/data/ssh/id_ed25519 \
    XRAY_PILOT_SSH_KNOWN_HOSTS_PATH=/data/known_hosts \
    TZ=UTC

# Persist the SQLite database, backups, known_hosts and any mounted SSH key.
VOLUME ["/data"]

USER xray
EXPOSE 8080

ENTRYPOINT ["/app/xray-pilot"]
