import sharp from 'sharp'
import { renderFramed } from '../src/lib/qr-code/frame'
import { DEFAULT_CONFIG, type ResolvedQRCodeConfig } from '../src/lib/qr-code/types'
import type { OutputFormat, QrConfigBody } from './schema'

function resolveConfig(config: QrConfigBody): ResolvedQRCodeConfig {
  return {
    data: config.data,
    size: config.size ?? DEFAULT_CONFIG.size,
    margin: config.margin ?? DEFAULT_CONFIG.margin,
    errorCorrectionLevel: config.errorCorrectionLevel ?? DEFAULT_CONFIG.errorCorrectionLevel,
    dots: {
      shape: config.dots?.shape ?? DEFAULT_CONFIG.dots.shape,
      color: config.dots?.color ?? DEFAULT_CONFIG.dots.color
    },
    cornerSquares: {
      shape: config.cornerSquares?.shape ?? DEFAULT_CONFIG.cornerSquares.shape,
      color: config.cornerSquares?.color ?? DEFAULT_CONFIG.cornerSquares.color
    },
    cornerDots: {
      shape: config.cornerDots?.shape ?? DEFAULT_CONFIG.cornerDots.shape,
      color: config.cornerDots?.color ?? DEFAULT_CONFIG.cornerDots.color
    },
    background: {
      color: config.background?.color ?? DEFAULT_CONFIG.background.color
    },
    image: config.image,
    frame: config.frame
  }
}

export interface RenderResult {
  buffer: Buffer
  contentType: 'image/svg+xml' | 'image/png' | 'image/jpeg'
  extension: 'svg' | 'png' | 'jpg'
}

const CONTENT_TYPE: Record<OutputFormat, RenderResult['contentType']> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg'
}

/**
 * Render a QR code on the server. SVG output is the raw string from the shared
 * core. PNG/JPG are produced by piping the SVG through sharp (librsvg under
 * the hood). For JPEG we flatten onto the configured background colour because
 * JPEG can't encode transparency.
 */
export async function renderQr(
  config: QrConfigBody,
  format: OutputFormat = 'png',
  jpegQuality?: number
): Promise<RenderResult> {
  const resolved = resolveConfig(config)
  const { svg, width, height } = renderFramed(resolved)

  if (format === 'svg') {
    return {
      buffer: Buffer.from(svg, 'utf-8'),
      contentType: CONTENT_TYPE.svg,
      extension: 'svg'
    }
  }

  let pipeline = sharp(Buffer.from(svg), { density: 300 }).resize({
    width: Math.round(width),
    height: Math.round(height),
    fit: 'contain'
  })

  if (format === 'jpg') {
    const flatten =
      resolved.background.color && resolved.background.color !== 'transparent'
        ? resolved.background.color
        : '#ffffff'
    pipeline = pipeline.flatten({ background: flatten }).jpeg({ quality: jpegQuality ?? 92 })
  } else {
    pipeline = pipeline.png()
  }

  const buffer = await pipeline.toBuffer()
  return {
    buffer,
    contentType: CONTENT_TYPE[format],
    extension: format
  }
}
