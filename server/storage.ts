import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { FileMeta, OutputFormat, QrConfigBody } from './schema'

export interface StorageOptions {
  dir: string
}

export interface SaveInput {
  config: QrConfigBody
  format: OutputFormat
  name?: string
  buffer: Buffer
  createdAt?: Date
}

export interface ListOptions {
  limit?: number
  offset?: number
  q?: string
  format?: OutputFormat
}

export class FileStorage {
  private ready: Promise<void> | null = null

  constructor(private readonly opts: StorageOptions) {}

  private async ensureDir(): Promise<void> {
    if (!this.ready) {
      this.ready = fs.mkdir(this.opts.dir, { recursive: true }).then(() => undefined)
    }
    await this.ready
  }

  private metaPath(id: string): string {
    return path.join(this.opts.dir, `${id}.json`)
  }

  private binPath(id: string, format: OutputFormat): string {
    return path.join(this.opts.dir, `${id}.${format}`)
  }

  async save(input: SaveInput): Promise<FileMeta> {
    await this.ensureDir()
    const created = input.createdAt ?? new Date()
    const id = buildId(created, input.name)
    const binPath = this.binPath(id, input.format)
    const metaPath = this.metaPath(id)

    await fs.writeFile(binPath, input.buffer)
    const meta: FileMeta = {
      id,
      name: input.name ?? null,
      format: input.format,
      size: input.buffer.byteLength,
      createdAt: created.toISOString(),
      url: `/api/qr/files/${id}.${input.format}`,
      config: input.config
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return meta
  }

  async list(opts: ListOptions = {}): Promise<{ total: number; items: FileMeta[] }> {
    await this.ensureDir()
    const entries = await fs.readdir(this.opts.dir)
    const metaFiles = entries.filter((f) => f.endsWith('.json'))

    const metas: FileMeta[] = []
    for (const file of metaFiles) {
      try {
        const raw = await fs.readFile(path.join(this.opts.dir, file), 'utf-8')
        const meta = JSON.parse(raw) as FileMeta
        if (opts.format && meta.format !== opts.format) continue
        if (opts.q && !(meta.name ?? '').toLowerCase().includes(opts.q.toLowerCase())) continue
        metas.push(meta)
      } catch {
        // ignore malformed sidecars
      }
    }

    metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    const total = metas.length
    const offset = opts.offset ?? 0
    const limit = opts.limit ?? 50
    return { total, items: metas.slice(offset, offset + limit) }
  }

  async readMeta(id: string): Promise<FileMeta | null> {
    await this.ensureDir()
    try {
      const raw = await fs.readFile(this.metaPath(id), 'utf-8')
      return JSON.parse(raw) as FileMeta
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async readBinary(id: string): Promise<{ meta: FileMeta; buffer: Buffer } | null> {
    const meta = await this.readMeta(id)
    if (!meta) return null
    try {
      const buffer = await fs.readFile(this.binPath(id, meta.format))
      return { meta, buffer }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async remove(id: string): Promise<boolean> {
    const meta = await this.readMeta(id)
    if (!meta) return false
    await Promise.allSettled([
      fs.unlink(this.binPath(id, meta.format)),
      fs.unlink(this.metaPath(id))
    ])
    return true
  }
}

/**
 * Build a filename-safe id: ISO timestamp with `:` and `.` replaced by `-`
 * (so it sorts lexicographically), optionally suffixed with a sanitized name
 * and a short random tag to avoid same-millisecond collisions.
 */
export function buildId(createdAt: Date, name?: string): string {
  const ts = createdAt.toISOString().replace(/[:.]/g, '-')
  const tag = randomBytes(2).toString('hex')
  const slug = name ? `-${slugify(name)}` : ''
  return `${ts}${slug}-${tag}`
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
