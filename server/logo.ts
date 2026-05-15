import { promises as fs } from 'node:fs'
import path from 'node:path'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 5000
const ALLOWED_MIME_PREFIX = 'image/'
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'])
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export interface LogoResolverOptions {
  /** Absolute path on disk where `image.path` lookups are resolved. Optional. */
  logoDir?: string | null
  /** When set, remote URLs are rejected unless the hostname matches one of these (exact match). */
  remoteHostAllowlist?: string[] | null
  /** Override the default 5MB cap. Tests use this to keep oversize cases cheap. */
  maxBytes?: number
  /** Override the default 5s remote fetch timeout. */
  fetchTimeoutMs?: number
}

export class LogoResolveError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'logo_invalid'
  ) {
    super(message)
    this.name = 'LogoResolveError'
  }
}

export interface ResolvedLogo {
  dataUri: string
  bytes: number
  source: 'data' | 'remote' | 'path' | 'multipart'
}

/**
 * Resolve an arbitrary logo input (data URI, http(s) URL, or local path) into
 * an inline `data:` URI that the SVG renderer can embed without leaving the
 * process. Each non-data path applies its own safety net:
 *
 *  - `data:` URIs are accepted as-is once we confirm they declare an image/*
 *    mime type. Untrusted data URIs can't reach the network, so the only
 *    risk is malformed input the renderer might choke on.
 *  - `http(s)://` URLs route through SSRF-aware DNS resolution before the
 *    actual fetch. Anything that resolves to a private / loopback /
 *    link-local IP is refused before a socket is opened. Body is hard
 *    capped at MAX_BYTES, fetch is aborted after FETCH_TIMEOUT_MS.
 *  - `path` reads from `logoDir` only, with realpath checks that prevent
 *    `..` escapes or symlink traversal out of the allowed root.
 */
export async function resolveLogoSource(
  href: string,
  options: LogoResolverOptions = {}
): Promise<ResolvedLogo> {
  if (href.startsWith('data:')) {
    return resolveDataUri(href)
  }
  if (/^https?:\/\//i.test(href)) {
    return resolveRemote(href, options)
  }
  throw new LogoResolveError(
    `image.href must start with "data:", "http://", or "https://" (got "${href.slice(0, 32)}...")`
  )
}

export async function resolveLogoFromPath(
  relPath: string,
  options: LogoResolverOptions
): Promise<ResolvedLogo> {
  const root = options.logoDir
  if (!root) {
    throw new LogoResolveError(
      'image.path is set but the server has no LOGO_DIR configured.',
      400,
      'logo_dir_disabled'
    )
  }
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const rootReal = await fs.realpath(root)
  const joined = path.resolve(rootReal, relPath)
  let resolved: string
  try {
    resolved = await fs.realpath(joined)
  } catch {
    throw new LogoResolveError(`Logo file not found: ${relPath}`, 404, 'logo_not_found')
  }
  if (!isInside(rootReal, resolved)) {
    throw new LogoResolveError(
      `image.path escapes LOGO_DIR (path traversal blocked)`,
      400,
      'logo_path_escape'
    )
  }
  const ext = path.extname(resolved).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new LogoResolveError(
      `Logo extension "${ext}" is not allowed (use png/jpg/svg/webp/gif).`,
      400,
      'logo_bad_extension'
    )
  }
  const stat = await fs.stat(resolved)
  if (stat.size > maxBytes) {
    throw new LogoResolveError(
      `Logo file ${relPath} is ${stat.size} bytes; max is ${maxBytes}.`,
      413,
      'logo_too_large'
    )
  }
  const bytes = await fs.readFile(resolved)
  const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream'
  return {
    dataUri: bufferToDataUri(bytes, mime),
    bytes: bytes.byteLength,
    source: 'path'
  }
}

/**
 * Wrap raw bytes from an uploaded multipart part. The caller is responsible
 * for enforcing the file part's size limit (fastify-multipart does this for
 * us via `limits.fileSize`); we re-check here as defence in depth.
 */
export function resolveLogoFromBuffer(
  bytes: Buffer,
  mimetype: string | undefined,
  filename: string | undefined,
  options: LogoResolverOptions = {}
): ResolvedLogo {
  const maxBytes = options.maxBytes ?? MAX_BYTES
  if (bytes.byteLength > maxBytes) {
    throw new LogoResolveError(
      `Uploaded logo is ${bytes.byteLength} bytes; max is ${maxBytes}.`,
      413,
      'logo_too_large'
    )
  }
  const mime =
    mimetype && mimetype.startsWith(ALLOWED_MIME_PREFIX)
      ? mimetype
      : inferMimeFromFilename(filename)
  if (!mime) {
    throw new LogoResolveError(
      `Could not determine an image/* MIME for uploaded logo${filename ? ` "${filename}"` : ''}.`,
      415,
      'logo_bad_mime'
    )
  }
  return {
    dataUri: bufferToDataUri(bytes, mime),
    bytes: bytes.byteLength,
    source: 'multipart'
  }
}

function resolveDataUri(href: string): ResolvedLogo {
  const match = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(href)
  if (!match) {
    throw new LogoResolveError('Malformed data URI.', 400, 'logo_bad_data_uri')
  }
  const mime = match[1].toLowerCase().trim()
  if (!mime.startsWith(ALLOWED_MIME_PREFIX)) {
    throw new LogoResolveError(
      `data URI must declare an image/* MIME (got "${mime}").`,
      415,
      'logo_bad_mime'
    )
  }
  // Approximate the decoded byte count for the size cap. A base64 payload
  // decodes to ~3/4 its string length; URL-encoded payloads roughly match
  // their on-wire length.
  const params = (match[2] ?? '').toLowerCase()
  const payload = match[3]
  const approxBytes = params.includes('base64')
    ? Math.floor((payload.length * 3) / 4)
    : payload.length
  if (approxBytes > MAX_BYTES) {
    throw new LogoResolveError(
      `Inline logo is ~${approxBytes} bytes; max is ${MAX_BYTES}.`,
      413,
      'logo_too_large'
    )
  }
  return { dataUri: href, bytes: approxBytes, source: 'data' }
}

async function resolveRemote(href: string, options: LogoResolverOptions): Promise<ResolvedLogo> {
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const timeoutMs = options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS
  let url: URL
  try {
    url = new URL(href)
  } catch {
    throw new LogoResolveError(`Invalid logo URL: ${href}`, 400, 'logo_bad_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LogoResolveError(
      `Only http(s) URLs allowed for image.href (got ${url.protocol}).`,
      400,
      'logo_bad_protocol'
    )
  }

  const hostname = url.hostname
  if (
    options.remoteHostAllowlist &&
    options.remoteHostAllowlist.length > 0 &&
    !options.remoteHostAllowlist.includes(hostname)
  ) {
    throw new LogoResolveError(
      `Host "${hostname}" is not in REMOTE_LOGO_HOSTS allowlist.`,
      403,
      'logo_host_blocked'
    )
  }

  await assertResolvableToPublicIp(hostname)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'image/*' }
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new LogoResolveError(
        `Timed out fetching ${url} after ${timeoutMs}ms.`,
        504,
        'logo_fetch_timeout'
      )
    }
    throw new LogoResolveError(
      `Failed to fetch ${url}: ${(err as Error).message}`,
      502,
      'logo_fetch_failed'
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new LogoResolveError(
      `Remote logo returned HTTP ${response.status}.`,
      502,
      'logo_fetch_status'
    )
  }
  const contentType = response.headers.get('content-type') ?? ''
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (!mime.startsWith(ALLOWED_MIME_PREFIX)) {
    throw new LogoResolveError(
      `Remote logo content-type "${mime || 'unknown'}" is not image/*.`,
      415,
      'logo_bad_mime'
    )
  }
  const declaredLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new LogoResolveError(
      `Remote logo content-length ${declaredLength} exceeds limit ${maxBytes}.`,
      413,
      'logo_too_large'
    )
  }

  const bytes = await readResponseWithLimit(response, maxBytes)
  return {
    dataUri: bufferToDataUri(bytes, mime),
    bytes: bytes.byteLength,
    source: 'remote'
  }
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader()
  if (!reader) {
    const arr = await response.arrayBuffer()
    if (arr.byteLength > maxBytes) {
      throw new LogoResolveError(
        `Remote logo is ${arr.byteLength} bytes; max is ${maxBytes}.`,
        413,
        'logo_too_large'
      )
    }
    return Buffer.from(arr)
  }
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore — best effort
      }
      throw new LogoResolveError(
        `Remote logo exceeded ${maxBytes} bytes mid-stream.`,
        413,
        'logo_too_large'
      )
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

/**
 * DNS-resolve the hostname ourselves before fastify's fetch, then reject any
 * answer that lands in private/loopback/link-local space. Done this way so
 * the SSRF check matches the IP we'd actually open a socket against rather
 * than just inspecting the hostname string.
 */
async function assertResolvableToPublicIp(hostname: string): Promise<void> {
  // If the caller pasted an IP literal, validate the literal directly.
  const literalFamily = isIP(hostname)
  if (literalFamily) {
    assertIpIsPublic(hostname, literalFamily)
    return
  }
  if (hostname === 'localhost') {
    throw new LogoResolveError(
      'Refusing to fetch logo from "localhost".',
      400,
      'logo_blocked_target'
    )
  }
  let entries: { address: string; family: number }[]
  try {
    entries = await dnsLookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new LogoResolveError(`Could not resolve "${hostname}".`, 400, 'logo_bad_host')
  }
  if (entries.length === 0) {
    throw new LogoResolveError(`No DNS records for "${hostname}".`, 400, 'logo_bad_host')
  }
  for (const entry of entries) {
    assertIpIsPublic(entry.address, entry.family)
  }
}

function assertIpIsPublic(ip: string, family: number): void {
  if (family === 4) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
      throw new LogoResolveError(`Invalid IPv4 address ${ip}.`, 400, 'logo_bad_host')
    }
    const [a, b] = parts
    const isPrivate =
      a === 10 ||
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224 // multicast + reserved
    if (isPrivate) {
      throw new LogoResolveError(
        `Refusing to fetch logo from non-public IPv4 ${ip}.`,
        400,
        'logo_blocked_target'
      )
    }
    return
  }
  // IPv6: block loopback (::1), unique-local (fc00::/7), link-local (fe80::/10),
  // any IPv4-mapped private address, and the v6-mapped IPv4 wildcard.
  const lower = ip.toLowerCase()
  if (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('::ffff:')
  ) {
    throw new LogoResolveError(
      `Refusing to fetch logo from non-public IPv6 ${ip}.`,
      400,
      'logo_blocked_target'
    )
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function bufferToDataUri(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString('base64')}`
}

function inferMimeFromFilename(filename: string | undefined): string | null {
  if (!filename) return null
  const ext = path.extname(filename).toLowerCase()
  return EXT_TO_MIME[ext] ?? null
}
