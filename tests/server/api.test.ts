import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server/app'

async function makeApp(overrides: Parameters<typeof buildApp>[0] = {}): Promise<{
  app: FastifyInstance
  storageDir: string
}> {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'mini-qr-test-'))
  const app = await buildApp({
    storageDir,
    staticDir: null,
    logger: false,
    rateLimitPerMinute: 1000,
    version: 'test',
    trustProxy: true,
    ...overrides
  })
  return { app, storageDir }
}

describe('GET /api/health', () => {
  let app: FastifyInstance
  let storageDir: string

  beforeAll(async () => {
    const built = await makeApp()
    app = built.app
    storageDir = built.storageDir
  })

  afterAll(async () => {
    await app.close()
    await rm(storageDir, { recursive: true, force: true })
  })

  it('returns ok and a version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', version: 'test' })
  })
})

describe('POST /api/qr', () => {
  let app: FastifyInstance
  let storageDir: string

  beforeAll(async () => {
    const built = await makeApp()
    app = built.app
    storageDir = built.storageDir
  })

  afterAll(async () => {
    await app.close()
    await rm(storageDir, { recursive: true, force: true })
  })

  it('returns an SVG document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: 'hello', format: 'svg' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/)
    expect(res.body.startsWith('<svg')).toBe(true)
  })

  it('returns a PNG (magic bytes)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: 'hello', format: 'png' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
    const buffer = res.rawPayload
    expect(buffer[0]).toBe(0x89)
    expect(buffer[1]).toBe(0x50)
    expect(buffer[2]).toBe(0x4e)
    expect(buffer[3]).toBe(0x47)
  })

  it('returns a JPEG (magic bytes)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: 'hello', format: 'jpg', quality: 80 }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/jpeg/)
    const buffer = res.rawPayload
    expect(buffer[0]).toBe(0xff)
    expect(buffer[1]).toBe(0xd8)
    expect(buffer[2]).toBe(0xff)
  })

  it('rejects invalid input with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: '', format: 'png' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects unknown format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: 'hello', format: 'bmp' }
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('saved files', () => {
  let app: FastifyInstance
  let storageDir: string

  beforeAll(async () => {
    const built = await makeApp()
    app = built.app
    storageDir = built.storageDir
  })

  afterAll(async () => {
    await app.close()
    await rm(storageDir, { recursive: true, force: true })
  })

  async function saveOne(payload: Record<string, unknown>): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: 'hello', format: 'png', save: true, ...payload }
    })
    expect(res.statusCode).toBe(200)
    const id = res.headers['x-qr-file-id']
    expect(typeof id).toBe('string')
    expect(res.headers['location']).toBe(`/api/qr/files/${id as string}.png`)
    return id as string
  }

  it('persists the file and surfaces it via headers', async () => {
    const id = await saveOne({ name: 'persist-test' })
    expect(id).toContain('-persist-test-')
  })

  it('lists saved files newest first', async () => {
    await saveOne({ name: 'alpha' })
    await saveOne({ name: 'bravo' })
    const res = await app.inject({ method: 'GET', url: '/api/qr/files?limit=5' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { total: number; items: Array<{ name: string }> }
    expect(body.total).toBeGreaterThanOrEqual(2)
    // Newest first — bravo was saved after alpha
    const names = body.items.map((i) => i.name)
    expect(names.indexOf('bravo')).toBeLessThan(names.indexOf('alpha'))
  })

  it('filters list by name substring', async () => {
    await saveOne({ name: 'unique-target-string' })
    const res = await app.inject({
      method: 'GET',
      url: '/api/qr/files?q=unique-target'
    })
    const body = res.json() as { items: Array<{ name: string }> }
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    expect(body.items.every((i) => i.name?.includes('unique-target'))).toBe(true)
  })

  it('downloads the binary with or without extension', async () => {
    const id = await saveOne({ name: 'download-test' })
    const noExt = await app.inject({ method: 'GET', url: `/api/qr/files/${id}` })
    expect(noExt.statusCode).toBe(200)
    expect(noExt.headers['content-type']).toMatch(/image\/png/)

    const withExt = await app.inject({ method: 'GET', url: `/api/qr/files/${id}.png` })
    expect(withExt.statusCode).toBe(200)
    expect(withExt.headers['content-type']).toMatch(/image\/png/)

    const wrongExt = await app.inject({ method: 'GET', url: `/api/qr/files/${id}.svg` })
    expect(wrongExt.statusCode).toBe(409)
  })

  it('returns metadata only when requested', async () => {
    const id = await saveOne({ name: 'meta-test' })
    const res = await app.inject({ method: 'GET', url: `/api/qr/files/${id}/meta` })
    expect(res.statusCode).toBe(200)
    const meta = res.json() as { id: string; name: string; config: { data: string } }
    expect(meta.id).toBe(id)
    expect(meta.name).toBe('meta-test')
    expect(meta.config.data).toBe('hello')
  })

  it('deletes a file', async () => {
    const id = await saveOne({ name: 'delete-test' })
    const del = await app.inject({ method: 'DELETE', url: `/api/qr/files/${id}` })
    expect(del.statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: `/api/qr/files/${id}` })
    expect(after.statusCode).toBe(404)
  })

  it('404s unknown ids', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/qr/files/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })
})

describe('auth', () => {
  it('is open when API_KEY is unset', async () => {
    const { app, storageDir } = await makeApp({ apiKey: undefined })
    try {
      const res = await app.inject({ method: 'POST', url: '/api/qr', payload: { data: 'hi' } })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('rejects missing credentials when API_KEY is set', async () => {
    const { app, storageDir } = await makeApp({ apiKey: 'secret' })
    try {
      const res = await app.inject({ method: 'POST', url: '/api/qr', payload: { data: 'hi' } })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('accepts Authorization Bearer', async () => {
    const { app, storageDir } = await makeApp({ apiKey: 'secret' })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/qr',
        payload: { data: 'hi' },
        headers: { authorization: 'Bearer secret' }
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('accepts X-API-Key', async () => {
    const { app, storageDir } = await makeApp({ apiKey: 'secret' })
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/qr',
        payload: { data: 'hi' },
        headers: { 'x-api-key': 'secret' }
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('keeps /api/health public even with auth enabled', async () => {
    const { app, storageDir } = await makeApp({ apiKey: 'secret' })
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})

describe('rate limiting', () => {
  let app: FastifyInstance
  let storageDir: string

  beforeAll(async () => {
    const built = await makeApp({ rateLimitPerMinute: 5 })
    app = built.app
    storageDir = built.storageDir
  })

  beforeEach(async () => {
    // Each test should start clean — the rate limit plugin keys by IP. We
    // close + rebuild the app to reset the in-memory counter.
    await app.close()
    const rebuilt = await makeApp({ rateLimitPerMinute: 5 })
    app = rebuilt.app
    await rm(storageDir, { recursive: true, force: true })
    storageDir = rebuilt.storageDir
  })

  afterAll(async () => {
    await app.close()
    await rm(storageDir, { recursive: true, force: true })
  })

  it('returns 429 once the threshold is crossed', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/qr',
        payload: { data: 'hi' }
      })
      expect(res.statusCode).toBe(200)
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/qr',
      payload: { data: 'hi' }
    })
    expect(blocked.statusCode).toBe(429)
  })

  it('does not rate limit /api/health', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/health' })
      expect(res.statusCode).toBe(200)
    }
  })
})

describe('OpenAPI docs', () => {
  it('serves a valid spec at /api/openapi.json', async () => {
    const { app, storageDir } = await makeApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/docs/json' })
      expect(res.statusCode).toBe(200)
      const spec = res.json() as { openapi: string; paths: Record<string, unknown> }
      expect(spec.openapi.startsWith('3.')).toBe(true)
      expect(spec.paths['/api/qr']).toBeDefined()
      expect(spec.paths['/api/qr/files']).toBeDefined()
      expect(spec.paths['/api/health']).toBeDefined()
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})

describe('split-port mode', () => {
  it('mountApi:false exposes no /api routes', async () => {
    // fastify-static needs a real directory; reuse the storage tmp dir.
    const storageDir = await mkdtemp(path.join(tmpdir(), 'mini-qr-test-'))
    const app = await buildApp({
      storageDir,
      staticDir: storageDir,
      mountApi: false,
      logger: false
    })
    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' })
      expect(health.statusCode).toBe(404)
      const gen = await app.inject({
        method: 'POST',
        url: '/api/qr',
        payload: { data: 'hello' }
      })
      expect(gen.statusCode).toBe(404)
      const docs = await app.inject({ method: 'GET', url: '/api/docs/json' })
      expect(docs.statusCode).toBe(404)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('mountApi:true with staticDir:null exposes only the API', async () => {
    const { app, storageDir } = await makeApp({ mountApi: true, staticDir: null })
    try {
      const health = await app.inject({ method: 'GET', url: '/api/health' })
      expect(health.statusCode).toBe(200)
      const root = await app.inject({ method: 'GET', url: '/' })
      expect(root.statusCode).toBe(404)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('refuses to build with both api and static disabled', async () => {
    await expect(buildApp({ mountApi: false, staticDir: null, logger: false })).rejects.toThrow(
      /at least one of mountApi or staticDir/
    )
  })
})
