// An isometric stack of slabs springs apart with leader lines and labels:
// what a thing is made of. Optionally clicks back together.
// Adapted from remocn exploded-view (MIT, see LICENSE-remocn.md).
import React from "react"
import { Easing, interpolate, spring } from "remotion"
import { CLAMP, mix, useClock, useStage } from "./common"

export type ExplodedViewProps = {
  /** One label per slab, top slab first; 2–6 slabs. */
  labels: string[]
  /** Small line under each label (same order), optional. */
  notes?: string[]
  /** Index of the slab in the accent colour, from the top; -1 — none. */
  highlight?: number
  /** Width of the block, px at 1080. */
  width?: number
  at?: number
  /** Element frame (from `at`) the slabs close again; omit to stay open. */
  closeAt?: number
  speed?: number
  style?: React.CSSProperties
}

const OPEN = 3
const COS30 = Math.cos(Math.PI / 6)

export function ExplodedView({ labels, notes = [], highlight = 0, width = 940, at = 0, closeAt, speed = 1, style }: ExplodedViewProps) {
  const clock = useClock(at, speed)
  const { u, fps, theme, ink, mute, line, accent, font, display } = useStage()
  const t = (clock * 30) / fps
  const W = width * u
  const n = Math.round(Math.min(6, Math.max(2, labels.length)))
  // Slabs on the left, labels on the right; the block is tall enough for the stack fully open.
  const side = W * 0.32
  const thick = W * 0.035
  const spreadTotal = W * 0.4
  const gap = spreadTotal / (n - 1)
  const H = side * 1.25 + n * thick + spreadTotal
  const cx = side * COS30 + W * 0.02
  const iso = (X: number, Y: number, Z: number) => [(X - Y) * COS30, (X + Y) * 0.5 - Z] as const
  const pts = (list: (readonly [number, number])[]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const CLOSE = closeAt === undefined ? Infinity : (closeAt * 30) / fps
  const close = Number.isFinite(CLOSE) ? spring({ frame: t - CLOSE, fps: 30, config: { damping: 26, stiffness: 320, mass: 0.8 } }) : 0
  // The top slab leaves first; the bottom one barely waits.
  const spread = Array.from({ length: n }, (_, i) => Math.max(0, spring({ frame: t - OPEN - (n - 1 - i) * 1.5, fps: 30, config: { damping: 12, stiffness: 110 } }) * (1 - close)))
  const offsets: number[] = []
  let z = 0
  for (let i = 0; i < n; i++) {
    offsets.push(z)
    z += thick + (i < n - 1 ? gap * Math.max(spread[i + 1], 0) : 0)
  }
  const knock = Number.isFinite(CLOSE) ? interpolate(t, [CLOSE + 5, CLOSE + 7, CLOSE + 12], [0, 1, 0], { ...CLAMP, easing: Easing.out(Easing.quad) }) * H * 0.008 : 0
  const baseY = H * 0.5 - side * 0.1 + z / 2 + knock
  const labelOut = Number.isFinite(CLOSE) ? interpolate(t, [CLOSE - 5, CLOSE], [1, 0], CLAMP) : 1
  const labelX = cx + side * COS30 + W * 0.08
  const fs = W * 0.056
  const slabTop = theme.card, slabLeft = mix(theme.card, "#000", 72), slabRight = mix(theme.card, "#000", 52)
  const hotTop = accent, hotLeft = mix(accent, "#000", 75), hotRight = mix(accent, "#000", 55)

  const slabs: React.ReactNode[] = []
  const leaders: React.ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const fromTop = n - 1 - i
    const hot = fromTop === highlight
    const z0 = offsets[i], z1 = z0 + thick, h = side / 2, inset = h * 0.78
    const mark = hot ? theme.accentForeground : theme.cardForeground
    slabs.push(
      <g key={i}>
        <polygon points={pts([iso(-h, h, z1), iso(h, h, z1), iso(h, h, z0), iso(-h, h, z0)])} fill={hot ? hotLeft : slabLeft} />
        <polygon points={pts([iso(h, -h, z1), iso(h, h, z1), iso(h, h, z0), iso(h, -h, z0)])} fill={hot ? hotRight : slabRight} />
        <polygon points={pts([iso(-h, -h, z1), iso(h, -h, z1), iso(h, h, z1), iso(-h, h, z1)])} fill={hot ? hotTop : slabTop} />
        <polygon points={pts([iso(-inset, -inset, z1), iso(inset, -inset, z1), iso(inset, inset, z1), iso(-inset, inset, z1)])} fill="none" stroke={mark} strokeOpacity={0.18} strokeWidth={W * 0.002} />
        {[-0.4, 0, 0.4].map((q) => {
          const a = iso(-inset * 0.7, q * inset, z1), b = iso(inset * (fromTop % 2 ? 0.2 : 0.7), q * inset, z1)
          return <line key={q} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={mark} strokeOpacity={0.22} strokeWidth={W * 0.006} strokeLinecap="round" />
        })}
      </g>,
    )
    const text = labels[fromTop]
    if (!text) continue
    const anchor = iso(h, -h, (z0 + z1) / 2)
    const draw = interpolate(t, [14 + fromTop * 2.5, 24 + fromTop * 2.5], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) })
    const show = interpolate(t, [19 + fromTop * 2.5, 27 + fromTop * 2.5], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) }) * labelOut
    const ax = cx + anchor[0] + W * 0.012, ay = baseY + anchor[1]
    const length = (labelX - ax) * draw * labelOut
    leaders.push(
      <React.Fragment key={`l${i}`}>
        <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width={W} height={H} aria-hidden>
          <circle cx={ax} cy={ay} r={W * 0.007} fill={hot ? accent : ink} opacity={Math.min(1, draw * 3) * labelOut} />
          <line x1={ax} y1={ay} x2={ax + length} y2={ay} stroke={line} strokeOpacity={0.9} strokeWidth={Math.max(1, W * 0.0025)} />
        </svg>
        <div style={{ position: "absolute", left: labelX + W * 0.02, top: ay, transform: `translate(${(1 - show) * W * 0.03}px, -50%)`, opacity: show, maxWidth: W - labelX - W * 0.02 }}>
          <div style={{ fontFamily: font, fontSize: fs * 0.48, fontWeight: 700, letterSpacing: "0.12em", color: hot ? accent : mute }}>{`0${fromTop + 1}`}</div>
          <div style={{ fontFamily: display, fontSize: fs, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, color: ink }}>{text}</div>
          {notes[fromTop] ? <div style={{ fontFamily: font, fontSize: fs * 0.52, color: mute, marginTop: fs * 0.12, lineHeight: 1.2 }}>{notes[fromTop]}</div> : null}
        </div>
      </React.Fragment>,
    )
  }
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <ellipse cx={cx} cy={baseY + side * 0.5 + side * 0.06} rx={side * COS30 * 1.05} ry={side * 0.16} fill="#000" opacity={0.18} />
        <g transform={`translate(${cx} ${baseY})`}>{slabs}</g>
      </svg>
      {leaders}
    </div>
  )
}
