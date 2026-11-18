// Time: a monumental countdown in a ring, a clock hand sweeping a wedge, a month
// calendar picking days. After remocn countdown, clock-sweep and calendar-pick (MIT).
import React from "react"
import { Easing, interpolate, spring } from "remotion"
import { CLAMP, kick, ramp, tint, useClock, useStage } from "./common"

const OUT = Easing.bezier(0.22, 1, 0.36, 1)
const IO = Easing.bezier(0.65, 0, 0.35, 1)
type Base = { at?: number; style?: React.CSSProperties }

/** A big numeral counts down inside a ring that drains with it, then the final word lands. */
export function Countdown({ from = 3, every = 18, final, caption, size = 760, at = 0, style }: Base & { from?: number; every?: number; final?: string; caption?: string; size?: number }) {
  const t = useClock(at)
  const { u, fps, ink, mute, accent, font, display } = useStage()
  const S = size * u, R = S * 0.42, C = 2 * Math.PI * R
  const end = from * every
  const step = Math.min(from - 1, Math.floor(t / every))
  const n = from - step
  const local = t - step * every
  const pop = spring({ frame: local, fps, config: { damping: 11, stiffness: 220 } })
  const drain = interpolate(t, [0, end], [1, 0], CLAMP)
  const done = t >= end && !!final
  const land = spring({ frame: t - end, fps, config: { damping: 12, stiffness: 180 } })
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 * u, ...style }}>
      <div style={{ position: "relative", width: S, height: S }}>
        <svg width={S} height={S} style={{ position: "absolute", inset: 0 }} aria-hidden>
          <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={tint(ink, 10)} strokeWidth={14 * u} />
          <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={accent} strokeWidth={14 * u} strokeLinecap="round" strokeDasharray={`${drain * C} ${C}`} transform={`rotate(-90 ${S / 2} ${S / 2})`} opacity={done ? 1 - ramp(t, end, 8) : 1} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: display, fontWeight: 900, color: done ? accent : ink, fontSize: done ? Math.min(S * 0.3, (S * 0.9) / Math.max(1, (final ?? "").length * 0.6)) : S * 0.52, lineHeight: 1, fontVariantNumeric: "tabular-nums", transform: `scale(${done ? 0.6 + 0.4 * land : 1.25 - 0.25 * Math.min(1, pop)})`, opacity: done ? Math.min(1, land) : Math.min(1, pop * 1.5) * (1 - ramp(local, every - 4, 4) * (n > 1 || final ? 0.6 : 0)) }}>
          {done ? final : n}
        </div>
      </div>
      {caption ? <div style={{ fontFamily: font, fontWeight: 600, fontSize: 40 * u, color: mute, opacity: ramp(t, 4, 8) }}>{caption}</div> : null}
    </div>
  )
}

/** A clock face: the hand sweeps from `from` to `to` minutes, filling the wedge; the line under it lands. */
export function ClockSweep({ from = 0, to = 15, label, caption, size = 680, at = 0, sweep = 40, style }: Base & { from?: number; to?: number; label?: string; caption?: string; size?: number; sweep?: number }) {
  const t = useClock(at)
  const { u, theme, ink, mute, accent, font, display } = useStage()
  const S = size * u, c = S / 2, R = S * 0.44
  const p = interpolate(t, [8, 8 + sweep], [0, 1], { ...CLAMP, easing: IO })
  const a0 = (from / 60) * Math.PI * 2, a1 = a0 + ((to - from) / 60) * Math.PI * 2 * p
  const pt = (a: number, r: number) => ({ x: c + Math.sin(a) * r, y: c - Math.cos(a) * r })
  const s = pt(a0, R * 0.92), e = pt(a1, R * 0.92)
  const wedge = `M ${c} ${c} L ${s.x} ${s.y} A ${R * 0.92} ${R * 0.92} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${e.x} ${e.y} Z`
  const hand = pt(a1, R * 0.78)
  const land = ramp(t, 8 + sweep, 10)
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36 * u, ...style }}>
      <svg width={S} height={S} aria-hidden style={{ overflow: "visible" }}>
        <circle cx={c} cy={c} r={R} fill={theme.card} stroke={tint(ink, 20)} strokeWidth={6 * u} />
        {Array.from({ length: 12 }, (_, i) => { const a = pt((i / 12) * Math.PI * 2, R * 0.86), b = pt((i / 12) * Math.PI * 2, R * 0.95); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tint(theme.cardForeground, 45)} strokeWidth={(i % 3 ? 3 : 6) * u} strokeLinecap="round" /> })}
        {p > 0 ? <path d={wedge} fill={tint(accent, 45)} /> : null}
        <line x1={c} y1={c} x2={hand.x} y2={hand.y} stroke={accent} strokeWidth={12 * u} strokeLinecap="round" />
        <circle cx={c} cy={c} r={16 * u} fill={accent} />
      </svg>
      {label ? <div style={{ fontFamily: display, fontWeight: 900, fontSize: 90 * u, lineHeight: 1, color: ink, opacity: land, transform: `translateY(${(1 - OUT(land)) * 30 * u}px)` }}>{label}</div> : null}
      {caption ? <div style={{ fontFamily: font, fontWeight: 600, fontSize: 38 * u, color: mute, textAlign: "center", opacity: ramp(t, 14 + sweep, 10) }}>{caption}</div> : null}
    </div>
  )
}

/**
 * A month calendar: days appear in a ripple, the marked days get tags one by one,
 * the picked day is circled in the accent.
 */
export function Calendar({ month, startsOn = 0, days = 30, marks = [], pick, width = 900, at = 0, style }: Base & { month: string; startsOn?: number; days?: number; marks?: { day: number; label: string }[]; pick?: number; width?: number }) {
  const t = useClock(at)
  const { u, fps, theme, ink, mute, line, accent, font, display } = useStage()
  const W = width * u, cell = W / 7
  const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
  const rows = Math.ceil((startsOn + days) / 7)
  const markAt = 18
  const pickAt = markAt + marks.length * 6 + 6
  const ring = spring({ frame: t - pickAt, fps, config: { damping: 12, stiffness: 180 } })
  return (
    <div style={{ width: W, padding: `${30 * u}px 0`, borderRadius: theme.radius * u * 1.4, background: theme.card, color: theme.cardForeground, boxShadow: `0 ${20 * u}px ${60 * u}px rgba(0,0,0,0.18)`, opacity: ramp(t, 0, 8), ...style }}>
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: 56 * u, padding: `0 ${cell * 0.3}px ${20 * u}px` }}>{month}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {names.map((n) => <div key={n} style={{ textAlign: "center", fontFamily: font, fontWeight: 700, fontSize: 26 * u, color: tint(theme.cardForeground, 50), paddingBottom: 14 * u }}>{n}</div>)}
        {Array.from({ length: rows * 7 }, (_, k) => {
          const day = k - startsOn + 1
          if (day < 1 || day > days) return <div key={k} />
          const row = Math.floor(k / 7), colI = k % 7
          const show = ramp(t, 2 + (row + colI) * 1.2, 6)
          const mi = marks.findIndex((m) => m.day === day)
          const tag = mi >= 0 ? spring({ frame: t - markAt - mi * 6, fps, config: { damping: 12, stiffness: 200 } }) : 0
          const picked = day === pick
          return (
            <div key={k} style={{ position: "relative", height: cell * 0.95, display: "grid", placeItems: "center", opacity: show }}>
              {picked ? <div style={{ position: "absolute", width: cell * 0.78, height: cell * 0.78, borderRadius: cell, background: accent, transform: `scale(${Math.max(0, ring)})` }} /> : null}
              <span style={{ position: "relative", fontFamily: display, fontWeight: picked || mi >= 0 ? 900 : 600, fontSize: 38 * u, color: picked && ring > 0.5 ? theme.accentForeground : mi >= 0 ? accent : theme.cardForeground }}>{day}</span>
              {mi >= 0 ? <span style={{ position: "absolute", bottom: 2 * u, left: "50%", transform: `translateX(-50%) scale(${Math.max(0, tag)})`, padding: `${2 * u}px ${8 * u}px`, borderRadius: 8 * u, background: tint(accent, 20), color: accent, fontFamily: font, fontWeight: 700, fontSize: 18 * u, whiteSpace: "nowrap" }}>{marks[mi].label}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
