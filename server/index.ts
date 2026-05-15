import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'

async function start() {
  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '0.0.0.0'
  const apiPortRaw = process.env.API_PORT
  const apiPort = apiPortRaw ? Number(apiPortRaw) : null
  const apiHost = process.env.API_HOST ?? host

  const apps: FastifyInstance[] = []

  if (apiPort && apiPort !== port) {
    // Split-port mode: SPA on `port`, API on `apiPort`. Two Fastify instances,
    // each scoped to one concern so a misbehaving API can't drop the UI and
    // vice versa.
    const spa = await buildApp({ mountApi: false })
    const api = await buildApp({ mountApi: true, staticDir: null })
    apps.push(spa, api)

    try {
      await spa.listen({ port, host })
      await api.listen({ port: apiPort, host: apiHost })
      spa.log.info({ port, host }, 'MiniQR SPA listening')
      api.log.info({ port: apiPort, host: apiHost }, 'MiniQR API listening')
    } catch (err) {
      for (const app of apps) app.log.error(err)
      process.exit(1)
    }
  } else {
    // Shared-port mode: one app, /api/* + SPA fallback on the same port.
    const app = await buildApp()
    apps.push(app)
    try {
      await app.listen({ port, host })
      app.log.info({ port, host }, 'MiniQR listening (SPA + API on same port)')
    } catch (err) {
      app.log.error(err)
      process.exit(1)
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      for (const app of apps) app.log.info({ signal }, 'shutting down')
      await Promise.all(apps.map((app) => app.close()))
      process.exit(0)
    })
  }
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
