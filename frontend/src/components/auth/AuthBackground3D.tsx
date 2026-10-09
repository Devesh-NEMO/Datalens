'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  FogExp2,
  GridHelper,
  InstancedMesh,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import type { Material } from 'three';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

/**
 * A restrained, professional data-themed backdrop: a softly glowing
 * perspective grid floor, a field of slowly floating translucent bars
 * (a stylized bar chart), gentle fog, and a few glowing particles.
 *
 * Design rules that keep it premium rather than gimmicky:
 * - one `InstancedMesh` for the whole bar field, one `Points` cloud and one
 *   grid → a few draw calls regardless of scene size;
 * - a very slow camera drift plus at most ~2° of eased mouse parallax;
 * - the animation loop pauses when the tab is hidden or the canvas is
 *   off-screen, and never runs for `prefers-reduced-motion: reduce`.
 *
 * Fallbacks, in order: no WebGL2 → the CSS gradient backdrop stays with no
 * errors; context creation throws → the canvas is removed and the CSS
 * backdrop stays; `prefers-reduced-motion: reduce` → exactly one static
 * frame (no loop, no parallax); narrow or low-core viewports → a lighter
 * scene (fewer bars/particles, no parallax).
 *
 * The scene is created once; theme changes only re-apply the palette to the
 * live objects (background texture, fog, grid, per-instance bar colours),
 * never recreating the renderer. Loaded via `next/dynamic({ ssr: false })`
 * from `AuthBackground.tsx` and fades in over the CSS backdrop once the first
 * frame is on screen.
 */

interface Palette {
  background: readonly [string, string, string];
  fog: string;
  bars: readonly string[];
  barOpacity: number;
  grid: string;
  gridOpacity: number;
  floor: string;
  floorOpacity: number;
  particles: string;
  particleOpacity: number;
  fogDensity: number;
}

const PALETTES: { light: Palette; dark: Palette } = {
  light: {
    background: ['#F6F9FF', '#E8EFFC', '#DEE7F9'],
    fog: '#E7EEFB',
    bars: ['#A5B4FC', '#93C5FD', '#C4B5FD', '#99F6E4'],
    barOpacity: 0.4,
    grid: '#6366F1',
    gridOpacity: 0.22,
    floor: '#6366F1',
    floorOpacity: 0.1,
    particles: '#6366F1',
    particleOpacity: 0.5,
    fogDensity: 0.026,
  },
  dark: {
    background: ['#050B18', '#0F1B3A', '#1B2450'],
    fog: '#0E1833',
    bars: ['#6366F1', '#3B82F6', '#8B5CF6', '#14B8A6'],
    barOpacity: 0.5,
    grid: '#6366F1',
    gridOpacity: 0.2,
    floor: '#6366F1',
    floorOpacity: 0.14,
    particles: '#A5B4FC',
    particleOpacity: 0.75,
    fogDensity: 0.024,
  },
};

export default function AuthBackground3D() {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const applyPaletteRef = useRef<((palette: Palette) => void) | null>(null);
  const renderOnceRef = useRef<(() => void) | null>(null);
  const staticModeRef = useRef(false);
  const { theme } = useTheme();
  const [fadedIn, setFadedIn] = useState(false);

  // --- One-time scene creation ---
  useEffect(() => {
    const holder = holderRef.current;
    const canvas = canvasRef.current;
    if (!holder || !canvas) return;

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- WebGL2 capability probe: fail quietly to the CSS backdrop ---
    let webgl2 = false;
    try {
      const probe = document.createElement('canvas');
      webgl2 = typeof window.WebGL2RenderingContext !== 'undefined' && !!probe.getContext('webgl2');
    } catch {
      webgl2 = false;
    }
    if (!webgl2) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      // Keep the canvas in place (it stays transparent — `fadedIn` is false),
      // so the CSS gradient + grid behind it remain the visible backdrop.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // DPR cap
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x000000, 1);

    const scene = new Scene();
    const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 240);

    // --- Scene intensity: lighter scene on narrow / low-power viewports ---
    const hardwareCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const isLightScene = window.innerWidth < 768 || (hardwareCores !== undefined && hardwareCores <= 4);
    const barCount = isLightScene ? 150 : 640;
    const particleCount = isLightScene ? 56 : 128;

    // Scenes start with the dark palette; the theme effect below re-applies the
    // correct palette immediately after mount (before the first RAF frame).
    let palette: Palette = PALETTES.dark;

    // --- Helpers (browser-only: textures are tiny canvases) ---
    function makeRadialDotTexture(): CanvasTexture {
      const size = 64;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      if (ctx) {
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      return tex;
    }

    function makeGradientTexture(stops: readonly [string, string, string]): CanvasTexture {
      const height = 256;
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = height;
      const ctx = c.getContext('2d');
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, stops[0]);
        grad.addColorStop(0.5, stops[1]);
        grad.addColorStop(1, stops[2]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 4, height);
      }
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      tex.magFilter = LinearFilter;
      tex.minFilter = LinearFilter;
      return tex;
    }

    function makeFloorTexture(color: string, alpha: number): CanvasTexture {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      if (ctx) {
        const col = new Color(color);
        const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, `rgba(${rgb},${alpha})`);
        grad.addColorStop(0.55, `rgba(${rgb},${alpha * 0.45})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      return tex;
    }

    // --- Lights (Standard-material shading makes the cubes read as 3D) ---
    const ambient = new AmbientLight(0xffffff, 0.8);
    const key = new DirectionalLight(0xffffff, 1.0);
    key.position.set(12, 24, 10);
    scene.add(ambient, key);

    // --- The floating bar-chart field (one draw call) ---
    const barGeometry = new BoxGeometry(1, 1, 1);
    const barMaterial = new MeshStandardMaterial({
      roughness: 0.55,
      metalness: 0.08,
      transparent: true,
    });
    const bars = new InstancedMesh(barGeometry, barMaterial, barCount);
    bars.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(bars);

    const barSeeds: Array<{
      x: number; z: number; w: number; h: number; depth: number;
      rotY: number; phase: number; speed: number; amp: number; colorIdx: number; variance: number;
    }> = [];
    for (let i = 0; i < barCount; i += 1) {
      barSeeds.push({
        x: (Math.random() * 2 - 1) * 24,
        z: (Math.random() * 2 - 1) * 9 - 7, // between -16 and 2
        w: 0.5 + Math.random() * 0.55,
        h: 0.45 + Math.random() * 1.75,
        depth: 0.5 + Math.random() * 0.55,
        rotY: (Math.random() * 2 - 1) * 0.24,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.5,
        amp: 0.05 + Math.random() * 0.1,
        colorIdx: Math.floor(Math.random() * palette.bars.length),
        variance: 0.85 + Math.random() * 0.3,
      });
    }
    const dummyBar = new Object3D();

    // --- Particles (one draw call) ---
    const particleGeometry = new BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);
    const PARTICLE_Y_MIN = 0.4;
    const PARTICLE_Y_MAX = 7;
    for (let i = 0; i < particleCount; i += 1) {
      particlePositions[i * 3] = (Math.random() * 2 - 1) * 22;
      particlePositions[i * 3 + 1] = PARTICLE_Y_MIN + Math.random() * (PARTICLE_Y_MAX - PARTICLE_Y_MIN);
      particlePositions[i * 3 + 2] = (Math.random() * 2 - 1) * 9 - 7;
      particleSpeeds[i] = 0.08 + Math.random() * 0.16;
    }
    particleGeometry.setAttribute('position', new BufferAttribute(particlePositions, 3));
    const particleTexture = makeRadialDotTexture();
    const particleMaterial = new PointsMaterial({
      size: 0.14,
      sizeAttenuation: true,
      map: particleTexture,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const particles = new Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // --- Fog + background (kept in sync in applyPalette) ---
    const fog = new FogExp2(palette.fog, palette.fogDensity);
    scene.fog = fog;
    let backgroundTexture = makeGradientTexture(palette.background);
    scene.background = backgroundTexture;

    // Scene objects that get recreated per palette / per theme.
    let grid: GridHelper | null = null;
    let floor: Mesh | null = null;
    let floorTexture: CanvasTexture | null = null;

    function applyPalette(p: Palette): void {
      palette = p;

      const nextBackground = makeGradientTexture(p.background);
      scene.background = nextBackground;
      backgroundTexture.dispose();
      backgroundTexture = nextBackground;

      fog.color.set(p.fog);
      fog.density = p.fogDensity;

      barMaterial.opacity = p.barOpacity;
      const color = new Color();
      for (let i = 0; i < barSeeds.length; i += 1) {
        const seed = barSeeds[i];
        color.set(p.bars[seed.colorIdx % p.bars.length]).multiplyScalar(seed.variance);
        bars.setColorAt(i, color);
      }
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true;

      // GridHelper bakes vertex colours, so recreate it per theme.
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        (grid.material as Material).dispose();
      }
      grid = new GridHelper(70, 36, p.grid, p.grid);
      const gridMaterial = grid.material as LineBasicMaterial;
      gridMaterial.transparent = true;
      gridMaterial.opacity = p.gridOpacity;
      scene.add(grid);

      if (floor) {
        scene.remove(floor);
        floor.geometry.dispose();
        (floor.material as Material).dispose();
      }
      if (floorTexture) floorTexture.dispose();
      floorTexture = makeFloorTexture(p.floor, p.floorOpacity);
      floor = new Mesh(
        new PlaneGeometry(160, 160),
        new MeshBasicMaterial({ map: floorTexture, transparent: true, depthWrite: false })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      scene.add(floor);

      particleMaterial.color.set(p.particles);
      particleMaterial.opacity = p.particleOpacity;
    }
    applyPalette(palette);
    applyPaletteRef.current = applyPalette;
    renderOnceRef.current = renderOnce;
    staticModeRef.current = reducedMotion;

    // --- Camera drift + mouse parallax (max ~2°, eased) ---
    const pointerTarget = { x: 0, y: 0 };
    const pointerCurrent = { x: 0, y: 0 };
    const useParallax = !reducedMotion && !isLightScene;

    function onPointerMove(event: PointerEvent): void {
      pointerTarget.x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
      pointerTarget.y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
    }

    function onResize(): void {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      if (reducedMotion) renderOnce();
    }

    function placeBars(t: number): void {
      for (let i = 0; i < barSeeds.length; i += 1) {
        const s = barSeeds[i];
        dummyBar.position.set(s.x, s.h / 2 + Math.sin(t * s.speed + s.phase) * s.amp, s.z);
        dummyBar.rotation.y = s.rotY + Math.sin(t * s.speed * 0.5 + s.phase) * 0.03;
        dummyBar.scale.set(s.w, s.h, s.depth);
        dummyBar.updateMatrix();
        bars.setMatrixAt(i, dummyBar.matrix);
      }
      bars.instanceMatrix.needsUpdate = true;
    }

    function driftParticles(dt: number): void {
      const attr = particleGeometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < particleCount; i += 1) {
        let y = particlePositions[i * 3 + 1] + particleSpeeds[i] * dt;
        if (y > PARTICLE_Y_MAX) y = PARTICLE_Y_MIN;
        particlePositions[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
    }

    function renderOnce(): void {
      camera.position.set(0, 3.8, 11.5);
      camera.lookAt(0, 1.15, -2.5);
      placeBars(0);
      renderer.render(scene, camera);
      setFadedIn(true);
    }

    // --- Animation loop (60fps target; ~4 draw calls per frame) ---
    let raf = 0;
    let running = false;
    let lastTime = 0;
    let firstFrameShown = false;

    function loop(now: number): void {
      if (!running) return;
      raf = requestAnimationFrame(loop);

      if (!lastTime) lastTime = now;
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const t = now / 1000;

      if (useParallax) {
        pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.045;
        pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.045;
      }

      camera.position.set(
        Math.sin(t * 0.1) * 0.6 + pointerCurrent.x * 0.4,
        3.8 + Math.sin(t * 0.08 + 1.2) * 0.3 - pointerCurrent.y * 0.25,
        11.5 + Math.cos(t * 0.07) * 0.5
      );
      camera.lookAt(
        pointerCurrent.x * 0.35, // ≈2° of rotation at this distance
        1.15 - pointerCurrent.y * 0.25,
        -2.5
      );

      placeBars(t);
      driftParticles(dt);
      renderer.render(scene, camera);

      if (!firstFrameShown) {
        firstFrameShown = true;
        setFadedIn(true);
      }
    }

    function start(): void {
      if (running || reducedMotion) return;
      running = true;
      lastTime = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop(): void {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // --- Lifecycle wiring ---
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) start();
        else stop();
      },
      { threshold: 0.01 }
    );
    observer.observe(holder);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      stop();
      canvas.remove();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    window.addEventListener('resize', onResize);
    if (useParallax) window.addEventListener('pointermove', onPointerMove);

    if (reducedMotion) {
      renderOnce(); // one static frame, no animation, no parallax
    } else {
      start(); // the loop fades the canvas in on its first frame
    }

    // --- Teardown: dispose everything three owns, drop the canvas ---
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('resize', onResize);
      if (useParallax) window.removeEventListener('pointermove', onPointerMove);

      scene.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Points || obj instanceof LineSegments) {
          obj.geometry.dispose();
          const material = obj.material as Material | Material[];
          const list = Array.isArray(material) ? material : [material];
          for (const m of list) {
            const textured = m as Material & { map?: Texture | null };
            if (textured.map) textured.map.dispose();
            m.dispose();
          }
        }
      });
      particleTexture.dispose();
      backgroundTexture.dispose();
      if (floorTexture) floorTexture.dispose();
      if (scene.background instanceof Texture) scene.background.dispose();
      renderer.dispose();
      // Note: the canvas DOM node is *not* removed here. In dev, React
      // StrictMode re-runs effects without re-creating the node, so removing
      // it would leave the second init rendering into a detached canvas. On a
      // real unmount React removes the node with the rest of the subtree.
    };
  }, []);

  // --- Theme changes: re-apply the palette, never recreate the renderer ---
  useEffect(() => {
    if (!applyPaletteRef.current) return;
    applyPaletteRef.current(theme === 'dark' ? PALETTES.dark : PALETTES.light);
    // In static (reduced-motion) mode the loop is not running, so repaint once
    // so the scene actually reflects the new colours.
    if (staticModeRef.current) renderOnceRef.current?.();
  }, [theme]);

  return (
    <div
      ref={holderRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className={cn(
          'block h-full w-full transition-opacity duration-700 ease-out',
          fadedIn ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  );
}