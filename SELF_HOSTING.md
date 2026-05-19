# Self-Hosting

This document covers all the ways to self-host MiniQR.

## With Docker 🐋

### Quick Start (prebuilt image)

Pull the prebuilt image from GitHub Container Registry and start the app:

```bash
wget https://raw.githubusercontent.com/amanger-qual/mini-qr/main/compose.yaml
docker compose up -d
```

The app will be available at [http://localhost](http://localhost) (port 80, proxied by Nginx).
This path pulls `ghcr.io/amanger-qual/mini-qr:latest`, so nobody has to build it locally unless they want to.
If the pull is blocked, the GHCR package needs to be public or you need to `docker login ghcr.io` first.

> **Note:** `compose.yaml` embeds its own Nginx config — you only need this one file for the Quick Start. No other files are required.

### Build Locally

To build from source, clone the repository and use `compose.dev.yaml` alongside `compose.yaml`:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Or build and run manually:

```bash
docker build -t mini-qr .
docker run -d -p 80:8080 mini-qr
```

## Without Docker 🌐

Compile the application directly using NPM and Vite:

```bash
git clone https://github.com/amanger-qual/mini-qr.git
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

| Variable                      | `compose.dev.yaml` build arg | Description                                                                                                  | Default            |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| `BASE_PATH`                   | `BASE_PATH`                  | URL sub-path for deployment (e.g., `/mini-qr` for `domain.com/mini-qr`)                                      | `/`                |
| `VITE_HIDE_CREDITS`           | `VITE_HIDE_CREDITS`          | Set to `"true"` to hide the footer credits                                                                   | `"false"`          |
| `VITE_DEFAULT_PRESET`         | `VITE_DEFAULT_PRESET`        | Name of the default QR code style preset (e.g., `"plain"`, `"lyqht"`)                                        | `""`               |
| `VITE_DEFAULT_DATA_TO_ENCODE` | `VITE_DEFAULT_DATA_TO_ENCODE` | Default text/URL pre-filled in the QR code input field when the app loads                                    | `""`               |
| `VITE_QR_CODE_PRESETS`        | `VITE_QR_CODE_PRESETS`       | JSON array of custom QR code presets. See [Custom Presets](#custom-presets) below                            | `"[]"`             |
| `VITE_FRAME_PRESET`           | `VITE_FRAME_PRESET`          | Name of the default frame preset to apply (e.g., `"Default Frame"`)                                          | `""`               |
| `VITE_FRAME_PRESETS`          | `VITE_FRAME_PRESETS`         | JSON array of custom frame presets. See [Custom Presets](#custom-presets) below                              | `"[]"`             |
| `VITE_DISABLE_LOCAL_STORAGE`  | `VITE_DISABLE_LOCAL_STORAGE` | Set to `"true"` to prevent the app from loading previously saved settings on startup                         | `"false"`          |
| `API_KEY`                     | `API_KEY`                    | Runtime — if set, all `/api/*` requests must present this key. Leave blank for an open API.                  | `""`               |
| `QR_STORAGE_DIR`              | `QR_STORAGE_DIR`             | Runtime — where saved QR codes live. Mount a volume here to persist across restarts.                         | `/data/qr-files`   |
| `API_RATE_LIMIT_PER_MIN`      | `API_RATE_LIMIT_PER_MIN`     | Runtime — per-IP rate limit for `/api/*`. Health and docs are always exempt.                                 | `1000`             |
| `PORT`                        | `PORT`                       | Runtime — port the SPA (and API, when shared) listens on.                                                    | `8080`             |
| `API_PORT`                    | `API_PORT`                   | Runtime — when set, the API binds here and the SPA stays on `PORT`. See [Split-port mode](#split-port-mode). | _(shared)_         |
| `API_HOST`                    | `API_HOST`                   | Runtime — interface to bind the API to in split-port mode. Defaults to `HOST`.                               | _(same as `HOST`)_ |
| `LOGO_DIR`                    | `LOGO_DIR`                   | Runtime — directory containing reusable logo files for `image.path`. Unset = feature disabled.               | _(unset)_          |
| `REMOTE_LOGO_HOSTS`           | `REMOTE_LOGO_HOSTS`          | Runtime — comma-separated hostnames allowed for remote `image.href` URLs. Unset = any public host.           | _(unset)_          |

### Passing Variables via `compose.dev.yaml`

The `compose.dev.yaml` file forwards the build args directly. Set the matching environment variables on the host before running:

```bash
BASE_PATH=/mini-qr VITE_DEFAULT_PRESET=plain VITE_DISABLE_LOCAL_STORAGE=true docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Or create a `.env` file alongside `compose.yaml`:

```dotenv
BASE_PATH=/mini-qr
VITE_DEFAULT_PRESET=plain
VITE_HIDE_CREDITS=false
VITE_DISABLE_LOCAL_STORAGE=true
```

Then run:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
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
VITE_QR_CODE_PRESETS='[{"name":"My Brand","dotsOptions":{"color":"#ff0000","type":"rounded"}}]' docker compose -f compose.yaml -f compose.dev.yaml up -d --build
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
BASE_PATH=/mini-qr docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

### Fixed preset with localStorage disabled

Useful when embedding MiniQR in a branded context where users should always see the configured preset:

```bash
VITE_DEFAULT_PRESET=plain VITE_DISABLE_LOCAL_STORAGE=true docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

### Hide footer credits

```bash
VITE_HIDE_CREDITS=true docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

## Nginx Proxy

The `compose.yaml` includes an `nginx-proxy` service that proxies traffic to the MiniQR app container. The Nginx configuration is embedded inline in `compose.yaml` under the `configs:` key, so no extra files are needed for the Quick Start.

To override the Nginx config (e.g. for subdirectory deployment or custom headers), replace the `configs.nginx-proxy-conf.content` block in `compose.yaml` with your own configuration, or switch to a file-based mount:

```yaml
volumes:
  - ./nginx-proxy.conf:/etc/nginx/nginx.conf:ro
```

## HTTP API

MiniQR ships an HTTP API so you can generate, save, list, and download QR codes without touching the UI. The API runs in the same container as the SPA on the same port and is mounted under `/api`. Interactive Swagger UI is available at `/api/docs` and the raw spec at `/api/docs/json`.

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

| Method | Path                      | Description                                                                         |
| ------ | ------------------------- | ----------------------------------------------------------------------------------- |
| POST   | `/api/qr`                 | Generate (and optionally save) a QR code. JSON body. Returns binary.                |
| POST   | `/api/qr/upload`          | Same as `/api/qr` but accepts a `multipart/form-data` body with a `logo` file part. |
| GET    | `/api/qr/files`           | List saved QR codes (newest first).                                                 |
| GET    | `/api/qr/files/:id[.ext]` | Download a saved QR code. Extension optional for `<img src>`.                       |
| GET    | `/api/qr/files/:id/meta`  | Get the JSON sidecar (config + metadata) for a saved file.                          |
| DELETE | `/api/qr/files/:id`       | Delete a saved QR code (both binary and sidecar).                                   |
| GET    | `/api/health`             | Liveness + version. Always public, never rate limited.                              |
| GET    | `/api/docs`               | Swagger UI.                                                                         |
| GET    | `/api/docs/json`          | Raw OpenAPI 3.1 spec.                                                               |

### Limits at a glance

- Request body limit: 5MB
- Multipart logo file limit: 5MB
- Multipart `config` field limit: 2MB
- Multipart file count: 1
- Multipart field count: 8
- Rate limit: 1000 requests/minute per IP for `/api/*`
- `GET /api/health` and `/api/docs*` are exempt from the rate limit

### `POST /api/qr` body

| Field | Type | Options / limits | Notes |
| ----- | ---- | ---------------- | ----- |
| `data` | string | Required, 1 to 4000 chars | Payload encoded into the QR code. |
| `size` | integer | 32 to 4096, default 200 | Output size in pixels. |
| `margin` | integer | 0 to 20, default 0 | Quiet zone in modules. |
| `errorCorrectionLevel` | enum | `L`, `M`, `Q`, `H` | Higher values add redundancy and make the QR larger. |
| `dots.shape` | enum | `square`, `rounded`, `extra-rounded`, `classy`, `classy-rounded`, `dots` | Shape for QR modules. |
| `dots.color` | string | Any CSS color, max 64 chars | Dot color. |
| `cornerSquares.shape` | enum | `square`, `rounded`, `extra-rounded`, `dot` | Finder pattern outer square shape. |
| `cornerSquares.color` | string | Any CSS color, max 64 chars | Finder pattern outer square color. |
| `cornerDots.shape` | enum | `square`, `rounded`, `dot` | Finder pattern inner dot shape. |
| `cornerDots.color` | string | Any CSS color, max 64 chars | Finder pattern inner dot color. |
| `background.color` | string | Any CSS color, max 64 chars | Background color. |
| `image.href` | string | `data:` URI or `http(s)://` URL | Remote URLs must be public, non-loopback, max 5MB, 5s timeout, `image/*`, no redirects. `REMOTE_LOGO_HOSTS` can further restrict the hostname allowlist. |
| `image.path` | string | Max 512 chars, safe filename characters only | Reads from `LOGO_DIR`. The file must stay inside that directory. |
| `image.sizeRatio` | number | 0 to 1 | Logo size as a ratio of the QR. |
| `image.margin` | number | 0 to 50 | Padding around the logo in module units. |
| `image.hideBackgroundDots` | boolean | `true` or `false` | Hides background dots behind the logo. |
| `frame.text` | string | Required when `frame` is provided, max 500 chars | Caption text. |
| `frame.textPosition` | enum | `top`, `bottom`, `left`, `right` | Caption position. |
| `frame.textColor` | string | Any CSS color, max 64 chars | Caption text color. |
| `frame.backgroundColor` | string | Any CSS color, max 64 chars | Frame background color. |
| `frame.borderColor` | string | Any CSS color, max 64 chars | Border color. |
| `frame.borderWidth` | number | 0 to 40 | Border width in pixels. |
| `frame.borderRadius` | number | 0 to 200 | Border radius in pixels. |
| `frame.padding` | number | 0 to 200 | Padding around the QR code. |
| `frame.fontFamily` | string | Max 120 chars | Caption font family. The UI offers a curated dropdown, but any valid CSS `font-family` string is accepted. |
| `frame.fontSize` | number | 4 to 200 | Caption font size in pixels. |
| `format` | enum | `svg`, `png`, `jpg`, default `png` | Output format. `jpg` uses JPEG rasterization. |
| `save` | boolean | `true` or `false` | Persists the generated file on the server. |
| `name` | string | Max 120 chars | Human label added to the saved id/filename. |
| `quality` | number | 1 to 100 | JPEG quality. Only matters when `format=jpg`. |

If `save: true`, the response also includes `X-QR-File-Id` and `Location` headers.

### `frame.fontFamily` options

The app uses a curated list for the frame font dropdown. You can still type or send any valid CSS `font-family` string, but these are the built-in options:

| Category | Options |
| -------- | ------- |
| Default | `Default` |
| Sans-serif | `Arial`, `Verdana`, `Roboto`, `Inter`, `Open Sans`, `Lato`, `Montserrat`, `Poppins`, `Oswald`, `Raleway`, `Nunito` |
| Serif | `Georgia`, `Times New Roman`, `Playfair Display`, `Merriweather` |
| Monospace | `Courier New`, `JetBrains Mono`, `Fira Code`, `Source Code Pro`, `IBM Plex Mono`, `Inconsolata` |
| Display | `Pacifico`, `Bebas Neue` |

### `POST /api/qr/upload`

Multipart fields:

| Field | Type | Options / limits | Notes |
| ----- | ---- | ---------------- | ----- |
| `config` | text/json | Required, max 2MB | The same JSON body accepted by `POST /api/qr`, encoded as a plain text field. If `image.href` or `image.path` is present, the uploaded `logo` file overrides it. |
| `logo` | file | Optional, image file, max 5MB | Uploaded center logo. Only one file part is accepted. MIME must start with `image/`. |

### `GET /api/qr/files`

| Query | Type | Options / limits | Notes |
| ----- | ---- | ---------------- | ----- |
| `limit` | integer | 1 to 200 | Page size. |
| `offset` | integer | 0 or greater | Zero-based offset into the result set. |
| `q` | string | Max 120 chars | Case-insensitive substring match against the saved name. |
| `format` | enum | `svg`, `png`, `jpg` | Filter to one file format. |

### Saved file path params

The saved-file routes use `:id` in the path.

- `id` must be 1 to 256 characters
- allowed characters: letters, numbers, `.`, `_`, `-`
- `GET /api/qr/files/:id[.ext]` accepts `.png`, `.svg`, `.jpg`, or `.jpeg`
- requesting the wrong extension returns `409 format_mismatch`

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
PORT=8080 API_PORT=8081 docker compose -f compose.yaml up -d
```

In split mode:

- The SPA stays on `PORT` (no `/api/*` routes — they 404 on this port).
- The API listens on `API_PORT` (no SPA — `/` 404s on this port).
- Two independent Fastify instances. A misbehaving API won't bring down the UI.
- `API_HOST` lets you bind them to different interfaces (e.g., SPA on `0.0.0.0`, API on `127.0.0.1` behind a private network).

You'll need to expose the second port in `compose.yaml`:

```yaml
services:
  mini-qr:
    ports:
      - 8080:8080 # SPA
      - 8081:8081 # API
    environment:
      API_PORT: 8081
```

### Logo input

The API supports four ways to attach a logo. Pick whichever fits how you're calling it:

| Method                  | Where the bytes come from                     | Best for                         |
| ----------------------- | --------------------------------------------- | -------------------------------- |
| Inline `data:` URI      | Base64-encoded in the JSON body               | Scripts that already have bytes  |
| Remote `http(s)://` URL | Server fetches it (with SSRF guards)          | Logos hosted on a CDN            |
| `image.path`            | Read from `LOGO_DIR` on the server filesystem | Reusable logos across many calls |
| Multipart `logo` part   | Uploaded as a file part                       | Hand-off from `curl -F` / Bruno  |

#### 1. Inline (data URI)

```bash
LOGO_B64=$(base64 -i logo.png | tr -d '\n')
curl -X POST http://localhost/api/qr \
  -H 'Content-Type: application/json' \
  -d "{\"data\":\"https://example.com\",\"format\":\"png\",\"image\":{\"href\":\"data:image/png;base64,$LOGO_B64\",\"sizeRatio\":0.25}}" \
  --output qr.png
```

#### 2. Remote URL

```bash
curl -X POST http://localhost/api/qr \
  -H 'Content-Type: application/json' \
  -d '{
    "data": "https://example.com",
    "format": "png",
    "image": { "href": "https://cdn.example.com/logo.png", "sizeRatio": 0.25 }
  }' \
  --output qr.png
```

Guards applied to every remote fetch:

- DNS resolution must land on a public IP. Private (`10/8`, `172.16/12`, `192.168/16`), loopback (`127/8`), link-local (`169.254/16`), and the IPv6 equivalents are blocked. The literal hostname `localhost` is rejected without a DNS round-trip.
- Body cap: 5MB.
- Connect/read timeout: 5s.
- Content-Type must start with `image/`.
- Redirects are not followed (avoids cross-origin SSRF via redirect chains).

Set `REMOTE_LOGO_HOSTS=cdn.example.com,assets.example.com` to restrict fetches to a specific hostname allowlist. Unset = every public host is fair game.

#### 3. `image.path` (server-side filesystem)

Mount logos at `LOGO_DIR` and reference by filename:

```yaml
services:
  mini-qr:
    environment:
      LOGO_DIR: /data/logos
    volumes:
      - ./logos:/data/logos
```

```bash
curl -X POST http://localhost/api/qr \
  -H 'Content-Type: application/json' \
  -d '{"data":"https://example.com","image":{"path":"brand.png","sizeRatio":0.25}}' \
  --output qr.png
```

Guards: extension must be one of `.png .jpg .jpeg .svg .webp .gif`; the resolved real path must stay inside `LOGO_DIR` (`..` and symlink traversal are blocked).

#### 4. Multipart upload (`POST /api/qr/upload`)

```bash
curl -X POST http://localhost/api/qr/upload \
  -F 'config={"data":"https://example.com","format":"png","save":true,"name":"with-logo"}' \
  -F 'logo=@./logo.png' \
  --output qr.png
```

The `config` field is the same JSON body as `POST /api/qr`. Any `image.href`/`image.path` in the config is overridden by the uploaded `logo` file. Same 5MB cap and image/\* mime check as the other paths.

### Persisting saved files

Saved files live at `QR_STORAGE_DIR` (default `/data/qr-files`). To survive container restarts, mount a volume to that path in `compose.yaml`:

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

- Remote logos must resolve to a public IP and be served with an `image/*` content-type within 5s under 5MB. Failures are surfaced as 502/504/413/415.
- The API is intended for trusted use behind your own reverse proxy. The included `nginx-proxy` does no auth beyond what `API_KEY` provides.

## Customization Example

An example of a self-hosted website with a modified MiniQR app with specific language and preset: <https://qrcode.outils.restosducoeur.org/>
