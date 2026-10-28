interface OptimizedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  width?: number
  height?: number
  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'sync' | 'auto'
  sizes?: string
  optimized?: boolean
  /**
   * Width passed to the Cloudinary URL transform. Defaults to 800; set 0 to
   * disable the transform (e.g. og:image). Product-detail images pass a
   * larger width so uploaded photos render sharp at full column size —
   * previously uploaded (full-URL) images got NO transform and shipped
   * 2000px originals, while they were displayed small.
   */
  transformWidth?: number
  /**
   * Extended error hook: receives the pre-fallback URL as the 2nd argument so
   * callers can tell a PRIMARY source failure (the original src, e.g. a
   * Cloudinary image) apart from a FALLBACK-stage failure (the swapped-in
   * local copy / placeholder, which is a shared asset and must not count as
   * "this image failed").
   */
  onError?: (
    event: React.SyntheticEvent<HTMLImageElement>,
    failedSrc?: string,
  ) => void
}

import { useEffect, useRef } from 'react'
import { applyImageFallback, applyCloudinaryTransform } from '../../lib/utils'

/**
 * Browser-picked srcSet for callers that declare a `sizes` layout: the base
 * rendition plus a 2× candidate. Cloudinary's `c_limit` never upscales, and
 * applyCloudinaryTransform returns width-carrying URLs untouched, so the two
 * candidates collapse to one whenever a 2× rendition is meaningless — in that
 * case no srcSet is emitted at all. Only Cloudinary sources get one; local
 * files are already exact-size.
 */
function buildSrcSet(src: string, base: number): string | undefined {
  if (!base || base <= 0) return undefined
  if (!src.includes('res.cloudinary.com') || !src.includes('/image/upload/')) return undefined
  const candidates = [
    applyCloudinaryTransform(src, base),
    applyCloudinaryTransform(src, base * 2),
  ]
  if (candidates[0] === candidates[1]) return undefined
  return `${candidates[0]} ${base}w, ${candidates[1]} ${base * 2}w`
}

/**
 * OptimizedImage renders a clean, high-performance <img> element.
 * Bypasses fragile <picture> type negotiation that can break in browsers or edge-case header caching.
 *
 * On error: applies a graceful fallback chain directly on the DOM element
 * (avoids React state re-render flicker):
 *   Cloudinary product URL → local deployed copy → placeholder → stop.
 *
 * Any Cloudinary URL that doesn't already carry a width is sized here
 * (f_auto,q_auto,w_800,c_limit) — this is the single choke point that keeps
 * images built outside getProductImageUrl (e.g. the home category tiles, one
 * of which shipped a 269 KB original) from downloading at full resolution.
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  loading = 'lazy',
  decoding = 'async',
  className,
  onError,
  sizes,
  transformWidth = 800,
  ...rest
}: OptimizedImageProps) {
  // A mobile connection can drop a single image request without the asset
  // being broken. Retrying the primary rendition once (after a short pause)
  // recovers those cases instead of leaving the gallery on a fallback/blank.
  const retriedSrc = useRef<string | null>(null)
  useEffect(() => {
    retriedSrc.current = null
  }, [src])

  return (
    <img
      src={applyCloudinaryTransform(src, transformWidth)}
      srcSet={sizes ? buildSrcSet(src, transformWidth) : undefined}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      className={className}
      onError={(e) => {
        const img = e.currentTarget
        // Read the failing URL BEFORE the fallback chain runs: by the time the
        // error event reaches the caller, applyImageFallback below may already
        // have swapped the src to the local placeholder.
        const failedSrc = img.getAttribute('src') || img.src
        const primarySrc = applyCloudinaryTransform(src, transformWidth)

        if (failedSrc === primarySrc && retriedSrc.current !== primarySrc) {
          retriedSrc.current = primarySrc
          setTimeout(() => {
            if (!img.isConnected) return
            img.src = `${primarySrc}${primarySrc.includes('?') ? '&' : '?'}_retry=1`
          }, 500)
          return
        }

        applyImageFallback(img)
        if (onError) onError(e, failedSrc)
      }}
      {...rest}
    />
  )
}
