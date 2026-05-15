# syntax=docker/dockerfile:1

# Build stage — produces the SPA bundle in /app/dist
FROM node:lts-alpine AS builder
WORKDIR /app

ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}

ARG VITE_HIDE_CREDITS
ARG VITE_DEFAULT_PRESET
ARG VITE_DEFAULT_DATA_TO_ENCODE
ARG VITE_QR_CODE_PRESETS
ARG VITE_FRAME_PRESET
ARG VITE_FRAME_PRESETS
ARG VITE_DISABLE_LOCAL_STORAGE
ARG VITE_APP_VERSION

ENV VITE_HIDE_CREDITS=${VITE_HIDE_CREDITS}
ENV VITE_DEFAULT_PRESET=${VITE_DEFAULT_PRESET}
ENV VITE_DEFAULT_DATA_TO_ENCODE=${VITE_DEFAULT_DATA_TO_ENCODE}
ENV VITE_QR_CODE_PRESETS=${VITE_QR_CODE_PRESETS}
ENV VITE_FRAME_PRESET=${VITE_FRAME_PRESET}
ENV VITE_FRAME_PRESETS=${VITE_FRAME_PRESETS}
ENV VITE_DISABLE_LOCAL_STORAGE=${VITE_DISABLE_LOCAL_STORAGE}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}

COPY package*.json ./
# No .git in the build context, so the husky postinstall would fail trying
# to write hooks. Strip it; we only need the deps to build the SPA.
RUN npm pkg delete scripts.postinstall \
  && npm install --no-audit --no-fund
COPY . .
RUN npm run build

# Production stage — small Fastify server that serves the SPA + /api routes
FROM node:lts-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV QR_STORAGE_DIR=/data/qr-files

# Sharp requires its native bindings to be present in the runtime image.
# Strip the husky postinstall (dev-only git hook setup) before installing —
# husky lives in devDependencies and isn't present with --omit=dev.
COPY package*.json ./
RUN npm pkg delete scripts.postinstall \
  && npm install --omit=dev --no-audit --no-fund

# SPA bundle, server source, and shared QR library
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/lib ./src/lib

# Storage directory (overridable via volume mount). Pre-created so a non-root
# operator can mount over it without permission surprises.
RUN mkdir -p /data/qr-files

# 8080 is the default shared port (SPA + API). When split-port mode is enabled
# via API_PORT, expose that one too (the value is up to the operator — 8081
# shown here as a convention).
EXPOSE 8080
EXPOSE 8081
CMD ["npm", "run", "start"]
