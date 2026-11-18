// Comparisons: two sides with rows of figures, a seesaw, flows merging into one,
// two circles overlapping. After remocn versus-split, balance-beam, sankey-flow and
// venn-merge (MIT, see LICENSE-remocn.md).
import React from "react"
import { Easing, interpolate, spring } from "remotion"
import { formatNumber } from "./charts"
import { CLAMP, kick, mix, ramp, tint, useClock, useStage } from "./common"

const OUT = Easing.bezier(0.22, 1, 0.36, 1)
const IO = Easing.bezier(0.65, 0, 0.35, 1)
type Base = { at?: number; style?: React.CSSProperties }

// ---------- versus ----------------------------------------------------------------

export type VersusRow = { label: string; left: string; right: string }

/**
 * Two sides split on a diagonal, «как было» grey on top and the winner in the accent
 * below, rows of figures landing one by one.
 */
export function Versus({ leftLabel, rightLabel, rows, versus = "vs", width = 940, at = 0, every = 8, style }: Base & { leftLabel: string; rightLabel: string; rows: VersusRow[]; versus?: string; width?: number; every?: number }) {
  const t = useClock(at)
  const { u, fps, theme, ink, mute, accent, font, display } = useStage()
  const W = width * u
  const split = spring({ frame: t, fps, config: { damping: 18, stiffness: 120 } })
  const side = (title: string, win: boolean, delay: number) => (
    <div style={{ position: "relative", padding: `${40 * u}px ${44 * u}px`, borderRadius: 28 * u, background: win ? accent : tint(ink, 7), color: win ? theme.accentForeground : ink, transform: `translateX(${(1 - Math.min(1, split)) * (win ? 1 : -1) * 120 * u}px) rotate(${win ? 1.2 : -1.2}deg)`, opacity: Math.min(1, split) }}>
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: 60 * u, lineHeight: 1, marginBottom: 24 * u }}>{title}</div>
      {rows.map((r, i) => {
        const p = ramp(t, 10 + delay + i * every, 8)
        return (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 30 * u, padding: `${12 * u}px 0`, borderTop: `${2 * u}px solid ${win ? tint(theme.accentForeground, 25) : tint(ink, 12)}`, opacity: p, transform: `translateY(${(1 - OUT(p)) * 20 * u}px)` }}>
            <span style={{ fontFamily: font, fontWeight: 600, fontSize: 32 * u, opacity: 0.75 }}>{r.label}</span>
            <span style={{ fontFamily: display, fontWeight: 900, fontSize: win ? 52 * u : 44 * u, textDecoration: win ? undefined : "line-through", textDecorationColor: tint(ink, 40), whiteSpace: "nowrap" }}>{win ? r.right : r.left}</span>
          </div>
        )
      })}
    </div>
  )
  const vs = spring({ frame: t - 8, fps, config: { damping: 9, stiffness: 200 } })
  return (
    <div style={{ position: "relative", width: W, display: "flex", flexDirection: "column", gap: 34 * u, ...style }}>
      {side(leftLabel, false, 0)}
      <div style={{ position: "absolute", left: "50%", top: "50%", zIndex: 2, transform: `translate(-50%, -50%) scale(${Math.max(0, vs)}) rotate(-8deg)`, padding: `${10 * u}px ${26 * u}px`, borderRadius: 999, background: ink, color: theme.background, fontFamily: display, fontWeight: 900, fontSize: 44 * u }}>{versus}</div>
      {side(rightLabel, true, rows.length * every * 0.5 + 6)}
    </div>
  )
}

// ---------- balance ---------------------------------------------------------------

/**
 * A seesaw: a pile of light things on one side, one heavy thing on the other.
 * The pile drops first, then the heavy one lands and the beam tips its way.
 */
export function BalanceBeam({ light, heavy, caption, width = 940, at = 0, style }: Base & { light: string[]; heavy: string; caption?: string; width?: number }) {
  const t = useClock(at)
  const { u, fps, theme, ink, mute, line, accent, font, display } = useStage()
  const W = width * u
  const beamW = W * 0.92, H = W * 0.95
  const pivotY = H * 0.72
  const pileDone = 6 + light.length * 5
  const heavyAt = pileDone + 8
  const tipToPile = interpolate(t, [6, pileDone], [0, -1], { ...CLAMP, easing: IO })
  const tip = spring({ frame: t - heavyAt - 4, fps, config: { damping: 9, stiffness: 90, mass: 1.2 } })
  const angle = (tipToPile * (1 - Math.min(1, Math.max(0, tip))) + tip) * 9 // + = heavy side (right) down
  const heavyDrop = Math.min(1, spring({ frame: t - heavyAt, fps, config: { damping: 14, stiffness: 220 } }))
  const chip = (text: string, hot: boolean, size: number): React.CSSProperties => ({ padding: `${10 * u}px ${18 * u}px`, borderRadius: 14 * u, background: hot ? accent : theme.card, color: hot ? theme.accentForeground : theme.cardForeground, fontFamily: hot ? display : font, fontWeight: hot ? 900 : 600, fontSize: size, whiteSpace: "nowrap", boxShadow: `0 ${6 * u}px ${18 * u}px rgba(0,0,0,0.15)` })
  return (
    <div style={{ position: "relative", width: W, height: H + (caption ? 90 * u : 0), ...style }}>
      <div style={{ position: "absolute", left: W / 2, top: pivotY, transform: `rotate(${angle}deg)`, transformOrigin: "0 0" }}>
        <div style={{ position: "absolute", left: -beamW / 2, top: -6 * u, width: beamW, height: 18 * u, borderRadius: 9 * u, background: ink }} />
        <div style={{ position: "absolute", left: -beamW / 2 + 10 * u, bottom: 12 * u, width: beamW * 0.42, display: "flex", flexWrap: "wrap-reverse", justifyContent: "center", gap: 10 * u, transform: `rotate(${-angle}deg)`, transformOrigin: "50% 100%" }}>
          {light.map((x, i) => {
            const d = Math.min(1, spring({ frame: t - 6 - i * 5, fps, config: { damping: 13, stiffness: 200 } }))
            return <div key={i} style={{ ...chip(x, false, 36 * u), opacity: d, transform: `translateY(${(1 - d) * -260 * u}px) rotate(${(i % 2 ? 1 : -1) * 3}deg)` }}>{x}</div>
          })}
        </div>
        <div style={{ position: "absolute", left: beamW * 0.08, bottom: 12 * u, width: beamW * 0.38, display: "flex", justifyContent: "center", transform: `rotate(${-angle}deg)`, transformOrigin: "50% 100%" }}>
          <div style={{ ...chip(heavy, true, 58 * u), padding: `${26 * u}px ${30 * u}px`, opacity: heavyDrop, transform: `translateY(${(1 - heavyDrop) * -360 * u}px) scale(${1 + 0.06 * kick(t - heavyAt - 3, 6)})` }}>{heavy}</div>
        </div>
      </div>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <polygon points={`${W / 2},${pivotY + 8 * u} ${W / 2 - 60 * u},${pivotY + 120 * u} ${W / 2 + 60 * u},${pivotY + 120 * u}`} fill={tint(ink, 70)} />
        <line x1={W * 0.1} x2={W * 0.9} y1={pivotY + 122 * u} y2={pivotY + 122 * u} stroke={line} strokeWidth={4 * u} />
      </svg>
      {caption ? <div style={{ position: "absolute", left: 0, right: 0, top: H, textAlign: "center", fontFamily: font, fontWeight: 600, fontSize: 40 * u, color: mute, opacity: ramp(t, heavyAt + 20, 10) }}>{caption}</div> : null}
    </div>
  )
}

// ---------- flows -----------------------------------------------------------------

/** Flows from several sources pour into one block, whose total counts up. */
export function Flows({ sources, target, unit = "", width = 940, height = 820, at = 0, style }: Base & { sources: { label: string; value: number }[]; target: string; unit?: string; width?: number; height?: number }) {
  const t = useClock(at)
  const { u, theme, ink, mute, accent, font, display } = useStage()
  const W = width * u, H = height * u
  const total = sources.reduce((s, x) => s + x.value, 0) || 1
  const left = W * 0.34, right = W * 0.62
  const gap = 26 * u
  const usable = H - gap * (sources.length - 1)
  const tH = H * 0.62, tTop = (H - tH) / 2
  let y = 0, ty = tTop
  const flows = sources.map((s, i) => {
    const h = (s.value / total) * usable
    const th = (s.value / total) * tH
    const f = { ...s, i, y, h, ty, th }
    y += h + gap
    ty += th
    return f
  })
  const filled = interpolate(t, [10, 10 + sources.length * 6 + 20], [0, 1], { ...CLAMP, easing: IO })
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        {flows.map((f) => {
          const p = interpolate(t, [10 + f.i * 6, 34 + f.i * 6], [0, 1], { ...CLAMP, easing: IO })
          const xEnd = left + (right - left) * p
          const mid = (left + right) / 2
          const yTop = (k: number) => f.y + (f.ty - f.y) * IO(Math.min(1, k))
          const d = `M ${left} ${f.y} C ${mid} ${f.y}, ${mid} ${f.ty}, ${right} ${f.ty} L ${right} ${f.ty + f.th} C ${mid} ${f.ty + f.th}, ${mid} ${f.y + f.h}, ${left} ${f.y + f.h} Z`
          return <g key={f.i}><clipPath id={`flow${f.i}`}><rect x={0} y={-H} width={xEnd} height={H * 3} /></clipPath><path d={d} fill={f.i === 0 ? tint(accent, 55) : tint(ink, 14 + f.i * 6)} clipPath={`url(#flow${f.i})`} />{void yTop}</g>
        })}
      </svg>
      {flows.map((f) => (
        <div key={f.i} style={{ position: "absolute", left: 0, width: left - 14 * u, top: f.y, height: Math.max(f.h, 60 * u), display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-end", textAlign: "right", opacity: ramp(t, 4 + f.i * 6, 8) }}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 40 * u, color: f.i === 0 ? accent : ink, lineHeight: 1 }}>{formatNumber(f.value)}{unit}</div>
          <div style={{ fontFamily: font, fontWeight: 600, fontSize: 28 * u, color: mute }}>{f.label}</div>
        </div>
      ))}
      <div style={{ position: "absolute", left: right, top: tTop, width: W - right, height: tH, borderRadius: `0 ${24 * u}px ${24 * u}px 0`, background: accent, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: theme.accentForeground, opacity: ramp(t, 8, 8) }}>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: 64 * u, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{formatNumber(Math.round(total * filled))}{unit}</div>
        <div style={{ fontFamily: font, fontWeight: 700, fontSize: 32 * u, marginTop: 10 * u, textAlign: "center", padding: `0 ${10 * u}px` }}>{target}</div>
      </div>
    </div>
  )
}

// ---------- venn ------------------------------------------------------------------

/** Two circles slide together; where they overlap, the lens fills with the accent and the result. */
export function Venn({ sets, center, caption, size = 900, at = 0, style }: Base & { sets: [string, string]; center: string; caption?: string; size?: number }) {
  const t = useClock(at)
  const { u, fps, theme, ink, mute, accent, font, display } = useStage()
  const W = size * u
  const r = W * 0.3
  const slide = spring({ frame: t - 6, fps, config: { damping: 16, stiffness: 90 } })
  const off = interpolate(Math.min(1, slide), [0, 1], [r * 1.25, r * 0.55])
  const cx1 = W / 2 - off, cx2 = W / 2 + off, cy = r * 1.15
  const fill = ramp(t, 30, 10)
  const clip = `venn${Math.round(W)}`
  const setFs = (text: string) => Math.min(44 * u, (r * 0.85) / Math.max(1, text.length * 0.56))
  return (
    <div style={{ position: "relative", width: W, height: cy * 2 + (caption ? 100 * u : 0), ...style }}>
      <svg width={W} height={cy * 2} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <defs><clipPath id={clip}><circle cx={cx1} cy={cy} r={r} /></clipPath></defs>
        <circle cx={cx1} cy={cy} r={r} fill={tint(ink, 6)} stroke={tint(ink, 50)} strokeWidth={5 * u} />
        <circle cx={cx2} cy={cy} r={r} fill={tint(ink, 6)} stroke={tint(ink, 50)} strokeWidth={5 * u} />
        <circle cx={cx2} cy={cy} r={r} fill={accent} clipPath={`url(#${clip})`} opacity={fill} />
      </svg>
      <div style={{ position: "absolute", left: cx1 - r * 0.62, top: cy, transform: "translate(-50%, -50%)", fontFamily: display, fontWeight: 800, fontSize: setFs(sets[0]), color: ink, textAlign: "center", maxWidth: r * 0.9, lineHeight: 1.1, opacity: ramp(t, 2, 8) }}>{sets[0]}</div>
      <div style={{ position: "absolute", left: cx2 + r * 0.62, top: cy, transform: "translate(-50%, -50%)", fontFamily: display, fontWeight: 800, fontSize: setFs(sets[1]), color: ink, textAlign: "center", maxWidth: r * 0.9, lineHeight: 1.1, opacity: ramp(t, 2, 8) }}>{sets[1]}</div>
      <div style={{ position: "absolute", left: W / 2, top: cy, transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * OUT(fill)})`, fontFamily: display, fontWeight: 900, fontSize: 46 * u, color: theme.accentForeground, textAlign: "center", maxWidth: r * 0.85, lineHeight: 1.05, opacity: fill }}>{center}</div>
      {caption ? <div style={{ position: "absolute", left: 0, right: 0, top: cy * 2 + 30 * u, textAlign: "center", fontFamily: font, fontWeight: 600, fontSize: 40 * u, color: mute, opacity: ramp(t, 40, 10) }}>{caption}</div> : null}
    </div>
  )
}
