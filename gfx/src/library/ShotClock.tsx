// A shot clock: whole seconds tick down, the last ones turn to tenths in the
// alarm colour, the buzzer flashes, the clock shrinks up and the title slams in.
// Adapted from remocn shot-clock (MIT, see LICENSE-remocn.md).
import React from "react"
import { Easing, interpolate } from "remotion"
import { CLAMP, kick, ramp, tint, useClock, useStage } from "./common"

export type ShotClockProps = {
  /** Seconds on the clock at the start. */
  from?: number
  /** Below this the clock shows tenths and turns to the alarm colour. */
  tenthsBelow?: number
  /** Frames per whole second on screen (the clock runs faster than real time). */
  tick?: number
  /** Frames per tenth below `tenthsBelow`. */
  tenth?: number
  /** The word that slams in at zero; "" — no title, the clock stays. */
  title?: string
  subtitle?: string
  /** Small labels over the clock. */
  label?: string
  period?: string
  /** Colour of the last seconds and the buzzer light. */
  alarm?: string
  /** Width of the block, px at 1080. */
  width?: number
  at?: number
  /** Frames the zero holds before the clock shrinks away. */
  hold?: number
  speed?: number
  style?: React.CSSProperties
}

const TICK_AT = 14
const SHRINK_LEN = 11
const SLAM = Easing.bezier(0.22, 1, 0.36, 1)
const MOVE = Easing.bezier(0.7, 0, 0.2, 1)

export function ShotClock({ from = 24, tenthsBelow = 5, tick = 2.6, tenth = 1, title = "", subtitle = "", label = "", period = "", alarm, width = 900, at = 0, hold = 6, speed = 1, style }: ShotClockProps) {
  // Starts two frames in, so the first frame already shows the drop.
  const t = useClock(at, speed) + 2
  const { u, ink, mute, accent, font, display } = useStage()
  const red = alarm ?? accent
  const W = width * u
  const H = W * (title ? 1.05 : 0.72)
  const k = W / 820
  const start = Math.max(tenthsBelow + 1, Math.floor(from))
  const redAt = TICK_AT + (start - tenthsBelow) * tick
  const buzzAt = redAt + tenthsBelow * 10 * tenth

  let tenths: number
  if (t < TICK_AT) tenths = start * 10
  else if (t < redAt) tenths = (start - Math.floor((t - TICK_AT) / tick)) * 10
  else tenths = Math.max(0, tenthsBelow * 10 - Math.floor((t - redAt) / tenth))
  const isRed = t >= redAt
  const buzzed = t >= buzzAt
  const text = isRed ? `${Math.floor(tenths / 10)},${tenths % 10}` : `${Math.round(tenths / 10)}`
  const remaining = interpolate(t, [TICK_AT, redAt, buzzAt], [start, tenthsBelow, 0], CLAMP)

  const clockFs = 380 * k
  const cx = W / 2
  const clockCY = title ? H * 0.42 : H * 0.55
  const lightY = clockCY - 0.5 * clockFs - 34 * k
  const barY = clockCY + 0.5 * clockFs + 18 * k
  const drop = SLAM(ramp(t, 0, 9))
  const draw = SLAM(ramp(t, 2, 12))
  const labelsIn = ramp(t, 5, 8)
  const redKick = kick(t - redAt, 8)
  const buzzKick = kick(t - buzzAt, 10)
  const flash = buzzed ? kick(t - buzzAt, 9) : 0
  const shrink = title ? MOVE(ramp(t, buzzAt + hold, SHRINK_LEN)) : 0
  const push = Easing.bezier(0.65, 0, 0.35, 1)(ramp(t, TICK_AT, buzzAt - TICK_AT))
  const groupScale = interpolate(shrink, [0, 1], [1 + 0.07 * push, 0.38]) * (1 + 0.03 * redKick + 0.04 * buzzKick)
  const groupDY = interpolate(shrink, [0, 1], [0, H * 0.1 - clockCY])
  const sideFade = 1 - ramp(shrink, 0, 0.4)
  const titleAt = buzzAt + hold + SHRINK_LEN - 4
  const titleIn = SLAM(ramp(t, titleAt, 7))
  const subIn = SLAM(ramp(t, titleAt + 4, 9))
  const titleHit = kick(t - (titleAt + 3), 8)
  const titleFs = Math.min(200 * k, (W * 0.96) / Math.max(1, title.length * 0.62))
  const small: React.CSSProperties = { fontFamily: font, fontWeight: 500, fontSize: 22 * k, letterSpacing: "0.14em", textTransform: "uppercase", color: mute }

  return (
    <div style={{ position: "relative", width: W, height: H, ...style }}>
      <div style={{ position: "absolute", inset: `${-0.3 * H}px ${-0.2 * W}px`, background: `radial-gradient(60% 50% at 50% 70%, ${tint(red, 45)} 0%, transparent 70%)`, opacity: 0.8 * ramp(t, buzzAt, 6) * (title ? 1 : 0.6) + flash * 0.4, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${groupDY}px) scale(${groupScale})`, transformOrigin: `${cx}px ${clockCY}px` }}>
        <div style={{ position: "absolute", left: cx - (W / 2) * draw, top: lightY, width: W * draw, height: 14 * k, borderRadius: 7 * k, background: buzzed ? red : tint(ink, 14) }} />
        {label ? <div style={{ ...small, position: "absolute", left: 0, top: lightY - 44 * k, opacity: labelsIn * sideFade }}>{label}</div> : null}
        {period ? (
          <div style={{ ...small, position: "absolute", right: 0, top: lightY - 44 * k, opacity: labelsIn * sideFade, display: "flex", alignItems: "center", gap: 10 * k }}>
            <div style={{ width: 10 * k, height: 10 * k, borderRadius: 5 * k, background: accent, opacity: buzzed ? 0 : Math.floor(t / 15) % 2 === 0 ? 1 : 0.35 }} />
            {period}
          </div>
        ) : null}
        <div style={{ position: "absolute", left: 0, right: 0, top: clockCY - clockFs / 2, height: clockFs, display: "flex", justifyContent: "center", alignItems: "center", fontFamily: display, fontWeight: 700, fontSize: clockFs, lineHeight: 1, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", color: isRed ? red : ink, transform: `translateY(${-(1 - drop) * 90 * k}px)`, opacity: drop }}>
          {text}
        </div>
        <div style={{ position: "absolute", left: cx - (W / 2) * draw, top: barY, width: W * draw, height: 8 * k, borderRadius: 4 * k, background: tint(ink, 12), opacity: sideFade }}>
          <div style={{ position: "absolute", left: `${50 - 50 * (remaining / start)}%`, width: `${100 * (remaining / start)}%`, top: 0, bottom: 0, borderRadius: 4 * k, background: isRed ? red : ink }} />
        </div>
      </div>
      {title ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: H * 0.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * k }}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: titleFs, lineHeight: 0.95, letterSpacing: "-0.03em", textTransform: "uppercase", color: ink, whiteSpace: "nowrap", opacity: titleIn, transform: `translateY(${(1 - titleIn) * 60 * k}px) scale(${(1.25 - 0.25 * titleIn) * (1 + 0.04 * titleHit)})` }}>{title}</div>
          {subtitle ? <div style={{ fontFamily: font, fontWeight: 500, fontSize: 40 * k, color: mute, opacity: subIn, transform: `translateY(${(1 - subIn) * 20 * k}px)` }}>{subtitle}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
