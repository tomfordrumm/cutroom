// A line strikes the old words out, then the new ones take their place:
// myth → fact, mistake → the right way. Adapted from remocn strikethrough-replace (MIT).
import React from "react"
import { interpolate } from "remotion"
import { CLAMP, useClock, useStage } from "./common"

export type StrikeReplaceProps = {
  /** The old words, one short line. */
  from: string
  /** The new words, one short line. */
  to: string
  /** Font size, px at 1080. */
  size?: number
  /** Element frame the strike starts. */
  at?: number
  /** Frames the line takes to cross the old words. */
  strike?: number
  /** Frames the old words are held struck before they leave. */
  hold?: number
  /** Frames of the swap. */
  swap?: number
  color?: string
  lineColor?: string
  fontWeight?: number
  speed?: number
  style?: React.CSSProperties
}

export function StrikeReplace({ from, to, size = 88, at = 0, strike = 14, hold = 12, swap = 10, color, lineColor, fontWeight = 700, speed = 1, style }: StrikeReplaceProps) {
  const t = useClock(at, speed)
  const { u, ink, accent, display } = useStage()
  const fs = size * u
  const swapAt = strike + hold
  const line = interpolate(t, [0, strike], [0, 100], CLAMP)
  const fromOpacity = interpolate(t, [swapAt, swapAt + swap], [1, 0], CLAMP)
  const toIn = interpolate(t, [swapAt, swapAt + swap], [0, 1], CLAMP)
  const text: React.CSSProperties = { gridArea: "1 / 1", fontFamily: display, fontSize: fs, fontWeight, lineHeight: 1.1, letterSpacing: "-0.03em", color: color ?? ink, whiteSpace: "nowrap", justifySelf: "center" }
  return (
    <div style={{ display: "inline-grid", alignItems: "center", ...style }}>
      <span style={{ ...text, position: "relative", opacity: fromOpacity, color: tint50(color ?? ink, line) }}>
        {from}
        <span aria-hidden style={{ position: "absolute", left: "-2%", top: "54%", height: Math.max(3, Math.round(fs * 0.09)), width: `${line * 1.04}%`, background: lineColor ?? accent, transform: "translateY(-50%) rotate(-1.5deg)", borderRadius: fs }} />
      </span>
      <span style={{ ...text, opacity: toIn, transform: `translateY(${(1 - toIn) * 0.12 * fs}px)` }}>{to}</span>
    </div>
  )
}

/** The struck words fade toward grey as the line crosses them. */
const tint50 = (hex: string, line: number) => `color-mix(in srgb, ${hex} ${100 - line * 0.45}%, transparent)`
