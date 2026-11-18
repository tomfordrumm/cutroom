// A donut of shares: the ring draws slice by slice, then the highlighted share
// detaches, the rest dims and its figure lands in the centre.
// Adapted from remocn share-donut (MIT, see LICENSE-remocn.md).
import React, { useId } from "react"
import { Easing, interpolate, spring } from "remotion"
import { CLAMP, mix, tint, useClock, useStage } from "./common"

export type DonutSegment = { label: string; value: number }

export type ShareDonutProps = {
  /** Up to six slices, clockwise from 12 o'clock; values are shares of their sum. */
  segments: DonutSegment[]
  /** Index of the slice that detaches and lands in the centre. */
  highlight?: number
  /** Unit after the centre figure and the slice labels. */
  unit?: string
  /** Side of the square block, px at 1080. */
  size?: number
  /** Element frame the ring starts drawing. */
  at?: number
  /** Frames for the ring to draw round. */
  drawLength?: number
  speed?: number
  style?: React.CSSProperties
}

const EASE_IO = Easing.bezier(0.65, 0, 0.35, 1)
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1)
const EASE_SEG = Easing.bezier(0.55, 0, 0.25, 1)
const TAU = Math.PI * 2
const DRAW_START = 6
const GREYS = [72, 52, 36, 24, 16]

const pt = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) })
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const s = pt(cx, cy, r, a0), e = pt(cx, cy, r, a1)
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

export function ShareDonut({ segments, highlight = 0, unit = "%", size = 900, at = 0, drawLength = 52, speed = 1, style }: ShareDonutProps) {
  const t = useClock(at, speed)
  const { u, fps, ink, mute, line, accent, font, display } = useStage()
  const accentEnd = mix(accent, ink, 78)
  const id = `d${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const box = size * u
  const k = box / 800 // remocn drew this at 720p, inside ~800 px
  const cx = box / 2, cy = box / 2
  const R = 216 * k
  const sw = 12 * k
  const list = (segments ?? []).slice(0, 6)
  const hl = Math.min(Math.max(0, Math.round(highlight)), Math.max(0, list.length - 1))
  const total = list.reduce((s, x) => s + Math.max(0, x.value), 0) || 1
  const gapA = (6 * k) / R

  let acc = 0, grey = 0, clock = DRAW_START
  const segs = list.map((s, i) => {
    const frac = Math.max(0, s.value) / total
    const a0 = acc * TAU
    acc += frac
    const a1 = acc * TAU
    const dur = Math.max(9, drawLength * frac)
    const start = clock
    clock += dur - 2
    return { ...s, i, a0: a0 + gapA / 2, a1: a1 - gapA / 2, mid: (a0 + a1) / 2, start, end: start + dur, color: i === hl ? accent : tint(ink, GREYS[Math.min(grey++, GREYS.length - 1)]), pct: Math.round(frac * 100) }
  })
  const HIT = (segs.length ? segs[segs.length - 1].end : DRAW_START) + 8

  const detach = spring({ frame: t - HIT, fps, config: { damping: 15, stiffness: 150, mass: 0.7 } })
  const dim = interpolate(t, [HIT, HIT + 16], [0, 1], { ...CLAMP, easing: EASE_IO })
  const land = interpolate(t, [HIT + 4, HIT + 24], [0, 1], { ...CLAMP, easing: EASE_OUT })
  const count = interpolate(t, [HIT + 4, HIT + 30], [0.55, 1], { ...CLAMP, easing: EASE_OUT })
  const labIn = interpolate(t, [HIT + 12, HIT + 30], [0, 1], { ...CLAMP, easing: EASE_OUT })
  const stage = interpolate(t, [0, 10], [0.4, 1], CLAMP)
  const spin = interpolate(t, [0, HIT + 10], [-14, 0], { ...CLAMP, easing: EASE_IO })
  const push = interpolate(t, [0, HIT + 60], [0, 1], { ...CLAMP, easing: EASE_IO })

  const target = segs[hl]
  const g0 = target ? pt(cx, cy, R, target.a0) : { x: cx, y: cy - R }
  const g1 = target ? pt(cx, cy, R, target.a1) : { x: cx + R, y: cy }
  const off = detach * 18 * k
  const hx = target ? Math.sin(target.mid) * off : 0
  const hy = target ? -Math.cos(target.mid) * off : 0

  return (
    <div style={{ position: "relative", width: box, height: box, transform: `scale(${0.97 + 0.04 * push})`, ...style }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, transparent ${R * 0.62}px, ${tint(accent, 12)} ${R * 1.02}px, ${tint(accent, 6)} ${R * 1.3}px, transparent ${R * 1.85}px)`, opacity: 0.25 + 0.75 * land }} />
      <svg width={box} height={box} style={{ position: "absolute", inset: 0, opacity: stage, overflow: "visible" }} aria-hidden>
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={g0.x} y1={g0.y} x2={g1.x} y2={g1.y}>
            <stop offset="0" stopColor={accent} />
            <stop offset="1" stopColor={accentEnd} />
          </linearGradient>
        </defs>
        <g transform={`rotate(${spin} ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={R} fill="none" stroke={tint(ink, 6)} strokeWidth={sw} opacity={1 - dim} />
          {segs.map((s) => {
            const p = interpolate(t, [s.start, s.end], [0, 1], { ...CLAMP, easing: EASE_SEG })
            if (p <= 0 || s.a1 <= s.a0) return null
            const isHl = s.i === hl
            return <path key={s.i} d={arc(cx, cy, R, s.a0, s.a0 + (s.a1 - s.a0) * p)} fill="none" stroke={isHl ? `url(#${id})` : s.color} strokeLinecap={isHl ? "round" : "butt"} strokeWidth={isHl ? sw * (1 + 0.5 * detach) : sw} opacity={isHl ? 1 : 1 - 0.5 * dim} transform={isHl ? `translate(${hx} ${hy})` : undefined} />
          })}
          {segs.map((s) => {
            const a = interpolate(t, [s.end - 6, s.end + 8], [0, 1], { ...CLAMP, easing: EASE_OUT })
            const p0 = pt(cx, cy, R + sw / 2 + 8 * k, s.mid), p1 = pt(cx, cy, R + sw / 2 + 8 * k + 14 * k * a, s.mid)
            return <line key={s.i} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={line} strokeWidth={Math.max(1, k * 1.5)} opacity={a * (s.i === hl ? 1 - dim : 1 - 0.55 * dim)} />
          })}
        </g>
      </svg>
      {segs.map((s) => {
        const a = interpolate(t, [s.end - 4, s.end + 12], [0, 1], { ...CLAMP, easing: EASE_OUT })
        const ang = s.mid + (spin * Math.PI) / 180
        const q = pt(cx, cy, R + sw / 2 + 30 * k + (1 - a) * -8 * k, ang)
        const right = Math.sin(ang) >= -0.05
        return (
          <div key={s.i} style={{ position: "absolute", left: q.x, top: q.y, transform: `translate(${right ? 0 : -100}%, -50%)`, display: "flex", flexDirection: "column", alignItems: right ? "flex-start" : "flex-end", gap: 2 * k, opacity: a * (s.i === hl ? 1 - dim : 1 - 0.3 * dim) * stage, whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: font, fontWeight: 700, fontSize: 40 * k, color: ink, fontVariantNumeric: "tabular-nums" }}>{s.pct}{unit}</span>
            <span style={{ fontFamily: font, fontWeight: 500, fontSize: 30 * k, color: mute }}>{s.label}</span>
          </div>
        )
      })}
      {target ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: display, fontWeight: 600, fontSize: 150 * k, lineHeight: 0.9, letterSpacing: "-0.035em", color: ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", opacity: land, filter: land < 0.99 ? `blur(${(1 - land) * 8 * k}px)` : undefined, transform: `translateY(${(1 - land) * 22 * k}px) scale(${1.05 - 0.05 * land})`, marginTop: 10 * k }}>
            {Math.round(target.pct * count)}
            <span style={{ fontSize: 76 * k, marginLeft: 4 * k, color: mute }}>{unit}</span>
          </div>
          <div style={{ marginTop: 14 * k, display: "flex", alignItems: "center", gap: 10 * k, opacity: labIn, transform: `translateY(${(1 - labIn) * 8 * k}px)` }}>
            <span style={{ width: 12 * k, height: 12 * k, borderRadius: "50%", background: accent }} />
            <span style={{ fontFamily: font, fontWeight: 600, fontSize: 34 * k, color: mute, whiteSpace: "nowrap" }}>{target.label}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
