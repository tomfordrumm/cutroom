// Charts and numbers that draw themselves: rings, bars, a line, a slope, a dot
// grid, a fraction, a stacked bar, a waterfall, a radar, tally marks, a row of stats.
// After remocn activity-rings, animated-bar-chart, animated-line-chart, slope-chart,
// unit-grid, fraction-split, time-breakdown, waterfall-chart, radar-compare,
// tally-marks and stat-sequence (MIT, see LICENSE-remocn.md).
import React, { useId } from "react"
import { Easing, interpolate, spring } from "remotion"
import { BrushGrain, brushFilterId, brushRibbon, sampleLine } from "./brush"
import { CLAMP, kick, mix, ramp, tint, useClock, useStage } from "./common"
import { hashRange, steppedRamp } from "./stop-motion"

const OUT = Easing.bezier(0.22, 1, 0.36, 1)
const IO = Easing.bezier(0.65, 0, 0.35, 1)

/** A number counting from 0 to `value` between frames, formatted the Russian way. */
export function formatNumber(value: number, decimals = 0) {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/ /g, " ")
}
const count = (t: number, value: number, start: number, len: number, decimals = 0) => formatNumber(value * interpolate(t, [start, start + len], [0, 1], { ...CLAMP, easing: OUT }), decimals)

type Base = { at?: number; style?: React.CSSProperties }
const label = (font: string, size: number, color: string, extra: React.CSSProperties = {}): React.CSSProperties => ({ fontFamily: font, fontSize: size, color, lineHeight: 1.15, ...extra })

// ---------- rings -----------------------------------------------------------------

export type Ring = { label: string; value: number; goal: number; unit?: string }

/** Concentric goal rings close one after another (past the goal they lap); the figures count up below. */
export function ActivityRings({ rings, size = 640, at = 0, style }: Base & { rings: Ring[]; size?: number }) {
  const t = useClock(at)
  const { u, ink, mute, accent, accent2, font, display } = useStage()
  const S = size * u
  const list = rings.slice(0, 3)
  const colors = [accent, accent2, mix(accent, ink, 55)]
  const sw = S * 0.085
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 48 * u, ...style }}>
      <svg width={S} height={S} style={{ overflow: "visible" }} aria-hidden>
        {list.map((r, i) => {
          const R = S / 2 - sw / 2 - i * sw * 1.18
          const C = 2 * Math.PI * R
          const p = interpolate(t, [6 + i * 6, 46 + i * 6], [0, Math.max(0, r.value / r.goal)], { ...CLAMP, easing: IO })
          return (
            <g key={i} transform={`rotate(-90 ${S / 2} ${S / 2})`}>
              <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={tint(colors[i], 18)} strokeWidth={sw} />
              <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={colors[i]} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${Math.min(p, 1) * C} ${C}`} />
              {p > 1 ? <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={mix(colors[i], "#000", 82)} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(p - 1) * C} ${C}`} /> : null}
            </g>
          )
        })}
      </svg>
      <div style={{ display: "flex", gap: 44 * u }}>
        {list.map((r, i) => (
          <div key={i} style={{ opacity: ramp(t, 20 + i * 6, 10) }}>
            <div style={label(display, 64 * u, colors[i], { fontWeight: 800, fontVariantNumeric: "tabular-nums" })}>{count(t, r.value, 10 + i * 6, 40, Number.isInteger(r.value) ? 0 : 1)}<span style={{ fontSize: 32 * u, color: mute }}> /{formatNumber(r.goal, Number.isInteger(r.goal) ? 0 : 1)}{r.unit ? ` ${r.unit}` : ""}</span></div>
            <div style={label(font, 32 * u, ink, { fontWeight: 600, marginTop: 6 * u })}>{r.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- bars ------------------------------------------------------------------

export type Bar = { label: string; value: number }

/** Bars spring up from the baseline in a cascade; the highlighted one in the accent, values on top. */
export function BarChart({ bars, highlight = -1, unit = "", width = 900, height = 720, at = 0, style }: Base & { bars: Bar[]; highlight?: number; unit?: string; width?: number; height?: number }) {
  const t = useClock(at)
  const { u, fps, ink, mute, line, accent, font, display } = useStage()
  const W = width * u, H = height * u
  const max = Math.max(...bars.map((b) => b.value), 1)
  const gap = W * 0.06 / Math.max(1, bars.length - 1) + W * 0.02
  const bw = (W - gap * (bars.length - 1)) / bars.length
  const plotH = H - 150 * u
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: plotH + 60 * u, height: 3 * u, background: line }} />
      {bars.map((b, i) => {
        const s = spring({ frame: t - 4 - i * 4, fps, config: { damping: 14, stiffness: 120 } })
        const h = (b.value / max) * plotH * Math.max(0, s)
        const hot = i === highlight
        return (
          <div key={i} style={{ position: "absolute", left: i * (bw + gap), width: bw, top: 60 * u, height: plotH + 90 * u }}>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 90 * u, height: h, borderRadius: `${14 * u}px ${14 * u}px 0 0`, background: hot ? accent : tint(ink, 22) }} />
            <div style={{ position: "absolute", left: -20 * u, right: -20 * u, bottom: 90 * u + h + 10 * u, textAlign: "center", ...label(display, 40 * u, hot ? accent : ink, { fontWeight: 800, opacity: ramp(t, 10 + i * 4, 8) }) }}>{formatNumber(Math.round(b.value * Math.min(1, Math.max(0, s))))}{unit}</div>
            <div style={{ position: "absolute", left: -20 * u, right: -20 * u, bottom: 0, height: 80 * u, textAlign: "center", ...label(font, 30 * u, hot ? ink : mute, { fontWeight: 600 }) }}>{b.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- line ------------------------------------------------------------------

/** A line draws left to right with a leading dot; the last value lands in a bubble. */
export function LineChart({ values, labels = [], unit = "", width = 900, height = 640, at = 0, draw = 40, style }: Base & { values: number[]; labels?: string[]; unit?: string; width?: number; height?: number; draw?: number }) {
  const t = useClock(at)
  const { u, theme, mute, line, accent, font, display } = useStage()
  const id = `l${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const W = width * u, H = height * u
  const padB = labels.length ? 70 * u : 20 * u, padT = 110 * u
  const lo = Math.min(...values), hi = Math.max(...values)
  const pts = values.map((v, i) => ({ x: (i / Math.max(1, values.length - 1)) * (W - 40 * u) + 20 * u, y: padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB) }))
  const p = interpolate(t, [4, 4 + draw], [0, 1], { ...CLAMP, easing: IO })
  const segs = pts.length - 1
  const at01 = p * segs, k = Math.min(segs - 1, Math.floor(at01)), f = at01 - k
  const head = segs > 0 ? { x: pts[k].x + (pts[k + 1].x - pts[k].x) * f, y: pts[k].y + (pts[k + 1].y - pts[k].y) * f } : pts[0]
  const drawn = [...pts.slice(0, k + 1), head]
  const d = drawn.map((q, i) => `${i ? "L" : "M"} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ")
  const area = `${d} L ${head.x} ${H - padB} L ${pts[0].x} ${H - padB} Z`
  const done = ramp(t, 4 + draw, 10)
  const last = pts[pts.length - 1]
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={accent} stopOpacity={0.28} /><stop offset="1" stopColor={accent} stopOpacity={0} /></linearGradient></defs>
        {[0, 0.5, 1].map((g) => <line key={g} x1={0} x2={W} y1={padT + g * (H - padT - padB)} y2={padT + g * (H - padT - padB)} stroke={line} strokeWidth={2 * u} strokeDasharray={`${6 * u} ${8 * u}`} />)}
        <path d={area} fill={`url(#${id})`} />
        <path d={d} fill="none" stroke={accent} strokeWidth={9 * u} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={head.x} cy={head.y} r={14 * u} fill={accent} stroke={tint(accent, 30)} strokeWidth={14 * u} />
      </svg>
      {labels.map((l, i) => <div key={i} style={{ position: "absolute", top: H - padB + 18 * u, left: pts[i]?.x ?? 0, transform: "translateX(-50%)", whiteSpace: "nowrap", ...label(font, 28 * u, mute, { fontWeight: 600 }) }}>{l}</div>)}
      <div style={{ position: "absolute", left: last.x, top: last.y - 36 * u, transform: `translate(-90%, -100%) scale(${0.7 + 0.3 * done})`, transformOrigin: "90% 100%", opacity: done, padding: `${10 * u}px ${22 * u}px`, borderRadius: 16 * u, background: accent, whiteSpace: "nowrap", ...label(display, 46 * u, theme.accentForeground, { fontWeight: 800 }) }}>
        {formatNumber(values[values.length - 1])}{unit}
      </div>
    </div>
  )
}

// ---------- slope -----------------------------------------------------------------

export type SlopeLine = { label: string; before: number; after: number }

/** Before and after on two posts: lines draw across, the highlighted one climbs in the accent. */
export function SlopeChart({ lines, highlight = 0, beforeLabel = "Было", afterLabel = "Стало", unit = "", width = 900, height = 760, at = 0, style }: Base & { lines: SlopeLine[]; highlight?: number; beforeLabel?: string; afterLabel?: string; unit?: string; width?: number; height?: number }) {
  const t = useClock(at)
  const { u, ink, mute, line, accent, font, display } = useStage()
  const W = width * u, H = height * u
  const padT = 110 * u, padB = 40 * u, x0 = W * 0.26, x1 = W * 0.74
  const all = lines.flatMap((l) => [l.before, l.after])
  const lo = Math.min(...all), hi = Math.max(...all)
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB)
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        {[x0, x1].map((x) => <line key={x} x1={x} x2={x} y1={padT - 20 * u} y2={H - padB + 10 * u} stroke={line} strokeWidth={3 * u} />)}
        {lines.map((l, i) => {
          const hot = i === highlight
          const p = interpolate(t, [10 + i * 3 + (hot ? 10 : 0), 34 + i * 3 + (hot ? 10 : 0)], [0, 1], { ...CLAMP, easing: IO })
          const xa = x0, ya = y(l.before), xb = x0 + (x1 - x0) * p, yb = ya + (y(l.after) - ya) * p
          return <g key={i}><line x1={xa} y1={ya} x2={xb} y2={yb} stroke={hot ? accent : tint(ink, 30)} strokeWidth={(hot ? 10 : 5) * u} strokeLinecap="round" /><circle cx={xa} cy={ya} r={(hot ? 12 : 8) * u} fill={hot ? accent : tint(ink, 45)} />{p > 0.98 ? <circle cx={xb} cy={yb} r={(hot ? 12 : 8) * u} fill={hot ? accent : tint(ink, 45)} /> : null}</g>
        })}
      </svg>
      {[[x0, beforeLabel], [x1, afterLabel]].map(([x, l]) => <div key={String(l)} style={{ position: "absolute", left: x as number, top: 0, transform: "translateX(-50%)", ...label(font, 30 * u, mute, { fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }) }}>{l}</div>)}
      {lines.map((l, i) => {
        const hot = i === highlight
        const show = ramp(t, 36 + i * 3 + (hot ? 10 : 0), 10)
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", right: W - x0 + 22 * u, top: y(l.before), transform: "translateY(-50%)", textAlign: "right", opacity: ramp(t, 6 + i * 3, 8), ...label(font, (hot ? 40 : 34) * u, hot ? ink : mute, { fontWeight: hot ? 700 : 500, whiteSpace: "nowrap" }) }}>{l.label} <b style={{ fontFamily: display }}>{formatNumber(l.before)}{unit}</b></div>
            <div style={{ position: "absolute", left: x1 + 22 * u, top: y(l.after), transform: "translateY(-50%)", opacity: show, ...label(display, (hot ? 60 : 40) * u, hot ? accent : mute, { fontWeight: 800, whiteSpace: "nowrap" }) }}>{formatNumber(l.after)}{unit}</div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ---------- unit grid -------------------------------------------------------------

/** A grid of dots lights up `highlighted` of `total` one by one, next to «N из M». */
export function UnitGrid({ total = 100, highlighted, columns = 10, caption, width = 760, at = 0, style }: Base & { total?: number; highlighted: number; columns?: number; caption?: string; width?: number }) {
  const t = useClock(at)
  const { u, ink, mute, accent, font, display } = useStage()
  const W = width * u
  const cell = W / columns
  const rows = Math.ceil(total / columns)
  const lightFrames = 34
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44 * u, ...style }}>
      <div style={{ ...label(display, 120 * u, accent, { fontWeight: 900, fontVariantNumeric: "tabular-nums" }) }}>{count(t, highlighted, 6, lightFrames)}<span style={{ fontSize: 56 * u, color: mute }}> из {formatNumber(total)}</span></div>
      <div style={{ position: "relative", width: W, height: rows * cell }}>
        {Array.from({ length: total }, (_, i) => {
          const on = i < highlighted && t >= 6 + (i / Math.max(1, highlighted)) * lightFrames
          const hit = on ? kick(t - 6 - (i / Math.max(1, highlighted)) * lightFrames, 5) : 0
          return <div key={i} style={{ position: "absolute", left: (i % columns) * cell + cell * 0.15, top: Math.floor(i / columns) * cell + cell * 0.15, width: cell * 0.7, height: cell * 0.7, borderRadius: cell, background: on ? accent : tint(ink, 14), transform: `scale(${(0.6 + 0.4 * ramp(t, (i % columns) * 0.6 + Math.floor(i / columns) * 0.6, 6)) * (1 + 0.25 * hit)})` }} />
        })}
      </div>
      {caption ? <div style={{ ...label(font, 40 * u, ink, { fontWeight: 600, textAlign: "center", opacity: ramp(t, 6 + lightFrames, 10) }) }}>{caption}</div> : null}
    </div>
  )
}

// ---------- fraction --------------------------------------------------------------

/** A row of cells with `filled` of `parts` in the accent, under a big fraction or headline. */
export function Fraction({ parts = 8, filled = 1, headline, caption, width = 900, at = 0, style }: Base & { parts?: number; filled?: number; headline?: string; caption?: string; width?: number }) {
  const t = useClock(at)
  const { u, fps, ink, mute, accent, font, display } = useStage()
  const W = width * u
  const gap = 14 * u
  const cw = (W - gap * (parts - 1)) / parts
  const ch = Math.min(cw * 1.6, 260 * u)
  return (
    <div style={{ width: W, display: "flex", flexDirection: "column", alignItems: "center", gap: 44 * u, ...style }}>
      <div style={{ ...label(display, 130 * u, ink, { fontWeight: 900, opacity: ramp(t, 0, 8) }) }}>{headline ?? `${filled}/${parts}`}</div>
      <div style={{ display: "flex", gap }}>
        {Array.from({ length: parts }, (_, i) => {
          const s = spring({ frame: t - 6 - i * 2, fps, config: { damping: 14, stiffness: 160 } })
          const fill = i < filled ? spring({ frame: t - 6 - parts * 2 - 6 - i * 3, fps, config: { damping: 12, stiffness: 170 } }) : 0
          return <div key={i} style={{ position: "relative", width: cw, height: ch, borderRadius: 16 * u, border: `${4 * u}px solid ${i < filled ? accent : tint(ink, 25)}`, overflow: "hidden", transform: `scale(${0.7 + 0.3 * Math.min(1, s)})`, opacity: Math.min(1, s) }}><div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${Math.min(1, Math.max(0, fill)) * 100}%`, background: accent }} /></div>
        })}
      </div>
      {caption ? <div style={{ ...label(font, 40 * u, mute, { fontWeight: 600, textAlign: "center", opacity: ramp(t, 6 + parts * 5 + 10, 10) }) }}>{caption}</div> : null}
    </div>
  )
}

// ---------- stacked bar -----------------------------------------------------------

/** One bar split into parts that grow in turn (a day, a budget, a plate), labels below each. */
export function StackedBar({ segments, highlight = -1, unit = "", total, width = 900, at = 0, style }: Base & { segments: Bar[]; highlight?: number; unit?: string; total?: string; width?: number }) {
  const t = useClock(at)
  const { u, ink, mute, accent, font, display } = useStage()
  const W = width * u
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1
  const H = 120 * u
  let acc = 0
  const greys = [52, 36, 24, 16, 10]
  let g = 0
  return (
    <div style={{ width: W, ...style }}>
      {total ? <div style={{ ...label(display, 72 * u, ink, { fontWeight: 900, marginBottom: 30 * u, opacity: ramp(t, 0, 8) }) }}>{total}</div> : null}
      <div style={{ position: "relative", width: W, height: H, borderRadius: 22 * u, overflow: "hidden", background: tint(ink, 6) }}>
        {segments.map((s, i) => {
          const left = (acc / sum) * W
          acc += s.value
          const w = (s.value / sum) * W
          const p = interpolate(t, [6 + i * 8, 20 + i * 8], [0, 1], { ...CLAMP, easing: OUT })
          const hot = i === highlight
          return <div key={i} style={{ position: "absolute", left, top: 0, bottom: 0, width: Math.max(0, w * p - 4 * u), background: hot ? accent : tint(ink, greys[Math.min(g++, greys.length - 1)]) }} />
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${18 * u}px ${36 * u}px`, marginTop: 30 * u }}>
        {segments.map((s, i) => (
          <div key={i} style={{ opacity: ramp(t, 12 + i * 8, 8) }}>
            <div style={{ ...label(display, 46 * u, i === highlight ? accent : ink, { fontWeight: 800 }) }}>{formatNumber(s.value)}{unit}</div>
            <div style={{ ...label(font, 30 * u, mute, { fontWeight: 600 }) }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- waterfall -------------------------------------------------------------

/** From a start through gains and losses to a total: each step hangs from the running sum. */
export function Waterfall({ start, steps, totalLabel = "Итого", unit = "", width = 940, height = 760, at = 0, style }: Base & { start: Bar; steps: Bar[]; totalLabel?: string; unit?: string; width?: number; height?: number }) {
  const t = useClock(at)
  const { u, fps, ink, mute, line, accent, font, display } = useStage()
  const W = width * u, H = height * u
  const bars: { label: string; from: number; to: number; kind: "start" | "up" | "down" | "total" }[] = [{ label: start.label, from: 0, to: start.value, kind: "start" }]
  let run = start.value
  for (const s of steps) { bars.push({ label: s.label, from: run, to: run + s.value, kind: s.value >= 0 ? "up" : "down" }); run += s.value }
  bars.push({ label: totalLabel, from: 0, to: run, kind: "total" })
  const max = Math.max(...bars.map((b) => Math.max(b.from, b.to)), 1)
  const plotT = 70 * u, plotB = H - 90 * u
  const yv = (v: number) => plotB - (v / max) * (plotB - plotT)
  const gap = 16 * u, bw = (W - gap * (bars.length - 1)) / bars.length
  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: plotB, height: 3 * u, background: line }} />
      {bars.map((b, i) => {
        const s = Math.min(1, Math.max(0, spring({ frame: t - 4 - i * 6, fps, config: { damping: 16, stiffness: 140 } })))
        const lo = Math.min(b.from, b.to), hi = Math.max(b.from, b.to)
        const grow = b.kind === "down" ? { top: yv(hi), h: (yv(lo) - yv(hi)) * s } : { top: yv(lo) - (yv(lo) - yv(hi)) * s, h: (yv(lo) - yv(hi)) * s }
        const color = b.kind === "total" ? accent : b.kind === "down" ? tint(ink, 20) : b.kind === "up" ? mix(accent, "transparent", 55) : tint(ink, 45)
        const delta = b.kind === "up" ? `+${formatNumber(b.to - b.from)}` : b.kind === "down" ? `−${formatNumber(b.from - b.to)}` : formatNumber(b.to)
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: i * (bw + gap), width: bw, top: grow.top, height: Math.max(2, grow.h), borderRadius: 8 * u, background: color }} />
            {i < bars.length - 1 && b.kind !== "total" ? <div style={{ position: "absolute", left: i * (bw + gap) + bw, width: gap, top: yv(b.to), height: 2 * u, background: mute, opacity: ramp(t, 10 + i * 6, 6) }} /> : null}
            <div style={{ position: "absolute", left: i * (bw + gap) - 10 * u, width: bw + 20 * u, top: (b.kind === "down" ? yv(b.from) : yv(Math.max(b.from, b.to))) - 52 * u, textAlign: "center", opacity: ramp(t, 10 + i * 6, 8), ...label(display, (b.kind === "total" ? 40 : 32) * u, b.kind === "total" ? accent : ink, { fontWeight: 800, whiteSpace: "nowrap" }) }}>{delta}{unit}</div>
            <div style={{ position: "absolute", left: i * (bw + gap) - 8 * u, width: bw + 16 * u, top: plotB + 16 * u, textAlign: "center", ...label(font, 26 * u, b.kind === "total" ? ink : mute, { fontWeight: 600 }) }}>{b.label}</div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ---------- radar -----------------------------------------------------------------

/** A radar: the axes draw, a reference outline, then the main polygon grows over it. */
export function Radar({ axes, values, compare, valueLabel, compareLabel, max = 1, size = 760, at = 0, style }: Base & { axes: string[]; values: number[]; compare?: number[]; valueLabel?: string; compareLabel?: string; max?: number; size?: number }) {
  const t = useClock(at)
  const { u, fps, ink, mute, line, accent, font } = useStage()
  const S = size * u, c = S / 2, R = S * 0.36
  const n = axes.length
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2
  const poly = (vals: number[], k: number) => vals.map((v, i) => `${c + Math.cos(ang(i)) * R * (v / max) * k},${c + Math.sin(ang(i)) * R * (v / max) * k}`).join(" ")
  const grid = ramp(t, 0, 14)
  const cmp = Math.min(1, spring({ frame: t - 10, fps, config: { damping: 18, stiffness: 120 } }))
  const main = spring({ frame: t - 22, fps, config: { damping: 11, stiffness: 120 } })
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 * u, ...style }}>
      <div style={{ position: "relative", width: S, height: S }}>
        <svg width={S} height={S} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
          {[0.33, 0.66, 1].map((k) => <polygon key={k} points={poly(axes.map(() => max), k * grid)} fill="none" stroke={line} strokeWidth={2 * u} />)}
          {axes.map((_, i) => <line key={i} x1={c} y1={c} x2={c + Math.cos(ang(i)) * R * grid} y2={c + Math.sin(ang(i)) * R * grid} stroke={line} strokeWidth={2 * u} />)}
          {compare ? <polygon points={poly(compare, cmp)} fill={tint(ink, 6)} stroke={tint(ink, 45)} strokeWidth={4 * u} strokeDasharray={`${10 * u} ${8 * u}`} /> : null}
          <polygon points={poly(values, Math.max(0, main))} fill={tint(accent, 30)} stroke={accent} strokeWidth={7 * u} strokeLinejoin="round" />
        </svg>
        {axes.map((a, i) => {
          const x = c + Math.cos(ang(i)) * (R + 60 * u), y = c + Math.sin(ang(i)) * (R + 50 * u)
          return <div key={i} style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", whiteSpace: "nowrap", opacity: ramp(t, 6 + i * 2, 8), ...label(font, 30 * u, ink, { fontWeight: 700 }) }}>{a}</div>
        })}
      </div>
      {valueLabel || compareLabel ? (
        <div style={{ display: "flex", gap: 40 * u, opacity: ramp(t, 30, 10), ...label(font, 30 * u, mute, { fontWeight: 600 }) }}>
          {valueLabel ? <span><span style={{ display: "inline-block", width: 26 * u, height: 8 * u, background: accent, borderRadius: 4 * u, marginRight: 12 * u, verticalAlign: "middle" }} />{valueLabel}</span> : null}
          {compareLabel ? <span><span style={{ display: "inline-block", width: 26 * u, height: 0, borderTop: `${5 * u}px dashed ${tint(ink, 45)}`, marginRight: 12 * u, verticalAlign: "middle" }} />{compareLabel}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------- tally -----------------------------------------------------------------

/** Hand-drawn tally marks in fives, then the count lands big. */
export function Tally({ count: n, caption, width = 860, at = 0, every = 2, style }: Base & { count: number; caption?: string; width?: number; every?: number }) {
  const t = useClock(at)
  const { u, ink, mute, accent, font, display } = useStage()
  const W = width * u
  const markH = 120 * u, markGap = 26 * u, groupGap = 54 * u
  const groupW = markGap * 4 + groupGap
  const perRow = Math.max(1, Math.floor(W / groupW))
  const groups = Math.ceil(n / 5)
  const rows = Math.ceil(groups / perRow)
  const sw = 10 * u
  const doneAt = 4 + n * every
  const marks: React.ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const g = Math.floor(i / 5), k = i % 5
    const gx = (g % perRow) * groupW, gy = Math.floor(g / perRow) * (markH + 40 * u)
    const p = steppedRamp(t, 4 + i * every, 4 + i * every + 3, { step: 1 })
    if (p <= 0) continue
    const seed = `tally${i}`
    const a = k < 4 ? { x: gx + k * markGap + hashRange(`${seed}a`, -3, 3) * u, y: gy + hashRange(`${seed}b`, 0, 8) * u } : { x: gx - 16 * u, y: gy + markH * 0.75 }
    const b = k < 4 ? { x: gx + k * markGap + hashRange(`${seed}c`, -4, 4) * u, y: gy + markH } : { x: gx + markGap * 3 + 22 * u, y: gy + markH * 0.2 }
    marks.push(<path key={i} d={brushRibbon(sampleLine(a, b, 10), { strokeWidth: sw, pressure: 0.6, release: 1, progress: p })} fill={k === 4 ? accent : ink} filter={`url(#${brushFilterId("tally", sw, 1)})`} />)
  }
  const land = ramp(t, doneAt, 8)
  return (
    <div style={{ width: W, display: "flex", flexDirection: "column", alignItems: "center", gap: 40 * u, ...style }}>
      <svg width={Math.min(groups, perRow) * groupW - groupGap + 20 * u} height={rows * (markH + 40 * u)} style={{ overflow: "visible" }} aria-hidden>
        <BrushGrain seed="tally" strokeWidth={sw} grain={1} />
        {marks}
      </svg>
      <div style={{ ...label(display, 110 * u, accent, { fontWeight: 900, opacity: land, transform: `scale(${1.3 - 0.3 * OUT(land)})` }) }}>{formatNumber(n)}</div>
      {caption ? <div style={{ ...label(font, 40 * u, mute, { fontWeight: 600, opacity: ramp(t, doneAt + 6, 8) }) }}>{caption}</div> : null}
    </div>
  )
}

// ---------- stats -----------------------------------------------------------------

export type Stat = { value: number; label: string; prefix?: string; suffix?: string; decimals?: number }

/** Two to four big figures count up one after another, stacked for a vertical frame. */
export function Stats({ stats, width = 900, at = 0, every = 10, style }: Base & { stats: Stat[]; width?: number; every?: number }) {
  const t = useClock(at)
  const { u, ink, mute, accent, line, font, display } = useStage()
  return (
    <div style={{ width: width * u, display: "flex", flexDirection: "column", gap: 40 * u, ...style }}>
      {stats.map((s, i) => {
        const p = ramp(t, i * every, 8)
        return (
          <div key={i} style={{ opacity: p, transform: `translateY(${(1 - OUT(p)) * 40 * u}px)`, borderTop: i ? `${3 * u}px solid ${line}` : undefined, paddingTop: i ? 36 * u : 0 }}>
            <div style={{ ...label(display, 130 * u, i === 0 ? accent : ink, { fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }) }}>{s.prefix ?? ""}{count(t, s.value, i * every, 30, s.decimals ?? 0)}{s.suffix ?? ""}</div>
            <div style={{ ...label(font, 38 * u, mute, { fontWeight: 600, marginTop: 10 * u }) }}>{s.label}</div>
          </div>
        )
      })}
    </div>
  )
}
