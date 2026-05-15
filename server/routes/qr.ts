import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  errorResponseSchema,
  fileIdParamSchema,
  fileMetaSchema,
  generateBodySchema,
  listQuerySchema,
  listResponseSchema,
  type OutputFormat,
  type QrConfigBody
} from '../schema'
import { renderQr } from '../qr'
import type { FileStorage } from '../storage'

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
}

export const qrRoutes: FastifyPluginAsyncZod<QrRouteOptions> = async (app, opts) => {
  const { storage } = opts

  app.post(
    '/api/qr',
    {
      schema: {
        tags: ['qr'],
        summary: 'Generate (and optionally save) a QR code',
        description:
          'Returns the binary QR code in the requested format (image/svg+xml, image/png, or image/jpeg).\n\nIf `save: true` the file is also persisted on the server and the response includes an `X-QR-File-Id` header along with a `Location` header pointing to the download URL.\n\n**Logo limitation**: only `data:` URI logos are supported server-side. External `http(s)://` logo URLs will not be fetched.\n\n**Errors**: returns 400 with an `errorResponse` body on invalid input, 500 on render failure.',
        body: generateBodySchema
      }
    },
    async (req, reply) => {
      const body = req.body
      const format: OutputFormat = body.format ?? 'png'

      try {
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
      } catch (err) {
        req.log.error({ err }, 'QR generation failed')
        return reply.code(500).send({
          error: 'render_failed',
          message: err instanceof Error ? err.message : 'Failed to render QR code.'
        })
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
