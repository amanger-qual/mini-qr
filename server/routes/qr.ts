import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  errorResponseSchema,
  fileIdParamSchema,
  fileMetaSchema,
  generateBodySchema,
  listQuerySchema,
  listResponseSchema,
  type GenerateBody,
  type OutputFormat,
  type QrConfigBody
} from '../schema'
import { renderQr } from '../qr'
import type { FileStorage } from '../storage'
import {
  LogoResolveError,
  resolveLogoFromBuffer,
  resolveLogoFromPath,
  resolveLogoSource,
  type LogoResolverOptions
} from '../logo'

const fileIdWithExtensionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(264)
    .regex(/^[A-Za-z0-9._-]+$/, 'id must contain only safe filesystem characters')
})

const EXTENSION_TO_FORMAT: Record<string, OutputFormat> = {
  svg: 'svg',
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg'
}

const FORMAT_TO_CONTENT_TYPE: Record<OutputFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg'
}

export interface QrRouteOptions {
  storage: FileStorage
  logoResolverOptions: LogoResolverOptions
}

export const qrRoutes: FastifyPluginAsyncZod<QrRouteOptions> = async (app, opts) => {
  const { storage, logoResolverOptions } = opts

  app.post(
    '/api/qr',
    {
      schema: {
        tags: ['qr'],
        summary: 'Generate (and optionally save) a QR code',
        description:
          'Returns the binary QR code in the requested format (image/svg+xml, image/png, or image/jpeg).\n\nIf `save: true` the file is also persisted on the server and the response includes an `X-QR-File-Id` header along with a `Location` header pointing to the download URL.\n\n**Logo input** (in priority order):\n1. `image.path` — read a file from the server-side `LOGO_DIR`.\n2. `image.href` as a `data:` URI — bytes inlined in the request.\n3. `image.href` as `https://` or `http://` — server fetches with SSRF guards (no private IPs, 5MB max, 5s timeout, image/*). Hostname can be restricted via the `REMOTE_LOGO_HOSTS` env.\n\nTo upload a logo as a file part instead of inlining bytes, use `POST /api/qr/upload` with `multipart/form-data`.\n\n**Errors**: 400 on invalid input, 413 on logo too large, 415 on bad MIME, 502/504 on remote fetch failure, 500 on render failure.',
        body: generateBodySchema
      }
    },
    async (req, reply) => {
      try {
        const resolvedBody = await resolveLogo(req.body, logoResolverOptions)
        return await generateAndRespond(reply, resolvedBody, storage)
      } catch (err) {
        return handleError(req, reply, err)
      }
    }
  )

  app.post(
    '/api/qr/upload',
    {
      schema: {
        tags: ['qr'],
        summary: 'Generate a QR code with a multipart-uploaded logo',
        description:
          'Multipart variant of `POST /api/qr`. Send two parts:\n\n- `config` (text/json) — the same JSON body that `POST /api/qr` accepts. Strip `image.href`/`image.path`; they will be replaced by the uploaded file.\n- `logo` (file) — the image bytes. Inferred MIME or use `Content-Type: image/*` on the part.\n\nExample:\n```bash\ncurl -X POST http://localhost:8080/api/qr/upload \\\n  -F \'config={"data":"https://example.com","format":"png","save":true,"name":"with-logo"}\' \\\n  -F \'logo=@./logo.png\' \\\n  --output qr.png\n```',
        consumes: ['multipart/form-data']
      }
    },
    async (req, reply) => {
      try {
        const parsed = await readMultipart(req)
        const resolvedBody = applyMultipartLogo(parsed.body, parsed.logo, logoResolverOptions)
        return await generateAndRespond(reply, resolvedBody, storage)
      } catch (err) {
        return handleError(req, reply, err)
      }
    }
  )

  app.get(
    '/api/qr/files',
    {
      schema: {
        tags: ['files'],
        summary: 'List saved QR codes',
        description: 'Returns sidecar metadata for every saved file. Sorted newest first.',
        querystring: listQuerySchema,
        response: { 200: listResponseSchema }
      }
    },
    async (req) => {
      const { limit, offset, q, format } = req.query
      return storage.list({ limit, offset, q, format })
    }
  )

  app.get(
    '/api/qr/files/:id/meta',
    {
      schema: {
        tags: ['files'],
        summary: 'Get saved QR metadata',
        description:
          'Returns only the JSON sidecar (config + metadata) for a saved file. 404 if no file with that id.',
        params: fileIdParamSchema,
        response: {
          200: fileMetaSchema,
          404: errorResponseSchema
        }
      }
    },
    async (req, reply) => {
      const meta = await storage.readMeta(req.params.id)
      if (!meta) {
        return reply.code(404).send({ error: 'not_found', message: 'No saved file with that id.' })
      }
      return meta
    }
  )

  app.get(
    '/api/qr/files/:id',
    {
      schema: {
        tags: ['files'],
        summary: 'Download a saved QR code',
        description:
          'Returns the binary file. An optional extension (`.png`, `.svg`, `.jpg`) on the id is accepted so this URL can be used directly in `<img src>`.\n\n**Errors**: 404 if no file with that id; 409 if the requested extension does not match the saved format.',
        params: fileIdWithExtensionSchema
      }
    },
    async (req, reply) => {
      const rawId = req.params.id
      const dot = rawId.lastIndexOf('.')
      const requestedExt = dot > 0 ? rawId.slice(dot + 1).toLowerCase() : null
      const id = dot > 0 ? rawId.slice(0, dot) : rawId

      const result = await storage.readBinary(id)
      if (!result) {
        return reply.code(404).send({ error: 'not_found', message: 'No saved file with that id.' })
      }

      if (requestedExt) {
        const normalised = EXTENSION_TO_FORMAT[requestedExt]
        if (!normalised || normalised !== result.meta.format) {
          return reply.code(409).send({
            error: 'format_mismatch',
            message: `File was saved as .${result.meta.format}; cannot serve as .${requestedExt}.`
          })
        }
      }

      reply.header('Content-Type', FORMAT_TO_CONTENT_TYPE[result.meta.format])
      reply.header('Content-Length', result.buffer.byteLength)
      reply.header(
        'Content-Disposition',
        `inline; filename="${result.meta.id}.${result.meta.format}"`
      )
      return reply.send(result.buffer)
    }
  )

  app.delete(
    '/api/qr/files/:id',
    {
      schema: {
        tags: ['files'],
        summary: 'Delete a saved QR code',
        description:
          'Removes the binary file and its JSON sidecar. Returns 404 if the file does not exist.',
        params: fileIdParamSchema
      }
    },
    async (req, reply) => {
      const removed = await storage.remove(req.params.id)
      if (!removed) {
        return reply.code(404).send({ error: 'not_found', message: 'No saved file with that id.' })
      }
      return reply.code(204).send()
    }
  )
}

function stripGenerationFields(body: z.infer<typeof generateBodySchema>): QrConfigBody {
  const { format, save, name, quality, ...config } = body
  void format
  void save
  void name
  void quality
  return config
}

async function resolveLogo(
  body: GenerateBody,
  options: LogoResolverOptions
): Promise<GenerateBody> {
  if (!body.image) return body
  if (body.image.path) {
    const resolved = await resolveLogoFromPath(body.image.path, options)
    return replaceImageHref(body, resolved.dataUri)
  }
  if (body.image.href) {
    const resolved = await resolveLogoSource(body.image.href, options)
    return replaceImageHref(body, resolved.dataUri)
  }
  return body
}

function applyMultipartLogo(
  body: GenerateBody,
  logo: { buffer: Buffer; mimetype?: string; filename?: string } | null,
  options: LogoResolverOptions
): GenerateBody {
  if (!logo) return body
  const resolved = resolveLogoFromBuffer(logo.buffer, logo.mimetype, logo.filename, options)
  // Strip any incoming image.href/path; the multipart upload wins.
  const image = stripImageSource(body.image ?? {})
  return {
    ...body,
    image: { ...image, href: resolved.dataUri }
  }
}

function replaceImageHref(body: GenerateBody, dataUri: string): GenerateBody {
  if (!body.image) return body
  return {
    ...body,
    image: { ...stripImageSource(body.image), href: dataUri }
  }
}

function stripImageSource<T extends { href?: string; path?: string }>(
  image: T
): Omit<T, 'href' | 'path'> {
  const { href, path, ...rest } = image
  void href
  void path
  return rest
}

interface ParsedMultipart {
  body: GenerateBody
  logo: { buffer: Buffer; mimetype?: string; filename?: string } | null
}

async function readMultipart(req: FastifyRequest): Promise<ParsedMultipart> {
  let configJson: string | null = null
  let logo: ParsedMultipart['logo'] = null

  // fastify-multipart augments FastifyRequest at runtime; the augmented types
  // aren't friends with the Zod type provider so we narrow locally instead.
  type MultipartField = { type: 'field'; fieldname: string; value: unknown }
  type MultipartFilePart = {
    type: 'file'
    fieldname: string
    filename: string
    mimetype: string
    toBuffer(): Promise<Buffer>
  }
  type AnyPart = MultipartField | MultipartFilePart
  const partsFn = (req as unknown as { parts: () => AsyncIterable<AnyPart> }).parts
  if (typeof partsFn !== 'function') {
    throw new LogoResolveError('Request is not multipart/form-data.', 415, 'multipart_required')
  }
  for await (const part of partsFn.call(req)) {
    if (part.type === 'file') {
      if (part.fieldname !== 'logo') {
        await part.toBuffer().catch(() => undefined)
        continue
      }
      logo = {
        buffer: await part.toBuffer(),
        mimetype: part.mimetype,
        filename: part.filename
      }
    } else if (part.type === 'field' && part.fieldname === 'config') {
      configJson = typeof part.value === 'string' ? part.value : ''
    }
  }

  if (configJson == null) {
    throw new LogoResolveError(
      'multipart request must include a "config" field with the JSON body.',
      400,
      'multipart_missing_config'
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(configJson)
  } catch (err) {
    throw new LogoResolveError(
      `"config" field is not valid JSON: ${(err as Error).message}`,
      400,
      'multipart_bad_json'
    )
  }
  const result = generateBodySchema.safeParse(parsed)
  if (!result.success) {
    throw new LogoResolveError(
      `"config" failed schema validation: ${result.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
      400,
      'multipart_bad_config'
    )
  }
  return { body: result.data, logo }
}

async function generateAndRespond(
  reply: FastifyReply,
  body: GenerateBody,
  storage: FileStorage
): Promise<FastifyReply> {
  const format: OutputFormat = body.format ?? 'png'
  const { buffer, contentType, extension } = await renderQr(body, format, body.quality)

  let downloadName = `qr.${extension}`
  if (body.save) {
    const meta = await storage.save({
      config: stripGenerationFields(body),
      format,
      name: body.name,
      buffer
    })
    reply.header('X-QR-File-Id', meta.id)
    reply.header('Location', meta.url)
    downloadName = `${meta.id}.${extension}`
  } else if (body.name) {
    downloadName = `${body.name}.${extension}`
  }

  reply.header('Content-Type', contentType)
  reply.header('Content-Disposition', `attachment; filename="${downloadName}"`)
  reply.header('Content-Length', buffer.byteLength)
  return reply.send(buffer)
}

function handleError(req: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof LogoResolveError) {
    return reply.code(err.statusCode).send({ error: err.code, message: err.message })
  }
  req.log.error({ err }, 'QR generation failed')
  return reply.code(500).send({
    error: 'render_failed',
    message: err instanceof Error ? err.message : 'Failed to render QR code.'
  })
}
