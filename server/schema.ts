import { z } from 'zod'

const colorSchema = z
  .string()
  .min(1)
  .max(64)
  .describe('Any valid CSS color (hex, rgb, rgba, named, "transparent")')

const dotShapeSchema = z
  .enum(['square', 'rounded', 'extra-rounded', 'classy', 'classy-rounded', 'dots'])
  .describe('Module shape for the QR dots')

const cornerSquareShapeSchema = z
  .enum(['square', 'rounded', 'extra-rounded', 'dot'])
  .describe('Shape for the three finder pattern outer squares')

const cornerDotShapeSchema = z
  .enum(['square', 'rounded', 'dot'])
  .describe('Shape for the inner dot of each finder pattern')

const errorCorrectionLevelSchema = z
  .enum(['L', 'M', 'Q', 'H'])
  .describe('QR error correction level. Higher = more redundancy, larger QR.')

const textPositionSchema = z.enum(['top', 'bottom', 'left', 'right'])

const imageSchema = z
  .object({
    href: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Logo image source. Accepts (1) a `data:` URI with bytes inlined, or (2) an `https://`/`http://` URL — the server fetches it, applies SSRF guards (no private/loopback IPs, 5MB max, 5s timeout, image/* only), and inlines the bytes.'
      ),
    path: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe(
        'Filename inside the configured `LOGO_DIR`. The server reads the file from disk. Requires `LOGO_DIR` env to be set.'
      ),
    sizeRatio: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Logo size as a ratio of the QR size (0-1).'),
    margin: z
      .number()
      .min(0)
      .max(50)
      .optional()
      .describe('Padding around the logo in module units.'),
    hideBackgroundDots: z.boolean().optional()
  })
  .describe(
    'Optional center logo. Provide bytes one of four ways: data URI, remote URL, `image.path` (requires `LOGO_DIR`), or a `logo` file part in a multipart request.'
  )

const frameSchema = z
  .object({
    text: z.string().max(500),
    textPosition: textPositionSchema,
    textColor: colorSchema.optional(),
    backgroundColor: colorSchema.optional(),
    borderColor: colorSchema.optional(),
    borderWidth: z.number().min(0).max(40).optional(),
    borderRadius: z.number().min(0).max(200).optional(),
    padding: z.number().min(0).max(200).optional(),
    fontFamily: z.string().max(120).optional(),
    fontSize: z.number().min(4).max(200).optional()
  })
  .describe('Optional caption/frame around the QR code.')

export const qrConfigSchema = z.object({
  data: z.string().min(1).max(4000).describe('Payload encoded into the QR code.'),
  size: z
    .number()
    .int()
    .min(32)
    .max(4096)
    .optional()
    .describe('Output size in pixels. Default 200.'),
  margin: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe('Quiet zone in module units. Default 0.'),
  errorCorrectionLevel: errorCorrectionLevelSchema.optional(),
  dots: z.object({ shape: dotShapeSchema.optional(), color: colorSchema.optional() }).optional(),
  cornerSquares: z
    .object({ shape: cornerSquareShapeSchema.optional(), color: colorSchema.optional() })
    .optional(),
  cornerDots: z
    .object({ shape: cornerDotShapeSchema.optional(), color: colorSchema.optional() })
    .optional(),
  background: z.object({ color: colorSchema.optional() }).optional(),
  image: imageSchema.optional(),
  frame: frameSchema.optional()
})

export const formatSchema = z
  .enum(['svg', 'png', 'jpg'])
  .describe('Output format. "jpg" rasterises with a JPEG quality of 92.')

export const generateBodySchema = qrConfigSchema.extend({
  format: formatSchema.optional().describe('Default "png".'),
  save: z
    .boolean()
    .optional()
    .describe('If true, the generated file is persisted to the server filesystem.'),
  name: z
    .string()
    .max(120)
    .optional()
    .describe('Optional human label appended to the timestamp id when saving.'),
  quality: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe('JPEG quality 1-100. Only meaningful when format=jpg.')
})

export type GenerateBody = z.infer<typeof generateBodySchema>
export type QrConfigBody = z.infer<typeof qrConfigSchema>
export type OutputFormat = z.infer<typeof formatSchema>

export const fileMetaSchema = z.object({
  id: z.string().describe('Storage id, e.g. "2026-05-15T20-12-34-567Z-spring-promo".'),
  name: z.string().nullable().describe('Optional name supplied at creation time, if any.'),
  format: formatSchema,
  size: z.number().int().nonnegative().describe('File size in bytes.'),
  createdAt: z.string().describe('ISO-8601 creation timestamp.'),
  url: z.string().describe('Path to download the binary, including extension.'),
  config: qrConfigSchema.describe('The exact config used to generate the file (reproducible).')
})

export type FileMeta = z.infer<typeof fileMetaSchema>

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().max(120).optional().describe('Case-insensitive substring match against the name.'),
  format: formatSchema.optional()
})

export const listResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(fileMetaSchema)
})

export const fileIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9._-]+$/, 'id must be safe filesystem characters only')
})

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string()
})

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string()
})
