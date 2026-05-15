# Self-Hosting

This document covers all the ways to self-host MiniQR.

## With Docker 🐋

### Quick Start (prebuilt image)

Pull the prebuilt image from GitHub Container Registry and start the app:

```bash
wget https://github.com/lyqht/mini-qr/raw/main/docker-compose.yml
docker compose up -d
```

The app will be available at [http://localhost](http://localhost) (port 80, proxied by Nginx).

> **Note:** The `docker-compose.yml` embeds its own Nginx config — you only need this one file for the Quick Start. No other files are required.

### Build Locally

To build from source, clone the repository and replace the `image:` line in `docker-compose.yml` with a `build:` section pointing to the local Dockerfile. Then run:

```bash
docker compose up -d --build
```

Or build and run manually:

```bash
docker build -t mini-qr .
docker run -d -p 80:8080 mini-qr
```

## Without Docker 🌐

Compile the application directly using NPM and Vite:

```bash
git clone https://github.com/lyqht/mini-qr.git
cd mini-qr
npm install
npm run build
```

The application builds into the `dist` folder, which can be served from any web server.

Example using PHP's built-in web server:

```bash
cd dist
php -S localhost:8080
```

## Environment Variables

All `VITE_*` variables are **build-time** arguments — they are baked into the static assets at build time and cannot be changed at runtime without rebuilding the image.

| Variable                      | `docker-compose.yml` alias | Description                                                                                       | Default            |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| `BASE_PATH`                   | `BASE_PATH`                | URL sub-path for deployment (e.g., `/mini-qr` for `domain.com/mini-qr`)                           | `/`                |
| `VITE_HIDE_CREDITS`           | `HIDE_CREDITS`             | Set to `"true"` to hide the footer credits                                                        | `"false"`          |
| `VITE_DEFAULT_PRESET`         | `DEFAULT_PRESET`           | Name of the default QR code style preset (e.g., `"plain"`, `"lyqht"`)                             | `""`               |
| `VITE_DEFAULT_DATA_TO_ENCODE` | `DEFAULT_DATA`             | Default text/URL pre-filled in the QR code input field when the app loads                        | `""`               |
| `VITE_QR_CODE_PRESETS`        | `PRESETS`                  | JSON array of custom QR code presets. See [Custom Presets](#custom-presets) below                 | `"[]"`             |
| `VITE_FRAME_PRESET`           | `FRAME_PRESET`             | Name of the default frame preset to apply (e.g., `"Default Frame"`)                              | `""`               |
| `VITE_FRAME_PRESETS`          | `FRAME_PRESETS`            | JSON array of custom frame presets. See [Custom Presets](#custom-presets) below                   | `"[]"`             |
| `VITE_DISABLE_LOCAL_STORAGE`  | `DISABLE_LOCAL_STORAGE`    | Set to `"true"` to prevent the app from loading previously saved settings on startup             | `"false"`          |
| `API_KEY`                     | `API_KEY`                  | Runtime — if set, all `/api/*` requests must present this key. Leave blank for an open API.       | `""`               |
| `QR_STORAGE_DIR`              | `QR_STORAGE_DIR`           | Runtime — where saved QR codes live. Mount a volume here to persist across restarts.              | `/data/qr-files`   |
| `API_RATE_LIMIT_PER_MIN`      | `API_RATE_LIMIT_PER_MIN`   | Runtime — per-IP rate limit for `/api/*`. Health and docs are always exempt.                      | `1000`             |
| `PORT`                        | `PORT`                     | Runtime — port the SPA (and API, when shared) listens on.                                         | `8080`             |
| `API_PORT`                    | `API_PORT`                 | Runtime — when set, the API binds here and the SPA stays on `PORT`. See [Split-port mode](#split-port-mode). | _(shared)_         |
| `API_HOST`                    | `API_HOST`                 | Runtime — interface to bind the API to in split-port mode. Defaults to `HOST`.                    | _(same as `HOST`)_ |

### Passing Variables via docker-compose

The `docker-compose.yml` maps shorter environment variable names to the full build arg names. Set them on the host before running:

```bash
BASE_PATH=/mini-qr DEFAULT_PRESET=plain DISABLE_LOCAL_STORAGE=true docker compose up -d --build
```

Or create a `.env` file alongside `docker-compose.yml`:

```dotenv
BASE_PATH=/mini-qr
DEFAULT_PRESET=plain
HIDE_CREDITS=false
DISABLE_LOCAL_STORAGE=true
```

Then run:

```bash
docker compose up -d --build
```

### Passing Variables via `docker build`

When building directly, pass each variable as a `--build-arg`:

```bash
docker build \
  --build-arg BASE_PATH=/mini-qr \
  --build-arg VITE_DEFAULT_PRESET=plain \
  --build-arg VITE_DISABLE_LOCAL_STORAGE=true \
  -t mini-qr .
```

## Custom Presets

### QR Code Presets (`VITE_QR_CODE_PRESETS`)

A JSON array of preset objects. Each preset overrides the visual style of the QR code. Required fields: `name`. All standard `qr-code-styling` options are supported.

```json
[
  {
    "name": "My Brand",
    "dotsOptions": { "color": "#ff0000", "type": "rounded" },
    "cornersSquareOptions": { "color": "#ff0000", "type": "extra-rounded" },
    "cornersDotOptions": { "color": "#ff0000" },
    "backgroundOptions": { "color": "#ffffff" }
  }
]
```

Pass as a build arg (escape the JSON or use a `.env` file):

```bash
PRESETS='[{"name":"My Brand","dotsOptions":{"color":"#ff0000","type":"rounded"}}]' docker compose up -d --build
```

### Frame Presets (`VITE_FRAME_PRESETS`)

A JSON array of frame preset objects. Each preset defines the style and optional default text for the frame surrounding the QR code.

```json
[
  {
    "name": "Red Frame",
    "text": "Scan me",
    "position": "bottom",
    "style": {
      "textColor": "#ffffff",
      "backgroundColor": "#cc0000",
      "borderColor": "#cc0000",
      "borderWidth": "2px",
      "borderRadius": "8px",
      "padding": "12px"
    }
  }
]
```

## Deployment Scenarios

### Deploy at root path (default)

```bash
docker compose up -d
```

### Deploy at a subdirectory

```bash
BASE_PATH=/mini-qr docker compose up -d --build
```

### Fixed preset with localStorage disabled

Useful when embedding MiniQR in a branded context where users should always see the configured preset:

```bash
DEFAULT_PRESET=plain DISABLE_LOCAL_STORAGE=true docker compose up -d --build
```

### Hide footer credits

```bash
HIDE_CREDITS=true docker compose up -d --build
```

## Nginx Proxy

The `docker-compose.yml` includes an `nginx-proxy` service that proxies traffic to the MiniQR app container. The Nginx configuration is embedded inline in `docker-compose.yml` under the `configs:` key, so no extra files are needed for the Quick Start.

To override the Nginx config (e.g. for subdirectory deployment or custom headers), replace the `configs.nginx-proxy-conf.content` block in `docker-compose.yml` with your own configuration, or switch to a file-based mount:

```yaml
    volumes:
      - ./nginx-proxy.conf:/etc/nginx/nginx.conf:ro
```

## HTTP API

MiniQR ships an HTTP API so you can generate, save, list, and download QR codes without touching the UI. The API runs in the same container as the SPA on the same port and is mounted under `/api`. Interactive Swagger UI is available at `/api/docs` and the raw spec at `/api/openapi.json`.

### Auth

The API is **open by default**. Set the `API_KEY` environment variable on the container to require authentication. When set, every `/api/*` request (except `/api/health` and `/api/docs`) must include either:

```
Authorization: Bearer <API_KEY>
```

or:

```
X-API-Key: <API_KEY>
```

### Rate limit

Per-IP rate limit defaults to **1000 requests/minute** for `/api/*` (health and docs are exempt). Override with `API_RATE_LIMIT_PER_MIN`.

### Endpoints

| Method | Path                              | Description                                                   |
| ------ | --------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/qr`                         | Generate (and optionally save) a QR code. Returns the binary. |
| GET    | `/api/qr/files`                   | List saved QR codes (newest first).                           |
| GET    | `/api/qr/files/:id[.ext]`         | Download a saved QR code. Extension optional for `<img src>`. |
| GET    | `/api/qr/files/:id/meta`          | Get the JSON sidecar (config + metadata) for a saved file.    |
| DELETE | `/api/qr/files/:id`               | Delete a saved QR code (both binary and sidecar).             |
| GET    | `/api/health`                     | Liveness + version. Always public, never rate limited.        |
| GET    | `/api/docs`                       | Swagger UI.                                                   |
| GET    | `/api/openapi.json`               | Raw OpenAPI 3.1 spec.                                         |

### Examples

Generate a PNG and save the response to disk:

```bash
curl -X POST http://localhost/api/qr \
  -H 'Content-Type: application/json' \
  -d '{"data":"https://example.com","format":"png","size":512}' \
  --output qr.png
```

Generate, persist on the server, and inspect the returned id:

```bash
curl -i -X POST http://localhost/api/qr \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer change-me' \
  -d '{"data":"https://example.com","format":"png","save":true,"name":"spring-promo"}' \
  --output spring-promo.png
# X-QR-File-Id: 2026-05-15T20-30-37-086Z-spring-promo-4801
# Location: /api/qr/files/2026-05-15T20-30-37-086Z-spring-promo-4801.png
```

List saved files (newest first), filter by name and format:

```bash
curl 'http://localhost/api/qr/files?q=spring&format=png&limit=20'
```

Embed a saved file directly:

```html
<img src="https://your-host/api/qr/files/2026-05-15T20-30-37-086Z-spring-promo-4801.png" />
```

Delete a saved file:

```bash
curl -X DELETE http://localhost/api/qr/files/2026-05-15T20-30-37-086Z-spring-promo-4801
```

### Split-port mode

By default the SPA and the API share a single port (`PORT`, default `8080`) — one container, one nginx upstream, same-origin requests. Set `API_PORT` to bind the API on its own port:

```bash
PORT=8080 API_PORT=8081 docker compose up -d
```

In split mode:

- The SPA stays on `PORT` (no `/api/*` routes — they 404 on this port).
- The API listens on `API_PORT` (no SPA — `/` 404s on this port).
- Two independent Fastify instances. A misbehaving API won't bring down the UI.
- `API_HOST` lets you bind them to different interfaces (e.g., SPA on `0.0.0.0`, API on `127.0.0.1` behind a private network).

You'll need to expose the second port in `docker-compose.yml`:

```yaml
services:
  mini-qr:
    ports:
      - 8080:8080      # SPA
      - 8081:8081      # API
    environment:
      API_PORT: 8081
```

### Persisting saved files

Saved files live at `QR_STORAGE_DIR` (default `/data/qr-files`). To survive container restarts, mount a volume to that path in `docker-compose.yml`:

```yaml
services:
  mini-qr:
    # ...
    environment:
      API_KEY: change-me
    volumes:
      - ./qr-files:/data/qr-files
```

Each saved QR produces two files: the binary (`<id>.png|svg|jpg`) and a JSON sidecar (`<id>.json`) containing the exact config used. The id format is `<iso-timestamp>[-<slug>]-<random>`, e.g. `2026-05-15T20-30-37-086Z-spring-promo-4801`.

### Limitations

- Server-side rendering can only inline `data:` URI logos. Remote `http(s)://` logos are not fetched (sharp/librsvg sandboxes external resources). Convert your logo to a data URI before sending.
- The API is intended for trusted use behind your own reverse proxy. The included `nginx-proxy` does no auth beyond what `API_KEY` provides.

## Customization Example

An example of a self-hosted website with a modified MiniQR app with specific language and preset: https://qrcode.outils.restosducoeur.org/
