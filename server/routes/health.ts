import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { healthResponseSchema } from '../schema'

export interface HealthRouteOptions {
  version: string
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRouteOptions> = async (app, opts) => {
  app.get(
    '/api/health',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        summary: 'Service health check',
        description: 'Always public; never rate limited. Use for readiness/liveness probes.',
        response: {
          200: healthResponseSchema
        }
      }
    },
    async () => ({ status: 'ok' as const, version: opts.version })
  )
}
