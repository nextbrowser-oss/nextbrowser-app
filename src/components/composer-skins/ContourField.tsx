// Adapted from Smet'A, smeta/src/components/ContourField.tsx (Git blob d68cac69).
// Живой фон главного экрана: контурная «карта» из слипающихся капель. Поле
// метаболов срезается несколькими уровнями (marching squares) — получаются
// вложенные изолинии, как на топографической карте; капли медленно плывут и
// перетекают друг в друга, как ферромагнитная жидкость.
//
// Рисуем на канве, а не в SVG: пересчёт изолиний каждый кадр дешевле, чем
// перестройка сотен path в DOM. Кадр ограничен 25 fps — движение медленное,
// больше не нужно, а телефон не греется.
import { useEffect, useRef } from 'react'

/** Капля: доля от ширины/высоты, амплитуда и скорость дрейфа, радиус в долях меньшей стороны. */
const SEEDS = [
  { x: 0.24, y: 0.16, ax: 0.1, ay: 0.07, fx: 0.11, fy: 0.08, px: 0.0, py: 1.1, r: 0.17 },
  { x: 0.72, y: 0.27, ax: 0.09, ay: 0.09, fx: 0.08, fy: 0.13, px: 2.2, py: 0.4, r: 0.14 },
  { x: 0.4, y: 0.44, ax: 0.12, ay: 0.06, fx: 0.14, fy: 0.09, px: 4.1, py: 2.7, r: 0.2 },
  { x: 0.83, y: 0.59, ax: 0.08, ay: 0.08, fx: 0.1, fy: 0.12, px: 1.4, py: 3.9, r: 0.15 },
  { x: 0.18, y: 0.68, ax: 0.1, ay: 0.05, fx: 0.12, fy: 0.07, px: 5.3, py: 1.8, r: 0.18 },
  { x: 0.56, y: 0.82, ax: 0.11, ay: 0.07, fx: 0.09, fy: 0.11, px: 3.1, py: 5.2, r: 0.19 },
  { x: 0.88, y: 0.93, ax: 0.07, ay: 0.06, fx: 0.13, fy: 0.1, px: 0.8, py: 2.3, r: 0.15 },
]

/** Уровни поля — «высоты» карты: чем ближе к капле, тем гуще кольца. */
const LEVELS = [0.32, 0.4, 0.5, 0.63, 0.79, 1.0, 1.26, 1.6, 2.05, 2.7, 3.6]
/** Шаг сетки поля в CSS-пикселях: мельче — плавнее контур и дороже кадр. */
const CELL = 14
const FRAME_MS = 40

/** Пары рёбер ячейки для каждой из 16 комбинаций «угол выше уровня». */
const CASES: number[][] = [
  [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [2, 0], [0, 1, 2, 3], [2, 1], [1, 3], [1, 0], [0, 3], [],
]

export function ContourField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let w = 0
    let h = 0
    let cols = 0
    let rows = 0
    let field = new Float32Array(0)
    let raf = 0
    let last = 0
    let stopped = false

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      // Crop a slice of the original map so rings keep their shape in a short input.
      const scale = Math.min(1, width / 720) || 1
      w = width / scale
      h = Math.max(300, height / scale)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, (height - h * scale) * dpr / 2)
      cols = Math.ceil(w / CELL)
      rows = Math.ceil(h / CELL)
      field = new Float32Array((cols + 1) * (rows + 1))
      last = 0
    }

    /** Точка на ребре ячейки: линейная интерполяция между углами. */
    const edge = (e: number, x: number, y: number, v0: number, v1: number, v2: number, v3: number, L: number): [number, number] => {
      const t = (a: number, b: number) => (L - a) / (b - a || 1e-6)
      if (e === 0) return [x + t(v0, v1) * CELL, y]
      if (e === 1) return [x + CELL, y + t(v1, v2) * CELL]
      if (e === 2) return [x + CELL - t(v2, v3) * CELL, y + CELL]
      return [x, y + CELL - t(v3, v0) * CELL]
    }

    const draw = (time: number) => {
      const t = time / 1000
      const u = Math.min(w, h)
      const blobs = SEEDS.map((s) => ({
        x: w * (s.x + s.ax * Math.sin(t * s.fx + s.px)),
        y: h * (s.y + s.ay * Math.cos(t * s.fy + s.py)),
        rr: (u * s.r) ** 2,
      }))

      // поле в узлах сетки: сумма r²/d² по каплям
      for (let j = 0; j <= rows; j++) {
        const py = j * CELL
        for (let i = 0; i <= cols; i++) {
          const px = i * CELL
          let v = 0
          for (const b of blobs) {
            const dx = px - b.x
            const dy = py - b.y
            v += b.rr / (dx * dx + dy * dy + 900)
          }
          field[j * (cols + 1) + i] = v
        }
      }

      const ink = getComputedStyle(canvas).getPropertyValue('--sm-contour').trim()
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = ink
      ctx.lineWidth = 1
      ctx.lineJoin = 'round'
      for (let l = 0; l < LEVELS.length; l++) {
        const L = LEVELS[l]
        ctx.globalAlpha = l === 0 || l === LEVELS.length - 1 ? 0.55 : 1
        ctx.beginPath()
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const a = j * (cols + 1) + i
            const v0 = field[a]
            const v1 = field[a + 1]
            const v2 = field[a + cols + 2]
            const v3 = field[a + cols + 1]
            const idx = (v0 >= L ? 1 : 0) | (v1 >= L ? 2 : 0) | (v2 >= L ? 4 : 0) | (v3 >= L ? 8 : 0)
            const segs = CASES[idx]
            if (!segs.length) continue
            const x = i * CELL
            const y = j * CELL
            for (let s = 0; s < segs.length; s += 2) {
              const p = edge(segs[s], x, y, v0, v1, v2, v3, L)
              const q = edge(segs[s + 1], x, y, v0, v1, v2, v3, L)
              ctx.moveTo(p[0], p[1])
              ctx.lineTo(q[0], q[1])
            }
          }
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    const loop = (time: number) => {
      if (stopped) return
      if (time - last >= FRAME_MS) {
        last = time
        draw(time)
      }
      raf = requestAnimationFrame(loop)
    }

    const start = () => {
      if (raf || stopped) return
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    // свёрнутое приложение не должно крутить анимацию
    const syncMotion = () => {
      if (document.hidden || motion.matches) stop()
      if (!document.hidden) motion.matches ? draw(0) : start()
    }
    const onResize = () => {
      resize()
      syncMotion()
    }

    onResize()
    const observer = new ResizeObserver(onResize)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', syncMotion)
    motion.addEventListener('change', syncMotion)
    return () => {
      stopped = true
      stop()
      document.removeEventListener('visibilitychange', syncMotion)
      motion.removeEventListener('change', syncMotion)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="sm-contours" aria-hidden />
}
