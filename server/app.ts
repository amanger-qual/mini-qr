import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod'
import { makeAuthHook } from './auth'
import { FileStorage } from './storage'
import { healthRoutes } from './routes/health'
import { qrRoutes } from './routes/qr'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface BuildAppOptions {
  apiKey?: string
  storageDir?: string
  staticDir?: string | null
  rateLimitPerMinute?: number
  version?: string
  trustProxy?: boolean
  logger?: boolean
  /**
   * When false, the resulting Fastify instance has no /api routes and no
   * Swagger UI — only the static SPA fallback. Used by the split-port mode
   * in server/index.ts.
   */
  mountApi?: boolean
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const {
    apiKey = process.env.API_KEY,
    storageDir = process.env.QR_STORAGE_DIR ?? '/data/qr-files',
    rateLimitPerMinute = readNumberEnv('API_RATE_LIMIT_PER_MIN', 1000),
    version = readPackageVersion(),
    trustProxy = true,
    logger = process.env.NODE_ENV !== 'test',
    mountApi = true
  } = options

  const staticDir =
    options.staticDir === null ? null : (options.staticDir ?? resolveDefaultStaticDir())

  const app = Fastify({
    logger,
    trustProxy,
    bodyLimit: 5 * 1024 * 1024
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  if (mountApi) {
    await app.register(fastifyRateLimit, {
      max: rateLimitPerMinute,
      timeWindow: '1 minute',
      allowList: (req) => req.url === '/api/health' || req.url.startsWith('/api/docs'),
      keyGenerator: (req) => req.ip
    })

    app.addHook('onRequest', makeAuthHook({ apiKey }))

    await app.register(fastifySwagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'MiniQR API',
          version,
          description:
            'HTTP API for generating, saving, listing, and downloading QR codes.\n\nAll endpoints under `/api` accept an optional `Authorization: Bearer <API_KEY>` or `X-API-Key: <API_KEY>` header. Authentication is only enforced when the server has been started with the `API_KEY` environment variable set.\n\nRate limit: 1000 requests/minute/IP by default (configurable via `API_RATE_LIMIT_PER_MIN`).'
        },
        tags: [
          { name: 'qr', description: 'Generate QR codes' },
          { name: 'files', description: 'Manage server-saved QR codes' },
          { name: 'health', description: 'Liveness / version' }
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' },
            apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
          }
        },
        security: apiKey ? [{ bearerAuth: [] }, { apiKeyAuth: [] }] : []
      },
      transform: jsonSchemaTransform
    })

    await app.register(fastifySwaggerUi, {
      routePrefix: '/api/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true }
    })

    const storage = new FileStorage({ dir: storageDir })

    await app.register(healthRoutes, { version })
    await app.register(qrRoutes, { storage })
  }

  if (staticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      wildcard: false,
      decorateReply: false
    })

    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found', message: 'Route not found.' })
      }
      return reply.sendFile('index.html')
    })
  } else if (!mountApi) {
    // Edge case — both disabled. Surface as a clear error instead of a
    // silently empty server.
    throw new Error('buildApp: at least one of mountApi or staticDir must be enabled')
  }

  return app
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'package.json'),
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(process.cwd(), 'package.json')
  ]
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf-8')
      const parsed = JSON.parse(raw) as { version?: string }
      if (parsed.version) return parsed.version
    } catch {
      // ignore
    }
  }
  return process.env.npm_package_version ?? '0.0.0'
}

function resolveDefaultStaticDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(__dirname, '..', '..', 'dist'),
    path.resolve(process.cwd(), 'dist')
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'index.html'))) {
        return candidate
      }
    } catch {
      // ignore
    }
  }
  return null
}
