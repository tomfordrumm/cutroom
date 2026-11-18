// Before and after on one picture: the frame lands, a grip appears, the divider
// sweeps to the middle, rests, then uncovers the after side completely.
// Adapted from remocn before-after (MIT, see LICENSE-remocn.md).
import React from "react"
import { Easing, Img, interpolate, spring } from "remotion"
import { CLAMP, tint, useClock, useStage } from "./common"

export type BeforeAfterProps = {
  /** URL of the before picture (props.files of the element). Without it the after picture is shown flat and grey. */
  before?: string
  /** URL of the after picture. Or pass your own drawing as `afterNode` / `beforeNode`. */
  after?: string
  beforeNode?: React.ReactNode
  afterNode?: React.ReactNode
  beforeLabel?: string
  afterLabel?: string
  /** A line above the frame. */
  title?: string
  /** Width of the frame, px at 1080. */
  width?: number
  /** Width / height of the frame. */
  aspect?: number
  fit?: "cover" | "contain"
  /** Where the divider rests, 0 (all after) – 1 (all before). */
  pauseAt?: number
  /** Frames the divider rests before uncovering the after side. */
  hold?: number
  at?: number
  speed?: number
  style?: React.CSSProperties
}

const ENTER = Easing.bezier(0.32, 0.72, 0, 1)
const EXIT = Easing.bezier(0.55, 0, 1, 0.45)
const HEAVY = { mass: 1, damping: 26, stiffness: 120 }
const CARD = { mass: 0.8, damping: 18, stiffness: 160 }
const CHIP = { mass: 0.5, damping: 12, stiffness: 200 }
const MORPH = { damping: 200 }
const BEAT = { title: 4, grip: 18, leg1: 24 }
const FLAT = "grayscale(0.85) contrast(0.78) brightness(0.9)"

function Chevrons({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 7.5 5 12l4.5 4.5" /><path d="M14.5 7.5 19 12l-4.5 4.5" />
    </svg>
  )
}

export function BeforeAfter({ before, after, beforeNode, afterNode, beforeLabel = "До", afterLabel = "После", title, width = 860, aspect = 4 / 5, fit = "cover", pauseAt = 0.5, hold = 54, at = 0, speed = 1, style }: BeforeAfterProps) {
  const frame = useClock(at, speed)
  const { u, fps, theme, ink, accent, font, display } = useStage()
  const W = width * u
  const H = W / aspect
  const radius = theme.radius * u
  const spr = (start: number, config: Record<string, number>) => spring({ frame: frame - start, fps, config })
  const leg2At = BEAT.leg1 + hold
  const gripOutAt = leg2At + 26

  const enter = spr(0, HEAVY)
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { ...CLAMP, easing: ENTER })
  const titleT = interpolate(frame, [BEAT.title, BEAT.title + 16], [0, 1], { ...CLAMP, easing: ENTER })
  const leg1 = spr(BEAT.leg1, CARD)
  const leg2 = spr(leg2At, MORPH)
  const pos = frame >= leg2At ? pauseAt * (1 - leg2) : 1 - (1 - pauseAt) * leg1
  const push = interpolate(frame, [0, 150], [1, 1.02], CLAMP)
  const gripIn = spr(BEAT.grip, CHIP)
  const gripOut = interpolate(frame, [gripOutAt, gripOutAt + 8], [0, 1], { ...CLAMP, easing: EXIT })
  const pressed = 1 - 0.04 * (spr(BEAT.leg1 - 5, CHIP) - spr(BEAT.leg1 + 1, CHIP))
  const grip = Math.min(1, gripIn) * (1 - gripOut)
  const divX = Math.max(0, Math.min(1, pos)) * W
  const capsIn = interpolate(frame, [BEAT.leg1, BEAT.leg1 + 12], [0, 1], { ...CLAMP, easing: ENTER })
  const gripD = 84 * u
  const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit }
  const afterLayer = afterNode ?? (after ? <Img src={after} style={fill} /> : null)
  const beforeLayer = beforeNode ?? (before ? <Img src={before} style={fill} /> : after ? <Img src={after} style={{ ...fill, filter: FLAT }} /> : null)
  const chip = (text: string, side: "left" | "right", visible: number): React.CSSProperties => ({
    position: "absolute", top: 28 * u, [side]: 28 * u, padding: `${12 * u}px ${24 * u}px`, borderRadius: 999,
    background: side === "right" ? accent : "rgba(10,10,12,0.62)", color: side === "right" ? theme.accentForeground : "#F5F5F5",
    fontFamily: font, fontWeight: 700, fontSize: 40 * u, whiteSpace: "nowrap", opacity: capsIn * visible,
  })

  return (
    <div style={{ position: "relative", width: W, display: "flex", flexDirection: "column", alignItems: "center", gap: 36 * u, ...style }}>
      {title ? (
        <div style={{ overflow: "hidden", maxWidth: W }}>
          <div style={{ fontFamily: display, fontWeight: 600, fontSize: 64 * u, lineHeight: 1.1, letterSpacing: "-0.03em", color: ink, textAlign: "center", transform: `translateY(${(1 - titleT) * 105}%)` }}>{title}</div>
        </div>
      ) : null}
      <div style={{ position: "relative", width: W, height: H, borderRadius: radius, overflow: "hidden", background: tint(ink, 8), boxShadow: `0 18px 40px -12px rgba(0,0,0,0.45), 0 50px 110px -40px rgba(0,0,0,0.6)`, opacity: fadeIn, transform: `translateY(${(1 - enter) * 40 * u}px) scale(${(0.96 + enter * 0.04) * push})` }}>
        {afterLayer}
        <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(100 - (divX / W) * 100).toFixed(4)}% 0 0)` }}>{beforeLayer}</div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: divX - 1.5 * u, width: 3 * u, background: "rgba(255,255,255,0.95)", boxShadow: "0 0 12px rgba(0,0,0,0.3)", opacity: grip }} />
        <div style={{ position: "absolute", left: divX - gripD / 2, top: H / 2 - gripD / 2, width: gripD, height: gripD, borderRadius: gripD, background: "#FFFFFF", boxShadow: "0 1px 2px rgba(0,0,0,0.25), 0 8px 20px -6px rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", opacity: grip, transform: `scale(${(0.6 + 0.4 * gripIn) * pressed})` }}>
          <Chevrons size={gripD * 0.56} color="#2A2A30" />
        </div>
        <div style={chip(beforeLabel, "left", interpolate(divX / W, [0.12, 0.3], [0, 1], CLAMP))}>{beforeLabel}</div>
        <div style={chip(afterLabel, "right", interpolate(divX / W, [0.7, 0.88], [1, 0], CLAMP))}>{afterLabel}</div>
        <div style={{ position: "absolute", inset: 0, borderRadius: radius, boxShadow: `inset 0 0 0 ${Math.max(1, u)}px rgba(255,255,255,0.1)`, pointerEvents: "none" }} />
      </div>
    </div>
  )
}
