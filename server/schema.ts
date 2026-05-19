import { z } from 'zod'

const colorSchema = z
  .string()
  .min(1)
  .max(64)
  .describe('Any valid CSS color (hex, rgb, rgba, named, "transparent")')

const dotShapeSchema = z
  .enum(['square', 'rounded', 'extra-rounded', 'classy', 'classy-rounded', 'dots'])
  .describe(
    'Module shape for the QR dots. Allowed values: square, rounded, extra-rounded, classy, classy-rounded, dots.'
  )

const cornerSquareShapeSchema = z
  .enum(['square', 'rounded', 'extra-rounded', 'dot'])
  .describe(
    'Shape for the three finder pattern outer squares. Allowed values: square, rounded, extra-rounded, dot.'
  )

const cornerDotShapeSchema = z
  .enum(['square', 'rounded', 'dot'])
  .describe('Shape for the inner dot of each finder pattern. Allowed values: square, rounded, dot.')

const errorCorrectionLevelSchema = z
  .enum(['L', 'M', 'Q', 'H'])
  .describe(
    'QR error correction level. Allowed values: L, M, Q, H. Higher values add redundancy and make the QR code larger.'
  )

const textPositionSchema = z
  .enum(['top', 'bottom', 'left', 'right'])
  .describe('Caption position for the optional frame. Allowed values: top, bottom, left, right.')

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
      .describe('Logo size as a ratio of the QR size. Range: 0 to 1.'),
    margin: z
      .number()
      .min(0)
      .max(50)
      .optional()
      .describe('Padding around the logo in module units. Range: 0 to 50.'),
    hideBackgroundDots: z
      .boolean()
      .optional()
      .describe('Hide the background QR dots behind the logo when true.')
  })
  .describe(
    'Optional center logo. Provide bytes one of four ways: data URI, remote URL, `image.path` (requires `LOGO_DIR`), or a `logo` file part in a multipart request.'
  )

const frameSchema = z
  .object({
    text: z.string().max(500).describe('Frame caption text. Maximum length: 500 characters.'),
    textPosition: textPositionSchema,
    textColor: colorSchema.optional().describe('Caption text color.'),
    backgroundColor: colorSchema.optional().describe('Frame background color.'),
    borderColor: colorSchema.optional().describe('Frame border color.'),
    borderWidth: z
      .number()
      .min(0)
      .max(40)
      .optional()
      .describe('Border width in pixels. Range: 0 to 40.'),
    borderRadius: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .describe('Border radius in pixels. Range: 0 to 200.'),
    padding: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .describe('Padding around the QR code in pixels. Range: 0 to 200.'),
    fontFamily: z
      .string()
      .max(120)
      .optional()
      .describe(
        'Font family for the caption. Maximum length: 120 characters. The UI offers a curated set of options, but any valid CSS font-family string is accepted.'
      ),
    fontSize: z
      .number()
      .min(4)
      .max(200)
      .optional()
      .describe('Caption font size in pixels. Range: 4 to 200.')
  })
  .describe('Optional caption/frame around the QR code.')

export const qrConfigSchema = z.object({
  data: z
    .string()
    .min(1)
    .max(4000)
    .describe('Payload encoded into the QR code. Required. Maximum length: 4000 characters.'),
  size: z
    .number()
    .int()
    .min(32)
    .max(4096)
    .optional()
    .describe('Output size in pixels. Optional. Default: 200. Range: 32 to 4096.'),
  margin: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe('Quiet zone in module units. Optional. Default: 0. Range: 0 to 20.'),
  errorCorrectionLevel: errorCorrectionLevelSchema
    .optional()
    .describe('QR error correction level. Optional.'),
  dots: z
    .object({
      shape: dotShapeSchema.optional().describe('Module shape for the QR dots.'),
      color: colorSchema.optional().describe('Dot color.')
    })
    .optional()
    .describe('Settings for the QR dot modules.'),
  cornerSquares: z
    .object({
      shape: cornerSquareShapeSchema.optional().describe('Corner square shape.'),
      color: colorSchema.optional().describe('Corner square color.')
    })
    .optional(),
  cornerDots: z
    .object({
      shape: cornerDotShapeSchema.optional().describe('Corner dot shape.'),
      color: colorSchema.optional().describe('Corner dot color.')
    })
    .optional(),
  background: z
    .object({ color: colorSchema.optional().describe('Background color.') })
    .optional()
    .describe('Background styling for the QR code.'),
  image: imageSchema.optional().describe('Optional center logo image.'),
  frame: frameSchema.optional().describe('Optional caption/frame around the QR code.')
})

export const formatSchema = z
  .enum(['svg', 'png', 'jpg'])
  .describe(
    'Output format. Allowed values: svg, png, jpg. jpg rasterises with a default JPEG quality of 92.'
  )

export const generateBodySchema = qrConfigSchema.extend({
  format: formatSchema.optional().describe('Output format. Optional. Default: png.'),
  save: z
    .boolean()
    .optional()
    .describe('If true, the generated file is persisted to the server filesystem.'),
  name: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Optional human label appended to the timestamp id when saving. Maximum length: 120 characters.'
    ),
  quality: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe('JPEG quality. Optional. Range: 1 to 100. Only meaningful when format=jpg.')
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
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Page size. Optional. Range: 1 to 200.'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Zero-based result offset. Optional. Minimum: 0.'),
  q: z
    .string()
    .max(120)
    .optional()
    .describe(
      'Case-insensitive substring match against the saved name. Maximum length: 120 characters.'
    ),
  format: formatSchema.optional().describe('Filter results to a single output format.')
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
    .describe(
      'Saved file id. Maximum length: 256 characters. Allowed characters: letters, numbers, dot, underscore, dash.'
    )
})

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string()
})

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string()
})
