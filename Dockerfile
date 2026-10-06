# syntax=docker/dockerfile:1

# The two build stages run on the builder's own platform and only the runtime
# stage is per-architecture, so a multi-arch build does not run npm or the Go
# compiler under emulation: the bundle is platform-independent and Go
# cross-compiles.

# Builds the frontend's static bundle.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Builds the backend binary. Migrations are embedded (see
# backend/migrations/embed.go), so the image needs nothing else at runtime to
# bring a fresh database up to date.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS backend
WORKDIR /app
# The version reported by GET /api/health and shown in the sidebar: the
# release tag, or the commit's short hash for an edge build, passed by the
# workflows under .github/workflows/; left at "dev" for a local
# `docker build`.
ARG VERSION=dev
ARG TARGETOS TARGETARCH
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -ldflags "-X main.version=${VERSION}" -o /app/server ./cmd/server

# Runtime: Caddy serves the frontend build and reverse-proxies /api/* to the
# backend binary, both started by entrypoint.sh. This is the only image the
# project publishes: it is not split into a frontend and a backend image
# because the backend never serves static files and self-hosting should
# stay a single container to run.
FROM caddy:2-alpine
RUN apk add --no-cache curl tzdata
COPY --from=frontend /app/dist /srv/www
COPY --from=backend /app/server /app/server
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Where GAMELOG_IMAGES_DIR points by default, and where the README's compose
# example mounts a named volume: everything the deployment needs to keep lives here.
ENV GAMELOG_IMAGES_DIR=/data/images
VOLUME /data

EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD curl -f http://127.0.0.1:${GAMELOG_PORT:-8080}/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
