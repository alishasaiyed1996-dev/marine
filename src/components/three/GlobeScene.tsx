import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sphere, Line } from '@react-three/drei'
import * as THREE from 'three'

function GlobeInner() {
  const meshRef = useRef<THREE.Mesh>(null!)
  const groupRef = useRef<THREE.Group>(null!)
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  // Continuous rotation in frameloop="demand" mode: each rendered frame must
  // call invalidate() to schedule the next one. When the globe scrolls out of
  // view (or prefers-reduced-motion), we simply stop invalidating — the loop
  // drains and GPU work drops to zero instead of burning battery behind the
  // rest of the page.
  const visibleRef = useRef(true)
  const reducedRef = useRef(false)

  useEffect(() => {
    reducedRef.current = !!window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting)
      visibleRef.current = visible
      if (visible) invalidate()
    }, { threshold: 0 })
    io.observe(gl.domElement)
    return () => io.disconnect()
  }, [gl, invalidate])

  useFrame((_, delta) => {
    if (!visibleRef.current) return
    if (reducedRef.current) return
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.15
    }
    invalidate()
  })

  const nodes = useMemo(
    () => [
      { lat: 21.7645, lng: 72.1519, label: 'Bhavnagar' },
    ],
    []
  )

  const latLngToPosition = (lat: number, lng: number, radius: number) => {
    const phi = (90 - lat) * (Math.PI / 180)
    const theta = (lng + 180) * (Math.PI / 180)
    const x = -radius * Math.sin(phi) * Math.cos(theta)
    const y = radius * Math.cos(phi)
    const z = radius * Math.sin(phi) * Math.sin(theta)
    return new THREE.Vector3(x, y, z)
  }

  const radius = 2.8
  const nodePositions = nodes.map((n) => latLngToPosition(n.lat, n.lng, radius))

  // Connection lines between nodes
  const lines = useMemo(() => {
    const pairs: [number, number][] = []
    return pairs.map(([i, j]) => ({
      from: nodePositions[i],
      to: nodePositions[j],
    }))
  }, [nodePositions])

  return (
    <group ref={groupRef}>
      {/* Globe sphere */}
      <Sphere ref={meshRef} args={[radius, 64, 64]}>
        <meshPhongMaterial
          color="#0A1628"
          emissive="#0EA5E9"
          emissiveIntensity={0.08}
          wireframe={false}
          transparent
          opacity={0.9}
        />
      </Sphere>

      {/* Wireframe overlay */}
      <Sphere args={[radius * 1.001, 32, 32]}>
        <meshBasicMaterial color="#1E3A5F" wireframe transparent opacity={0.3} />
      </Sphere>

      {/* Glow ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -radius * 1.05, 0]}>
        <ringGeometry args={[radius * 0.8, radius * 1.1, 64]} />
        <meshBasicMaterial color="#0EA5E9" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>

      {/* Connection lines */}
      {lines.map((line, i) => (
        <Line
          key={i}
          points={[line.from, line.to]}
          color="#0EA5E9"
          lineWidth={1}
          transparent
          opacity={0.2}
        />
      ))}

      {/* Node dots */}
      {nodePositions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#0EA5E9" />
        </mesh>
      ))}

      {/* Glow halos on nodes */}
      {nodePositions.map((pos, i) => (
        <mesh key={`glow-${i}`} position={pos}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshBasicMaterial color="#0EA5E9" transparent opacity={0.15} />
        </mesh>
      ))}
    </group>
  )
}

export default function GlobeScene() {
  return (
    <Canvas
      // z=8 so the 5.6-unit globe (radius 2.8) + glow ring fit inside the
      // fov-45 frustum: at z=6 the visible height is ~4.97 and the poles were
      // cropped by the viewport.
      camera={{ position: [0, 0, 8], fov: 45 }}
      // 1.5x dpr cap: 3x phones were shading 9x the pixels for a decorative
      // globe for no visible benefit.
      dpr={[1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={0.8} />
      <GlobeInner />
    </Canvas>
  )
}
