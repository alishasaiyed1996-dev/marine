import { useEffect, useRef, useCallback } from 'react'
import createGlobe from 'cobe'

interface Marker {
  id: string
  location: [number, number]
  label: string
}

interface Arc {
  id: string
  from: [number, number]
  to: [number, number]
  label?: string
}

interface GlobeProps {
  markers?: Marker[]
  arcs?: Arc[]
  className?: string
  markerColor?: [number, number, number]
  baseColor?: [number, number, number]
  arcColor?: [number, number, number]
  glowColor?: [number, number, number]
  dark?: number
  mapBrightness?: number
  markerSize?: number
  markerElevation?: number
  arcWidth?: number
  arcHeight?: number
  speed?: number
  theta?: number
  diffuse?: number
  mapSamples?: number
}

/**
 * Interactive 3D globe (cobe) — drag to rotate, auto-spins when idle.
 * Markers and arcs (supply routes) render as canvas primitives, with their
 * labels positioned via CSS Anchor Positioning on the `--cobe-*` custom
 * properties cobe publishes on the canvas.
 */
export function Globe({
  markers = [],
  arcs = [],
  className = '',
  markerColor = [0.3, 0.45, 0.85],
  baseColor = [1, 1, 1],
  arcColor = [0.3, 0.45, 0.85],
  glowColor = [0.94, 0.93, 0.91],
  dark = 0,
  mapBrightness = 10,
  markerSize = 0.025,
  markerElevation = 0.01,
  arcWidth = 0.5,
  arcHeight = 0.25,
  speed = 0.003,
  theta = 0.2,
  diffuse = 1.5,
  mapSamples = 16000,
}: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Respect prefers-reduced-motion: render a static globe (auto-spin off) but
  // keep drag-to-rotate available — user-initiated motion is fine.
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null)
  const lastPointer = useRef<{ x: number; y: number; t: number } | null>(null)
  const dragOffset = useRef({ phi: 0, theta: 0 })
  const velocity = useRef({ phi: 0, theta: 0 })
  const phiOffsetRef = useRef(0)
  const thetaOffsetRef = useRef(0)
  const isPausedRef = useRef(false)
  // Set by the WebGL effect's IntersectionObserver; lets the pointer handlers
  // skip work for a globe that is scrolled out of view.
  const offscreenRef = useRef(false)
  // The animation loop lives inside the WebGL effect; drag handlers use this
  // to wake it (e.g. reduced-motion keeps the loop stopped until a drag starts).
  const resumeLoopRef = useRef<(() => void) | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY }
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
    isPausedRef.current = true
    // A reduced-motion globe idles with the loop stopped — restart it so the
    // canvas follows the pointer during this drag.
    resumeLoopRef.current?.()
  }, [])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (pointerInteracting.current !== null) {
      const deltaX = e.clientX - pointerInteracting.current.x
      const deltaY = e.clientY - pointerInteracting.current.y
      dragOffset.current = { phi: deltaX / 300, theta: deltaY / 1000 }
      const now = Date.now()
      if (lastPointer.current) {
        const dt = Math.max(now - lastPointer.current.t, 1)
        const maxVelocity = 0.15
        velocity.current = {
          phi: Math.max(-maxVelocity, Math.min(maxVelocity, ((e.clientX - lastPointer.current.x) / dt) * 0.3)),
          theta: Math.max(-maxVelocity, Math.min(maxVelocity, ((e.clientY - lastPointer.current.y) / dt) * 0.08)),
        }
      }
      lastPointer.current = { x: e.clientX, y: e.clientY, t: now }
    }
  }, [])

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi
      thetaOffsetRef.current += dragOffset.current.theta
      dragOffset.current = { phi: 0, theta: 0 }
      lastPointer.current = null
      // Reduced motion: no momentum coasting after release — the globe stops
      // where the user leaves it and the loop settles immediately.
      if (prefersReducedMotion) velocity.current = { phi: 0, theta: 0 }
    }
    pointerInteracting.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
    isPausedRef.current = false
  }, [prefersReducedMotion])

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerUp, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  // Serialize every option that drives the WebGL scene into one signature —
  // object/array props (colors, markers, arcs) are recreated on each parent
  // render, so depending on them directly destroyed and recreated the globe
  // (a visible flicker) every time the page re-rendered while data was still
  // loading. A stable signature re-runs the effect only when a VALUE actually
  // changes, e.g. the theme flip.
  const configKey = JSON.stringify([
    markers, arcs, markerColor, baseColor, arcColor, glowColor, dark,
    mapBrightness, markerSize, markerElevation, arcWidth, arcHeight,
    speed, theta, diffuse, mapSamples,
  ])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    let globe: ReturnType<typeof createGlobe> | null = null
    let animationId = 0
    let phi = 0

    /** Render one frame with the current option values (cobe's render entry). */
    function paint() {
      globe!.update({
        phi: phi + phiOffsetRef.current + dragOffset.current.phi,
        theta: theta + thetaOffsetRef.current + dragOffset.current.theta,
        dark,
        mapBrightness,
        markerColor,
        baseColor,
        arcColor,
        markerElevation,
        markers: markers.map((m) => ({
          location: m.location,
          size: markerSize,
          id: m.id,
        })),
        arcs: arcs.map((a) => ({
          from: a.from,
          to: a.to,
          id: a.id,
        })),
      })
    }

    function animate() {
      animationId = 0
      const spinning = !prefersReducedMotion && !isPausedRef.current
      const momentum =
        Math.abs(velocity.current.phi) > 0.0001 || Math.abs(velocity.current.theta) > 0.0001
      // While dragged (paused), keep painting so the globe follows the pointer.
      // With reduced motion and no drag the globe is static: the initial paint
      // happened in init(), so the loop stops — an idle globe costs nothing.
      if (spinning || momentum || isPausedRef.current) {
        if (spinning) phi += speed
        // Inertia decays regardless of the motion preference: it is the direct
        // result of the user's own drag and settles in well under a second.
        if (momentum) {
          phiOffsetRef.current += velocity.current.phi
          thetaOffsetRef.current += velocity.current.theta
          velocity.current.phi *= 0.95
          velocity.current.theta *= 0.95
        }
        if (spinning || momentum) {
          const thetaMin = -0.4
          const thetaMax = 0.4
          if (thetaOffsetRef.current < thetaMin) {
            thetaOffsetRef.current += (thetaMin - thetaOffsetRef.current) * 0.1
          } else if (thetaOffsetRef.current > thetaMax) {
            thetaOffsetRef.current += (thetaMax - thetaOffsetRef.current) * 0.1
          }
        }
        paint()
        animationId = requestAnimationFrame(animate)
      }
    }

    /** Start the loop unless it is already running or the canvas is offscreen. */
    function startLoop() {
      if (animationId || offscreenRef.current || !globe) return
      animationId = requestAnimationFrame(animate)
    }
    resumeLoopRef.current = startLoop

    function init() {
      const width = canvas.offsetWidth
      if (width === 0 || globe) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width,
        height: width,
        phi: 0,
        theta,
        dark,
        diffuse,
        mapSamples,
        mapBrightness,
        baseColor,
        markerColor,
        glowColor,
        markerElevation,
        markers: markers.map((m) => ({
          location: m.location,
          size: markerSize,
          id: m.id,
        })),
        arcs: arcs.map((a) => ({
          from: a.from,
          to: a.to,
          id: a.id,
        })),
        arcColor,
        arcWidth,
        arcHeight,
        opacity: 0.7,
      })
      // Always render one frame synchronously — cobe only paints on update(),
      // so under reduced-motion (where the animate loop stops immediately)
      // this is what puts the globe on screen.
      paint()
      startLoop()
      setTimeout(() => canvas && (canvas.style.opacity = '1'))
    }

    if (canvas.offsetWidth > 0) {
      init()
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          ro.disconnect()
          init()
        }
      })
      ro.observe(canvas)
    }

    // Stop the animation entirely while the globe is scrolled out of view —
    // the WebGL loop kept burning GPU/battery behind the rest of the page.
    const io = new IntersectionObserver((entries) => {
      offscreenRef.current = !entries.some((e) => e.isIntersecting)
      if (offscreenRef.current) {
        if (animationId) {
          cancelAnimationFrame(animationId)
          animationId = 0
        }
      } else {
        startLoop()
      }
    }, { threshold: 0 })
    io.observe(canvas)

    return () => {
      io.disconnect()
      resumeLoopRef.current = null
      if (animationId) cancelAnimationFrame(animationId)
      if (globe) globe.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
          opacity: 0,
          transition: 'opacity 1.2s ease',
          borderRadius: '50%',
          touchAction: 'none',
        }}
      />
      {markers.map((m) => (
        <div
          key={m.id}
          style={{
            position: 'absolute',
            // CSS Anchor Positioning — positionAnchor is now part of React 19's CSSProperties.
            positionAnchor: `--cobe-${m.id}`,
            bottom: 'anchor(top)',
            left: 'anchor(center)',
            translate: '-50% 0',
            marginBottom: 8,
            padding: '2px 6px',
            background: '#1a1a2e',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: '0.6rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
            pointerEvents: 'none' as const,
            opacity: `var(--cobe-visible-${m.id}, 0)`,
            filter: `blur(calc((1 - var(--cobe-visible-${m.id}, 0)) * 8px))`,
            transition: 'opacity 0.8s, filter 0.8s',
          }}
        >
          {m.label}
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translate3d(-50%, -1px, 0)',
              border: '5px solid transparent',
              borderTopColor: '#1a1a2e',
            }}
          />
        </div>
      ))}
      {arcs
        .filter((a) => a.label)
        .map((a) => (
          <div
            key={a.id}
            style={{
              position: 'absolute',
              // CSS Anchor Positioning — positionAnchor is now part of React 19's CSSProperties.
              positionAnchor: `--cobe-arc-${a.id}`,
              bottom: 'anchor(top)',
              left: 'anchor(center)',
              translate: '-50% 0',
              marginBottom: 8,
              padding: '2px 6px',
              background: '#fff',
              color: '#1a1a2e',
              fontFamily: 'monospace',
              fontSize: '0.6rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              whiteSpace: 'nowrap' as const,
              pointerEvents: 'none' as const,
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              opacity: `var(--cobe-visible-arc-${a.id}, 0)`,
              filter: `blur(calc((1 - var(--cobe-visible-arc-${a.id}, 0)) * 8px))`,
              transition: 'opacity 0.8s, filter 0.8s',
            }}
          >
            {a.label}
            <span
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translate3d(-50%, -1px, 0)',
                border: '5px solid transparent',
                borderTopColor: '#fff',
              }}
            />
          </div>
        ))}
    </div>
  )
}
