import type { FastifyReply, FastifyRequest } from 'fastify'

export interface AuthConfig {
  apiKey: string | undefined
}

const SKIP_PREFIXES = ['/api/health', '/api/docs', '/api/openapi.json']

/**
 * Require a matching API key on /api/* requests when `apiKey` is configured.
 * If `apiKey` is undefined the API is open. Health + docs are always public.
 */
export function makeAuthHook(config: AuthConfig) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!config.apiKey) return
    if (!req.url.startsWith('/api/')) return
    if (
      SKIP_PREFIXES.some(
        (prefix) =>
          req.url === prefix || req.url.startsWith(prefix + '/') || req.url.startsWith(prefix + '?')
      )
    ) {
      return
    }

    const presented = extractKey(req)
    if (presented && timingSafeEqual(presented, config.apiKey)) return

    reply.code(401).send({
      error: 'unauthorized',
      message:
        'Missing or invalid API key. Send "Authorization: Bearer <key>" or "X-API-Key: <key>".'
    })
  }
}

function extractKey(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim())
    if (match) return match[1].trim()
  }
  const xKey = req.headers['x-api-key']
  if (typeof xKey === 'string' && xKey.length > 0) return xKey.trim()
  return null
}

/**
 * Constant-time string comparison. Avoids leaking the API key length through
 * early-exit timing differences.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const buf = Buffer.from(a)
  const target = Buffer.from(b)
  if (buf.length !== target.length) return false
  let diff = 0
  for (let i = 0; i < buf.length; i++) diff |= buf[i] ^ target[i]
  return diff === 0
}
