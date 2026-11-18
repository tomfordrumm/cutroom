// Two app scenes that are not about software: booking a session and finishing a
// lesson with a streak. After remocn calendar-booking and streak-reward (MIT).
import React from "react"
import { Easing, interpolate, spring } from "remotion"
import { Cursor, Icon, palette } from "../kit"
import { CLAMP, kick, ramp, tint, useClock, useStage } from "./common"
import { cursorPath } from "../moves"

const OUT = Easing.bezier(0.22, 1, 0.36, 1)
type Base = { at?: number; style?: React.CSSProperties }

/**
 * A booking card: who and what on top, a day and its time slots; the cursor picks
 * a slot, presses «Записаться», the card turns into a confirmation.
 */
export function Booking({ host, event, day, slots, pick = 0, button = "Записаться", booked = "Вы записаны", width = 860, at = 0, style }: Base & { host: string; event: string; day: string; slots: string[]; pick?: number; button?: string; booked?: string; width?: number }) {
  const t = useClock(at)
  const { u, fps, theme, font, display } = useStage()
  const c = palette(theme, "auto")
  const W = width * u
  const cols = 3
  const slotW = (W - 80 * u - 20 * u * (cols - 1)) / cols, slotH = 92 * u
  const slotsTop = 300 * u
  const pr = Math.floor(pick / cols), pc = pick % cols
  const slotX = 40 * u + pc * (slotW + 20 * u) + slotW / 2, slotY = slotsTop + pr * (slotH + 20 * u) + slotH / 2
  const rows = Math.ceil(slots.length / cols)
  const btnY = slotsTop + rows * (slotH + 20 * u) + 30 * u + 55 * u
  const cur = cursorPath(t, [{ x: W * 0.9, y: btnY + 200 * u, at: 0 }, { x: slotX, y: slotY, at: 22, click: true }, { x: W / 2, y: btnY, at: 44, click: true }, { x: W / 2 + 40 * u, y: btnY + 60 * u, at: 60 }])
  const chosen = t >= 24
  const confirm = spring({ frame: t - 50, fps, config: { damping: 15, stiffness: 140 } })
  const cf = Math.min(1, Math.max(0, confirm))
  const H = btnY + 90 * u
  return (
    <div style={{ position: "relative", width: W, height: H, borderRadius: theme.radius * u * 1.4, background: c.surface, color: c.text, fontFamily: c.font, boxShadow: `0 ${24 * u}px ${70 * u}px rgba(0,0,0,.2)`, overflow: "hidden", opacity: ramp(t, 0, 8), ...style }}>
      <div style={{ position: "absolute", inset: 0, padding: 40 * u, opacity: 1 - cf }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 * u }}>
          <div style={{ width: 84 * u, height: 84 * u, borderRadius: 42 * u, background: c.accent, color: c.onAccent, display: "grid", placeItems: "center", fontFamily: display, fontWeight: 900, fontSize: 40 * u }}>{host.slice(0, 1)}</div>
          <div><div style={{ fontWeight: 800, fontSize: 40 * u }}>{event}</div><div style={{ fontSize: 30 * u, color: c.mute }}>{host}</div></div>
        </div>
        <div style={{ marginTop: 50 * u, fontWeight: 800, fontSize: 34 * u }}>{day}</div>
      </div>
      {slots.map((s, i) => {
        const r = Math.floor(i / cols), k = i % cols
        const sel = chosen && i === pick
        return <div key={i} style={{ position: "absolute", left: 40 * u + k * (slotW + 20 * u), top: slotsTop + r * (slotH + 20 * u), width: slotW, height: slotH, borderRadius: 18 * u, border: `${3 * u}px solid ${sel ? c.accent : c.line}`, background: sel ? c.accent : "transparent", color: sel ? c.onAccent : c.text, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 34 * u, opacity: ramp(t, 4 + i * 1.5, 6) * (1 - cf), transform: `scale(${1 + 0.06 * (sel ? kick(t - 24, 6) : 0)})` }}>{s}</div>
      })}
      <div style={{ position: "absolute", left: 40 * u, right: 40 * u, top: btnY - 55 * u, height: 110 * u, borderRadius: 22 * u, background: chosen ? c.accent : c.subtle, color: chosen ? c.onAccent : c.mute, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 38 * u, opacity: 1 - cf, transform: `scale(${1 - 0.04 * kick(t - 46, 5)})` }}>{button}</div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 * u, opacity: cf, transform: `scale(${0.9 + 0.1 * cf})` }}>
        <div style={{ width: 150 * u, height: 150 * u, borderRadius: 75 * u, background: c.accent, color: c.onAccent, display: "grid", placeItems: "center", transform: `scale(${0.6 + 0.4 * cf + 0.1 * kick(t - 56, 8)})` }}><Icon name="check" size={90} strokeWidth={2.6} /></div>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: 60 * u }}>{booked}</div>
        <div style={{ fontSize: 36 * u, color: c.mute, textAlign: "center" }}>{event}<br />{day}, {slots[pick]}</div>
      </div>
      {cf < 0.5 ? <Cursor x={cur.x} y={cur.y} press={cur.press} /> : null}
    </div>
  )
}

/**
 * Lesson complete: a badge pops, stats count up, the week's streak fills day by day
 * and the last day flares.
 */
export function Streak({ title = "Урок пройден", streak, days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], done, stats = [], cta = "Продолжить", width = 860, at = 0, style }: Base & { title?: string; streak: number; days?: string[]; done: number; stats?: { label: string; value: string }[]; cta?: string; width?: number }) {
  const t = useClock(at)
  const { u, fps, theme, display } = useStage()
  const c = palette(theme, "auto")
  const W = width * u
  const badge = spring({ frame: t - 2, fps, config: { damping: 10, stiffness: 180 } })
  const fillAt = 20 + stats.length * 6
  return (
    <div style={{ width: W, padding: 44 * u, borderRadius: theme.radius * u * 1.4, background: c.surface, color: c.text, fontFamily: c.font, boxShadow: `0 ${24 * u}px ${70 * u}px rgba(0,0,0,.2)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 34 * u, opacity: ramp(t, 0, 6), ...style }}>
      <div style={{ width: 170 * u, height: 170 * u, borderRadius: 48 * u, background: c.accent, color: c.onAccent, display: "grid", placeItems: "center", transform: `scale(${Math.max(0, badge)}) rotate(${(1 - Math.min(1, badge)) * -20}deg)` }}><Icon name="star" size={100} strokeWidth={2.2} /></div>
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: 64 * u, textAlign: "center", opacity: ramp(t, 8, 8) }}>{title}</div>
      {stats.length ? (
        <div style={{ display: "flex", gap: 20 * u, width: "100%" }}>
          {stats.map((s, i) => {
            const p = spring({ frame: t - 14 - i * 6, fps, config: { damping: 13, stiffness: 200 } })
            return <div key={i} style={{ flex: 1, padding: `${22 * u}px ${12 * u}px`, borderRadius: 22 * u, background: c.subtle, textAlign: "center", transform: `scale(${Math.max(0, Math.min(1.05, p))})` }}><div style={{ fontFamily: display, fontWeight: 900, fontSize: 48 * u, color: c.accent }}>{s.value}</div><div style={{ fontSize: 26 * u, color: c.mute, fontWeight: 600 }}>{s.label}</div></div>
          })}
        </div>
      ) : null}
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 * u, opacity: ramp(t, fillAt - 6, 8) }}>
          <span style={{ fontWeight: 800, fontSize: 34 * u }}>Серия</span>
          <span style={{ fontFamily: display, fontWeight: 900, fontSize: 44 * u, color: c.accent }}>{Math.round(interpolate(t, [fillAt, fillAt + done * 5], [Math.max(0, streak - done), streak], { ...CLAMP, easing: OUT }))} дн.</span>
        </div>
        <div style={{ display: "flex", gap: 12 * u }}>
          {days.map((d, i) => {
            const on = i < done && t >= fillAt + i * 5
            const last = i === done - 1
            return (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: 70 * u, borderRadius: 18 * u, background: on ? c.accent : c.subtle, color: c.onAccent, display: "grid", placeItems: "center", transform: `scale(${on ? 1 + (last ? 0.18 : 0.08) * kick(t - fillAt - i * 5, 7) : 1})`, boxShadow: on && last ? `0 0 ${30 * u}px ${tint(c.accent, 70)}` : undefined }}>{on ? <Icon name="check" size={40} strokeWidth={2.6} /> : null}</div>
                <div style={{ fontSize: 24 * u, color: c.mute, marginTop: 8 * u, fontWeight: 600 }}>{d}</div>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ width: "100%", height: 104 * u, borderRadius: 24 * u, background: c.accent, color: c.onAccent, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 38 * u, opacity: ramp(t, fillAt + done * 5 + 4, 8) }}>{cta}</div>
    </div>
  )
}
